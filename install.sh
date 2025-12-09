#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/HareK02/crafters-toolbox.git"

# Check for Deno
if ! command -v deno &> /dev/null; then
  echo "Error: Deno is required to install crafters-toolbox."
  echo "Install Deno from: https://deno.com"
  exit 1
fi

# Check if we're in the project directory
if [ -f "deno.json" ] && [ -f "main.ts" ] && [ -f "installer/install.ts" ]; then
  # Local installation
  exec deno run -A installer/install.ts "$@"
else
  # Remote installation - need to clone first
  if ! command -v git &> /dev/null; then
    echo "Error: Git is required for remote installation."
    exit 1
  fi
  
  TEMP_DIR=$(mktemp -d)
  trap "rm -rf $TEMP_DIR" EXIT
  
  echo "Cloning repository to temporary directory..."
  if ! git clone --depth 1 "$REPO_URL" "$TEMP_DIR"; then
    echo "Error: Failed to clone repository"
    exit 1
  fi
  
  cd "$TEMP_DIR"
  exec deno run -A installer/install.ts "$@"
fi
