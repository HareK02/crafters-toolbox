
import { type ReadableStream, type WritableStream } from "jsr:@std/streams";

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
const FOOTER_HEIGHT = 2;

interface AttachState {
    currentInput: string;
    containerName: string;
    statusMessage: string;
    isCleanExit: boolean;
    isRunning: boolean;
}

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

// --- Docker API Helper ---
async function inspectContainer(containerName: string): Promise<ContainerInspect | null> {
    try {
        const conn = await Deno.connect({ transport: "unix", path: "/var/run/docker.sock" });
        try {
            const request = `GET /containers/${containerName}/json HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`;
            await conn.write(ENC.encode(request));

            const buffer = new Uint8Array(4096); // Header usually fits, body might not
            // We need a proper HTTP reader but for inspect JSON (usuall < 3KB) we might get away with simple reading
            let response = "";
            while (true) {
                const n = await conn.read(buffer);
                if (n === null) break;
                response += DEC.decode(buffer.subarray(0, n));
                // Simple termination check (Docker closes connection due to Connection: close? or Content-Length)
                // For valid JSON at end.
            }

            // Extract body
            const bodyIndex = response.indexOf("\r\n\r\n");
            if (bodyIndex === -1) return null;
            const body = response.slice(bodyIndex + 4);

            // Handle Transfer-Encoding: chunked if necessary (Docker usually doesn't for small JSON?)
            // Docker API usually returns Content-Length for JSON info.
            // If chunked, we are in trouble with this simple parser. 
            // BUT: inspect command output is small.

            // Attempt parse
            // If body has chunk lengths (hex\r\n...), we might fail.
            // Let's assume non-chunked for /json endpoint or robust try-catch
            // Simple removal of chunk headers if simplistic approach:
            const jsonStr = body.replace(/^[0-9a-fA-F]+\r\n/, "").replace(/\r\n0\r\n\r\n$/, "");

            // Try parsing raw body first
            try {
                return JSON.parse(body);
            } catch {
                try {
                    // Try simplistic de-chunk
                    return JSON.parse(jsonStr);
                } catch {
                    return null;
                }
            }

        } finally {
            try { conn.close(); } catch { }
        }
    } catch {
        return null;
    }
}



// --- Restart Logic ---
async function waitForRestart(containerName: string, state: AttachState): Promise<boolean> {
    const start = Date.now();
    const TIMEOUT_MS = 10000; // Wait up to 10s for a restart to happen

    // If it was an error crash, Docker might take a moment to restart it.

    while (Date.now() - start < TIMEOUT_MS) {
        const info = await inspectContainer(containerName);
        if (!info) {
            // Container gone?
            return false;
        }

        if (info.State.Running) {
            return true;
        }

        if (info.State.Restarting) {
            state.statusMessage = "Container restarting...";
            drawFooter(state);
            await new Promise(r => setTimeout(r, 500));
            continue;
        }

        if (info.State.Status === "exited") {
            // Check if it plans to restart?
            // "Restarting" flag should be true if it is waiting to restart.
            // However, if we caught it in the "dead" phase of restart loop, maybe wait?
            if (info.State.ExitCode !== 0 && info.State.Error) {
                // Error happened, likely will restart if policy set.
                state.statusMessage = `Crashed (Code ${info.State.ExitCode}). Waiting...`;
                drawFooter(state);
            } else if (info.State.ExitCode === 0) {
                // Clean exit (e.g. /stop).
                // IF policy is always, it restarts. IF unless-stopped, it implies manual stop?
                // But manual stop usually sets some internal flag?
                // We can't easily distinguish 'docker stop' vs '/stop' inside without events.
                // BUT 'docker stop' sends SIGTERM. '/stop' is app logic.
                // Both result in Exited.

                // Heuristic: If we are here, Socket Closed.
                // If it was 'docker stop', we usually don't want to auto-reattach.
                // If it was '/stop', maybe we do? But /stop usually means "Shutdown" for MC server.

                // User request: "docker stopによる完全な停止なのか、内部からの/stopやエラー落ちなのかを区別し"
                // Internal /stop -> Exit Code 0. -> Usually SHOULD stop.
                // Error crash -> Exit Code != 0. -> Should restart.

                if (info.State.ExitCode !== 0) {
                    // Crash.
                } else {
                    // Clean exit. Allow a brief window just in case 'always' policy is set?
                    // But generally 0 means done.
                    // IMPORTANT: 'docker stop' also results in 0 (usually).
                }
            }
        }

        await new Promise(r => setTimeout(r, 1000));
    }

    return false;
}

