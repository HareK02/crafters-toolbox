import { copy } from "jsr:@std/fs";
import { basename, isAbsolute, join } from "jsr:@std/path";
import logUpdate from "npm:log-update";
import cliSpinners from "npm:cli-spinners";

import { Command } from "../command.ts";
import { Datapack } from "../components/datapack.ts";
import { Mod } from "../components/mod.ts";
import { Plugin } from "../components/plugin.ts";
import { Resourcepack } from "../components/resourcepack.ts";
import { World } from "../components/world.ts";
import {
  ArtifactConfig,
  BuildConfig,
  ComponentIDString,
  ComponentIDType,
  IComponent,
  SourceConfig,
} from "../component.ts";
import { readComponents } from "../components_reader.ts";
import { getJavaImage, loadConfig } from "../config.ts";
import { PropertiesManager, ServerType } from "../property.ts";
import { LocalRef } from "../reference.ts";

const GAME_SERVER_ROOT = "./.app/gameserver";
const CACHE_ROOT = "./.cache/components";
const PREFIX = "[components:update]";
const IS_TTY = Deno.isatty(Deno.stdout.rid);

type DeployConfig = {
  worldContainer: "root" | "worlds";
  supportsPlugins: boolean;
  supportsMods: boolean;
};

const DEPLOY_CONFIGS: Record<ServerType, DeployConfig> = {
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

let currentStatus: ReturnType<typeof createStatusManager> | undefined;

const safeLog = (message: string, isError = false) => {
  logUpdate.clear();
  (isError ? console.error : console.log)(`${PREFIX} ${message}`);
  currentStatus?.render();
};
const warn = (message: string) => safeLog(message, true);
const info = (message: string) => safeLog(message, false);

type SpinnerState = {
  phase: string;
  message?: string;
  state: "running" | "succeed" | "fail";
  frame: number;
};

const createStatusManager = () => {
  const spinner = cliSpinners.dots;
  const states = new Map<string, SpinnerState>();
  let timer: number | undefined;

  const render = () => {
    if (!IS_TTY) return;
    const entries = [...states.entries()];
    const maxName = entries.reduce((m, [name]) => Math.max(m, name.length), 0);
    const lines = entries.map(([name, s]) => {
      const icon = s.state === "running"
        ? spinner.frames[s.frame % spinner.frames.length]
        : s.state === "succeed"
        ? "✓"
        : "✗";
      const padded = name.padEnd(maxName, " ");
      return `${PREFIX} ${padded} [${s.phase.padEnd(12)} ${icon}]${
        s.message ? ` ${s.message}` : ""
      }`;
    });
    logUpdate(`${PREFIX} Components Status\n${lines.join("\n")}`);
  };

  const tick = () => {
    for (const state of states.values()) {
      if (state.state === "running") state.frame += 1;
    }
    render();
  };

  const ensureTimer = () => {
    if (timer === undefined) {
      timer = setInterval(tick, spinner.interval) as unknown as number;
    }
  };

  const stopTimerIfDone = () => {
    if ([...states.values()].every((s) => s.state !== "running")) {
      if (timer !== undefined) {
        clearInterval(timer as number);
        timer = undefined;
      }
      render();
      if (IS_TTY) logUpdate.done();
    }
  };

  return {
    start: (name: string, phase: string, message?: string) => {
      if (!IS_TTY) {
        console.log(`${PREFIX} ${name} [${phase}] ${message ?? ""}`);
        return;
      }
      states.set(name, { phase, message, state: "running", frame: 0 });
      ensureTimer();
      tick();
    },
    update: (name: string, phase: string, message?: string) => {
      if (!IS_TTY) {
        console.log(`${PREFIX} ${name} [${phase}] ${message ?? ""}`);
        return;
      }
      const s = states.get(name) ?? { phase, state: "running", frame: 0 };
      s.phase = phase;
      s.message = message;
      s.state = "running";
      states.set(name, s);
      tick();
    },
    succeed: (name: string, message?: string) => {
      if (!IS_TTY) {
        console.log(`${PREFIX} ${name} [done] ${message ?? ""}`);
        return;
      }
      const s = states.get(name);
      if (s) {
        s.state = "succeed";
        s.message = message;
      }
      tick();
      stopTimerIfDone();
    },
    fail: (name: string, message?: string) => {
      if (!IS_TTY) {
        console.error(`${PREFIX} ${name} [fail] ${message ?? ""}`);
        return;
      }
      const s = states.get(name);
      if (s) {
        s.state = "fail";
        s.message = message;
      }
      tick();
      stopTimerIfDone();
    },
    render,
    stop: () => {
      if (!IS_TTY) return;
      if (timer !== undefined) clearInterval(timer as number);
      timer = undefined;
      render();
      logUpdate.done();
    },
  };
};

const resolveSourceConfig = (
  component: IComponent,
): SourceConfig | undefined => {
  if (component.source) return component.source;
  const legacy = (component as { reference?: { path?: string; url?: string } })
    .reference;
  if (!legacy) return undefined;
  if ("path" in legacy && legacy.path) {
    return { type: "local", path: legacy.path };
  }
  if ("url" in legacy && legacy.url) {
    const cleaned = legacy.url.replace(/^"+|"+$/g, "").trim();
    return { type: "http", url: cleaned };
  }
  return undefined;
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

const toComponentId = (component: IComponent): ComponentIDString => {
  if (
    typeof (component as { toIDString?: () => ComponentIDString })
      .toIDString === "function"
  ) {
    return (component as { toIDString: () => ComponentIDString }).toIDString();
  }
  const kind = component.kind;
  if (kind === ComponentIDType.WORLD) return "world";
  return `${ComponentIDType.toShortString(kind)}:${component.name}`;
};

const downloadTo = async (
  url: string,
  destDir: string,
  fallbackName: string,
): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      warn(`Failed to download ${url} (status: ${res.status})`);
      return false;
    }
    const fileName = basename(new URL(url).pathname) ||
      fallbackName.replace(/[/\\]/g, "");
    await Deno.mkdir(destDir, { recursive: true });
    await Deno.writeFile(
      join(destDir, fileName),
      new Uint8Array(await res.arrayBuffer()),
    );
    return true;
  } catch (error) {
    warn(`Unable to download ${url}: ${error}`);
    return false;
  }
};

