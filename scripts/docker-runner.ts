import { basename } from "jsr:@std/path";
import { getLocalIdentity, getUserSpec } from "./docker-env.ts";

/**
 * Get the project name from the current working directory
 */
export function getProjectName(): string {
    const cwd = Deno.cwd();
    return basename(cwd);
}

/**
 * Get container name for a service
 */
export function getContainerName(service: string): string {
    const project = getProjectName();
    const serviceSuffix = service.replace("-server", "");
    return `${project}-${serviceSuffix}`;
}

/**
 * Get environment variables for docker run as array format
 */
export function getDockerRunEnv(): string[] {
    const identity = getLocalIdentity();

    return [
        `-e`, `LOCAL_UID=${identity.uid}`,
        `-e`, `LOCAL_GID=${identity.gid}`,
        `-e`, `LOCAL_USER=${identity.username}`,
    ];
}

/**
 * Check if a container exists and is running
 */
export async function getContainerStatus(containerName: string): Promise<{
    exists: boolean;
    running: boolean;
    state?: string;
}> {
    try {
        const command = new Deno.Command("docker", {
            args: ["inspect", "--format", "{{json .State}}", containerName],
            stdout: "piped",
            stderr: "piped",
        });

        const { success, stdout } = await command.output();
        if (!success) {
            return { exists: false, running: false };
        }

        const text = new TextDecoder().decode(stdout).trim();
        const state = JSON.parse(text) as { Running: boolean; Status: string };

        return {
            exists: true,
            running: state.Running,
            state: state.Status,
        };
    } catch {
        return { exists: false, running: false };
    }
}

/**
 * Stop and remove a container
 */
export async function stopContainer(containerName: string): Promise<boolean> {
    const status = await getContainerStatus(containerName);

    if (!status.exists) {
        return true; // Already stopped/removed
    }

    if (status.running) {
        // Stop the container
        const stopCmd = new Deno.Command("docker", {
            args: ["stop", containerName],
            stdout: "inherit",
            stderr: "inherit",
        });

        const { success } = await stopCmd.output();
        if (!success) {
            return false;
        }
    }

    // Remove the container
    const rmCmd = new Deno.Command("docker", {
        args: ["rm", containerName],
        stdout: "inherit",
        stderr: "inherit",
    });

    const { success } = await rmCmd.output();
    return success;
}

interface RunContainerOptions {
    image?: string;
    entrypoint?: string[];
    ports?: string[];
    volumes?: string[];
    env?: string[];
    user?: string;
    restart?: string;
    detach?: boolean;
    network?: string;
}

/**
 * Run a container with the specified configuration
 */
export async function runContainer(
    service: string,
    options: RunContainerOptions = {},
): Promise<boolean> {
    const containerName = getContainerName(service);

    // Stop existing container if running
    await stopContainer(containerName);

    const args = ["run"];

    // Container name
    args.push("--name", containerName);

    // TTY and stdin
    args.push("-t", "-i");

    // Detach mode
    if (options.detach !== false) {
        args.push("-d");
    }

    // Restart policy
    if (options.restart) {
        args.push("--restart", options.restart);
    }

    // User
    if (options.user) {
        args.push("--user", options.user);
    } else {
        const identity = getLocalIdentity();
        const userSpec = getUserSpec((identity.uid ?? 0) as number, (identity.gid ?? 0) as number);
        args.push("--user", userSpec);
    }

    // Environment variables
    const envVars = [...getDockerRunEnv(), ...(options.env || [])];
    args.push(...envVars);

    // Add host.docker.internal
    args.push("--add-host", "host.docker.internal:host-gateway");

    // Network
    if (options.network) {
        args.push("--network", options.network);
    }

    // Volumes
    if (options.volumes) {
        for (const volume of options.volumes) {
            args.push("-v", volume);
        }
    }

    // Ports
    if (options.ports) {
        for (const port of options.ports) {
            args.push("-p", port);
        }
    }

    // Entrypoint
    if (options.entrypoint) {
        args.push("--entrypoint", options.entrypoint[0]);
    }

    // Image
    const image = options.image || "crafters-toolbox:latest";
    args.push(image);

    // Additional entrypoint args
    if (options.entrypoint && options.entrypoint.length > 1) {
        args.push(...options.entrypoint.slice(1));
    }

    const command = new Deno.Command("docker", {
        args,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
    });

    const { success } = await command.output();
    return success;
}