// --- Session Logic ---
async function attachSession(state: AttachState): Promise<"user_detach" | "socket_closed"> {
    let conn: Deno.Conn;
    try {
        conn = await Deno.connect({ transport: "unix", path: "/var/run/docker.sock" });
    } catch {
        return "socket_closed";
    }

    try {
        // Attach Request
        const request =
            `POST /containers/${state.containerName}/attach?stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.1\r
Host: localhost\r
Upgrade: tcp\r
Connection: Upgrade\r
\r
`;
        await conn.write(ENC.encode(request));

        // Read Headers
        const buffer = new Uint8Array(1);
        let header = "";
        while (true) {
            const n = await conn.read(buffer);
            if (n === null) throw new Error("Closed");
            header += String.fromCharCode(buffer[0]);
            if (header.endsWith("\r\n\r\n")) break;
        }

        if (!header.startsWith("HTTP/1.1 101") && !header.startsWith("HTTP/1.0 101")) {
            return "socket_closed";
        }

        // Initial Draw
        state.isRunning = true;
        drawFooter(state);

        // Loops
        const abortController = new AbortController();

        const outputLoop = async () => {
            const buf = new Uint8Array(8192);
            try {
                while (state.isRunning) {
                    const n = await conn.read(buf);
                    if (n === null) break;
                    writeLog(buf.subarray(0, n), state);
                }
            } catch {
            } finally {
                // If this loop exits, socket is closed.
                abortController.abort();
            }
        };

        const inputLoop = async () => {
            const buf = new Uint8Array(128);
            try {
                while (state.isRunning) {
                    // Deno.stdin.read is not easily cancellable without signal?
                    // But we are in raw mode.
                    const n = await Deno.stdin.read(buf);
                    if (n === null) break;

                    const chunk = buf.subarray(0, n);
                    const str = DEC.decode(chunk);

                    if (str.includes("\x03")) { // Ctrl+C
                        state.isCleanExit = true;
                        state.isRunning = false;
                        return "user_detach";
                    }

                    if (state.isRunning) { // Check again before process
                        await processInput(str, chunk, state, conn);
                    }
                }
            } catch {
            }
            return "user_detach"; // Fallback return, though meaningless if outputLoop aborts first
        };

        // Race them. 
        // If outputLoop finishes (socket closed), inputLoop is stuck in read() but we must break.
        // Actually Deno.stdin.read blocks. It's hard to interrupt inputLoop from outside.
        // BUT, if we return from attachSession, we restart the loop.
        // The problem is: if socket closed, we enter 'waitForRestart'.
        // 'waitForRestart' does some async waits.
        // The 'inputLoop' is still blocked on 'read()'.
        // If user types something during 'waitForRestart', it will be caught by that dangling read?
        // 
        // Ideally we shouldn't spawn a new input loop every time if the old one is still alive.
        // BUT for simplicity, let's assume we can't easily kill the input reader without closing stdin (bad).
        // 
        // Solution: Lift input handling UP to the main function?
        // Or: Use a shared state for the input handler.
        // 
        // Let's refactor to have ONE input loop that feeds the CURRENT connection.

        return await new Promise<"user_detach" | "socket_closed">((resolve) => {
            // 1. Output Handler
            outputLoop().then(() => {
                if (state.isRunning) {
                    state.isRunning = false;
                    resolve("socket_closed");
                }
            });

            // 2. Input Handler - this is tricky if we want to reuse it.
            // We can use a specialized input handler here that checks a shared "currentConn" ref.
            // But for now, let's just use the race.
            // If socket closes, state.isRunning = false.
            // We resolve "socket_closed".
            // We leave inputLoop dangling? Yes, that's a resource leak/bug.
            // Deno doesn't support cancelling stdin read easily.

            // Actually, if we just let the Input Loop handle the "Ctrl+C", it behaves effectively as the "User Detach" signal.
            // If "Socket Closed" happens, we want to keep input loop active but pointing to nothing?
            // Or better: We Lift the input loop.

            // Let's attach the RESOLVER to the state so input loop can signal detach.
            (state as any)._detachResolve = resolve;
        });

    } finally {
        try { conn.close(); } catch { }
    }
}

