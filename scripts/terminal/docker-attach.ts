// --- ANSI Helper ---
const ENC = new TextEncoder();
const DEC = new TextDecoder();
const ESC = "\x1b[";
const ANSI = {
  hideCursor: `${ESC}?25l`,
  showCursor: `${ESC}?25h`,
  clearLine: `${ESC}2K`,
  clearScreenDown: `${ESC}J`,
  up: (n: number) => `${ESC}${n}A`,
  moveCol: (n: number) => `${ESC}${n}G`,
};

function writeRaw(text: string | Uint8Array) {
  if (!text) return;
  const data = typeof text === "string" ? ENC.encode(text) : text;
  try {
    Deno.stdout.writeSync(data);
  } catch {
    // Ignore write errors
  }
}

// --- Configuration ---
// --- Configuration ---
const FOOTER_HEIGHT = 2;

type ServerStatus =
  | "ONLINE"
  | "STOPPING"
  | "RESTARTING"
  | "STARTING"
  | "UNKNOWN";

interface AttachState {
  currentInput: string;
  containerName: string;
  statusMessage: string;
  isCleanExit: boolean;
  isRunning: boolean;
  serverStatus: ServerStatus;
}

// ... (ContainerInspect interface) ...
interface ContainerInspect {
  State: {
    Status: string;
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    OOMKilled: boolean;
    Dead: boolean;
    Pid: number;
    ExitCode: number;
    Error: string;
    StartedAt: string;
    FinishedAt: string;
  };
}

// --- Helper for Status Colors ---
function getStatusColor(status: ServerStatus): string {
  switch (status) {
    case "ONLINE":
      return "\x1b[42m"; // Green
    case "STOPPING":
      return "\x1b[43m"; // Yellow (Orange-ish)
    case "RESTARTING":
      return "\x1b[45m"; // Magenta
    case "STARTING":
      return "\x1b[44m"; // Blue
    default:
      return "\x1b[44m"; // Blue (Default)
  }
}

// --- Docker API Helper ---
async function inspectContainer(
  containerName: string,
): Promise<ContainerInspect | null> {
  try {
    const conn = await Deno.connect({
      transport: "unix",
      path: "/var/run/docker.sock",
    });
    try {
      const request =
        `GET /containers/${containerName}/json HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`;
      await conn.write(ENC.encode(request));

      const buffer = new Uint8Array(4096);
      let response = "";
      while (true) {
        const n = await conn.read(buffer);
        if (n === null) break;
        response += DEC.decode(buffer.subarray(0, n));
      }

      const bodyIndex = response.indexOf("\r\n\r\n");
      if (bodyIndex === -1) return null;
      const body = response.slice(bodyIndex + 4);
      const jsonStr = body
        .replace(/^[0-9a-fA-F]+\r\n/, "")
        .replace(/\r\n0\r\n\r\n$/, "");

      try {
        return JSON.parse(body);
      } catch {
        try {
          return JSON.parse(jsonStr);
        } catch {
          return null;
        }
      }
    } finally {
      try {
        conn.close();
      } catch {}
    }
  } catch {
    return null;
  }
}

// Global Single Input Loop Logic (Refactored)
async function runInputLoop(
  state: AttachState,
  getConn: () => Deno.Conn | null,
  onDetach: () => void,
) {
  const buf = new Uint8Array(128);
  while (true) {
    if (state.isCleanExit) break;
    try {
      const n = await Deno.stdin.read(buf);
      if (n === null) break;
      const chunk = buf.subarray(0, n);
      const str = DEC.decode(chunk);

      if (str.includes("\x03")) {
        // Ctrl+C
        state.isCleanExit = true;
        onDetach();
        break;
      }

      const conn = getConn();
      if (conn && state.isRunning) {
        await processInput(str, chunk, state, conn);
      }
    } catch {
      break;
    }
  }
}

