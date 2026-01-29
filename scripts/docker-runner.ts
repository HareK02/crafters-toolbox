import { attachToContainer } from "./terminal/docker-attach.ts";
import { basename } from "@std/path";
import { getLocalIdentity, getUserSpec } from "./docker-env.ts";
import { loadConfig } from "./config.ts";
import { resolveGameServerConfig, resolveSSHConfig } from "./config/migrate.ts";

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
    `-e`,
    `LOCAL_UID=${identity.uid}`,
    `-e`,
    `LOCAL_GID=${identity.gid}`,
    `-e`,
    `LOCAL_USER=${identity.username}`,
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
  } catch (error) {
    // Docker inspect failed - container likely doesn't exist or docker daemon is unavailable
    if (Deno.env.get("CRTB_DEBUG")) {
      console.debug(
        `[docker] Failed to inspect container ${containerName}:`,
        error,
      );
    }
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
    const userSpec = getUserSpec(
      (identity.uid ?? 0) as number,
      (identity.gid ?? 0) as number,
    );
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

  await attachToContainer(containerName);
  return true;
}

/**
 * Configuration for game server container
 */
export function getGameServerConfig(): RunContainerOptions {
  const config = resolveGameServerConfig(loadConfig());
  const memMax = Deno.env.get("MEM_MAX") || config.maxMemory;
  const memMin = Deno.env.get("MEM_MIN") || config.minMemory;
  const hostPort = Deno.env.get("GAME_PORT") || config.port;
  const rconPort = Deno.env.get("RCON_PORT") || config.rconPort;
  return {
    entrypoint: ["start-game"],
    restart: "unless-stopped",
    network: "bridge",
    env: [
      `-e`,
      `MEM_MAX=${memMax}`,
      ...(memMin ? [`-e`, `MEM_MIN=${memMin}`] : []),
    ],
    volumes: [
      `${Deno.cwd()}/server:/home/container/server`,
    ],
    ports: [
      `${hostPort}:25565`,
      `${rconPort}:25575`,
    ],
  };
}

/**
 * Configuration for SSH server container
 */
export function getSSHServerConfig(): RunContainerOptions {
  const resolved = resolveSSHConfig(loadConfig());
  const sshPort = Deno.env.get("SSH_PORT") || resolved.port;
  const passwordAuth = Deno.env.get("SSH_ENABLE_PASSWORD_AUTH") ||
    (resolved.passwordAuth.enabled ? "true" : "false");
  const keyAuth = Deno.env.get("SSH_ENABLE_KEY_AUTH") ||
    (resolved.keyAuth.enabled ? "true" : "false");
  const password = Deno.env.get("SSH_PASSWORD") ||
    (resolved.passwordAuth.value ?? "");
  return {
    entrypoint: ["start-ssh"],
    user: "0:0", // SSH server needs root
    env: [
      `-e`,
      `SSH_PORT=${sshPort}`,
      `-e`,
      `SSH_ENABLE_PASSWORD_AUTH=${passwordAuth}`,
      `-e`,
      `SSH_ENABLE_KEY_AUTH=${keyAuth}`,
      `-e`,
      `SSH_PASSWORD=${password}`,
    ],
    volumes: [
      `${Deno.cwd()}/components:/home/container/components`,
      `${Deno.cwd()}/server:/home/container/server`,
      `${Deno.cwd()}/.ssh:/home/container/.ssh`,
    ],
    ports: [
      `${sshPort}:2222`,
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
      `-e`,
      `MONITOR_SUMMARY_INTERVAL=${
        Deno.env.get("MONITOR_SUMMARY_INTERVAL") || "300"
      }`,
    ],
    volumes: [
      `${Deno.cwd()}/server:/home/container/server`,
    ],
  };
}