/**
 * Attach to a running container's console with status bar and command input
 */
export async function attachContainer(containerName: string): Promise<boolean> {
    const status = await getContainerStatus(containerName);

    if (!status.exists || !status.running) {
        console.error(`Container ${containerName} is not running`);
        return false;
    }

    // Import status bar utilities
    const { initStatusBar, drawStatusBar, drawInputLine, getTerminalSize, ANSI } = await import("./terminal/status-bar.ts");

    // Initialize status bar
    initStatusBar();

    // Start docker logs process
    const logsCommand = new Deno.Command("docker", {
        args: ["logs", "-f", "--tail", "100", containerName],
        stdout: "piped",
        stderr: "piped",
    });

    const logsProcess = logsCommand.spawn();

    // Start persistent input process
    const inputCommand = new Deno.Command("docker", {
        args: ["attach", "--detach-keys", "ctrl-c", containerName],
        stdin: "piped",
        stdout: "null",
        stderr: "null",
    });

    const inputProcess = inputCommand.spawn();
    const inputWriter = inputProcess.stdin.getWriter();

    // Decoder
    const decoder = new TextDecoder();

    let currentInput = "";

    // Function to redraw the UI at the bottom
    const redrawUI = () => {
        const { rows } = getTerminalSize();
        // Move to bottom-1 line, Clear to end, Draw Input, Draw Status
        // Note: We use manual cursor controls here to be absolutely precise
        const output =
            ANSI.hideCursor +
            ANSI.moveTo(rows - 1, 1) +
            ANSI.clearScreenDown +
            "> " + currentInput + "\n" +
            (containerName.length > 50 ? containerName.slice(0, 50) : containerName) + " | Type command... | Ctrl+C to exit" +
            ANSI.showCursor +
            ANSI.moveTo(rows - 1, (currentInput.length + 3)); // Position cursor at end of input

        Deno.stdout.writeSync(new TextEncoder().encode(output));
    };

    // Helper to write log
    const writeLog = (text: string) => {
        // 1. Hide Cursor
        Deno.stdout.writeSync(new TextEncoder().encode(ANSI.hideCursor));

        // 2. Move to start of Input Line (Footer start)
        const { rows } = getTerminalSize();
        Deno.stdout.writeSync(new TextEncoder().encode(ANSI.moveTo(rows - 1, 1)));

        // 3. Clear Footer
        Deno.stdout.writeSync(new TextEncoder().encode(ANSI.clearScreenDown));

        // 4. Write Log (Trim trailing newline allows us to control the last break)
        // If text ends with \n, and we write it, the cursor moves to next line.
        // We want standard output behavior.
        Deno.stdout.writeSync(new TextEncoder().encode(text));

        // 5. If the last character wasn't a newline, we MUST add one
        // otherwise the input line will be drawn on the same line as the log.
        if (!text.endsWith("\n")) {
            Deno.stdout.writeSync(new TextEncoder().encode("\n"));
        }

        // 6. Redraw UI
        redrawUI();
    };

    // Initial draw
    redrawUI();

    const uiInterval = setInterval(redrawUI, 1000);

    // Use TextLineStream easily if available, but for now implementing a robust line reader manually
    // to avoid dependency issues if @std/streams is not configured.
    // If we wanted to use @std/streams:
    // import { TextLineStream } from "jsr:@std/streams/text-line-stream";
    // process.stdout.pipeThrough(new TextDecoderStream()).pipeThrough(new TextLineStream())

    // Manual robust buffering equivalent to TextLineStream
    const createLineProcessor = (reader: ReadableStream<Uint8Array>, onLine: (line: string) => void) => {
        const decoder = new TextDecoder();
        let buffer = "";

        return async () => {
            try {
                for await (const chunk of reader) {
                    const text = decoder.decode(chunk, { stream: true });
                    const parts = (buffer + text).split("\n");
                    buffer = parts.pop() || "";

                    for (const line of parts) {
                        onLine(line);
                    }
                }
                // Flush remaining
                if (buffer) {
                    onLine(buffer);
                }
            } catch (error) {
                // Ignore errors
            }
        };
    };

    // Handle stdout
    const readStdout = createLineProcessor(logsProcess.stdout, (line) => {
        // Filter out empty lines if desired, but general logs might need them
        writeLog(line + "\n");
    });

    // Handle stderr
    const readStderr = createLineProcessor(logsProcess.stderr, (line) => {
        writeLog(line + "\n");
    });

    // Handle keyboard input
    const handleInput = async () => {
        Deno.stdin.setRaw(true);
        const buffer = new Uint8Array(1);
        try {
            while (true) {
                const n = await Deno.stdin.read(buffer);
                if (n === null) break;
                const char = buffer[0];

                if (char === 3) break; // Ctrl+C

                else if (char === 13 || char === 10) { // Enter
                    if (currentInput.trim()) {
                        const command = currentInput.trim() + "\n";
                        try {
                            await inputWriter.write(new TextEncoder().encode(command));
                        } catch (error) { }
                        currentInput = "";
                        redrawUI();
                    }
                }
                else if (char === 127 || char === 8) { // Backspace
                    if (currentInput.length > 0) {
                        currentInput = currentInput.slice(0, -1);
                        redrawUI();
                    }
                }
                else if (char >= 32 && char <= 126) {
                    currentInput += String.fromCharCode(char);
                    redrawUI();
                }
            }
        } catch (error) { }
        finally { Deno.stdin.setRaw(false); }
    };

    const readPromise = Promise.all([readStdout(), readStderr()]);
    const inputPromise = handleInput();

    try {
        await Promise.race([logsProcess.status, readPromise, inputPromise]);
    } catch (error) {
    } finally {
        clearInterval(uiInterval);
        // Clear footer one last time
        const { rows } = getTerminalSize();
        Deno.stdout.writeSync(new TextEncoder().encode(ANSI.moveTo(rows - 1, 1) + ANSI.clearScreenDown));

        Deno.stdin.setRaw(false);
        try {
            logsProcess.kill("SIGTERM");
            inputProcess.kill("SIGTERM");
        } catch { }
    }

    return true;
}

