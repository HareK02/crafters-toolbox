/**
 * コンポーネントデプロイ
 */
import { copy } from "@std/fs";
import { basename, join } from "@std/path";
import { ComponentIDType, IComponent } from "../component.ts";
import { getClientConfig, getJavaImage, loadConfig } from "../config.ts";
import { DeploymentManifest } from "../deployment/manifest.ts";
import { PropertiesManager, ServerType } from "../property.ts";
import { pickArtifactFile, resolveArtifactBase } from "./artifact-resolver.ts";
import { runBuild } from "./build-runner.ts";
import {
  componentBasePath,
  copyToDir,
  ensureLocalPresence,
  ensureWorldSource,
} from "./source-resolver.ts";
import {
  createStatusManager,
  info,
  setCurrentStatusManager,
  warn,
} from "./status-manager.ts";

const GAME_SERVER_ROOT = "./server";

type DeployConfig = {
  worldContainer: "root" | "worlds";
  supportsPlugins: boolean;
  supportsMods: boolean;
};

export const DEPLOY_CONFIGS: Record<ServerType, DeployConfig> = {
  vanilla: {
    worldContainer: "root",
    supportsMods: false,
    supportsPlugins: false,
  },
  fabric: {
    worldContainer: "root",
    supportsMods: true,
    supportsPlugins: false,
  },
  forge: {
    worldContainer: "root",
    supportsMods: true,
    supportsPlugins: false,
  },
  neoforge: {
    worldContainer: "root",
    supportsMods: true,
    supportsPlugins: false,
  },
  paper: {
    worldContainer: "worlds",
    supportsMods: false,
    supportsPlugins: true,
  },
  folia: {
    worldContainer: "worlds",
    supportsMods: false,
    supportsPlugins: true,
  },
  spigot: {
    worldContainer: "worlds",
    supportsMods: false,
    supportsPlugins: true,
  },
  bukkit: {
    worldContainer: "worlds",
    supportsMods: false,
    supportsPlugins: true,
  },
};

class AsyncLock {
  #mutex: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const prev = this.#mutex;
    this.#mutex = new Promise((resolve) => (release = resolve));
    await prev;
    try {
      return await fn();
    } finally {
      release?.();
    }
  }
}

type ComponentIDString = string;

const toComponentId = (component: IComponent): ComponentIDString => {
  if (
    typeof (component as { toIDString?: () => ComponentIDString })
      .toIDString === "function"
  ) {
    return (component as { toIDString: () => ComponentIDString }).toIDString();
  }
  const kind = component.kind;
  if (kind === ComponentIDType.WORLD) return "world";
  return `${
    ComponentIDType.toShortString(kind)
  }:${component.name}` as ComponentIDString;
};

const resolveLevelName = async (gameRoot: string): Promise<string> => {
  try {
    const content = await Deno.readTextFile(
      join(gameRoot, "server.properties"),
    );
    const levelLine = content
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith("level-name="));
    if (levelLine) return levelLine.split("=")[1].trim() || "world";
  } catch {
    // best-effort
  }
  return "world";
};

const resolveWorldPath = (
  serverType: ServerType,
  levelName: string,
): string => {
  const config = DEPLOY_CONFIGS[serverType];
  const base = config?.worldContainer === "worlds"
    ? join(GAME_SERVER_ROOT, "worlds")
    : GAME_SERVER_ROOT;
  return join(base, levelName);
};

const resolveWorldRoot = (serverType: ServerType): string => {
  const config = DEPLOY_CONFIGS[serverType];
  return config?.worldContainer === "worlds"
    ? join(GAME_SERVER_ROOT, "worlds")
    : GAME_SERVER_ROOT;
};

const resolveAbsolutePath = async (path: string) => {
  try {
    return await Deno.realPath(path);
  } catch {
    return path;
  }
};

