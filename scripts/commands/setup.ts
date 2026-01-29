import { join } from "@std/path";

import { Command } from "../command.ts";
import { PropertiesManager, ServerProperty, ServerType } from "../property.ts";
import {
  downloadServerJar,
  type ServerFlavor,
} from "../server-jar-downloader/mod.ts";

const PROPERTIES_PATH = "./crtb.properties.yml";
const SERVER_DIR = "./server";
const SERVER_JAR_NAME = "server.jar";
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
      // If neither flag is provided, do both (default behavior)
      const doAll = !doServer;

      if (doAll || doServer) {
        const server = await loadServerProperty();
        const flavor = mapServerType(server.type);
        if (!flavor) {
          console.error(
            `[setup] Server type "${server.type}" is not supported for automatic jar download. ` +
              "Provide your own server.jar or use a supported type (vanilla/paper/fabric/neoforge).",
          );
        } else {
          const build = normalizeBuild(server.build);
          const outputPath = join(SERVER_DIR, SERVER_JAR_NAME);

          await Deno.mkdir(SERVER_DIR, { recursive: true });
          console.log(
            `[setup] Downloading ${flavor} ${server.version}${
              build ? ` (build ${build})` : ""
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
      }

      if (doAll) {
        await ensureDockerImage();
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
      `Failed to load server properties: ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
}

function mapServerType(type: ServerType): ServerFlavor | undefined {
  const normalized = type.toLowerCase() as ServerType;
  return SERVER_TYPE_TO_FLAVOR[normalized];
}

function normalizeBuild(build?: string): string | undefined {
  if (!build) return undefined;
  return build.trim().toLowerCase() === "latest" ? undefined : build.trim();
}

async function ensureDockerImage() {
  const exists = await checkImageExists(IMAGE_REFERENCE);
  if (exists) return;
  throw new Error(
    `Docker image ${IMAGE_REFERENCE} was not found. ` +
      "Please install it before running setup.",
  );
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