const copyToDir = async (
  srcPath: string,
  destDir: string,
  componentName?: string,
) => {
  const targetPath = join(destDir, componentName ?? basename(srcPath));
  const normalizedSrc = await Deno.realPath(srcPath).catch(() => srcPath);
  const normalizedDest = await Deno.realPath(targetPath).catch(() =>
    targetPath
  );
  if (normalizedSrc === normalizedDest) return;

  const stat = await Deno.stat(srcPath);
  await Deno.mkdir(destDir, { recursive: true });
  const targetName = stat.isDirectory
    ? componentName ?? basename(srcPath)
    : basename(srcPath);
  const dest = join(destDir, targetName);
  await copy(srcPath, dest, { overwrite: true });
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

const componentBasePath = (component: IComponent) =>
  join("./components", `${component.kind}s`, component.name);

const ensureLocalPresence = async (
  component: IComponent,
): Promise<string | undefined> => {
  if (component.kind === ComponentIDType.WORLD) return undefined;
  const baseDir = join("./components", `${component.kind}s`);
  const dest = componentBasePath(component);
  try {
    const stat = await Deno.stat(dest);
    if (stat.isDirectory) {
      for await (const _entry of Deno.readDir(dest)) {
        return dest; // non-empty
      }
      // empty directory, fall back to fetch below
    } else {
      return dest;
    }
  } catch {
    // not exists, try to fetch
  }

  const source = resolveSourceConfig(component);
  if (!source) {
    warn(
      `Component ${component.name} has no source/reference; cannot fetch to ${dest}`,
    );
    return undefined;
  }
  if (source.type === "local") {
    if (source.path === dest) return dest;
    await copyToDir(source.path, baseDir, component.name);
    return dest;
  }
  if (source.type === "http") {
    const ok = await downloadTo(
      source.url,
      dest,
      basename(new URL(source.url).pathname) || component.name,
    );
    return ok ? dest : undefined;
  }
  if (source.type === "git") {
    const gitDir = join(CACHE_ROOT, "git", component.name);
    await Deno.mkdir(gitDir, { recursive: true });
    const repoDir = join(gitDir, "repo");
    const cloneArgs = [
      "git",
      "clone",
      "--depth",
      "1",
      source.url,
      repoDir,
    ];
    const updateArgs = ["git", "-C", repoDir, "pull", "--ff-only"];
    const checkoutArgs = source.commit
      ? ["git", "-C", repoDir, "checkout", source.commit]
      : source.branch
      ? ["git", "-C", repoDir, "checkout", source.branch]
      : undefined;

    const exists = await Deno.stat(repoDir).then(() => true).catch(() => false);
    const cmd = new Deno.Command("bash", {
      args: ["-lc", exists ? updateArgs.join(" ") : cloneArgs.join(" ")],
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await cmd.spawn().status;
    if (!status.success) {
      warn(`Git fetch failed for ${component.name}`);
      return undefined;
    }
    if (checkoutArgs) {
      const checkoutCmd = new Deno.Command("bash", {
        args: ["-lc", checkoutArgs.join(" ")],
        stdout: "inherit",
        stderr: "inherit",
      });
      const checkoutStatus = await checkoutCmd.spawn().status;
      if (!checkoutStatus.success) {
        warn(`Git checkout failed for ${component.name}`);
        return undefined;
      }
    }
    await copyToDir(repoDir, baseDir, component.name);
    return dest;
  }
  return undefined;
};

const ensureWorldSource = async (
  component: IComponent,
): Promise<string | undefined> => {
  const legacy = (component as { reference?: { path?: string } }).reference;
  if (legacy?.path) return legacy.path;
  const source = resolveSourceConfig(component);
  if (!source) return undefined;
  if (source.type === "local") return source.path;
  if (source.type === "http") {
    const destDir = join(CACHE_ROOT, "world", component.name ?? "world");
    const ok = await downloadTo(
      source.url,
      destDir,
      basename(new URL(source.url).pathname) || component.name,
    );
    return ok ? destDir : undefined;
  }
  if (source.type === "git") {
    warn(`World ${component.name} uses git source; fetch not implemented yet.`);
  }
  return undefined;
};

const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void,
): Promise<T> => {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error("timeout"));
    }, ms) as unknown as number;
  });
  const result = await Promise.race([promise, timeout]);
  if (timer !== undefined) clearTimeout(timer as number);
  return result as T;
};