const removeDeployedArtifacts = async (
  paths: string[],
  componentName: string,
) => {
  for (const target of paths) {
    try {
      const stat = await Deno.lstat(target);
      if (stat.isDirectory) {
        await Deno.remove(target, { recursive: true });
      } else {
        await Deno.remove(target);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      warn(`Failed to remove previous artifact for ${componentName}: ${error}`);
    }
  }
};

const copyWorldDir = async (srcPath: string, destPath: string) => {
  const stat = await Deno.stat(srcPath);
  if (!stat.isDirectory) {
    warn(`World source ${srcPath} is not a directory, skipping`);
    return;
  }
  await Deno.mkdir(destPath, { recursive: true });
  for await (const entry of Deno.readDir(srcPath)) {
    const from = join(srcPath, entry.name);
    const to = join(destPath, entry.name);
    await copy(from, to, { overwrite: true });
  }
  info(`Synced world from ${srcPath} to ${destPath}`);
};

const extractZip = async (zipPath: string, destDir: string) => {
  await Deno.mkdir(destDir, { recursive: true });
  const cmd = new Deno.Command("unzip", {
    args: ["-o", zipPath, "-d", destDir],
    stdout: "inherit",
    stderr: "inherit",
  });
  const { success } = await cmd.output();
  if (!success) {
    throw new Error(`Failed to unzip ${zipPath} to ${destDir}`);
  }
};

const isZipPath = (path: string, artifactType?: string) => {
  if (artifactType === "zip") return true;
  return path.toLowerCase().endsWith(".zip");
};

export const deployEntry = async (
  srcPath: string,
  destDir: string,
  componentName: string,
): Promise<string | undefined> => {
  try {
    return await copyToDir(srcPath, destDir, componentName);
  } catch (error) {
    warn(
      `Failed to deploy ${componentName} from ${srcPath} to ${destDir}: ${error}`,
    );
    return undefined;
  }
};

export const applyComponents = async (
  properties: PropertiesManager,
  selectedNames?: Set<string>,
  options?: { pull?: boolean },
) => {
  const serverType = properties.properties.server?.type;
  if (!serverType) {
    warn("server.type is not defined, cannot deploy components.");
    return;
  }

  const deployConfig = DEPLOY_CONFIGS[serverType];
  if (!deployConfig) {
    warn(`Unsupported server type "${serverType}", skipping deployment.`);
    return;
  }

  const allComponents = properties
    .getComponentsAsArray()
    .filter((component) =>
      selectedNames ? selectedNames.has(component.name) : true
    );

  const components = options?.pull
    ? allComponents.filter((c) =>
      c.source?.type === "http" || c.source?.type === "git"
    )
    : allComponents;

  if (options?.pull) {
    const skipped = allComponents.filter((c) =>
      c.source?.type !== "http" && c.source?.type !== "git"
    );
    if (skipped.length > 0) {
      info(
        `Skipping local-only components: ${skipped.map((c) => c.name).join(", ")}`,
      );
    }
  }

  if (components.length === 0) {
    info("No components matched the selected filters.");
    return;
  }

  const status = createStatusManager(components.length);
  setCurrentStatusManager(status);
  const config = loadConfig();
  const runnerImage = getJavaImage(config);
  const clientConfig = getClientConfig(config);

  const levelName = await resolveLevelName(GAME_SERVER_ROOT);
  const worldPath = resolveWorldPath(serverType, levelName);
  const datapacksDir = join(worldPath, "datapacks");
  const resourcepacksDir = join(GAME_SERVER_ROOT, "resourcepacks");
  const pluginsDir = join(GAME_SERVER_ROOT, "plugins");
  const serverModsDir = join(GAME_SERVER_ROOT, "mods");
  const clientModsDir = clientConfig.modsDir;
  const worldRoot = resolveWorldRoot(serverType);
  const manifest = await DeploymentManifest.load(GAME_SERVER_ROOT);
  const manifestLock = new AsyncLock();

  const tasks = components.map(async (component) => {
    status.start(component.name, "resolving");
    const componentId = toComponentId(component);
    try {
      try {
        const sourceResult = component.kind === ComponentIDType.WORLD
          ? (await ensureWorldSource(component, options))
          : (await ensureLocalPresence(component, options));

        let localPath: string | undefined;
        let cached = false;

        if (sourceResult) {
          localPath = sourceResult.path;
          cached = sourceResult.cached;
        }

        if (!localPath) {
          status.fail(component.name, "source unavailable");
          return {
            name: component.name,
            success: false,
            message: "Source unavailable",
          };
        }

        if (cached) {
          status.succeed(component.name, "cached (skipped)");
          return { name: component.name, success: true, cached: true };
        }

        status.update(component.name, "building");
        const workPath = localPath ?? componentBasePath(component);
        let buildOutput = workPath;
        try {
          buildOutput = await runBuild(component, workPath, runnerImage);
        } catch (error) {
          status.fail(component.name, `build failed: ${error}`);
          return {
            name: component.name,
            success: false,
            message: `Build failed: ${error}`,
          };
        }

        status.update(component.name, "artifact");
        const { path: artifactPath, config: artifact } = resolveArtifactBase(
          component,
          buildOutput,
        );

        const exists = await Deno.stat(artifactPath)
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          status.fail(component.name, `artifact missing: ${artifactPath}`);
          return {
            name: component.name,
            success: false,
            message: `Artifact missing: ${artifactPath}`,
          };
        }
        let finalArtifactPath = artifactPath;
        const stat = await Deno.stat(artifactPath);
        if (
          stat.isDirectory &&
          artifact.type !== "dir" &&
          artifact.type !== "raw"
        ) {
          const exts = artifact.type === "jar"
            ? [".jar"]
            : artifact.type === "zip"
            ? [".zip"]
            : [];
          const picked = await pickArtifactFile(
            artifactPath,
            exts,
            artifact.pattern,
          );
          if (!picked) {
            status.fail(component.name, "artifact file not found in directory");
            return {
              name: component.name,
              success: false,
              message: "Artifact file not found in directory",
            };
          }
          finalArtifactPath = picked;
        }

        const previousPaths = await manifestLock.runExclusive(async () => {
          const recorded = manifest.getAbsolutePaths(componentId);
          manifest.setPaths(componentId, []);
          await manifest.saveIfDirty();
          return recorded;
        });
        if (previousPaths.length) {
          await removeDeployedArtifacts(previousPaths, component.name);
        }

        status.update(component.name, "deploying");
        const deployedPaths: string[] = [];
        let deploymentSucceeded = false;
        switch (component.kind) {
          case ComponentIDType.WORLD: {
            if (!finalArtifactPath) {
              status.fail(component.name, "world artifact missing");
              return {
                name: component.name,
                success: false,
                message: "World artifact missing",
              };
            }
            if (artifact.unzip) {
              if (!isZipPath(finalArtifactPath, artifact.type)) {
                status.fail(component.name, "world artifact is not a zip");
                return {
                  name: component.name,
                  success: false,
                  message: "World artifact is not a zip",
                };
              }
              const targetDir = artifact.target
                ? join(worldRoot, artifact.target)
                : worldRoot;
              await extractZip(finalArtifactPath, targetDir);
              status.succeed(component.name, "deployed world (unzipped)");
              deployedPaths.push(await resolveAbsolutePath(targetDir));
              deploymentSucceeded = true;
            } else {
              await copyWorldDir(finalArtifactPath, worldPath);
              status.succeed(component.name, "deployed world");
              deployedPaths.push(await resolveAbsolutePath(worldPath));
              deploymentSucceeded = true;
            }
            break;
          }
          case ComponentIDType.DATAPACKS: {
            if (artifact.unzip) {
              if (!isZipPath(finalArtifactPath, artifact.type)) {
                status.fail(component.name, "datapack artifact is not a zip");
                return {
                  name: component.name,
                  success: false,
                  message: "Datapack artifact is not a zip",
                };
              }
              const targetDir = join(
                datapacksDir,
                artifact.target ?? component.name,
              );
              await extractZip(finalArtifactPath, targetDir);
              deployedPaths.push(await resolveAbsolutePath(targetDir));
              status.succeed(component.name, "deployed datapack (unzipped)");
              deploymentSucceeded = true;
            } else {
              const dest = await deployEntry(
                finalArtifactPath,
                datapacksDir,
                component.name,
              );
              if (!dest) {
                status.fail(component.name, "failed to deploy datapack");
                return {
                  name: component.name,
                  success: false,
                  message: "Failed to deploy datapack",
                };
              }
              deployedPaths.push(await resolveAbsolutePath(dest));
              status.succeed(component.name, "deployed datapack");
              deploymentSucceeded = true;
            }
            break;
          }
          case ComponentIDType.RESOURCEPACKS: {
            if (artifact.unzip) {
              if (!isZipPath(finalArtifactPath, artifact.type)) {
                status.fail(
                  component.name,
                  "resourcepack artifact is not a zip",
                );
                return {
                  name: component.name,
                  success: false,
                  message: "Resourcepack artifact is not a zip",
                };
              }
              const targetDir = join(
                resourcepacksDir,
                artifact.target ?? component.name,
              );
              await extractZip(finalArtifactPath, targetDir);
              deployedPaths.push(await resolveAbsolutePath(targetDir));
              status.succeed(component.name, "deployed resourcepack (unzipped)");
              deploymentSucceeded = true;
            } else {
              const dest = await deployEntry(
                finalArtifactPath,
                resourcepacksDir,
                component.name,
              );
              if (!dest) {
                status.fail(component.name, "failed to deploy resourcepack");
                return {
                  name: component.name,
                  success: false,
                  message: "Failed to deploy resourcepack",
                };
              }
              deployedPaths.push(await resolveAbsolutePath(dest));
              status.succeed(component.name, "deployed resourcepack");
              deploymentSucceeded = true;
            }
            break;
          }
          case ComponentIDType.PLUGINS: {
            if (!deployConfig.supportsPlugins) {
              status.fail(component.name, `unsupported on ${serverType}`);
              return {
                name: component.name,
                success: false,
                message: `Unsupported on ${serverType}`,
              };
            }
            if (artifact.unzip) {
              if (!isZipPath(finalArtifactPath, artifact.type)) {
                status.fail(component.name, "plugin artifact is not a zip");
                return {
                  name: component.name,
                  success: false,
                  message: "Plugin artifact is not a zip",
                };
              }
              const targetDir = join(
                pluginsDir,
                artifact.target ?? component.name,
              );
              await extractZip(finalArtifactPath, targetDir);
              deployedPaths.push(await resolveAbsolutePath(targetDir));
              status.succeed(component.name, "deployed plugin (unzipped)");
              deploymentSucceeded = true;
            } else {
              const dest = await deployEntry(
                finalArtifactPath,
                pluginsDir,
                component.name,
              );
              if (!dest) {
                status.fail(component.name, "failed to deploy plugin");
                return {
                  name: component.name,
                  success: false,
                  message: "Failed to deploy plugin",
                };
              }
              deployedPaths.push(await resolveAbsolutePath(dest));
              status.succeed(component.name, "deployed plugin");
              deploymentSucceeded = true;
            }
            break;
          }
          case ComponentIDType.MODS: {
            const modTarget = component.target ?? "both";
            const deployToServer = modTarget === "server" || modTarget === "both";
            const deployToClient = modTarget === "client" || modTarget === "both";

            if (deployToServer && !deployConfig.supportsMods) {
              status.fail(component.name, `unsupported on ${serverType}`);
              return {
                name: component.name,
                success: false,
                message: `Unsupported on ${serverType}`,
              };
            }

            const deployModTo = async (destDir: string): Promise<boolean> => {
              await Deno.mkdir(destDir, { recursive: true });
              if (artifact.unzip) {
                if (!isZipPath(finalArtifactPath, artifact.type)) {
                  return false;
                }
                const targetDir = join(destDir, artifact.target ?? component.name);
                await extractZip(finalArtifactPath, targetDir);
                deployedPaths.push(await resolveAbsolutePath(targetDir));
              } else {
                const dest = await deployEntry(finalArtifactPath, destDir, component.name);
                if (!dest) return false;
                deployedPaths.push(await resolveAbsolutePath(dest));
              }
              return true;
            };

            if (artifact.unzip && !isZipPath(finalArtifactPath, artifact.type)) {
              status.fail(component.name, "mod artifact is not a zip");
              return {
                name: component.name,
                success: false,
                message: "Mod artifact is not a zip",
              };
            }

            if (deployToServer) {
              const ok = await deployModTo(serverModsDir);
              if (!ok) {
                status.fail(component.name, "failed to deploy mod to server");
                return { name: component.name, success: false, message: "Failed to deploy mod to server" };
              }
            }
            if (deployToClient) {
              const ok = await deployModTo(clientModsDir);
              if (!ok) {
                status.fail(component.name, "failed to deploy mod to client");
                return { name: component.name, success: false, message: "Failed to deploy mod to client" };
              }
            }

            const label = deployToServer && deployToClient
              ? "server + client"
              : deployToServer ? "server" : "client";
            status.succeed(component.name, `deployed mod (${label})${artifact.unzip ? " (unzipped)" : ""}`);
            deploymentSucceeded = true;
            break;
          }
          default:
            status.fail(component.name, `unknown kind ${component.kind}`);
            return {
              name: component.name,
              success: false,
              message: `Unknown kind ${component.kind}`,
            };
        }

        if (deploymentSucceeded) {
          await manifestLock.runExclusive(async () => {
            manifest.setPaths(componentId, deployedPaths);
            await manifest.saveIfDirty();
          });
        }
      } catch (error) {
        status.fail(component.name, `failed inner: ${error}`);
        throw error;
      }
    } catch (error) {
      status.fail(component.name, `failed: ${error}`);
      return { name: component.name, success: false, message: `${error}` };
    }
    return { name: component.name, success: true, cached: false };
  });

  const results = await Promise.all(tasks);
  status.stop();

  console.log("\nDeployment Summary:");
  const successCount = results.filter((r) => r?.success).length;
  const failureCount = results.filter((r) => r && !r.success).length;

  console.log(`\n${successCount} succeeded, ${failureCount} failed.\n`);

  const failures = results.filter((r) => r && !r.success);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => {
      if (f) console.log(` - ${f.name}: ${f.message || "Unknown error"}`);
    });
  }
  setCurrentStatusManager(undefined);
};
