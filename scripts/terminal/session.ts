import { TerminalDisplay } from "./ui.ts";
import { isTerminal } from "./tty.ts";

export type TerminalSessionOptions = {
  title: string;
  startMessage?: string;
  exitMessage?: string | null;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  wrapInPty?: boolean;
};

export type TerminalSessionResult = {
  interrupted: boolean;
  status: Deno.CommandStatus;
};

type SpawnedProcess = ReturnType<Deno.Command["spawn"]>;

export async function runTerminalSession(
  options: TerminalSessionOptions,
): Promise<TerminalSessionResult> {
  const display = new TerminalDisplay();
  const args = options.args ?? [];
  let displayClosed = false;
  const closeDisplay = () => {
    if (displayClosed) return;
    display.close();
    displayClosed = true;
  };
  const interactive = isTerminal(Deno.stdin) && isTerminal(Deno.stdout);
  const useManagedPty = !!options.wrapInPty && interactive;
  const defaultStart = useManagedPty
    ? `${options.title}: Attaching to container console. Press Ctrl+C to detach without stopping the server.`
    : `${options.title}: Attaching to container console. Detach with ${DOCKER_DETACH_HINT}.`;
  display.info(options.startMessage ?? defaultStart);

  const command = buildCommand(options, useManagedPty);
  const child = command.spawn();

  if (!useManagedPty) {
    return await waitForProcess(child, display, options, closeDisplay);
  }

  const abortController = new AbortController();
  const forwarder = createInputForwarder({
    child,
    title: options.title,
    display,
    signal: abortController.signal,
  });
  const sigintHandler = () => forwarder.requestDetach();
  Deno.addSignalListener("SIGINT", sigintHandler);
  const inputPromise = forwarder.start();

  let detached = false;
  let status: Deno.CommandStatus;
  try {
    status = await child.status;
  } finally {
    abortController.abort();
    try {
      detached = await inputPromise;
    } catch (_error) {
      detached = true;
    }
    Deno.removeSignalListener("SIGINT", sigintHandler);
  }

  display.clearStatus();
  if (detached) {
    display.info(`${options.title}: Detached from console.`);
    closeDisplay();
    return { interrupted: true, status };
  }

  await finishProcess(display, options, status);
  closeDisplay();
  return { interrupted: false, status };
}

function buildCommand(
  options: TerminalSessionOptions,
  useManagedPty: boolean,
) {
  const args = options.args ?? [];
  if (!useManagedPty) {
    return new Deno.Command(options.command, {
      args,
      env: options.env,
      cwd: options.cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  }

  const shellCommand = [options.command, ...args].map(shellQuote).join(" ");
  return new Deno.Command("script", {
    args: ["-qefc", shellCommand, "/dev/null"],
    env: options.env,
    cwd: options.cwd,
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
  });
}

async function waitForProcess(
  child: SpawnedProcess,
  display: TerminalDisplay,
  options: TerminalSessionOptions,
  closeDisplay: () => void,
): Promise<TerminalSessionResult> {
  let interrupted = false;
  const sigintHandler = () => {
    interrupted = true;
    display.setStatus(`${options.title}: Detaching (server keeps running)...`);
  };
  Deno.addSignalListener("SIGINT", sigintHandler);
  try {
    const status = await child.status;
    display.clearStatus();
    if (interrupted) {
      display.info(`${options.title}: Detached from console.`);
      closeDisplay();
      return { interrupted: true, status };
    }
    await finishProcess(display, options, status);
    closeDisplay();
    return { interrupted: false, status };
  } finally {
    Deno.removeSignalListener("SIGINT", sigintHandler);
    closeDisplay();
  }
}

async function finishProcess(
  display: TerminalDisplay,
  options: TerminalSessionOptions,
  status: Deno.CommandStatus,
) {
  const exitMessage = options.exitMessage === undefined
    ? `${options.title}: Console session ended.`
    : options.exitMessage;
  if (!exitMessage) return;
  if (status.success) {
    display.info(exitMessage);
  } else {
    display.error(
      `${options.title}: Console exited with status ${status.code ?? "?"}.`,
    );
  }
}

function shellQuote(token: string) {
  if (/^[A-Za-z0-9_\/:.=+-]+$/.test(token)) {
    return token;
  }
  return `'${token.replace(/'/g, `'"'"'`)}'`;
}

const CTRL_C = 0x03;
const DETACH_SEQUENCE = new Uint8Array([0x10, 0x11]);
const DOCKER_DETACH_HINT = "Ctrl+C";

type InputForwarder = {
  start: () => Promise<boolean>;
  requestDetach: () => void;
};

function createInputForwarder(
  options: {
    child: SpawnedProcess;
    title: string;
    display: TerminalDisplay;
    signal: AbortSignal;
  },
): InputForwarder {
  const stdinStream = Deno.stdin.readable;
  const childStdin = options.child.stdin;
  if (!stdinStream || !childStdin) {
    return {
      start: async () => false,
      requestDetach: () => {},
    };
  }

  const writer = childStdin.getWriter();
  const reader = stdinStream.getReader();
  let detaching = false;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    options.signal.removeEventListener("abort", abortListener);
    reader.releaseLock();
    writer.releaseLock();
  };

  const abortListener = () => {
    reader.cancel().catch(() => {});
  };

  const requestDetach = () => {
    if (detaching) return;
    detaching = true;
    options.display.setStatus(
      `${options.title}: Detaching (server keeps running)...`,
    );
    reader.cancel().catch(() => {});
    writer.write(DETACH_SEQUENCE).catch(() => {})
      .finally(() => writer.close().catch(() => {}));
  };

  const start = async (): Promise<boolean> => {
    options.signal.addEventListener("abort", abortListener);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        if (!detaching) {
          const ctrlIndex = value.indexOf(CTRL_C);
          if (ctrlIndex >= 0) {
            if (ctrlIndex > 0) {
              await writer.write(value.subarray(0, ctrlIndex));
            }
            requestDetach();
            break;
          }
        }

        if (!detaching) {
          await writer.write(value);
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        throw error;
      }
    } finally {
      cleanup();
    }
    return detaching;
  };

  return { start, requestDetach };
}