// Global Single Input Loop Logic (Refactored)
// To avoid blocking stdin issues, we run one input loop for the lifetime of attachToContainer.

async function runInputLoop(state: AttachState, getConn: () => Deno.Conn | null, onDetach: () => void) {
    const buf = new Uint8Array(128);
    while (true) {
        if (state.isCleanExit) break;
        try {
            const n = await Deno.stdin.read(buf);
            if (n === null) break;
            const chunk = buf.subarray(0, n);
            const str = DEC.decode(chunk);

            if (str.includes("\x03")) { // Ctrl+C
                state.isCleanExit = true;
                onDetach();
                break;
            }

            const conn = getConn();
            if (conn && state.isRunning) {
                await processInput(str, chunk, state, conn);
            } else {
                // Buffering? Or ignore?
                // If restarting, maybe we should buffer or just drop. 
                // Drop is safer to avoid accidental commands.
            }
        } catch {
            break;
        }
    }
}

export async function attachToContainerRefactored(containerName: string): Promise<void> {
    const state: AttachState = {
        currentInput: "",
        containerName,
        statusMessage: "Connecting...",
        isCleanExit: false,
        isRunning: false,
    };

    let currentConn: Deno.Conn | null = null;
    let detachResolver: (() => void) | null = null;

    try {
        Deno.stdin.setRaw(true);
    } catch {
        console.warn("Raw mode failed");
    }

    // Start Input Loop
    const inputPromise = runInputLoop(state, () => currentConn, () => {
        if (detachResolver) detachResolver();
    });

    try {
        while (!state.isCleanExit) {
            // 1. Connect
            state.statusMessage = "Connecting...";
            drawFooter(state);

            try {
                const conn = await Deno.connect({ transport: "unix", path: "/var/run/docker.sock" });
                // Attach Handshake
                const request = `POST /containers/${containerName}/attach?stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.1\r\nHost: localhost\r\nUpgrade: tcp\r\nConnection: Upgrade\r\n\r\n`;
                await conn.write(ENC.encode(request));
                // Read Headers
                const buffer = new Uint8Array(1);
                let header = "";
                while (true) {
                    const n = await conn.read(buffer);
                    if (n === null) throw new Error("Closed");
                    header += String.fromCharCode(buffer[0]);
                    if (header.endsWith("\r\n\r\n")) break;
                }
                if (!header.startsWith("HTTP/1.1 101") && !header.startsWith("HTTP/1.0 101")) {
                    throw new Error("Handshake failed");
                }

                // Ready
                currentConn = conn;
                state.isRunning = true;
                state.statusMessage = "Connected via Socket | Ctrl+C to Detach";
                drawFooter(state);

                // Wait for socket close OR user detach
                await new Promise<void>((resolve) => {
                    detachResolver = resolve;

                    // Output Reader
                    (async () => {
                        const buf = new Uint8Array(8192);
                        try {
                            while (true) {
                                const n = await conn.read(buf);
                                if (n === null) break;
                                writeLog(buf.subarray(0, n), state);
                            }
                        } catch { }
                        // Socket closed
                        resolve();
                    })();
                });

                // Cleanup current connection
                state.isRunning = false;
                currentConn = null;
                detachResolver = null;
                try { conn.close(); } catch { }

            } catch (e) {
                // Connection failed
            }

            if (state.isCleanExit) break;

            // 2. Wait / Recovery
            state.statusMessage = "Connection lost. Checking status...";
            drawFooter(state);

            const canRetry = await waitForRestart(containerName, state);
            if (!canRetry) {
                writeRaw("\nContainer stopped.\n");
                state.isCleanExit = true; // Break outer
                // We need to stop input loop too? Input loop checks isCleanExit.
                // But it is blocked on read.
                // We can't unblock it easily.
                // So we actually just exit process usually found in CLI tools.
                break;
            }
            // Retry
            await new Promise(r => setTimeout(r, 500));
        }
    } finally {
        try { Deno.stdin.setRaw(false); } catch { }
        // Since we can't kill inputPromise easily if it's waiting for key, 
        // we might just have to exit the Deno process or rely on user hitting a key if we returned?
        // But for "crtb terminal" command, returning implies command done.
    }
}

