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

    // Positioning
    moveTo: (row: number, col: number) => `${CSI}${row};${col}H`,
    moveToBottom: `${CSI}999;1H`, // Move to bottom left

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
 * Set the scrolling region of the terminal
 * This allows us to reserve the bottom lines for the status bar and input
 */
export function setScrollingRegion(top: number, bottom: number): void {
    const output = `${CSI}${top};${bottom}r`;
    Deno.stdout.writeSync(new TextEncoder().encode(output));
}

/**
 * Reset the scrolling region to the full screen
 */
export function resetScrollingRegion(): void {
    const output = `${CSI}r`; // No arguments resets to full screen
    Deno.stdout.writeSync(new TextEncoder().encode(output));
}

/**
 * Clear both input line and status bar
 */
export function clearInputAndStatus(): void {
    // With scrolling region, we just need to move cursor to stored position
    // No explicit clearing needed usually, but we implement reset here
    resetScrollingRegion();

    const { rows } = getTerminalSize();
    const output =
        ANSI.moveTo(rows - 1, 1) +
        ANSI.clearLine +
        ANSI.moveTo(rows, 1) +
        ANSI.clearLine +
        ANSI.showCursor; // Ensure cursor is visible

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
 * Initialize status bar with scrolling region
 */
export function initStatusBar(): void {
    const { rows } = getTerminalSize();
    // Reserve bottom 2 lines (one for input, one for status)
    // Set scrolling region from line 1 to rows-2
    setScrollingRegion(1, rows - 2);

    // Clear the screen to apply changes cleanly
    Deno.stdout.writeSync(new TextEncoder().encode(ANSI.clearScreen));

    // Move cursor to input line (second to last)
    Deno.stdout.writeSync(new TextEncoder().encode(`${CSI}${rows - 1};1H`));

    // Set up cleanup on exit
    const cleanup = () => {
        resetScrollingRegion();
        clearStatusBar();
        Deno.stdout.writeSync(new TextEncoder().encode(ANSI.showCursor));
    };

    // Register cleanup handlers
    globalThis.addEventListener("unload", cleanup);

    // Deno.addSignalListener can throw in some environments or only allow one listener
    try {
        Deno.addSignalListener("SIGINT", cleanup);
        Deno.addSignalListener("SIGTERM", cleanup);
    } catch {
        // Ignore errors
    }
}
