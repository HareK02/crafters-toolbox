import { join } from "@std/path";

import { Command } from "../command.ts";
import { dockerTest } from "../docker-test.ts";
import {
  getContainerName,
  getContainerStatus,
  getSSHServerConfig,
  runContainer,
  stopContainer,
} from "../docker-runner.ts";
import { getSSHConfig, loadConfig } from "../config.ts";
import type { ResolvedSSHConfig } from "../config.ts";

const SSH_SERVICE = "ssh-server";
const SSH_KEYS_DIR = ".ssh";
const AUTHORIZED_KEYS_FILE = join(SSH_KEYS_DIR, "authorized_keys");
const SSH_DISABLED_MESSAGE =
  "SSH service is disabled in crtb.config.yml (set ssh.enabled: true to enable it).";

function resolveSSHConfig(): ResolvedSSHConfig {
  return getSSHConfig(loadConfig());
}

async function showStatus(sshConfig: ResolvedSSHConfig) {
  if (!sshConfig.enabled) {
    console.log(SSH_DISABLED_MESSAGE);
    return;
  }

  const containerName = getContainerName(SSH_SERVICE);
  const status = await getContainerStatus(containerName);

  if (!status.exists) {
    console.log(
      "SSH server is not running. Use `crtb ssh start` to launch the collaboration SSH container.",
    );
  } else {
    console.log(
      `ssh-server: ${status.running ? "running" : "stopped"} (${
        status.state ?? "unknown"
      })`,
    );
  }

  const passwordState = sshConfig.passwordAuth.enabled
    ? (sshConfig.passwordAuth.value ? "enabled" : "enabled (password not set)")
    : "disabled";
  const keyState = sshConfig.keyAuth.enabled ? "enabled" : "disabled";
  console.log(`Auth config -> keys: ${keyState}, password: ${passwordState}`);
}

async function ensureAuthorizedKeysFile() {
  await Deno.mkdir(SSH_KEYS_DIR, { recursive: true });
  try {
    await Deno.stat(AUTHORIZED_KEYS_FILE);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      await Deno.writeTextFile(AUTHORIZED_KEYS_FILE, "");
    } else {
      throw error;
    }
  }
  await safeChmod(SSH_KEYS_DIR, 0o700);
  await safeChmod(AUTHORIZED_KEYS_FILE, 0o600);
}

async function safeChmod(path: string, mode: number) {
  try {
    await Deno.chmod(path, mode);
  } catch (_) {
    // noop for environments that do not support chmod
  }
}

