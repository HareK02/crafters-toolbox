
import { parseArgs } from "jsr:@std/cli/parse-args";

// --- ANSI Helper ---
const ENC = new TextEncoder();
const ESC = "\x1b[";
const ANSI = {
    hideCursor: `${ESC}?25l`,
    showCursor: `${ESC}?25h`,
    clearLine: `${ESC}2K`,
    clearScreenDown: `${ESC}J`,
    up: (n: number) => `${ESC}${n}A`,
    moveCol: (n: number) => `${ESC}${n}G`,
    saveCursor: `${ESC}s`, // Or ESC 7
    restoreCursor: `${ESC}u`, // Or ESC 8
};

function writeRaw(text: string) {
    if (!text) return;
    Deno.stdout.writeSync(ENC.encode(text));
}

// --- Status State ---
// Footer height: Let's say 2 lines (1 for status, 1 for input)
const FOOTER_HEIGHT = 2;
let currentInput = "";
let isCleanExit = false;

// --- Rendering Logic ---

// 1. Erase Footer -> Print Log -> Redraw Footer
function writeLog(text: string | Uint8Array) {
    // Convert to string if needed
    const str = typeof text === "string" ? text : new TextDecoder().decode(text);
    if (!str) return;

    writeRaw(ANSI.hideCursor);

    // Move up to the top of the footer
    // We assume the cursor is currently resting at the END of the input line (bottom row)
    // So we move up (FOOTER_HEIGHT - 1) lines to get to the start of the footer
    if (FOOTER_HEIGHT > 1) {
        writeRaw(ANSI.up(FOOTER_HEIGHT - 1));
    }

    // Go to column 0 and clear everything below
    writeRaw(ANSI.moveCol(0) + ANSI.clearScreenDown);

    // Print the log (this pushes history up if needed)
    // Ensure we don't print undefined newlines if the chunk is partial, 
    // but usually we want to ensure it ends with newline to separate from footer.
    Deno.stdout.writeSync(typeof text === "string" ? ENC.encode(text) : text);

    // If the log didn't end with a newline, we MUST add one, 
    // otherwise the footer starts on the same line as the log.
    if (!str.endsWith("\n")) {
        writeRaw("\n");
    }

    // Now redraw the footer at the new bottom
    drawFooter();

    writeRaw(ANSI.showCursor);
}

function drawFooter() {
    // Line 1: Status Bar
    writeRaw(`\r${ANSI.clearLine}`);
    writeRaw(`\x1b[44m[STATUS] Connected to Docker | Ctrl+C to Exit\x1b[0m\n`);

    // Line 2: Input
    writeRaw(`${ANSI.clearLine}> ${currentInput}`);
}

// --- Main Script ---

const args = parseArgs(Deno.args);
const containerName = args._[0];

if (!containerName) {
    console.error("Usage: deno run -A scripts/fixed-footer.ts <container-name>");
    Deno.exit(1);
}

// Setup TTY
try {
    Deno.stdin.setRaw(true);
} catch (e) {
    console.error("Warning: Could not set raw mode. Input might behave strictly.");
}

console.log(`Connecting to ${containerName}...`);

try {
    const conn = await Deno.connect({
        transport: "unix",
        path: "/var/run/docker.sock"
    });

    const request =
        `POST /containers/${containerName}/attach?stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.1\r
Host: localhost\r
Upgrade: tcp\r
Connection: Upgrade\r
\r
`;

    await conn.write(ENC.encode(request));

    // Headers
    const buffer = new Uint8Array(1);
    let header = "";
    while (true) {
        const n = await conn.read(buffer);
        if (n === null) throw new Error("Connection closed");
        header += String.fromCharCode(buffer[0]);
        if (header.endsWith("\r\n\r\n")) break;
    }

    if (!header.startsWith("HTTP/1.1 101") && !header.startsWith("HTTP/1.0 101")) {
        console.error("Failed to attach.");
        Deno.exit(1);
    }

    // Initial draw
    drawFooter();

    // Loop for Docker Output
    const handleOutput = async () => {
        const buffer = new Uint8Array(4096);
        try {
            while (true) {
                const n = await conn.read(buffer);
                if (n === null) break;
                // Decomposed: We intercept the output here
                const chunk = buffer.subarray(0, n);
                writeLog(chunk);
            }
        } catch (e) {
            // closed
        }
    };

    // Loop for User Input
    const handleInput = async () => {
        const buffer = new Uint8Array(64); // Small buffer for keystrokes
        try {
            while (true) {
                const n = await Deno.stdin.read(buffer);
                if (n === null) break;

                const chunk = buffer.subarray(0, n);
                const str = new TextDecoder().decode(chunk);

                // Handle special keys
                if (str === "\x03") { // Ctrl+C
                    isCleanExit = true;
                    throw new Error("Exit");
                }

                if (str === "\r" || str === "\n") { // Enter
                    // 1. Send to container
                    const cmd = currentInput + "\n";
                    await conn.write(ENC.encode(cmd));

                    // 2. Feedback in log (Optional: Local echo)
                    // writeLog(`> ${currentInput}\n`); 

                    // 3. Clear Input
                    currentInput = "";

                    // 4. Redraw footer (to clear input line)
                    // Since we didn't call writeLog, we just manually update footer
                    // Note: If we don't 'writeLog', we haven't scrolled. 
                    // So we just overwrite the current footer lines.
                    writeRaw(ANSI.hideCursor);
                    writeRaw(ANSI.up(FOOTER_HEIGHT - 1));
                    drawFooter();
                    writeRaw(ANSI.showCursor);

                } else if (str === "\x7f" || str === "\b") { // Backspace
                    if (currentInput.length > 0) {
                        currentInput = currentInput.slice(0, -1);
                        // Redraw just the input line
                        writeRaw(`\r${ANSI.clearLine}> ${currentInput}`);
                    }
                } else if (str.length === 1 && str.charCodeAt(0) >= 32) {
                    // Normal char
                    currentInput += str;
                    Deno.stdout.writeSync(chunk); // Local echo typing
                }
            }
        } catch (e: any) {
            if (e.message !== "Exit") throw e;
        }
    };

    await Promise.race([handleOutput(), handleInput()]);

} catch (error: any) {
    if (!isCleanExit) {
        console.error(error);
    }
} finally {
    try { Deno.stdin.setRaw(false); } catch { }
    // Reset cursor to below footer
    writeRaw("\n");
}
