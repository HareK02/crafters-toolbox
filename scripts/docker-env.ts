const HOST_SUPPORTS_POSIX_IDS = Deno.build.os !== "windows";

function fallbackPosixId() {
  return HOST_SUPPORTS_POSIX_IDS ? 1000 : 0;
}

function safeUid() {
  if (!HOST_SUPPORTS_POSIX_IDS) return 0;
  try {
    return Deno.uid();
  } catch (_) {
    return fallbackPosixId();
  }
}

function safeGid() {
  if (!HOST_SUPPORTS_POSIX_IDS) return 0;
  try {
    return Deno.gid();
  } catch (_) {
    return fallbackPosixId();
  }
}

function resolveUsername() {
  return Deno.env.get("LOCAL_USER") ||
    Deno.env.get("USER") ||
    Deno.env.get("USERNAME") ||
    "ctbx";
}

export function getLocalIdentity() {
  return {
    uid: safeUid(),
    gid: safeGid(),
    username: resolveUsername(),
  };
}

export function getComposeEnv() {
  const { uid, gid, username } = getLocalIdentity();

  return {
    LOCAL_UID: `${uid}`,
    LOCAL_GID: `${gid}`,
    LOCAL_USER: username,
    MEM_MAX: Deno.env.get("MEM_MAX") ?? "4G",
    SSH_PORT: Deno.env.get("SSH_PORT") ?? "2222",
    MONITOR_SUMMARY_INTERVAL: Deno.env.get("MONITOR_SUMMARY_INTERVAL") ?? "300",
  };
}
