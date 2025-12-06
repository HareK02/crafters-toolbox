#!/usr/bin/env bash
set -euo pipefail


# Determine role based on the script name (entrypoint alias)
case "$(basename "$0")" in
  start-game)    export SERVICE_ROLE=game ;;
  start-ssh)     export SERVICE_ROLE=ssh ;;
esac

SERVER_DIR=${SERVER_DIR:-/home/container/server}
COMPONENTS_DIR=${COMPONENTS_DIR:-/home/container/components}
SSH_DATA_DIR=${SSH_DATA_DIR:-/home/container/.ssh}
MONITOR_SCRIPT=${MONITOR_SCRIPT:-/opt/monitor/monitor.ts}
LOGIN_SHELL=${LOGIN_SHELL:-${DEFAULT_SHELL:-/bin/bash}}
SSH_CRYPT_METHOD=${SSH_CRYPT_METHOD:-SHA512}
SSH_CRYPT_ROUNDS=${SSH_CRYPT_ROUNDS:-5000}
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

ensure_tmp_permissions() {
  if [ -d /tmp ]; then
    chmod 1777 /tmp || true
  fi
}

is_truthy() {
  case "${1:-}" in
    1|t|T|true|TRUE|True|y|Y|yes|YES|Yes|on|ON|On)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

bool_to_yes_no() {
  if is_truthy "$1"; then
    echo "yes"
  else
    echo "no"
  fi
}

find_group_by_gid() {
  local gid="$1"
  local file="/etc/group"
  [ -f "$file" ] || return 1
  awk -F: -v target="$gid" '$3 == target { print $1; exit 0 } END { exit 1 }' "$file"
}

group_exists() {
  local name="$1"
  local file="/etc/group"
  [ -f "$file" ] || return 1
  awk -F: -v target="$name" '$1 == target { exit 0 } END { exit 1 }' "$file"
}

find_user_by_uid() {
  local uid="$1"
  local file="/etc/passwd"
  [ -f "$file" ] || return 1
  awk -F: -v target="$uid" '$3 == target { print $1; exit 0 } END { exit 1 }' "$file"
}

user_exists() {
  local name="$1"
  local file="/etc/passwd"
  [ -f "$file" ] || return 1
  awk -F: -v target="$name" '$1 == target { exit 0 } END { exit 1 }' "$file"
}

ensure_system_group() {
  local gid="$1"
  local name="$2"
  local existing
  existing=$(find_group_by_gid "$gid" || true)
  if [ -n "$existing" ]; then
    echo "$existing"
    return
  fi
  if group_exists "$name"; then
    groupmod -g "$gid" "$name"
    echo "$name"
    return
  fi
  groupadd -g "$gid" "$name"
  echo "$name"
}

ensure_system_user() {
  local uid="$1"
  local username="$2"
  local group_name="$3"
  local gid="$4"
  local home="/home/container"
  local shell="$LOGIN_SHELL"

  local existing
  existing=$(find_user_by_uid "$uid" || true)
  if [ -n "$existing" ] && [ "$existing" != "$username" ]; then
    usermod -l "$username" "$existing"
  fi

  if user_exists "$username"; then
    usermod -u "$uid" -g "$group_name" -d "$home" -s "$shell" "$username"
  else
    useradd -M -d "$home" -s "$shell" -u "$uid" -g "$group_name" "$username"
  fi

  mkdir -p "$home"
  chown "$uid":"$gid" "$home" || true
}

setup_system_user() {
  local uid="$1"
  local gid="$2"
  local username="$3"
  local group_name
  group_name=$(ensure_system_group "$gid" "$username")
  ensure_system_user "$uid" "$username" "$group_name" "$gid"
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
  local shell="$LOGIN_SHELL"

  if [ "$(id -u)" -eq 0 ]; then
    if [ "$uid" -eq 0 ] && [ "$gid" -eq 0 ]; then
      export SSH_LOGIN_USER="${LOCAL_USER:-root}"
      return
    fi
    setup_system_user "$uid" "$gid" "$username"
    unset LD_PRELOAD NSS_WRAPPER_PASSWD NSS_WRAPPER_GROUP || true
    export SSH_LOGIN_USER="$username"
    return
  fi

  printf '%s:x:%s:%s:%s:/home/container:%s\n' "$username" "$uid" "$gid" "$username" "$shell" > "$passwd_file"
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
  ensure_tmp_permissions
  mkdir -p "$COMPONENTS_DIR" "$SSH_DATA_DIR" "$SSH_DATA_DIR/host_keys"
  mkdir -p /run/sshd
  chmod 755 /run/sshd || true
  setup_dynamic_user

  local authorized_keys="${SSH_AUTHORIZED_KEYS:-$SSH_DATA_DIR/authorized_keys}"
  touch "$authorized_keys"
  chmod 600 "$authorized_keys" || true

  local ed25519_key="${SSH_HOST_KEY_ED25519:-$SSH_DATA_DIR/host_keys/ssh_host_ed25519_key}"
  local rsa_key="${SSH_HOST_KEY_RSA:-$SSH_DATA_DIR/host_keys/ssh_host_rsa_key}"
  local enable_password_auth="${SSH_ENABLE_PASSWORD_AUTH:-false}"
  local enable_key_auth="${SSH_ENABLE_KEY_AUTH:-true}"
  local ssh_password="${SSH_PASSWORD:-}"

  if is_truthy "$enable_password_auth" && [ "$(id -u)" -ne 0 ]; then
    log "Error: Password authentication requires the SSH container to run as root."
    exit 1
  fi

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
  export SSH_PASSWORD_AUTH="$(bool_to_yes_no "$enable_password_auth")"
  export SSH_PUBKEY_AUTH="$(bool_to_yes_no "$enable_key_auth")"

  if is_truthy "$enable_password_auth"; then
    if [ -z "$ssh_password" ]; then
      log "Error: SSH password authentication enabled but SSH_PASSWORD is empty."
      exit 1
    fi
    local chpasswd_args=("--crypt-method" "$SSH_CRYPT_METHOD")
    if [[ "$SSH_CRYPT_METHOD" =~ ^SHA(256|512)$ ]]; then
      chpasswd_args+=("--sha-rounds" "$SSH_CRYPT_ROUNDS")
    fi
    if ! echo "$SSH_LOGIN_USER:$ssh_password" | chpasswd "${chpasswd_args[@]}" >/dev/null 2>&1; then
      log "Error: Failed to configure SSH password for $SSH_LOGIN_USER"
      exit 1
    fi
  else
    passwd -d "$SSH_LOGIN_USER" >/dev/null 2>&1 || true
  fi

  if ! is_truthy "$enable_key_auth"; then
    log "Public key authentication disabled by configuration."
  fi

  local runtime_config="/tmp/sshd_config.runtime"
  render_template_file /opt/ssh/sshd_config "$runtime_config"
  chmod 600 "$runtime_config" || true

  log "Starting SSH server on port ${SSH_PORT}"
  exec /usr/sbin/sshd -De -f "$runtime_config"
}



SERVICE_ROLE=${SERVICE_ROLE:-game}

case "$SERVICE_ROLE" in
  game)
    start_game "$@"
    ;;
  ssh)
    start_ssh
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
