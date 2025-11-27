import { runTerminalSession } from "./session.ts";

export type AttachOptions = {
  title?: string;
};

type ContainerState = {
  Status: string;
  Running: boolean;
  Restarting: boolean;
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
  let waitForRestart = false;

  while (true) {
    attempt++;
    if (waitForRestart) {
      const ready = await waitForContainerRunning(containerName);
      if (!ready) {
        console.log(
          `${title}: Container stopped and did not restart. Console session will exit.`,
        );
        break;
      }
    }

    const startMessage = waitForRestart
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

    if (result.interrupted || isManualDetachExit(result.status)) {
      return;
    }

    const state = await inspectContainerState(containerName);
    if (!shouldAutoReconnect(state)) {
      console.log(
        `${title}: Container is ${
          state?.Status ?? "unavailable"
        }. Console session ended.`,
      );
      break;
    }

    console.log(
      `${title}: Container restarted (exit code ${
        result.status.code ?? "?"
      }). Reattaching...`,
    );
    waitForRestart = true;
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

function shouldAutoReconnect(state: ContainerState | null): boolean {
  if (!state) return false;
  if (state.Status === "running" && state.Running) return true;
  if (state.Restarting) return true;
  if (state.Status === "created") return true;
  return false;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isManualDetachExit(status: Deno.CommandStatus): boolean {
  if (status.success && status.code === 0) return true;
  if (typeof status.code === "number" && status.code === 1) return true;
  const manualExitCodes = new Set([130, 131, 143]);
  if (typeof status.code === "number" && manualExitCodes.has(status.code)) {
    return true;
  }
  return false;
}