const resolveOutputPath = (base: string, output?: string) => {
  if (!output) return base;
  if (output.startsWith("/")) return output;
  return join(base, output);
};

const runBuild = async (
  component: IComponent,
  workdir: string,
  runnerImage: string,
): Promise<string> => {
  const absWorkdir = await Deno.realPath(workdir).catch(() => workdir);
  const build = component.build as BuildConfig | undefined;
  if (!build || build.type === undefined || build.type === "none") {
    return workdir;
  }

  switch (build.type) {
    case "gradle": {
      const task = build.task ?? "build";
      const gradlew = join(absWorkdir, "gradlew");
      const useGradlew = await Deno.stat(gradlew).then(() => true).catch(() =>
        false
      );
      const gradleCmd = useGradlew ? `./gradlew ${task}` : `gradle ${task}`;
      const dockerCmd = new Deno.Command("docker", {
        args: [
          "run",
          "--rm",
          "-v",
          `${absWorkdir}:${absWorkdir}`,
          "-w",
          absWorkdir,
          runnerImage,
          "bash",
          "-lc",
          gradleCmd,
        ],
        stdout: "piped",
        stderr: "piped",
      });
      const output = await dockerCmd.output();
      if (!output.success) {
        const msg = new TextDecoder().decode(output.stderr) ||
          "Gradle build failed";
        warn(msg.trim());
      }
      return resolveOutputPath(absWorkdir, build.output);
    }
    case "custom": {
      const base = build.workdir
        ? isAbsolute(build.workdir)
          ? build.workdir
          : join(absWorkdir, build.workdir)
        : absWorkdir;
      const dockerCmd = new Deno.Command("docker", {
        args: [
          "run",
          "--rm",
          "-v",
          `${base}:${base}`,
          "-w",
          base,
          runnerImage,
          "bash",
          "-lc",
          build.command,
        ],
        stdout: "piped",
        stderr: "piped",
      });
      const output = await dockerCmd.output();
      if (!output.success) {
        const msg = new TextDecoder().decode(output.stderr) ||
          "Custom build failed";
        warn(msg.trim());
      }
      return resolveOutputPath(base, build.output);
    }
    default:
      warn(
        `Unsupported build type ${
          (build as { type: string }).type
        } for ${component.name}`,
      );
      return workdir;
  }
};

