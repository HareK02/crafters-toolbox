function safeUid() {
  try {
    return Deno.uid();
  } catch (_) {
    return 1000;
  }
}

function safeGid() {
  try {
    return Deno.gid();
  } catch (_) {
    return 1000;
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
