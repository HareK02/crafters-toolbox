/**
 * Terminal status bar utilities
 */

const ESC = "\x1b";
const CSI = `${ESC}[`;

/**
 * ANSI escape sequences for terminal control
 */
export const ANSI = {
    // Cursor control
    saveCursor: `${ESC}7`,
    restoreCursor: `${ESC}8`,
    hideCursor: `${CSI}?25l`,
    showCursor: `${CSI}?25h`,

    // Screen control
    clearScreen: `${CSI}2J`,
    clearLine: `${CSI}2K`,
    clearScreenDown: `${CSI}J`, // Clear from cursor to end of screen

    // Positioning
    moveTo: (row: number, col: number) => `${CSI}${row};${col}H`,
    moveToBottom: `${CSI}999;1H`, // Move to bottom left
    moveUp: (count: number) => `${CSI}${count}A`,

    // Colors
    reset: `${CSI}0m`,
    bold: `${CSI}1m`,
    dim: `${CSI}2m`,

    // Background colors
    bgBlack: `${CSI}40m`,
    bgRed: `${CSI}41m`,
    bgGreen: `${CSI}42m`,
    bgYellow: `${CSI}43m`,
    bgBlue: `${CSI}44m`,
    bgMagenta: `${CSI}45m`,
    bgCyan: `${CSI}46m`,
    bgWhite: `${CSI}47m`,

    // Foreground colors
    fgBlack: `${CSI}30m`,
    fgRed: `${CSI}31m`,
    fgGreen: `${CSI}32m`,
    fgYellow: `${CSI}33m`,
    fgBlue: `${CSI}34m`,
    fgMagenta: `${CSI}35m`,
    fgCyan: `${CSI}36m`,
    fgWhite: `${CSI}37m`,
};

/**
 * Get terminal size
 */
export function getTerminalSize(): { rows: number; cols: number } {
    const size = Deno.consoleSize();
    return { rows: size.rows, cols: size.columns };
}

/**
 * Draw a status bar at the bottom of the terminal
 */
export function drawStatusBar(content: string, options?: {
    bg?: string;
    fg?: string;
    align?: "left" | "center" | "right";
}): void {
    const { cols } = getTerminalSize();
    const bg = options?.bg || ANSI.bgBlack;
    const fg = options?.fg || ANSI.fgWhite;
    const align = options?.align || "left";

    // Pad content to fill the entire width
    let paddedContent = content;
    if (content.length < cols) {
        const padding = cols - content.length;
        if (align === "center") {
            const leftPad = Math.floor(padding / 2);
            const rightPad = padding - leftPad;
            paddedContent = " ".repeat(leftPad) + content + " ".repeat(rightPad);
        } else if (align === "right") {
            paddedContent = " ".repeat(padding) + content;
        } else {
            paddedContent = content + " ".repeat(padding);
        }
    } else if (content.length > cols) {
        paddedContent = content.slice(0, cols);
    }

    // Draw the status bar (last line)
    const output =
        ANSI.saveCursor +
        ANSI.moveToBottom +
        ANSI.clearLine +
        bg + fg +
        paddedContent +
        ANSI.reset +
        ANSI.restoreCursor;

    Deno.stdout.writeSync(new TextEncoder().encode(output));
}

/**
 * Draw an input line above the status bar
 */
export function drawInputLine(prompt: string, input: string): void {
    const { rows, cols } = getTerminalSize();
    const inputRow = rows - 1; // Second to last line

    // Combine prompt and input
    const fullLine = `${prompt}${input}`;

    // Pad to fill the entire width (with normal background)
    let paddedLine = fullLine;
    if (fullLine.length < cols) {
        paddedLine = fullLine + " ".repeat(cols - fullLine.length);
    } else if (fullLine.length > cols) {
        paddedLine = fullLine.slice(0, cols);
    }

    // Draw the input line
    const output =
        ANSI.saveCursor +
        `${CSI}${inputRow};1H` + // Move to second-to-last line
        ANSI.clearLine +
        paddedLine +
        ANSI.reset +
        ANSI.restoreCursor;

    Deno.stdout.writeSync(new TextEncoder().encode(output));
}

/**
 * Clear both input line and status bar
 */
export function clearInputAndStatus(): void {
    const { rows } = getTerminalSize();
    const inputRow = rows - 1;

    const output =
        ANSI.saveCursor +
        `${CSI}${inputRow};1H` +
        ANSI.clearLine +
        ANSI.moveToBottom +
        ANSI.clearLine +
        ANSI.restoreCursor;

    Deno.stdout.writeSync(new TextEncoder().encode(output));
}

/**
 * Clear the status bar
 */
export function clearStatusBar(): void {
    const output =
        ANSI.saveCursor +
        ANSI.moveToBottom +
        ANSI.clearLine +
        ANSI.restoreCursor;

    Deno.stdout.writeSync(new TextEncoder().encode(output));
}

/**
 * Initialize status bar
 */
export function initStatusBar(): void {
    // Hide cursor for clean UI update
    Deno.stdout.writeSync(new TextEncoder().encode(ANSI.hideCursor));

    // Set up cleanup on exit
    const cleanup = () => {
        clearInputAndStatus();
        Deno.stdout.writeSync(new TextEncoder().encode(ANSI.showCursor));
    };

    // Register cleanup handlers
    globalThis.addEventListener("unload", cleanup);

    try {
        Deno.addSignalListener("SIGINT", cleanup);
        Deno.addSignalListener("SIGTERM", cleanup);
    } catch {
        // Ignore errors
    }
}