// --- Restart Logic ---
async function waitForRestart(
  containerName: string,
  state: AttachState,
): Promise<boolean> {
  const start = Date.now();
  const TIMEOUT_MS = 60000; // Increase timeout to 60s for server restart

  state.serverStatus = "RESTARTING";
  state.statusMessage = "Waiting for container restart...";
  drawFooter(state);

  while (Date.now() - start < TIMEOUT_MS) {
    const info = await inspectContainer(containerName);
    if (!info) return false;

    if (info.State.Running && !info.State.Restarting) {
      // Container is back up
      return true;
    }

    if (info.State.Restarting) {
      state.statusMessage = "Container is restarting...";
      drawFooter(state);
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    if (info.State.Status === "exited") {
      if (info.State.ExitCode !== 0 || info.State.Error) {
        state.statusMessage =
          `Crashed (Code ${info.State.ExitCode}). Waiting...`;
        drawFooter(state);
      } else {
        // Clean exit.
        // If we were STOPPING, this is expected.
        // But do we auto-restart?
        // If the user manually stopped it, we should exit.
        // But "RESTARTING" implies we expect it to come back.
        // Let's wait a bit longer to see if Docker restarts it (unless-stopped/always).
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  return false;
}

// ... (attachSession remains mostly same, need to update initial state) ...

export async function attachToContainerRefactored(
  containerName: string,
): Promise<void> {
  const state: AttachState = {
    currentInput: "",
    containerName,
    statusMessage: "Connecting...",
    isCleanExit: false,
    isRunning: false,
    serverStatus: "STARTING",
  };

  let currentConn: Deno.Conn | null = null;
  let detachResolver: (() => void) | null = null;

  try {
    Deno.stdin.setRaw(true);
  } catch {
    console.warn("Raw mode failed");
  }

  // Start Input Loop
  const inputPromise = runInputLoop(
    state,
    () => currentConn,
    () => {
      if (detachResolver) detachResolver();
    },
  );

  try {
    while (!state.isCleanExit) {
      // 1. Connect
      state.statusMessage = "Connecting...";
      // Check if we are reconnecting (RESTARTING) or initial (STARTING)
      // Keep current status if RESTARTING, else STARTING
      if (state.serverStatus !== "RESTARTING") {
        state.serverStatus = "STARTING";
      }
      drawFooter(state);

      try {
        // ... (Connection Logic same as before) ...
        const conn = await Deno.connect({
          transport: "unix",
          path: "/var/run/docker.sock",
        });
        const request =
          `POST /containers/${containerName}/attach?stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.1\r\nHost: localhost\r\nUpgrade: tcp\r\nConnection: Upgrade\r\n\r\n`;
        await conn.write(ENC.encode(request));
        // ... (Header reading same) ...
        const buffer = new Uint8Array(1);
        let header = "";
        while (true) {
          const n = await conn.read(buffer);
          if (n === null) throw new Error("Closed");
          header += String.fromCharCode(buffer[0]);
          if (header.endsWith("\r\n\r\n")) break;
        }
        if (
          !header.startsWith("HTTP/1.1 101") &&
          !header.startsWith("HTTP/1.0 101")
        ) {
          throw new Error("Handshake failed");
        }

        // Ready
        currentConn = conn;
        state.isRunning = true;
        state.statusMessage = "Connected via Socket | Ctrl+C to Detach";
        // If we reconnected, we might still be in STARTING phase effectively until we see "Done" log.
        // Or if we were RESTARTING, now we are STARTING (container process running).
        state.serverStatus = "STARTING";
        drawFooter(state);

        // Send 'list' command to check server status
        try {
          await conn.write(ENC.encode("list\n"));
        } catch {
          // Ignore if write fails
        }

        // Wait for socket close OR user detach
        await new Promise<void>((resolve) => {
          detachResolver = resolve;
          (async () => {
            const buf = new Uint8Array(8192);
            try {
              while (true) {
                const n = await conn.read(buf);
                if (n === null) break;
                writeLog(buf.subarray(0, n), state);
              }
            } catch {}
            resolve();
          })();
        });

        state.isRunning = false;
        currentConn = null;
        detachResolver = null;
        try {
          conn.close();
        } catch {}
      } catch (e) {
        // Connection failed
      }

      if (state.isCleanExit) break;

      // 2. Wait / Recovery
      // Print disconnect message block
      writeRaw("\n");
      const SEP_COLOR = "\x1b[45m\x1b[97m"; // Magenta background (matches RESTARTING), White text
      const RESET = "\x1b[0m";
      const blockFunc = (msg: string) =>
        `${SEP_COLOR} ${msg.padEnd(60)} ${RESET}\n`;

      writeRaw(blockFunc("--- SESSION DISCONNECTED ---"));
      writeRaw(blockFunc("The container is expected to restart soon."));
      writeRaw(blockFunc("Waiting for reconnection..."));
      writeRaw("\n");

      // 2. Wait / Recovery
      // If we detected STOPPING log before disconnect, we are likely RESTARTING (or stopped).
      // If status is STOPPING, transition to RESTARTING.
      // Note: writeLog() may have changed serverStatus to "STOPPING"
      const currentStatus = state.serverStatus as ServerStatus;
      if (currentStatus === "STOPPING") {
        state.serverStatus = "RESTARTING";
      }
      state.statusMessage = "Connection lost. Checking status...";
      drawFooter(state);

      const canRetry = await waitForRestart(containerName, state);
      if (!canRetry) {
        writeRaw("\nContainer stopped.\n");
        state.isCleanExit = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    try {
      Deno.stdin.setRaw(false);
    } catch {}
  }
}

function writeLog(chunk: Uint8Array, state: AttachState) {
  const text = DEC.decode(chunk);
  if (!text) return;

  // Status Detection
  // "Done (7.649s)! For help, type "help"" -> ONLINE
  if (/Done \(\d+\.\d+s\)! For help, type "help"/.test(text)) {
    state.serverStatus = "ONLINE";
    state.statusMessage = "Server Online";
  } // "There are X of a max of Y players online" -> ONLINE (from 'list' command)
  else if (/There are \d+ of a max of \d+ players online/.test(text)) {
    state.serverStatus = "ONLINE";
    state.statusMessage = "Server Online";
  } // "Stopping server" -> STOPPING
  else if (/Stopping server/.test(text)) {
    state.serverStatus = "STOPPING";
    state.statusMessage = "Stopping Server...";
  }

  writeRaw(ANSI.hideCursor);
  writeRaw(ANSI.moveCol(0)); // Start of Input Line (Top of footer)
  writeRaw(ANSI.clearScreenDown);
  writeRaw(chunk);
  if (!text.endsWith("\n")) writeRaw("\n");
  drawFooter(state); // Redraws plain footer below log
  writeRaw(ANSI.showCursor);
}

function drawFooter(state: AttachState) {
  // Determine Width
  let width = 80;
  try {
    const size = Deno.consoleSize();
    width = size.columns;
  } catch {}

  // Top: Input Line
  writeRaw(`\r${ANSI.clearLine}> ${state.currentInput}\n`);

  // Bottom: Status Line with Full Width Color
  const color = getStatusColor(state.serverStatus);
  const statusText = `${state.serverStatus} |`;

  // Pad with spaces to fill width
  const visibleLength = statusText.length;
  const padding = Math.max(0, width - visibleLength);
  const paddedText = statusText + " ".repeat(padding);

  writeRaw(`\r${color}${paddedText}\x1b[0m`);

  // Move cursor back to input line
  writeRaw(ANSI.up(1));
  writeRaw(ANSI.moveCol(3 + state.currentInput.length));
}

async function processInput(
  str: string,
  rawChunk: Uint8Array,
  state: AttachState,
  conn: Deno.Conn,
) {
  if (str === "\r" || str === "\n") {
    const cmd = state.currentInput + "\n";
    await conn.write(ENC.encode(cmd));
    state.currentInput = "";
    writeRaw(ANSI.hideCursor);
    writeRaw(ANSI.moveCol(0));

    // Just redraw footer is enough as it clears line
    drawFooter(state);
    writeRaw(ANSI.showCursor);
  } else if (str === "\x7f" || str === "\b") {
    if (state.currentInput.length > 0) {
      state.currentInput = state.currentInput.slice(0, -1);
      writeRaw(`\r${ANSI.clearLine}> ${state.currentInput}`);
    }
  } else {
    if (str.length === 1 && str.charCodeAt(0) >= 32) {
      state.currentInput += str;
      writeRaw(rawChunk);
    }
  }
}

export { attachToContainerRefactored as attachToContainer };
