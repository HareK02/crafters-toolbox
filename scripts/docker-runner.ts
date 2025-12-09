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
    const { initStatusBar, drawStatusBar, drawInputLine, clearInputAndStatus, resetScrollingRegion, getTerminalSize, ANSI } = await import("./terminal/status-bar.ts");

    // Initialize status bar (sets scrolling region)
    initStatusBar();

    // Start docker attach process
    const attachCommand = new Deno.Command("docker", {
        args: ["attach", "--sig-proxy=false", containerName],
        stdout: "piped",
        stderr: "piped",
        stdin: "piped",
    });

    const attachProcess = attachCommand.spawn();
    const inputWriter = attachProcess.stdin.getWriter();

    // Create a decoder for the output
    const decoder = new TextDecoder();

    // Input state
    let currentInput = "";

    // Function to update input line only
    const updateInputLine = () => {
        drawInputLine("> ", currentInput);
    };

    // Function to draw static status bar (only once or on resize)
    const drawStaticStatusBar = () => {
        const statusText = `Container: ${containerName} | Type command and press Enter | Ctrl+C to exit`;
        drawStatusBar(statusText);
        updateInputLine();
    };

    // Initial draw
    drawStaticStatusBar();

    // Helper to write log with cursor preservation
    const writeLog = (text: string) => {
        const { rows } = getTerminalSize();
        // Save cursor, move to bottom of scroll region, write, restore cursor
        // We write to rows-2 because that's the bottom of scroll region
        const output =
            ANSI.saveCursor +
            ANSI.moveTo(rows - 2, 1) +
            text +
            ANSI.restoreCursor;

        Deno.stdout.writeSync(new TextEncoder().encode(output));
    };

    // Handle stdout
    const readStdout = async () => {
        try {
            for await (const chunk of attachProcess.stdout) {
                const text = decoder.decode(chunk);
                writeLog(text);
            }
        } catch (error) {
            // Stream ended
        }
    };

    // Handle stderr
    const readStderr = async () => {
        try {
            for await (const chunk of attachProcess.stderr) {
                const text = decoder.decode(chunk);
                writeLog(text);
            }
        } catch (error) {
            // Stream ended
        }
    };

    // Handle keyboard input
    const handleInput = async () => {
        // Set stdin to raw mode
        Deno.stdin.setRaw(true);

        const buffer = new Uint8Array(1);
        try {
            while (true) {
                const n = await Deno.stdin.read(buffer);
                if (n === null) break;

                const char = buffer[0];

                // Ctrl+C (3)
                if (char === 3) {
                    break;
                }
                // Enter (13 or 10)
                else if (char === 13 || char === 10) {
                    if (currentInput.trim()) {
                        const command = currentInput.trim() + "\n";
                        try {
                            await inputWriter.write(new TextEncoder().encode(command));
                        } catch (error) {
                            // Write failed
                        }
                        currentInput = "";
                        updateInputLine();
                    }
                }
                // Backspace (127 or 8)
                else if (char === 127 || char === 8) {
                    if (currentInput.length > 0) {
                        currentInput = currentInput.slice(0, -1);
                        updateInputLine();
                    }
                }
                // Printable characters
                else if (char >= 32 && char <= 126) {
                    currentInput += String.fromCharCode(char);
                    updateInputLine();
                }
            }
        } catch (error) {
            // Input ended
        } finally {
            Deno.stdin.setRaw(false);
        }
    };

    // Start all async tasks
    const readPromise = Promise.all([readStdout(), readStderr()]);
    const inputPromise = handleInput();

    // Wait for any to complete
    try {
        await Promise.race([
            attachProcess.status,
            readPromise,
            inputPromise,
        ]);
    } catch (error) {
        // Process ended
    } finally {
        // Cleanup
        resetScrollingRegion(); // CRITICAL: Reset scrolling region
        clearInputAndStatus();
        Deno.stdin.setRaw(false);

        // Kill the attach process
        try {
            attachProcess.kill("SIGTERM");
        } catch {
            // Process already ended
        }
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
