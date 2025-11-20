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

const SERVER_TYPE_TO_FLAVOR: Partial<Record<ServerType, ServerFlavor>> = {
  vanilla: "vanilla",
  paper: "paper",
  fabric: "fabric",
  neoforge: "neoforge",
};

const cmd: Command = {
  name: "setup",
  description: "Setup the environment",
  handler: async (_args: string[]) => {
    try {
      const server = await loadServerProperty();
      const flavor = mapServerType(server.type);
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
