import { runTerminalSession } from "./session.ts";
import type { TerminalSessionResult } from "./session.ts";

export type AttachOptions = {
  title?: string;
};

type ContainerState = {
  Status: string;
  Running: boolean;
  Restarting: boolean;
  Pid?: number;
  StartedAt?: string;
  FinishedAt?: string;
};

const decoder = new TextDecoder();
const REATTACH_TIMEOUT_MS = 120_000;
const REATTACH_POLL_INTERVAL_MS = 2_000;
const DETACH_KEYS = "ctrl-c";

export async function attachContainerConsole(
  containerName: string,
  options: AttachOptions = {},
) {
  const title = options.title ?? containerName;
  let attempt = 0;
  let pendingExitReason: ExitReason | null = null;

  while (true) {
    attempt++;
    if (pendingExitReason) {
      const ready = await waitForContainerRunning(containerName);
      if (!ready) {
        console.log(
          `${title}: ${
            describeExitReason(pendingExitReason)
          } Container did not restart within ${
            REATTACH_TIMEOUT_MS / 1000
          } seconds. Console session will exit.`,
        );
        break;
      }
      pendingExitReason = null;
    }

    const sessionState = await inspectContainerState(containerName);
    if (!sessionState || !isStateRunning(sessionState)) {
      console.log(
        `${title}: Container is not running. Console session ended.`,
      );
      break;
    }
    const sessionPid = typeof sessionState.Pid === "number"
      ? sessionState.Pid
      : null;

    const startMessage = attempt > 1
      ? `${title}: Reattaching to container console (attempt ${attempt}).`
      : undefined;

    const result = await runTerminalSession({
      title,
      command: "docker",
      args: [
        "attach",
        "--sig-proxy=false",
        `--detach-keys=${DETACH_KEYS}`,
        containerName,
      ],
      startMessage,
      exitMessage: null,
    });

    const state = await inspectContainerState(containerName);
    const exitReason = classifyExit(result, state, sessionPid);
    if (exitReason.kind === "manual") {
      return;
    }

    console.log(
      `${title}: ${
        describeExitReason(exitReason)
      } Waiting for Docker to restart...`,
    );
    pendingExitReason = exitReason;
  }

  console.log(`${title}: Console closed.`);
}

async function inspectContainerState(
  containerName: string,
): Promise<ContainerState | null> {
  const command = new Deno.Command("docker", {
    args: ["inspect", "--format", "{{json .State}}", containerName],
  });

  try {
    const { success, stdout } = await command.output();
    if (!success) return null;
    const text = decoder.decode(stdout).trim();
    if (!text) return null;
    return JSON.parse(text) as ContainerState;
  } catch (_error) {
    return null;
  }
}

async function waitForContainerRunning(
  containerName: string,
): Promise<boolean> {
  const deadline = Date.now() + REATTACH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await inspectContainerState(containerName);
    if (!state) return false;
    if (state.Status === "running" && state.Running) {
      return true;
    }
    if (!state.Restarting && state.Status !== "created") {
      return false;
    }
    await delay(REATTACH_POLL_INTERVAL_MS);
  }
  return false;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ExitReason =
  | { kind: "manual" }
  | { kind: "graceful"; code: number | null }
  | { kind: "signal"; code: number | null; signal?: string | null }
  | { kind: "error"; code: number | null; signal?: string | null };

function classifyExit(
  result: TerminalSessionResult,
  state: ContainerState | null,
  sessionPid: number | null,
): ExitReason {
  const { interrupted, status } = result;
  if (interrupted) {
    return { kind: "manual" };
  }

  const code = typeof status.code === "number" ? status.code : null;
  const signal = status.signal ?? null;
  const containerRunning = isStateRunning(state);
  if (
    containerRunning && sessionPid !== null && typeof state?.Pid === "number" &&
    state.Pid === sessionPid
  ) {
    return { kind: "manual" };
  }

  if (status.success) {
    return { kind: "graceful", code };
  }

  const manualDetachCodes = new Set([130, 131]);
  if (code !== null && manualDetachCodes.has(code)) {
    return { kind: "manual" };
  }

  if (code !== null && (code === 137 || code === 143)) {
    return { kind: "signal", code, signal };
  }

  if (signal) {
    return { kind: "signal", code, signal };
  }

  return { kind: "error", code, signal };
}

function describeExitReason(reason: ExitReason): string {
  switch (reason.kind) {
    case "graceful": {
      const suffix = typeof reason.code === "number"
        ? ` (exit code ${reason.code})`
        : "";
      return `Server process exited cleanly${suffix}.`;
    }
    case "signal": {
      const detail = reason.signal
        ? `signal ${reason.signal}`
        : `exit code ${reason.code ?? "?"}`;
      return `Container stopped due to ${detail}.`;
    }
    case "error": {
      const suffix = typeof reason.code === "number"
        ? ` (exit code ${reason.code})`
        : "";
      return `Container exited unexpectedly${suffix}.`;
    }
    case "manual":
      return "Console detached manually.";
  }
}

function isStateRunning(state: ContainerState | null | undefined): boolean {
  return !!(state && state.Status === "running" && state.Running);
}
