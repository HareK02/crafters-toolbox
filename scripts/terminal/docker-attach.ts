

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
        // Ignore write errors (e.g. pipe closed)
    }
}

// --- Configuration ---
const FOOTER_HEIGHT = 2;

interface AttachState {
    currentInput: string;
    containerName: string;
    isCleanExit: boolean;
    isRunning: boolean;
}

// --- Main Function ---
export async function attachToContainer(containerName: string): Promise<void> {
    const state: AttachState = {
        currentInput: "",
        containerName,
        isCleanExit: false,
        isRunning: true,
    };

    console.log(`Connecting to Docker API for ${containerName}...`);

    let conn: Deno.Conn;
    try {
        conn = await Deno.connect({
            transport: "unix",
            path: "/var/run/docker.sock"
        });
    } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
            console.error("Could not connect to /var/run/docker.sock. Is Docker running?");
            return;
        }
        throw e;
    }

    // Handshake
    try {
        const request =
            `POST /containers/${containerName}/attach?stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.1\r
Host: localhost\r
Upgrade: tcp\r
Connection: Upgrade\r
\r
`;
        await conn.write(ENC.encode(request));

        const buffer = new Uint8Array(1);
        let header = "";
        while (true) {
            const n = await conn.read(buffer);
            if (n === null) throw new Error("Connection closed during handshake");
            header += String.fromCharCode(buffer[0]);
            if (header.endsWith("\r\n\r\n")) break;
        }

        if (!header.startsWith("HTTP/1.1 101") && !header.startsWith("HTTP/1.0 101")) {
            console.error("Failed to attach. Server returned unexpected header.");
            console.error(header);
            conn.close();
            return;
        }
    } catch (e) {
        console.error("Error during connection initialization:", e);
        try { conn.close(); } catch { }
        return;
    }

    // Setup TTY
    try {
        Deno.stdin.setRaw(true);
    } catch (e) {
        console.warn("Could not set TTY to raw mode. Input experience may be degraded.");
    }

    // Initial Draw
    drawFooter(state);

    // Stream Handlers
    const handleOutput = async () => {
        const buffer = new Uint8Array(8192);
        try {
            while (state.isRunning) {
                const n = await conn.read(buffer);
                if (n === null) break;
                const chunk = buffer.subarray(0, n);
                writeLog(chunk, state);
            }
        } catch (e) {
            // Connection closed or other error
        } finally {
            state.isRunning = false;
        }
    };

    const handleInput = async () => {
        const buffer = new Uint8Array(128);
        try {
            while (state.isRunning) {
                const n = await Deno.stdin.read(buffer);
                if (n === null) break;

                const chunk = buffer.subarray(0, n);
                const str = DEC.decode(chunk);

                // Check for Ctrl+C
                if (str.includes("\x03")) {
                    state.isCleanExit = true;
                    state.isRunning = false;
                    break;
                }

                // Handle Input Logic
                await processInput(str, chunk, state, conn);
            }
        } catch (e) {
            // Error reading stdin
        }
    };

    try {
        await Promise.race([handleOutput(), handleInput()]);
    } finally {
        // Cleanup
        state.isRunning = false;
        try { Deno.stdin.setRaw(false); } catch { }
        try { conn.close(); } catch { }

        // Final cleanup of footer area
        // Move to bottom and print newline to preserve last log
        writeRaw("\n");
        console.log("Disconnected.");
    }
}

// --- UI Logic ---

function writeLog(chunk: Uint8Array, state: AttachState) {
    const text = DEC.decode(chunk);
    if (!text) return;

    writeRaw(ANSI.hideCursor);

    // 1. Move Cursor Up to clear footer
    // We assume cursor is at the end of input line (bottom)
    writeRaw(ANSI.up(FOOTER_HEIGHT - 1));
    writeRaw(ANSI.moveCol(0));
    writeRaw(ANSI.clearScreenDown);

    // 2. Write Log
    // If text does not end with newline, add one for separation (visual only, we don't modify log content effectively)
    // Actually, to keep "scrolling" working correctly, we just print the log.
    // If the log is partial line, it might mess up, but Docker logs usually line-buffer reasonably well for display.
    writeRaw(chunk);

    if (!text.endsWith("\n")) {
        writeRaw("\n");
    }

    // 3. Redraw Footer
    drawFooter(state);
    writeRaw(ANSI.showCursor);
}

function drawFooter(state: AttachState) {
    // We expect to be at the line AFTER the last log output
    // Line 1: Status
    writeRaw(`${ANSI.clearLine}\x1b[44m[${state.containerName}] Connected via Socket | Ctrl+C to Detach\x1b[0m\n`);
    // Line 2: Input
    writeRaw(`${ANSI.clearLine}> ${state.currentInput}`);
}

async function processInput(str: string, rawChunk: Uint8Array, state: AttachState, conn: Deno.Conn) {
    // Simple line editing
    if (str === "\r" || str === "\n") {
        // Enter
        const cmd = state.currentInput + "\n";
        await conn.write(ENC.encode(cmd));

        state.currentInput = "";

        // Redraw footer (clear input line)
        writeRaw(ANSI.hideCursor);
        writeRaw(ANSI.up(FOOTER_HEIGHT - 1));
        drawFooter(state);
        writeRaw(ANSI.showCursor);

    } else if (str === "\x7f" || str === "\b") {
        // Backspace
        if (state.currentInput.length > 0) {
            state.currentInput = state.currentInput.slice(0, -1);
            // Updating input line only would be efficient, but let's just redraw
            writeRaw(`\r${ANSI.clearLine}> ${state.currentInput}`);
        }
    } else {
        // Filter out non-printable or special control sequences if strict
        // For now, accept printable characters
        if (str.length === 1 && str.charCodeAt(0) >= 32) {
            state.currentInput += str;
            // Local echo
            writeRaw(rawChunk);
        }
    }
}
