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
  const rawCapable = interactive && canEnableRawMode(Deno.stdin);
  const useManagedPty = !!options.wrapInPty && rawCapable;
  const defaultStart = useManagedPty
    ? `${options.title}: Attaching to container console. Press Ctrl+C to detach without stopping the server.`
    : `${options.title}: Attaching to container console. Detach with ${DOCKER_DETACH_HINT}.`;
  display.info(options.startMessage ?? defaultStart);

  const command = buildCommand(options, useManagedPty);
  const child = command.spawn();

  if (!useManagedPty) {
    return await waitForProcess(child, display, options, closeDisplay);
  }

  const restoreRaw = enableRawMode(Deno.stdin);
  const abortController = new AbortController();
  const inputPromise = forwardInputToChild({
    child,
    title: options.title,
    display,
    signal: abortController.signal,
  });

  let detached = false;
  let status: Deno.CommandStatus;
  try {
    status = await child.status;
  } finally {
    abortController.abort();
    try {
      detached = await inputPromise;
    } catch (_error) {
      detached = false;
    }
    restoreRaw?.();
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
const DOCKER_DETACH_HINT = "Ctrl+P, Ctrl+Q";

type RawCapableStdin = typeof Deno.stdin & {
  setRaw?: (mode: boolean) => void;
};

function canEnableRawMode(
  stream: typeof Deno.stdin,
): stream is RawCapableStdin {
  return typeof (stream as RawCapableStdin).setRaw === "function";
}

function enableRawMode(stream: typeof Deno.stdin) {
  const tty = stream as RawCapableStdin;
  tty.setRaw?.(true);
  return () => {
    try {
      tty.setRaw?.(false);
    } catch (_error) {
      // ignore restore errors
    }
  };
}

async function forwardInputToChild(options: {
  child: SpawnedProcess;
  title: string;
  display: TerminalDisplay;
  signal: AbortSignal;
}): Promise<boolean> {
  if (!options.child.stdin) return false;
  const stdinReadable =
    (Deno.stdin as { readable?: ReadableStream<Uint8Array> })
      .readable;
  if (!stdinReadable) return false;
  const reader = stdinReadable.getReader();
  const writer = options.child.stdin.getWriter();
  let detached = false;
  let inputEnded = false;

  const abortListener = () => {
    reader.cancel().catch(() => {});
  };
  options.signal.addEventListener("abort", abortListener);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        inputEnded = true;
        break;
      }
      if (!value || value.length === 0) continue;

      const ctrlIndex = value.indexOf(CTRL_C);
      if (ctrlIndex >= 0) {
        if (ctrlIndex > 0) {
          await writer.write(value.subarray(0, ctrlIndex));
        }
        options.display.setStatus(
          `${options.title}: Detaching (server keeps running)...`,
        );
        await writer.write(DETACH_SEQUENCE);
        detached = true;
        break;
      }

      await writer.write(value);
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
  } finally {
    options.signal.removeEventListener("abort", abortListener);
    if (inputEnded) {
      try {
        await writer.close();
      } catch (_error) {
        // ignore close errors
      }
    } else {
      writer.releaseLock();
    }
    reader.releaseLock();
  }

  return detached;
}