const resolveArtifactBase = (
  component: IComponent,
  buildOutputPath: string,
): { path: string; config: ArtifactConfig } => {
  const artifact: ArtifactConfig = component.artifact ?? {};
  const basePath = resolveOutputPath(buildOutputPath, artifact.path);
  if (!artifact.type) {
    switch (component.kind) {
      case ComponentIDType.PLUGINS:
      case ComponentIDType.MODS:
        artifact.type = "jar";
        break;
      case ComponentIDType.DATAPACKS:
      case ComponentIDType.RESOURCEPACKS:
      case ComponentIDType.WORLD:
        artifact.type = "dir";
        break;
      default:
        artifact.type = "raw";
    }
  }
  return { path: basePath, config: artifact };
};

const deployEntry = async (
  srcPath: string,
  destDir: string,
  componentName: string,
) => {
  try {
    await copyToDir(srcPath, destDir, componentName);
  } catch (error) {
    warn(
      `Failed to deploy ${componentName} from ${srcPath} to ${destDir}: ${error}`,
    );
  }
};

const pickArtifactFile = async (
  basePath: string,
  preferredExts: string[],
): Promise<string | undefined> => {
  const files: string[] = [];
  for await (const entry of Deno.readDir(basePath)) {
    if (entry.isFile) files.push(entry.name);
  }
  for (const ext of preferredExts) {
    const found = files.find((f) => f.toLowerCase().endsWith(ext));
    if (found) return join(basePath, found);
  }
  return files.length === 1 ? join(basePath, files[0]) : undefined;
};

const applyComponents = async (properties: PropertiesManager) => {
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

  const status = createStatusManager();
  currentStatus = status;
  const config = loadConfig();
  const runnerImage = getJavaImage(config);

  const levelName = await resolveLevelName(GAME_SERVER_ROOT);
  const worldPath = resolveWorldPath(serverType, levelName);
  const datapacksDir = join(worldPath, "datapacks");
  const resourcepacksDir = join(GAME_SERVER_ROOT, "resourcepacks");
  const pluginsDir = join(GAME_SERVER_ROOT, "plugins");
  const modsDir = join(GAME_SERVER_ROOT, "mods");

  const tasks = properties.getComponentsAsArray().map(async (component) => {
    status.start(component.name, "resolving");
    try {
      const localPromise = component.kind === ComponentIDType.WORLD
        ? ensureWorldSource(component)
        : ensureLocalPresence(component);
      let localPath: string | undefined;
      try {
        localPath = await withTimeout(
          localPromise,
          60000,
          () => status.update(component.name, "resolving (timeout)"),
        );
      } catch (error) {
        status.fail(component.name, `source error: ${error}`);
        return;
      }
      if (!localPath) {
        status.fail(component.name, "source unavailable");
        return;
      }

      status.update(component.name, "building");
      const workPath = localPath ?? componentBasePath(component);
      let buildOutput = workPath;
      try {
        buildOutput = await runBuild(component, workPath, runnerImage);
      } catch (error) {
        status.fail(component.name, `build failed: ${error}`);
        return;
      }

      status.update(component.name, "artifact");
      const { path: artifactPath, config: artifact } = resolveArtifactBase(
        component,
        buildOutput,
      );

      const exists = await Deno.stat(artifactPath).then(() => true).catch(() =>
        false
      );
      if (!exists) {
        status.fail(component.name, `artifact missing: ${artifactPath}`);
        return;
      }
      let finalArtifactPath = artifactPath;
      const stat = await Deno.stat(artifactPath);
      if (
        stat.isDirectory && artifact.type !== "dir" && artifact.type !== "raw"
      ) {
        const exts = artifact.type === "jar"
          ? [".jar"]
          : artifact.type === "zip"
          ? [".zip"]
          : [];
        const picked = await pickArtifactFile(artifactPath, exts);
        if (!picked) {
          status.fail(component.name, "artifact file not found in directory");
          return;
        }
        finalArtifactPath = picked;
      }

      status.update(component.name, "deploying");
      switch (component.kind) {
        case ComponentIDType.WORLD: {
          if (!finalArtifactPath) {
            status.fail(component.name, "world artifact missing");
            break;
          }
          await copyWorldDir(finalArtifactPath, worldPath);
          status.succeed(component.name, "deployed world");
          break;
        }
        case ComponentIDType.DATAPACKS: {
          await deployEntry(finalArtifactPath, datapacksDir, component.name);
          status.succeed(component.name, "deployed datapack");
          break;
        }
        case ComponentIDType.RESOURCEPACKS: {
          await deployEntry(
            finalArtifactPath,
            resourcepacksDir,
            component.name,
          );
          status.succeed(component.name, "deployed resourcepack");
          break;
        }
        case ComponentIDType.PLUGINS: {
          if (!deployConfig.supportsPlugins) {
            status.fail(component.name, `unsupported on ${serverType}`);
            break;
          }
          await deployEntry(finalArtifactPath, pluginsDir, component.name);
          status.succeed(component.name, "deployed plugin");
          break;
        }
        case ComponentIDType.MODS: {
          if (!deployConfig.supportsMods) {
            status.fail(component.name, `unsupported on ${serverType}`);
            break;
          }
          await deployEntry(finalArtifactPath, modsDir, component.name);
          status.succeed(component.name, "deployed mod");
          break;
        }
        default:
          status.fail(component.name, `unknown kind ${component.kind}`);
          break;
      }
    } catch (error) {
      status.fail(component.name, `failed: ${error}`);
    }
  });

  await Promise.allSettled(tasks);
  status.stop();
  currentStatus = undefined;
};