/**
 * Configuration for game server container
 */
export function getGameServerConfig(): RunContainerOptions {
    return {
        entrypoint: ["start-game"],
        restart: "unless-stopped",
        network: "bridge",
        env: [
            `-e`, `MEM_MAX=${Deno.env.get("MEM_MAX") || "4G"}`,
        ],
        volumes: [
            `${Deno.cwd()}/server:/home/container/server`,
        ],
        ports: [
            "25565:25565",
        ],
    };
}

/**
 * Configuration for SSH server container
 */
export function getSSHServerConfig(): RunContainerOptions {
    return {
        entrypoint: ["start-ssh"],
        user: "0:0", // SSH server needs root
        env: [
            `-e`, `SSH_PORT=${Deno.env.get("SSH_PORT") || "2222"}`,
            `-e`, `SSH_ENABLE_PASSWORD_AUTH=${Deno.env.get("SSH_ENABLE_PASSWORD_AUTH") || "false"}`,
            `-e`, `SSH_ENABLE_KEY_AUTH=${Deno.env.get("SSH_ENABLE_KEY_AUTH") || "true"}`,
            `-e`, `SSH_PASSWORD=${Deno.env.get("SSH_PASSWORD") || ""}`,
        ],
        volumes: [
            `${Deno.cwd()}/components:/home/container/components`,
            `${Deno.cwd()}/server:/home/container/server`,
            `${Deno.cwd()}/.ssh:/home/container/.ssh`,
        ],
        ports: [
            "2222:2222",
        ],
    };
}

/**
 * Configuration for monitor server container
 */
export function getMonitorServerConfig(): RunContainerOptions {
    return {
        entrypoint: ["start-monitor"],
        env: [
            `-e`, `MONITOR_SUMMARY_INTERVAL=${Deno.env.get("MONITOR_SUMMARY_INTERVAL") || "300"}`,
        ],
        volumes: [
            `${Deno.cwd()}/server:/home/container/server`,
        ],
    };
}
