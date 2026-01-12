import { join } from "jsr:@std/path";
import { Command } from "../command.ts";
import { ComponentIDType, IComponent } from "../component.ts";
import { getJavaImage, loadConfig } from "../config.ts";
import { PropertiesManager } from "../property.ts";
import {
  copyToDir,
  createStatusManager,
  ensureLocalPresence,
  pickArtifactFile,
  resolveArtifactBase,
  runBuild,
} from "./components.ts";
import { launchClient as launcherLaunch } from "../launcher/mod.ts";
import { LauncherOptions } from "../launcher/types.ts";

const CLIENT_ROOT = "./minecraft";

const prepareClientEnvironment = async (
  components: IComponent[],
  _properties: PropertiesManager,
  options?: { pull?: boolean },
) => {
  const status = createStatusManager(components.length);
  const config = loadConfig();
  const runnerImage = getJavaImage(config);

  const modsDir = join(CLIENT_ROOT, "mods");
  const resourcepacksDir = join(CLIENT_ROOT, "resourcepacks");
  const configDir = join(CLIENT_ROOT, "config");

  await Deno.mkdir(modsDir, { recursive: true });
  await Deno.mkdir(resourcepacksDir, { recursive: true });
  await Deno.mkdir(configDir, { recursive: true });

  for await (const entry of Deno.readDir(modsDir)) {
    await Deno.remove(join(modsDir, entry.name), { recursive: true });
  }
  for await (const entry of Deno.readDir(resourcepacksDir)) {
    await Deno.remove(join(resourcepacksDir, entry.name), { recursive: true });
  }

  const results = await Promise.all(
    components.map(async (component) => {
      status.start(component.name, "resolving");

      try {
        const sourceResult = await ensureLocalPresence(component, options);
        if (!sourceResult) {
          status.fail(component.name, "source unavailable");
          return undefined;
        }

        if (!sourceResult.cached) {
          status.update(component.name, "building");
          try {
            await runBuild(component, sourceResult.path, runnerImage);
          } catch (error) {
            status.fail(component.name, `build failed: ${error}`);
            return undefined;
          }
        } else {
          status.update(component.name, "cached (build skipped)");
        }

        status.update(component.name, "artifact");

        // Ensure regular build output resolution
        let buildOutput = sourceResult.path;
        if (!sourceResult.cached) {
          buildOutput = await runBuild(
            component,
            sourceResult.path,
            runnerImage,
          );
        }

        const { path: finalArtifactBase, config: artifactConfig } =
          resolveArtifactBase(component, buildOutput);

        let fileToDeploy = finalArtifactBase;
        try {
          const stat = await Deno.stat(finalArtifactBase);
          if (stat.isDirectory && artifactConfig.type !== "dir") {
            const picked = await pickArtifactFile(
              finalArtifactBase,
              artifactConfig.type === "jar"
                ? [".jar"]
                : artifactConfig.type === "zip"
                ? [".zip"]
                : [],
            );
            if (!picked) {
              status.fail(component.name, "artifact missing");
              return undefined;
            }
            fileToDeploy = picked;
          }
        } catch {
          status.fail(
            component.name,
            `artifact path not found: ${finalArtifactBase}`,
          );
          return undefined;
        }

        status.update(component.name, "deploying");
        if (component.kind === ComponentIDType.MODS) {
          await copyToDir(fileToDeploy, modsDir, undefined);
        } else if (component.kind === ComponentIDType.RESOURCEPACKS) {
          await copyToDir(fileToDeploy, resourcepacksDir, undefined);
        }

        status.succeed(component.name, "ready");
        return { component, path: sourceResult.path };
      } catch (e) {
        status.fail(component.name, `${e}`);
        return undefined;
      }
    }),
  );

  status.stop();
  return results.filter((r) => r !== undefined) as {
    component: IComponent;
    path: string;
  }[];
};

const resolveJavaPath = () => {
  const javaHome = Deno.env.get("JAVA_HOME");
  if (javaHome) {
    return join(javaHome, "bin", "java");
  }
  return "java";
};

const clientCommand: Command = {
  name: "client",
  description: "Manage local client environment",
  subcommands: [
    {
      name: "start",
      description: "Setup environment and start client",
      handler: async (_args: string[]) => {
        let yaml: string;
        try {
          yaml = await Deno.readTextFile("./crtb.properties.yml");
        } catch {
          console.error("Could not read crtb.properties.yml");
          return;
        }

        const manager = PropertiesManager.fromYaml(yaml);
        const components = manager.getComponentsAsArray().filter((c) =>
          c.kind === ComponentIDType.MODS ||
          c.kind === ComponentIDType.RESOURCEPACKS
        );

        if (components.length === 0) {
          console.log("No components to load.");
          // return; // Allow running without components?
        }

        const serverProp = manager.properties.server;
        if (!serverProp) {
          console.error("No 'server' section in crtb.properties.yml");
          return;
        }

        console.log(`Preparing client environment in ${CLIENT_ROOT}...`);
        await prepareClientEnvironment(components, manager);

        const gameDir = await Deno.realPath(CLIENT_ROOT);
        const assetsDir = join(gameDir, "assets");
        const librariesDir = join(gameDir, "libraries");
        const nativesDir = join(gameDir, "natives");

        await Deno.mkdir(assetsDir, { recursive: true });
        await Deno.mkdir(librariesDir, { recursive: true });

        const launchOpts: LauncherOptions = {
          version: serverProp.version, // e.g. "1.21.1"
          gameDir,
          assetsDir,
          librariesDir,
          nativesDir,
          // Check if fabric
          fabricVersion: serverProp.type === "fabric"
            ? (serverProp.build || "latest")
            : undefined,
          javaPath: resolveJavaPath(),
          user: {
            username: Deno.env.get("CRTB_PLAYER_NAME") || "Dev",
            uuid: "00000000-0000-0000-0000-000000000000",
            accessToken: "token",
          },
        };

        await launcherLaunch(launchOpts);
      },
    },
  ],
  handler: async (_args) => {
    console.log("Use `crtb client start`");
  },
};

export default clientCommand;