async function getAuthorizedKeys(): Promise<string[]> {
  try {
    const content = await Deno.readTextFile(AUTHORIZED_KEYS_FILE);
    return content.split(/\r?\n/).map((line) => line.trim()).filter((line) =>
      line.length
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
}

async function saveAuthorizedKeys(keys: string[]) {
  await ensureAuthorizedKeysFile();
  const formatted = keys.map((line) => `${line}\n`).join("");
  await Deno.writeTextFile(AUTHORIZED_KEYS_FILE, formatted);
  await safeChmod(AUTHORIZED_KEYS_FILE, 0o600);
}

async function listAuthorizedKeys() {
  await ensureAuthorizedKeysFile();
  const keys = await getAuthorizedKeys();
  const sshConfig = resolveSSHConfig();
  console.log(`Authorized keys file: ${AUTHORIZED_KEYS_FILE}`);
  if (!sshConfig.keyAuth.enabled) {
    console.log(
      "Note: Key authentication is disabled (ssh.auth.keys.enabled = false).",
    );
  }
  if (!keys.length) {
    console.log(
      "No SSH public keys found. Use `crtb ssh keys add <public-key|--file path>` to add one.",
    );
    return;
  }
  keys.forEach((key, index) => {
    console.log(`${index + 1}. ${key}`);
  });
}

async function addAuthorizedKey(args: string[]) {
  const key = await resolveKeyInput(args);
  if (!key) {
    console.error(
      "Provide a public key string or --file <path> that contains one.",
    );
    return;
  }
  const keys = await getAuthorizedKeys();
  if (keys.includes(key)) {
    console.log("The provided key already exists in authorized_keys.");
    return;
  }
  keys.push(key);
  await saveAuthorizedKeys(keys);
  console.log("Added public key to authorized_keys.");
}

async function removeAuthorizedKey(args: string[]) {
  if (!args.length) {
    console.error(
      "Specify the key index to remove (see `crtb ssh keys list`).",
    );
    return;
  }
  const index = Number.parseInt(args[0], 10);
  if (!Number.isInteger(index) || index < 1) {
    console.error("Key index must be a positive integer.");
    return;
  }
  const keys = await getAuthorizedKeys();
  if (index > keys.length) {
    console.error(`Key index ${index} is out of range (found ${keys.length}).`);
    return;
  }
  const [removed] = keys.splice(index - 1, 1);
  await saveAuthorizedKeys(keys);
  console.log(`Removed key #${index}: ${removed}`);
}

async function resolveKeyInput(args: string[]): Promise<string | undefined> {
  if (!args.length) return undefined;
  if (args[0] === "--file" || args[0] === "-f") {
    const filePath = args[1];
    if (!filePath) {
      console.error("Missing file path after --file.");
      return undefined;
    }
    return await readKeyFromFile(filePath, true);
  }
  const joined = args.join(" ").trim();
  if (!joined) return undefined;
  const fromFile = await readKeyFromFile(joined, false);
  if (fromFile) return fromFile;
  return joined;
}

async function readKeyFromFile(
  filePath: string,
  strict: boolean,
): Promise<string | undefined> {
  try {
    const stat = await Deno.stat(filePath);
    if (!stat.isFile) {
      if (strict) console.error(`"${filePath}" is not a regular file.`);
      return undefined;
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      if (strict) console.error(`Key file not found: ${filePath}`);
      return undefined;
    }
    throw error;
  }
  const content = await Deno.readTextFile(filePath);
  const keyLine = content.split(/\r?\n/).map((line) => line.trim()).find((
    line,
  ) => line.length);
  if (!keyLine) {
    if (strict) console.error(`Key file "${filePath}" is empty.`);
    return undefined;
  }
  return keyLine;
}

async function startSSHContainer() {
  const sshConfig = resolveSSHConfig();
  if (!sshConfig.enabled) {
    console.error(SSH_DISABLED_MESSAGE);
    return;
  }
  if (!(await dockerTest())) return;

  console.log("Starting ssh-server...");
  const config = getSSHServerConfig();
  const started = await runContainer(SSH_SERVICE, config);

  if (!started) {
    console.error("Failed to start SSH server");
  }
}

async function stopSSHContainer() {
  const sshConfig = resolveSSHConfig();
  if (!sshConfig.enabled) {
    console.log(
      `${SSH_DISABLED_MESSAGE} Attempting to stop any existing ssh containers anyway...`,
    );
  }
  if (!(await dockerTest())) return;

  console.log("Stopping ssh-server...");
  const containerName = getContainerName(SSH_SERVICE);
  await stopContainer(containerName);
}

const sshCommand: Command = {
  name: "ssh",
  description: "Manage the SSH collaboration container",
  subcommands: [
    {
      name: "start",
      description: "Start the SSH container in detached mode",
      handler: async (_args: string[]) => {
        await startSSHContainer();
      },
    },
    {
      name: "up",
      description: "Alias of start (will be removed in a future release)",
      handler: async (_args: string[]) => {
        await startSSHContainer();
      },
    },
    {
      name: "stop",
      description: "Stop the SSH container",
      handler: async () => {
        await stopSSHContainer();
      },
    },
    {
      name: "down",
      description: "Alias of stop (will be removed in a future release)",
      handler: async () => {
        await stopSSHContainer();
      },
    },
    {
      name: "keys",
      description: "Manage .ssh/authorized_keys entries",
      subcommands: [
        {
          name: "list",
          description: "List authorized SSH public keys",
          handler: async () => {
            await listAuthorizedKeys();
          },
        },
        {
          name: "add",
          description: "Add a public key string or --file path",
          handler: async (args: string[]) => {
            await addAuthorizedKey(args);
          },
        },
        {
          name: "remove",
          description: "Remove a public key by its list index",
          handler: async (args: string[]) => {
            await removeAuthorizedKey(args);
          },
        },
        {
          name: "path",
          description: "Show the location of authorized_keys",
          handler: async () => {
            console.log(AUTHORIZED_KEYS_FILE);
          },
        },
      ],
      handler: async () => {
        await listAuthorizedKeys();
      },
    },
  ],
  handler: async (args: string[]) => {
    if (args.length) {
      console.error(
        `Unknown ssh subcommand: ${
          args[0]
        }. Use start, stop, keys, or no subcommand to view status.`,
      );
      return;
    }
    const sshConfig = resolveSSHConfig();
    if (!sshConfig.enabled) {
      console.log(SSH_DISABLED_MESSAGE);
      return;
    }
    if (!(await dockerTest())) return;
    await showStatus(sshConfig);
  },
};

export default sshCommand;
