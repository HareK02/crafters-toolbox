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

export function getComposeEnv() {
  const uid = safeUid();
  const gid = safeGid();
  const username = Deno.env.get("LOCAL_USER") ||
    Deno.env.get("USER") ||
    Deno.env.get("USERNAME") ||
    "ctbx";

  return {
    LOCAL_UID: `${uid}`,
    LOCAL_GID: `${gid}`,
    LOCAL_USER: username,
    MEM_MAX: Deno.env.get("MEM_MAX") ?? "4G",
    SSH_PORT: Deno.env.get("SSH_PORT") ?? "2222",
    MONITOR_SUMMARY_INTERVAL: Deno.env.get("MONITOR_SUMMARY_INTERVAL") ?? "300",
  };
}