// ... UI Logic (same as before) ...
function writeLog(chunk: Uint8Array, state: AttachState) {
    const text = DEC.decode(chunk);
    if (!text) return;
    writeRaw(ANSI.hideCursor);
    writeRaw(ANSI.moveCol(0));
    writeRaw(ANSI.moveCol(0));
    writeRaw(ANSI.clearScreenDown);
    writeRaw(chunk);
    if (!text.endsWith("\n")) writeRaw("\n");
    drawFooter(state);
    writeRaw(ANSI.showCursor);
}

function drawFooter(state: AttachState) {
    // Top: Input Line
    writeRaw(`\r${ANSI.clearLine}> ${state.currentInput}\n`);
    // Bottom: Status Line
    writeRaw(`${ANSI.clearLine}\x1b[44m[${state.containerName}] ${state.statusMessage}\x1b[0m`);
    // Move cursor back to input line (1 line up, at the end of input)
    writeRaw(ANSI.up(1));
    writeRaw(ANSI.moveCol(3 + state.currentInput.length)); // "> " is 2 chars, so 3 is 1-based index start? No, ANSI col is 1-based. "> " len 2. So start logic...
    // Input prompt "> " (len 2). Col 1 is '>', Col 2 is ' ', Col 3 is first char.
    // So 3 + len is correct.
    writeRaw(ANSI.moveCol(3 + state.currentInput.length));
}

