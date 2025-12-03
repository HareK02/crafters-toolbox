const HOST_HAS_NATIVE_POSIX_IDS = Deno.build.os !== "windows";

const CUSTOM_UID = parseNumericEnv("CRTB_HOST_UID");
const CUSTOM_GID = parseNumericEnv("CRTB_HOST_GID");
const CUSTOM_USERNAME = Deno.env.get("CRTB_HOST_USER");
const HAS_CUSTOM_POSIX_IDS = CUSTOM_UID !== undefined &&
  CUSTOM_GID !== undefined;

const WSL_IDENTITY = !HOST_HAS_NATIVE_POSIX_IDS
  ? detectWslIdentity()
  : undefined;

export const HOST_SUPPORTS_POSIX_IDS = HOST_HAS_NATIVE_POSIX_IDS ||
  HAS_CUSTOM_POSIX_IDS ||
  WSL_IDENTITY !== undefined;

function parseNumericEnv(name: string): number | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.warn(
      `Ignoring ${name}: expected a non-negative integer but got "${raw}"`,
    );
    return undefined;
  }
  return value;
}

function fallbackPosixId() {
  return HOST_HAS_NATIVE_POSIX_IDS ? 1000 : 0;
}

function safeUid() {
  if (CUSTOM_UID !== undefined) return CUSTOM_UID;
  if (HOST_HAS_NATIVE_POSIX_IDS) {
    try {
      return Deno.uid();
    } catch (_) {
      return fallbackPosixId();
    }
  }
  if (WSL_IDENTITY?.uid !== undefined) return WSL_IDENTITY.uid;
  return fallbackPosixId();
}

function safeGid() {
  if (CUSTOM_GID !== undefined) return CUSTOM_GID;
  if (HOST_HAS_NATIVE_POSIX_IDS) {
    try {
      return Deno.gid();
    } catch (_) {
      return fallbackPosixId();
    }
  }
  if (WSL_IDENTITY?.gid !== undefined) return WSL_IDENTITY.gid;
  return fallbackPosixId();
}

function resolveUsername() {
  return CUSTOM_USERNAME ||
    Deno.env.get("LOCAL_USER") ||
    Deno.env.get("USER") ||
    Deno.env.get("USERNAME") ||
    WSL_IDENTITY?.username ||
    "ctbx";
}

export function getLocalIdentity() {
  return {
    uid: safeUid(),
    gid: safeGid(),
    username: resolveUsername(),
  };
}

export function getUserSpec(uid: number, gid: number) {
  return HOST_SUPPORTS_POSIX_IDS ? `${uid}:${gid}` : "root";
}

export function getComposeEnv() {
  const { uid, gid, username } = getLocalIdentity();
  const userSpec = getUserSpec(uid, gid);

  return {
    LOCAL_UID: `${uid}`,
    LOCAL_GID: `${gid}`,
    LOCAL_USER: username,
    LOCAL_USERMAP: userSpec,
    MEM_MAX: Deno.env.get("MEM_MAX") ?? "4G",
    SSH_PORT: Deno.env.get("SSH_PORT") ?? "2222",
    MONITOR_SUMMARY_INTERVAL: Deno.env.get("MONITOR_SUMMARY_INTERVAL") ?? "300",
  };
}

type PosixIdentity = {
  uid?: number;
  gid?: number;
  username?: string;
};

function detectWslIdentity(): PosixIdentity | undefined {
  const wslExe = Deno.env.get("CRTB_WSL_COMMAND") ?? "wsl";
  const shell = Deno.env.get("CRTB_WSL_SHELL") ?? "sh";
  const script = "id -u && id -g && id -un";
  try {
    const command = new Deno.Command(wslExe, {
      args: ["-e", shell, "-c", script],
      stdout: "piped",
      stderr: "null",
    });
    const result = command.outputSync();
    if (!result.success) return undefined;
    const lines = new TextDecoder().decode(result.stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 3) return undefined;
    const uid = Number(lines[0]);
    const gid = Number(lines[1]);
    if (!Number.isInteger(uid) || !Number.isInteger(gid)) return undefined;
    const username = lines[2];
    return { uid, gid, username };
  } catch (_) {
    return undefined;
  }
}
