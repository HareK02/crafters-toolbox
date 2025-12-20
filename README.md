# Crafter's Toolbox

CRTB is a tool for Minecraft:Java Edition that helps you create and manage your
projects.

## Description

Crafter's Toolbox is an external toolset designed to support various aspects of
Minecraft creation. It is specifically built to assist in the development of
Mods and Datapacks.

## Features

- Automatic server setup and provisioning
- Automated build and deployment for Plugins and Mods
- Version control integration for your creations
- SSH server for real-time collaboration
- Creation of backup archives

## Installation

To install Crafter's Toolbox, run the following command:

```bash
curl -fsSL https://raw.githubusercontent.com/HareK02/crafters-toolbox/main/install.sh | bash
```

## Quick Start

1. Initialize a new project:
   ```bash
   crtb init my-server
   cd my-server
   ```
2. Configure your server:
   ```bash
   $EDITOR crtb.properties.yml
   ```
3. Setup the environment (download server jar, etc.):
   ```bash
   crtb setup
   ```
4. Start the server:
   ```bash
   crtb server start
   ```

## Dependencies

- [Git](https://git-scm.com/)
- [Deno](https://deno.land/)
- [Docker](https://www.docker.com/).

## Platform Notes

- Windows hosts: Docker Desktop exposes bind mounts as root-owned inside the VM,
  so CRTB automatically asks your default WSL distribution for its
  UID/GID/username and impersonates that identity inside the containers. This
  keeps generated files writable by your usual WSL user without changing any
  workflow. If WSL is unavailable or you prefer a different mapping, you can
  override it with `CRTB_HOST_UID`, `CRTB_HOST_GID`, and (optionally)
  `CRTB_HOST_USER` before running `crtb`. In that case the provided IDs are
  forwarded to Docker even on Windows.