async function processInput(str: string, rawChunk: Uint8Array, state: AttachState, conn: Deno.Conn) {
    if (str === "\r" || str === "\n") {
        const cmd = state.currentInput + "\n";
        await conn.write(ENC.encode(cmd));
        state.currentInput = "";
        writeRaw(ANSI.hideCursor);
        writeRaw(ANSI.moveCol(0));

        // Clear screen down from current position (which was Input Line)
        // Actually, if we are at Input Line, we are at Top of footer.
        // We writeLog/drawFooter usually does full redraw.

        // Simple redraw footer
        // But drawFooter assumes we are at the START of drawing area? 
        // No, drawFooter just writes lines.
        // We need to move to the TOP of the footer area before calling drawFooter usually?
        // Or drawFooter handles it?

        // Let's rely on full redraw logic used elsewhere:
        // Move to start of footer -> Draw.
        // Since we are AT the input line (Top), we are already at start?
        // Yes, if cursor is at Input line.

        // Wait, ANSI.up(FOOTER_HEIGHT - 1) implies we were at the BOTTOM?
        // In previous logic: Status (Top), Input (Bottom). Cursor at Input.
        // So up(1) went to Status.
        // Now: Input (Top), Status (Bottom). Cursor at Input.
        // So up(1) goes ABOVE footer?
        // We are already at Input line (Top).

        // If we want to fully redraw footer:
        // We are at Input Line.
        // 1. Clear Line (Input)
        // 2. Write New Input (Empty)
        // 3. Newline -> Status Line
        // 4. Clear Line (Status) -> Write Status
        // 5. Up 1 -> Input Line.

        // So simply calling drawFooter() from current position (Input Line) works IF we just want to overwrite.
        // But wait, drawFooter writes "\n" between lines.

        // Previous logic:
        // up(1). drawFooter.
        // Because "Status\nInput". Cursor at Input. "up(1)" -> Status line start.

        // Current logic:
        // "Input\nStatus". Cursor at Input.
        // So we are ALREADY at the start of the footer block.
        // So we don't need up().

        // CAUTION: The standard `writeLog` does `up(FOOTER_HEIGHT - 1)`.
        // If cursor is at Input (Top), FOOTER_HEIGHT=2. up(1) goes 1 line above Input.
        // That's WRONG if we are at Input line.

        // BUT `writeLog` is called when new log comes in.
        // When log comes in, cursor is supposedly at Input Line?
        // No, usually stdout/stderr writes move cursor?
        // No, we capture stdout/stderr in `writeLog`.

        // The implementation assumes the cursor is sitting at the Input Line (correct position) while waiting for user.
        // If logs come, `writeLog` moves UP, clears down, writes log, writes footer.
        // If `writeLog` moves UP 1 line from Input Line, it assumes Input Line is the "Last" line.
        // NOW Input Line is "First" line of footer (or Second last?).
        // Footer: 
        // Line N: Input
        // Line N+1: Status

        // If cursor is at Input (Line N), and we want to write logs BEFORE footer.
        // We need to move to Line N. Clear Down.
        // So `writeLog` logic:
        // up(FOOTER_HEIGHT - 1) -> If cursor at Input (N), up(1) -> N-1.
        // This means it overwrites the line ABOVE Input? That's log area.
        // Correct. Logs are written above footer.

        // WAIT.
        // Old: Status (N), Input (N+1). Cursor at N+1.
        // up(1) -> N.
        // clearScreenDown -> Clears N and N+1.
        // write log... (cursor moves down with log)
        // writeFooter -> writes N, N+1.

        // New: Input (N), Status (N+1). Cursor at N.
        // up(1) -> N-1.
        // clearScreenDown -> clears N-1, N, N+1.
        // writes log at N-1...
        // writes footer at ... Wait.

        // If we write log at N-1.
        // If log ends with newline, cursor is at N.
        // Then we call drawFooter.
        // drawFooter writes Input(N)\nStatus(N+1).
        // Then moves back to Input(N).

        // So `writeLog` logic seems correct actually. It clears the footer AND the line above it?
        // `FOOTER_HEIGHT` is 2. `up(1)`.

        // Case Old: Status(N), Input(N+1). Cursor at N+1.
        // up(1) -> N. 
        // It clears Status and Input. Writes log at N.
        // Log ends at N (or N+k).
        // drawFooter writes Status, Input.

        // Case New: Input(N), Status(N+1). Cursor at N.
        // up(1) -> N-1.
        // It clears Line N-1 (Log area), Input(N), Status(N+1).
        // This means it effectively scrolls up 1 line?
        // If we clear line N-1, we erase the last log line?
        // That seems wrong.

        // So if Input is at Top of Footer, and Cursor is there.
        // We are at the boundary of Log and Footer.
        // We shouldn't move UP if we are already at the top of footer.
        // We just move Col 0, Clear Down.

        writeRaw(ANSI.moveCol(0)); // Start of Input Line
        writeRaw(ANSI.clearScreenDown); // Clear Footer (Input + Status)

        // But what about the log chunk?
        // If we write chunk at Input Line position, it pushes footer down?
        // No, terminal just writes text.
        // If we write text, we are effectively adding to log.
        // Then we redraw footer below it.

        // So for `writeLog`, we simply:
        // 1. Move to start of Input Line.
        // 2. Clear Screen Down.
        // 3. Write Chunk.
        // 4. Draw Footer.

        // So for `writeLog`, we DON'T need `up(...)` if cursor is at Input Line (Top).
        // BUT wait, `FOOTER_HEIGHT` is 2.

        // Let's adjust `writeLog` as well.

        // And `processInput`.
        // If user types, we update Input Line.
        // We are at Input Line.
        // We can just overwrite Input Line.

        // Backspace/Char handling.
        // Just rewriting the line is easiest.

        // Let's refine `writeLog` and `processInput` in the ReplacementContent.

        drawFooter(state);
        // Cursor is now at Input Line.
    } else if (str === "\x7f" || str === "\b") {
        if (state.currentInput.length > 0) {
            state.currentInput = state.currentInput.slice(0, -1);
            // Redraw Input Line Only?
            // Since Status is below, simpler to just redraw line.
            writeRaw(`\r${ANSI.clearLine}> ${state.currentInput}`);
            // Cursor is at end of input. Correct.
        }
    } else {
        if (str.length === 1 && str.charCodeAt(0) >= 32) {
            state.currentInput += str;
            writeRaw(rawChunk); // Echo char (or we could just write char)
            // If we write char, cursor moves right.
            // Correct.
        }
    }
}


export { attachToContainerRefactored as attachToContainer };
