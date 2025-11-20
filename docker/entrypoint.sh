#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR=${SERVER_DIR:-/home/container/server}
COMPONENTS_DIR=${COMPONENTS_DIR:-/home/container/components}
SSH_DATA_DIR=${SSH_DATA_DIR:-${COMPONENTS_DIR}/.ssh}
MONITOR_SCRIPT=${MONITOR_SCRIPT:-/opt/monitor/monitor.ts}
DEFAULT_GAME_COMMAND=(
  "java"
  "-Xms128M"
  "-Xmx{{MEM_MAX}}"
  "-Dterminal.jline=false"
  "-Dterminal.ansi=true"
  "-jar"
  "server.jar"
  "nogui"
)

log() {
  echo "[$(date --iso-8601=seconds)] $*"
}

replace_placeholders() {
  local token="$1"
  while IFS='=' read -r env_name env_value; do
    [[ -z "$env_name" ]] && continue
    [[ "$env_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    token="${token//\{\{$env_name\}\}/$env_value}"
  done < <(env)
  printf '%s' "$token"
}

render_and_exec() {
  local args=("$@")
  local rendered=()
  for token in "${args[@]}"; do
    rendered+=("$(replace_placeholders "$token")")
  done
  log "$(pwd): ${rendered[*]}"
  exec "${rendered[@]}"
}

render_template_file() {
  local template_path="$1"
  local destination_path="$2"
  local content
  content="$(cat "$template_path")"
  while IFS='=' read -r env_name env_value; do
    [[ -z "$env_name" ]] && continue
    [[ "$env_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    content="${content//\{\{$env_name\}\}/$env_value}"
  done < <(env)
  printf '%s' "$content" > "$destination_path"
}

start_game() {
  mkdir -p "$SERVER_DIR"
  cd "$SERVER_DIR"
  export PATH="$JAVA_HOME/bin:$PATH"
  java --version || true
  local cmd=("$@")
  if [ ${#cmd[@]} -eq 0 ]; then
    cmd=("${DEFAULT_GAME_COMMAND[@]}")
  fi
  render_and_exec "${cmd[@]}"
}

locate_nss_wrapper() {
  for candidate in /usr/lib/libnss_wrapper.so /usr/lib/*-linux-gnu/libnss_wrapper.so; do
    if [ -f "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

setup_dynamic_user() {
  local uid="${LOCAL_UID:-$(id -u)}"
  local gid="${LOCAL_GID:-$(id -g)}"
  local username="${LOCAL_USER:-ctbx}"
  local passwd_file="/tmp/passwd"
  local group_file="/tmp/group"

  printf '%s:x:%s:%s:%s:/home/container:/bin/bash\n' "$username" "$uid" "$gid" "$username" > "$passwd_file"
  printf '%s:x:%s:\n' "$username" "$gid" > "$group_file"

  if nss_lib=$(locate_nss_wrapper); then
    export LD_PRELOAD="$nss_lib"
  else
    log "Warning: libnss_wrapper.so not found. SSH logins may be unavailable."
  fi

  export NSS_WRAPPER_PASSWD="$passwd_file"
  export NSS_WRAPPER_GROUP="$group_file"
  export SSH_LOGIN_USER="$username"
}

start_ssh() {
  mkdir -p "$COMPONENTS_DIR" "$SSH_DATA_DIR" "$SSH_DATA_DIR/host_keys"
  setup_dynamic_user

  local authorized_keys="${SSH_AUTHORIZED_KEYS:-$SSH_DATA_DIR/authorized_keys}"
  touch "$authorized_keys"
  chmod 600 "$authorized_keys" || true

  local ed25519_key="${SSH_HOST_KEY_ED25519:-$SSH_DATA_DIR/host_keys/ssh_host_ed25519_key}"
  local rsa_key="${SSH_HOST_KEY_RSA:-$SSH_DATA_DIR/host_keys/ssh_host_rsa_key}"

  if [ ! -s "$ed25519_key" ]; then
    ssh-keygen -t ed25519 -N '' -f "$ed25519_key" >/dev/null
  fi
  if [ ! -s "$rsa_key" ]; then
    ssh-keygen -t rsa -b 4096 -N '' -f "$rsa_key" >/dev/null
  fi

  export SSH_PORT="${SSH_PORT:-2222}"
  export SSHD_PID_FILE="${SSHD_PID_FILE:-/tmp/sshd.pid}"
  export AUTHORIZED_KEYS_PATH="$authorized_keys"
  export HOST_KEY_ED25519="$ed25519_key"
  export HOST_KEY_RSA="$rsa_key"
  export SSH_USER="$SSH_LOGIN_USER"

  local runtime_config="/tmp/sshd_config.runtime"
  render_template_file /opt/ssh/sshd_config "$runtime_config"
  chmod 600 "$runtime_config" || true

  log "Starting SSH server on port ${SSH_PORT}"
  exec /usr/sbin/sshd -De -f "$runtime_config"
}

start_monitor() {
  mkdir -p "$COMPONENTS_DIR"
  if [ ! -f "$MONITOR_SCRIPT" ]; then
    log "Monitor script not found at $MONITOR_SCRIPT"
    exit 1
  fi

  local target="$COMPONENTS_DIR"
  export COMPONENTS_DIR="$target"
  log "Starting component monitor for $target"
  exec deno run --allow-read="$target" --allow-env=COMPONENTS_DIR,MONITOR_ "$MONITOR_SCRIPT"
}

SERVICE_ROLE=${SERVICE_ROLE:-game}

case "$SERVICE_ROLE" in
  game)
    start_game "$@"
    ;;
  ssh)
    start_ssh
    ;;
  monitor)
    start_monitor
    ;;
  *)
    if [ $# -gt 0 ]; then
      render_and_exec "$@"
    else
      log "Unknown SERVICE_ROLE: $SERVICE_ROLE"
      exit 1
    fi
    ;;
esac