const cmd: Command = {
  name: "components",
  description: "Show components information",
  subcommands: [
    {
      name: "list",
      description: "List all components",
      handler: async () => {
        console.log(await readComponents("./components"));
      },
    },
    {
      name: "update",
      description: "Update components",
      handler: async () => {
        try {
          const properties = PropertiesManager.fromYaml(
            Deno.readTextFileSync("./crtb.properties.yml"),
          );
          const currentComponents = await readComponents("./components");

          // register unregistered components
          const unregisteredComponents = currentComponents.filter(
            (component) => {
              return !properties
                .getComponentsAsArray()
                .some(
                  (rc) => toComponentId(rc) === component,
                );
            },
          );

          for (const component_id_str of unregisteredComponents) {
            const { type, name } = ComponentIDString.split(component_id_str);
            if (name === undefined && type !== ComponentIDType.WORLD) {
              console.warn(
                `Component ${component_id_str} has no name, skipping`,
              );
              continue;
            }
            const localPath = `./components/${type}s/${name}`;
            const ref = new LocalRef(localPath);
            const baseOptions = {
              source: { type: "local", path: localPath } as SourceConfig,
            };
            const component = properties.properties.components;
            switch (type) {
              case ComponentIDType.WORLD:
                component.world = new World(ref, baseOptions);
                break;
              case ComponentIDType.DATAPACKS:
                if (component.datapacks === undefined) component.datapacks = [];
                component.datapacks.push(new Datapack(name!, ref, baseOptions));
                break;
              case ComponentIDType.PLUGINS:
                if (component.plugins === undefined) component.plugins = [];
                component.plugins.push(new Plugin(name!, ref, baseOptions));
                break;
              case ComponentIDType.RESOURCEPACKS:
                if (component.resourcepacks === undefined) {
                  component.resourcepacks = [];
                }
                component.resourcepacks.push(
                  new Resourcepack(name!, ref, baseOptions),
                );
                break;
              case ComponentIDType.MODS:
                if (component.mods === undefined) component.mods = [];
                component.mods.push(new Mod(name!, ref, baseOptions));
                break;
              default:
                console.warn(
                  `Unknown component type: ${type}. Skipping ${name}`,
                );
                continue;
            }
          }

          // write property
          Deno.writeTextFileSync("./crtb.properties.yml", properties.toYaml());
          await applyComponents(properties);
        } catch (e) {
          console.error("Error reading components:", e);
        }
      },
    },
  ],
  handler: async (args: string[]) => {
    console.log(await readComponents("./components"));
  },
};

export default cmd;
