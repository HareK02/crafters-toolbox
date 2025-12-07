import { join } from "jsr:@std/path";

import { Command } from "../command.ts";
import { PropertiesManager, ServerProperty, ServerType } from "../property.ts";
import {
  downloadServerJar,
  type ServerFlavor,
} from "../server-jar-downloader/mod.ts";

const PROPERTIES_PATH = "./crtb.properties.yml";
const SERVER_DIR = "./server";
const SERVER_JAR_NAME = "server.jar";
const DOCKER_FLAKE_DIR = "./docker";
const DOCKER_BUILD_TARGET = ".#dockerImage";
const DOCKER_RESULT_LINK = "result";
const IMAGE_REFERENCE = "crafters-toolbox:latest";

const SERVER_TYPE_TO_FLAVOR: Partial<Record<ServerType, ServerFlavor>> = {
  vanilla: "vanilla",
  paper: "paper",
  fabric: "fabric",
  neoforge: "neoforge",
};

const cmd: Command = {
  name: "setup",
  description: "Setup the environment",
  handler: async (args: string[]) => {
    try {
      const doServer = args.includes("--server");
      const doDocker = args.includes("--docker");
      // If neither flag is provided, do both (default behavior)
      const doAll = !doServer && !doDocker;

      if (doAll || doServer) {
        const server = await loadServerProperty();
        const flavor = mapServerType(server.type);
        const build = normalizeBuild(server.build);
        const outputPath = join(SERVER_DIR, SERVER_JAR_NAME);

        await Deno.mkdir(SERVER_DIR, { recursive: true });
        console.log(
          `[setup] Downloading ${flavor} ${server.version}${build ? ` (build ${build})` : ""
          }...`,
        );
        const destination = await downloadServerJar({
          flavor,
          version: server.version,
          build,
          output: outputPath,
        });
        console.log(`[setup] Server jar saved to ${destination}`);
      }

      if (doAll || doDocker) {
        // When explicitly asked with --docker, force build. 
        // When running all (default), check existence first (forceBuild=false).
        const forceBuild = doDocker;
        await ensureDockerImage(forceBuild);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[setup] ${message}`);
    }
  },
};

export default cmd;

async function loadServerProperty(): Promise<ServerProperty> {
  try {
    const yaml = await Deno.readTextFile(PROPERTIES_PATH);
    const properties = PropertiesManager.fromYaml(yaml).properties.server;
    if (!properties) {
      throw new Error("Server configuration is missing in crtb.properties.yml");
    }
    return properties;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        "crtb.properties.yml was not found. Run this command inside a CRTB project.",
      );
    }
    throw new Error(
      `Failed to load server properties: ${error instanceof Error ? error.message : error
      }`,
    );
  }
}

function mapServerType(type: ServerType): ServerFlavor {
  const normalized = type.toLowerCase() as ServerType;
  const flavor = SERVER_TYPE_TO_FLAVOR[normalized];
  if (!flavor) {
    throw new Error(
      `Server type "${type}" is not supported by the setup command.`,
    );
  }
  return flavor;
}

function normalizeBuild(build?: string): string | undefined {
  if (!build) return undefined;
  return build.trim().toLowerCase() === "latest" ? undefined : build.trim();
}

async function ensureDockerImage(forceBuild: boolean) {
  if (!forceBuild) {
    console.log(`[setup] Checking for Docker image ${IMAGE_REFERENCE}...`);
    const exists = await checkImageExists(IMAGE_REFERENCE);
    if (exists) {
      console.log(`[setup] Image ${IMAGE_REFERENCE} already exists. Skipping build.`);
      return;
    }
    console.log(`[setup] Image ${IMAGE_REFERENCE} not found. Building...`);
  } else {
    console.log(`[setup] Force build requested.`);
  }

  await buildAndLoadImage();
}

async function checkImageExists(imageName: string): Promise<boolean> {
  try {
    const process = new Deno.Command("docker", {
      args: ["inspect", "--type=image", imageName],
      stdout: "null",
      stderr: "null",
    }).spawn();
    const status = await process.status;
    return status.success;
  } catch (_error) {
    return false;
  }
}

async function buildAndLoadImage() {
  if (await isNixAvailable()) {
    console.log(
      "[setup] Building Docker image via `nix build .#dockerImage` (native)...",
    );
    await runCommandOrThrow("nix", [
      "--extra-experimental-features",
      "nix-command flakes",
      "build",
      DOCKER_BUILD_TARGET,
    ], {
      cwd: DOCKER_FLAKE_DIR,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  } else {
    console.log(
      "[setup] Nix not found. Building via Docker (nixos/nix)...",
    );
    await buildViaDocker();
  }

  // If built via Docker (and result is in volume or not directly accessible/linked), we might need handling.
  // But wait, if built inside docker container mounting the dir, the 'result' symlink might appear in host?
  // Yes, if we mount the directory.

  const tarPath = await resolveDockerResultPath();
  console.log(`[setup] Loading Docker image from ${tarPath}...`);
  await runCommandOrThrow("docker", ["load", "--input", tarPath], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  console.log(`[setup] Docker image ${IMAGE_REFERENCE} is ready.`);
}

async function isNixAvailable(): Promise<boolean> {
  try {
    const process = new Deno.Command("nix", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).spawn();
    return (await process.status).success;
  } catch {
    return false;
  }
}

async function buildViaDocker() {
  const cwd = await Deno.realPath(DOCKER_FLAKE_DIR);
  // We run a nixos/nix container, mount the docker directory, and run nix build.
  // Note: We need 'nix build .#dockerImage'. 
  // IMPORTANT: The 'result' symlink created inside container might be invalid on host if paths differ,
  // but the 'result' target (the store path) won't exist on host. 
  // However, 'docker load' usually takes a tarball. 
  // 'nix build' produces a symlink to /nix/store/.../image.tar.gz.
  // If we run this in docker, the /nix/store path is only in the container.
  // So we must output the file to the mounted volume explicitly? 
  // Or simpler: We just use `nix build` which makes `result` link.
  // But host cannot resolve `result` link pointing to container's /nix/store.

  // Strategy:
  // 1. Run nix build inside container.
  // 2. Inside container, cp -L result image.tar.gz (dereference symlink to actual file in shared vol).
  // 3. Host sees image.tar.gz and loads it.

  // We'll rename 'result' handling in 'resolveDockerResultPath' to support this 'image.tar.gz' fallback or just force this flow.

  await runCommandOrThrow("docker", [
    "run",
    "--rm",
    "-v", `${cwd}:/app`,
    "-w", "/app",
    "nixos/nix",
    "sh", "-c",
    `nix --extra-experimental-features "nix-command flakes" build ${DOCKER_BUILD_TARGET} && cp -L result image.tar`
  ], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
}

// Updated resolve function to look for image.tar if result link is broken or specialized
async function resolveDockerResultPath() {
  const tarFile = join(DOCKER_FLAKE_DIR, "image.tar");
  try {
    const info = await Deno.stat(tarFile);
    if (info.isFile) return await Deno.realPath(tarFile);
  } catch {
    // ignore
  }

  const relative = join(DOCKER_FLAKE_DIR, DOCKER_RESULT_LINK);
  try {
    const info = await Deno.stat(relative);
    // On host, if 'result' is a symlink into /nix/store (which doesn't exist), stat might fail or return isSymlink.
    // If we used native nix build, it works.
    if (info.isFile || info.isSymlink) {
      return await Deno.realPath(relative);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Double check if it's a broken symlink (stat throws NotFound for broken link usually, lstat works)
      try {
        const lstat = await Deno.lstat(relative);
        if (lstat.isSymlink) {
          // It is a symlink, but likely points to missing /nix/store path.
          throw new Error("Nix build artifact exists but points to missing /nix/store path (was it built in Docker?). Cannot load.");
        }
      } catch { }
      throw new Error(
        "nix build did not produce a docker image (missing ./docker/result or ./docker/image.tar).",
      );
    }
    throw error;
  }
  return await Deno.realPath(relative);
}

async function runCommandOrThrow(
  command: string,
  args: string[],
  options: Deno.CommandOptions = {},
) {
  try {
    const process = new Deno.Command(command, { ...options, args }).spawn();
    const status = await process.status;
    if (!status.success) {
      const detail = status.code !== undefined
        ? `exit code ${status.code}`
        : status.signal !== undefined
          ? `signal ${status.signal}`
          : "unknown failure";
      throw new Error(
        `Command "${command} ${args.join(" ")}" failed (${detail}).`,
      );
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Command not found: ${command}`);
    }
    throw error;
  }
}
