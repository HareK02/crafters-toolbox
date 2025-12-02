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
import { getLocalIdentity } from "../docker-env.ts";
import { PropertiesManager, ServerType } from "../property.ts";
import { isTerminal } from "../terminal/tty.ts";
import { DeploymentManifest } from "../deployment/manifest.ts";

const GAME_SERVER_ROOT = "./server";
const CACHE_ROOT = "./.cache/components";
const STREAM_COMPONENT_LOGS = !(
  Deno.env.get("CRTB_COMPONENTS_STREAM_LOGS") === "0"
);
const IS_TTY = !STREAM_COMPONENT_LOGS && isTerminal(Deno.stdout);

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
  (isError ? console.error : console.log)(message);
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

const createStatusManager = (totalCount: number) => {
  const spinner = cliSpinners.dots;
  const states = new Map<string, SpinnerState>();
  const order: string[] = [];
  let timer: number | undefined;
  let lastRender: string | undefined;

  const render = () => {
    if (!IS_TTY) return;
    const names = order;
    const maxName = names.reduce((m, name) => Math.max(m, name.length), 0);
    const completed = names.filter((name) => {
      const state = states.get(name);
      return state?.state === "succeed";
    }).length;

    const lines: string[] = [`Processing... [${completed}/${totalCount}]`];
    names.forEach((name) => {
      const state = states.get(name);
      if (!state) return;
      const icon =
        state.state === "running"
          ? spinner.frames[state.frame % spinner.frames.length]
          : state.state === "succeed"
            ? "✓"
            : "✗";
      const label = `${name.padEnd(maxName)} [${state.phase.padEnd(
        10,
      )} ${icon}]`;
      lines.push(`  ${label}`);
    });

    const output = lines.join("\n");
    if (output === lastRender) return;
    lastRender = output;
    logUpdate(output);
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
      states.set(name, { phase, message, state: "running", frame: 0 });
      if (!order.includes(name)) order.push(name);
      if (!IS_TTY) {
        console.log(`${name} [${phase}] ${message ?? ""}`);
        return;
      }
      ensureTimer();
      tick();
    },
    update: (name: string, phase: string, message?: string) => {
      const s = states.get(name) ?? { phase, state: "running", frame: 0 };
      s.phase = phase;
      s.message = message;
      s.state = "running";
      states.set(name, s);
      if (!IS_TTY) {
        console.log(`${name} [${phase}] ${message ?? ""}`);
        return;
      }
      tick();
    },
    succeed: (name: string, message?: string) => {
      if (!IS_TTY) {
        console.log(`${name} [done] ${message ?? ""}`);
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
        console.error(`${name} [fail] ${message ?? ""}`);
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
      lastRender = undefined;
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
  const base =
    config?.worldContainer === "worlds"
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
    const fileName =
      basename(new URL(url).pathname) || fallbackName.replace(/[/\\]/g, "");
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
): Promise<string> => {
  const targetPath = join(destDir, componentName ?? basename(srcPath));
  const normalizedSrc = await Deno.realPath(srcPath).catch(() => srcPath);
  const normalizedDest = await Deno.realPath(targetPath).catch(
    () => targetPath,
  );
  if (normalizedSrc === normalizedDest) return normalizedDest;

  const stat = await Deno.stat(srcPath);
  await Deno.mkdir(destDir, { recursive: true });
  const targetName = stat.isDirectory
    ? (componentName ?? basename(srcPath))
    : basename(srcPath);
  const dest = join(destDir, targetName);
  await copy(srcPath, dest, { overwrite: true });
  return dest;
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
    const cloneArgs = ["git", "clone", "--depth", "1", source.url, repoDir];
    const updateArgs = ["git", "-C", repoDir, "pull", "--ff-only"];
    const checkoutArgs = source.commit
      ? ["git", "-C", repoDir, "checkout", source.commit]
      : source.branch
        ? ["git", "-C", repoDir, "checkout", source.branch]
        : undefined;

    const exists = await Deno.stat(repoDir)
      .then(() => true)
      .catch(() => false);
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

const getComponentLogLabel = (component: IComponent) => {
  if (component.kind === ComponentIDType.WORLD) return "world";
  if (component.name && component.name.length > 0) return component.name;
  return ComponentIDType.toShortString(component.kind);
};

const flushLogBuffer = (buffer: string, prefix: string, isError: boolean) => {
  if (!buffer.length) return "";
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  const remainder = parts.pop() ?? "";
  for (const part of parts) {
    safeLog(`${prefix} ${part}`, isError);
  }
  return remainder;
};

const streamPrefixedLines = async (
  stream: ReadableStream<Uint8Array> | null,
  prefix: string,
  isError: boolean,
) => {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = flushLogBuffer(buffer, prefix, isError);
  }
  buffer += decoder.decode();
  if (buffer.length) {
    safeLog(`${prefix} ${buffer}`, isError);
  }
};

const streamComponentLogs = async (
  child: Deno.CommandChild,
  component: IComponent,
) => {
  const prefix = `[${getComponentLogLabel(component)}]`;
  await Promise.all([
    streamPrefixedLines(child.stdout, prefix, false),
    streamPrefixedLines(child.stderr, prefix, true),
  ]);
};

const runBuildCommand = async (
  component: IComponent,
  command: Deno.Command,
  failureMessage: string,
) => {
  if (STREAM_COMPONENT_LOGS) {
    const child = command.spawn();
    const [status] = await Promise.all([
      child.status,
      streamComponentLogs(child, component),
    ]);
    if (!status.success) {
      warn(`${failureMessage} (exit code ${status.code})`);
    }
    return status.success;
  }
  const output = await command.output();
  if (!output.success) {
    const msg = new TextDecoder().decode(output.stderr) || failureMessage;
    warn(msg.trim());
  }
  return output.success;
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
      const useGradlew = await Deno.stat(gradlew)
        .then(() => true)
        .catch(() => false);
      const baseCmd = useGradlew ? `./gradlew` : `gradle`;
      const gradleCmd = `${baseCmd} ${task} --console=plain`;
      const gradleUserHome = join(absWorkdir, ".gradle");
      const { uid, gid, username } = getLocalIdentity();
      const userArgs = [
        "-u",
        `${uid}:${gid}`,
        "-e",
        `LOCAL_UID=${uid}`,
        "-e",
        `LOCAL_GID=${gid}`,
        "-e",
        `LOCAL_USER=${username}`,
        "-e",
        `GRADLE_USER_HOME=${gradleUserHome}`,
      ];
      const dockerCmd = new Deno.Command("docker", {
        args: [
          "run",
          "--rm",
          ...userArgs,
          "-e",
          "CI=1",
          "-e",
          "TERM=dumb",
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
      const success = await runBuildCommand(
        component,
        dockerCmd,
        "Gradle build failed",
      );
      if (!success) {
        throw new Error("Gradle build failed");
      }
      return resolveOutputPath(absWorkdir, build.output);
    }
    case "custom": {
      const base = build.workdir
        ? isAbsolute(build.workdir)
          ? build.workdir
          : join(absWorkdir, build.workdir)
        : absWorkdir;
      const { uid, gid, username } = getLocalIdentity();
      const userArgs = [
        "-u",
        `${uid}:${gid}`,
        "-e",
        `LOCAL_UID=${uid}`,
        "-e",
        `LOCAL_GID=${gid}`,
        "-e",
        `LOCAL_USER=${username}`,
      ];
      const dockerCmd = new Deno.Command("docker", {
        args: [
          "run",
          "--rm",
          ...userArgs,
          "-e",
          "CI=1",
          "-e",
          "TERM=dumb",
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
      const success = await runBuildCommand(
        component,
        dockerCmd,
        "Custom build failed",
      );
      if (!success) {
        throw new Error("Custom build failed");
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

const pickArtifactFile = async (
  basePath: string,
  preferredExts: string[],
  pattern?: string,
): Promise<string | undefined> => {
  let regex: RegExp | undefined;
  if (pattern) {
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      warn(`Invalid artifact.pattern /${pattern}/: ${error}`);
    }
  }

  const candidates: { name: string; mtimeMs: number }[] = [];
  for await (const entry of Deno.readDir(basePath)) {
    if (!entry.isFile) continue;
    if (regex && !regex.test(entry.name)) continue;
    if (preferredExts.length) {
      const lower = entry.name.toLowerCase();
      const matchesExt = preferredExts.some((ext) => lower.endsWith(ext));
      if (!matchesExt) continue;
    }
    const fullPath = join(basePath, entry.name);
    const stat = await Deno.stat(fullPath).catch(() => undefined);
    if (!stat) continue;
    const mtimeMs = stat.mtime?.getTime() ?? 0;
    candidates.push({ name: entry.name, mtimeMs });
  }

  if (candidates.length === 0) return undefined;
  candidates.sort(
    (a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name),
  );
  return join(basePath, candidates[0].name);
};

const applyComponents = async (
  properties: PropertiesManager,
  selected?: Set<ComponentIDString>,
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

  const components = properties
    .getComponentsAsArray()
    .filter((component) =>
      selected ? selected.has(toComponentId(component)) : true,
    );
  if (components.length === 0) {
    info("No components matched the selected filters.");
    return;
  }

  const status = createStatusManager(components.length);
  currentStatus = status;
  const config = loadConfig();
  const runnerImage = getJavaImage(config);

  const levelName = await resolveLevelName(GAME_SERVER_ROOT);
  const worldPath = resolveWorldPath(serverType, levelName);
  const datapacksDir = join(worldPath, "datapacks");
  const resourcepacksDir = join(GAME_SERVER_ROOT, "resourcepacks");
  const pluginsDir = join(GAME_SERVER_ROOT, "plugins");
  const modsDir = join(GAME_SERVER_ROOT, "mods");
  const manifest = await DeploymentManifest.load(GAME_SERVER_ROOT);
  const manifestLock = new AsyncLock();

  const tasks = components.map(async (component) => {
    status.start(component.name, "resolving");
    const componentId = toComponentId(component);
    try {
      const localPromise =
        component.kind === ComponentIDType.WORLD
          ? ensureWorldSource(component)
          : ensureLocalPresence(component);
      let localPath: string | undefined;
      try {
        localPath = await withTimeout(localPromise, 60000, () =>
          status.update(component.name, "resolving (timeout)"),
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

      const exists = await Deno.stat(artifactPath)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        status.fail(component.name, `artifact missing: ${artifactPath}`);
        return;
      }
      let finalArtifactPath = artifactPath;
      const stat = await Deno.stat(artifactPath);
      if (
        stat.isDirectory &&
        artifact.type !== "dir" &&
        artifact.type !== "raw"
      ) {
        const exts =
          artifact.type === "jar"
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
          return;
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
            break;
          }
          await copyWorldDir(finalArtifactPath, worldPath);
          status.succeed(component.name, "deployed world");
          deployedPaths.push(await resolveAbsolutePath(worldPath));
          deploymentSucceeded = true;
          break;
        }
        case ComponentIDType.DATAPACKS: {
          const dest = await deployEntry(
            finalArtifactPath,
            datapacksDir,
            component.name,
          );
          if (!dest) {
            status.fail(component.name, "failed to deploy datapack");
            break;
          }
          deployedPaths.push(await resolveAbsolutePath(dest));
          status.succeed(component.name, "deployed datapack");
          deploymentSucceeded = true;
          break;
        }
        case ComponentIDType.RESOURCEPACKS: {
          const dest = await deployEntry(
            finalArtifactPath,
            resourcepacksDir,
            component.name,
          );
          if (!dest) {
            status.fail(component.name, "failed to deploy resourcepack");
            break;
          }
          deployedPaths.push(await resolveAbsolutePath(dest));
          status.succeed(component.name, "deployed resourcepack");
          deploymentSucceeded = true;
          break;
        }
        case ComponentIDType.PLUGINS: {
          if (!deployConfig.supportsPlugins) {
            status.fail(component.name, `unsupported on ${serverType}`);
            break;
          }
          const dest = await deployEntry(
            finalArtifactPath,
            pluginsDir,
            component.name,
          );
          if (!dest) {
            status.fail(component.name, "failed to deploy plugin");
            break;
          }
          deployedPaths.push(await resolveAbsolutePath(dest));
          status.succeed(component.name, "deployed plugin");
          deploymentSucceeded = true;
          break;
        }
        case ComponentIDType.MODS: {
          if (!deployConfig.supportsMods) {
            status.fail(component.name, `unsupported on ${serverType}`);
            break;
          }
          const dest = await deployEntry(
            finalArtifactPath,
            modsDir,
            component.name,
          );
          if (!dest) {
            status.fail(component.name, "failed to deploy mod");
            break;
          }
          deployedPaths.push(await resolveAbsolutePath(dest));
          status.succeed(component.name, "deployed mod");
          deploymentSucceeded = true;
          break;
        }
        default:
          status.fail(component.name, `unknown kind ${component.kind}`);
          break;
      }

      if (deploymentSucceeded) {
        await manifestLock.runExclusive(async () => {
          manifest.setPaths(componentId, deployedPaths);
          await manifest.saveIfDirty();
        });
      }
    } catch (error) {
      status.fail(component.name, `failed: ${error}`);
    }
  });

  await Promise.allSettled(tasks);
  status.stop();
  currentStatus = undefined;
};

type ComponentListEntry = {
  id: ComponentIDString;
  type: ComponentIDType;
  name: string;
  component?: IComponent;
  registered: boolean;
};

const COMPONENT_GROUPS = [
  { type: ComponentIDType.WORLD, label: "World" },
  { type: ComponentIDType.DATAPACKS, label: "Datapacks" },
  { type: ComponentIDType.PLUGINS, label: "Plugins" },
  { type: ComponentIDType.RESOURCEPACKS, label: "Resourcepacks" },
  { type: ComponentIDType.MODS, label: "Mods" },
] as const;

const LOCAL_SOURCE_BASE: Record<ComponentIDType, string> = {
  [ComponentIDType.WORLD]: "./server/world",
  [ComponentIDType.DATAPACKS]: "./components/datapacks",
  [ComponentIDType.PLUGINS]: "./components/plugins",
  [ComponentIDType.RESOURCEPACKS]: "./components/resourcepacks",
  [ComponentIDType.MODS]: "./components/mods",
};

type UnregisteredComponentEntry = {
  id: ComponentIDString;
  type: ComponentIDType;
  name?: string;
  path: string;
};

const resolveLocalComponentPath = (
  type: ComponentIDType,
  name?: string,
): string | undefined => {
  const base = LOCAL_SOURCE_BASE[type];
  if (!base) return undefined;
  if (type === ComponentIDType.WORLD) return base;
  if (!name) return undefined;
  return join(base, name);
};

const pathExists = async (path: string) => {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
};

const discoverUnregisteredComponents = async (
  properties: PropertiesManager,
): Promise<Map<ComponentIDString, UnregisteredComponentEntry>> => {
  const entries = new Map<ComponentIDString, UnregisteredComponentEntry>();
  const registeredIds = new Set(
    properties
      .getComponentsAsArray()
      .map((component) => toComponentId(component)),
  );

  try {
    const currentComponents = await readComponents("./components");
    for (const componentId of currentComponents) {
      if (registeredIds.has(componentId)) continue;
      const { type, name } = ComponentIDString.split(componentId);
      const path = resolveLocalComponentPath(type, name);
      if (!path) continue;
      entries.set(componentId, { id: componentId, type, name, path });
    }
  } catch (error) {
    console.warn("Failed to scan ./components directory:", error);
  }

  if (!registeredIds.has("world" as ComponentIDString)) {
    const worldPath = resolveLocalComponentPath(ComponentIDType.WORLD);
    if (worldPath && (await pathExists(worldPath))) {
      entries.set("world", {
        id: "world",
        type: ComponentIDType.WORLD,
        name: undefined,
        path: worldPath,
      });
    }
  }

  return entries;
};

const gitTextDecoder = new TextDecoder();

const runGitCommand = async (
  cwd: string,
  args: string[],
): Promise<{ success: boolean; stdout: string }> => {
  try {
    const cmd = new Deno.Command("git", {
      args: ["-C", cwd, ...args],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) return { success: false, stdout: "" };
    return {
      success: true,
      stdout: gitTextDecoder.decode(output.stdout).trim(),
    };
  } catch {
    return { success: false, stdout: "" };
  }
};

const detectComponentSource = async (
  relativePath: string,
): Promise<SourceConfig | undefined> => {
  const absPath = await Deno.realPath(relativePath).catch(() => undefined);
  if (!absPath) {
    console.warn(
      `Path "${relativePath}" does not exist; unable to determine source.`,
    );
    return undefined;
  }

  const gitStatus = await runGitCommand(absPath, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (gitStatus.success && gitStatus.stdout === "true") {
    const remote = await runGitCommand(absPath, [
      "config",
      "--get",
      "remote.origin.url",
    ]);
    if (remote.success && remote.stdout.length > 0) {
      return { type: "git", url: remote.stdout };
    }
  }

  return { type: "local", path: relativePath };
};

const fallbackLocalPath = (type: ComponentIDType, name?: string) => {
  const base = LOCAL_SOURCE_BASE[type];
  if (!base) return undefined;
  if (type === ComponentIDType.WORLD) return base;
  if (!name) return base;
  return `${base}/${name}`;
};

const formatSourceSummary = (
  component: IComponent | undefined,
  type: ComponentIDType,
  name?: string,
) => {
  const source = component?.source;
  if (source) {
    switch (source.type) {
      case "local": {
        return source.path ? `local ${source.path}` : "local";
      }
      case "git": {
        const branch = source.branch ? `+${source.branch}` : "";
        const commit =
          !branch && source.commit ? `@${source.commit.slice(0, 7)}` : "";
        const label = branch || commit ? `git${branch || commit}` : "git";
        return `${label} ${source.url}`;
      }
      case "http": {
        const isZip =
          component?.artifact?.type === "zip" ||
          Boolean(component?.artifact?.unzip) ||
          source.url.toLowerCase().endsWith(".zip");
        const label = isZip ? "http(zip)" : "http";
        return `${label} ${source.url}`;
      }
    }
  }

  const fallback = fallbackLocalPath(type, name);
  if (fallback) return `local ${fallback}`;
  return "unknown source";
};

const loadPropertiesComponents = async () => {
  try {
    const yaml = await Deno.readTextFile("./crtb.properties.yml");
    const manager = PropertiesManager.fromYaml(yaml);
    return manager.properties.components;
  } catch (error) {
    console.warn(
      "Failed to load crtb.properties.yml. Falling back to filesystem-only listing.",
      error,
    );
    return undefined;
  }
};

const renderComponentInventory = async () => {
  const components = await loadPropertiesComponents();
  const propertyMap = new Map<ComponentIDString, IComponent>();
  const register = (component?: IComponent) => {
    if (!component) return;
    try {
      propertyMap.set(component.toIDString(), component);
    } catch (error) {
      console.warn(`Failed to register component ${component.name}:`, error);
    }
  };

  register(components?.world);
  components?.datapacks?.forEach(register);
  components?.plugins?.forEach(register);
  components?.resourcepacks?.forEach(register);
  components?.mods?.forEach(register);

  let discoveredIds: ComponentIDString[] = [];
  try {
    discoveredIds = await readComponents("./components");
  } catch (error) {
    console.warn("Failed to scan ./components directory:", error);
  }

  const combinedIds = new Set<ComponentIDString>();
  discoveredIds.forEach((id) => combinedIds.add(id));
  propertyMap.forEach((_component, id) => combinedIds.add(id));
  if (propertyMap.has("world" as ComponentIDString)) {
    combinedIds.add("world");
  }

  const groups = COMPONENT_GROUPS.map((group) => ({
    ...group,
    entries: [] as ComponentListEntry[],
  }));
  const groupLookup = new Map<ComponentIDType, (typeof groups)[number]>();
  for (const group of groups) {
    groupLookup.set(group.type, group);
  }

  for (const id of combinedIds) {
    if (!id) continue;
    let parsed;
    try {
      parsed = ComponentIDString.split(id);
    } catch (error) {
      console.warn(`Skipping unknown component id "${id}":`, error);
      continue;
    }
    const group = groupLookup.get(parsed.type);
    if (!group) continue;
    const entry: ComponentListEntry = {
      id,
      type: parsed.type,
      name: parsed.name ?? "world",
      component: propertyMap.get(id),
      registered: propertyMap.has(id),
    };
    group.entries.push(entry);
  }

  const anyRegistered = groups.some((group) => group.entries.length > 0);
  groups.forEach((group, index) => {
    if (!group.entries.length) {
      console.log(`${group.label}: (none)`);
    } else {
      group.entries.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
      const nameWidth = group.entries.reduce(
        (width, entry) => Math.max(width, entry.name.length),
        0,
      );
      console.log(`${group.label}:`);
      for (const entry of group.entries) {
        const summary = formatSourceSummary(
          entry.component,
          entry.type,
          entry.name,
        );
        const suffix = entry.registered ? "" : "  (unregistered)";
        console.log(`  - ${entry.name.padEnd(nameWidth)}  ${summary}${suffix}`);
      }
    }
    if (index < groups.length - 1) console.log("");
  });

  if (!anyRegistered && combinedIds.size === 0) {
    console.log(
      "No components detected. Add entries under ./components or register them in crtb.properties.yml.",
    );
  }
};

const COMPONENT_TOKEN_ALIASES: Record<string, ComponentIDType> = {
  world: ComponentIDType.WORLD,
  w: ComponentIDType.WORLD,
  dp: ComponentIDType.DATAPACKS,
  datapack: ComponentIDType.DATAPACKS,
  datapacks: ComponentIDType.DATAPACKS,
  pl: ComponentIDType.PLUGINS,
  plugin: ComponentIDType.PLUGINS,
  plugins: ComponentIDType.PLUGINS,
  rp: ComponentIDType.RESOURCEPACKS,
  resourcepack: ComponentIDType.RESOURCEPACKS,
  resourcepacks: ComponentIDType.RESOURCEPACKS,
  mod: ComponentIDType.MODS,
  mods: ComponentIDType.MODS,
};

const resolveTypeAlias = (token: string): ComponentIDType | undefined => {
  return COMPONENT_TOKEN_ALIASES[token.toLowerCase()];
};

const parseComponentSelectorToken = (
  token: string,
): ComponentIDString | null => {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (trimmed === "world") return "world";
  const [typeToken, name] = trimmed.split(":", 2);
  if (!name) {
    console.error(
      `Invalid component selector "${token}". Use <type>:<name> (e.g., dp:example).`,
    );
    return null;
  }
  const type = resolveTypeAlias(typeToken);
  if (!type) {
    console.error(
      `Unknown component type "${typeToken}" in selector "${token}".`,
    );
    return null;
  }
  if (type === ComponentIDType.WORLD) {
    console.error(
      'World component selectors should be specified simply as "world" without a name.',
    );
    return null;
  }
  const short = ComponentIDType.toShortString(type);
  return `${short}:${name}` as ComponentIDString;
};

const parseComponentArgs = (
  tokens: string[],
): ComponentIDString[] | null | undefined => {
  if (tokens.length === 0) return undefined;
  const parsed: ComponentIDString[] = [];
  let hasError = false;
  for (const token of tokens) {
    const result = parseComponentSelectorToken(token);
    if (result) parsed.push(result);
    else hasError = true;
  }
  if (hasError) return null;
  return parsed;
};

const promptComponentsForUpdate = async (): Promise<
  ComponentIDString[] | undefined
> => {
  try {
    const yaml = await Deno.readTextFile("./crtb.properties.yml");
    const manager = PropertiesManager.fromYaml(yaml);
    const defined = manager.getComponentsAsArray();
    if (!defined.length) {
      console.log("crtb.properties.yml に定義済みコンポーネントがありません。");
      return undefined;
    }
    const options = defined.map((component) => {
      const id = toComponentId(component);
      const groupLabel =
        COMPONENT_GROUPS.find((g) => g.type === component.kind)?.label ??
        component.kind;
      const summary = formatSourceSummary(
        component,
        component.kind,
        component.name,
      );
      const label =
        component.kind === ComponentIDType.WORLD ? "world" : component.name;
      return {
        value: id,
        label: `${label} (${groupLabel})`,
        hint: truncateHint(summary),
      };
    });
    const prompts = await import("npm:@clack/prompts");
    const selection = await prompts.multiselect({
      message:
        "更新するコンポーネントを選択してください (Space で選択, Enter で確定)",
      options,
      required: true,
    });
    if (prompts.isCancel(selection) || !Array.isArray(selection)) {
      console.log("コンポーネントの選択をキャンセルしました。");
      return undefined;
    }
    if (selection.length === 0) {
      console.log("コンポーネントが選択されていません。");
      return undefined;
    }
    return selection as ComponentIDString[];
  } catch (error) {
    console.error("Failed to load components for selection:", error);
    return undefined;
  }
};

const getComponentGroupLabel = (type: ComponentIDType) => {
  return COMPONENT_GROUPS.find((g) => g.type === type)?.label ?? type;
};

const truncateHint = (text: string, max = 60) => {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
};

const promptComponentsForImport = async (
  unregistered: Map<ComponentIDString, UnregisteredComponentEntry>,
): Promise<ComponentIDString[] | undefined> => {
  if (unregistered.size === 0) {
    console.log("インポート可能なコンポーネントはありません。");
    return undefined;
  }

  const sorted = [...unregistered.values()].sort((a, b) =>
    (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
      sensitivity: "base",
    }),
  );
  const options = sorted.map((entry) => {
    const label =
      entry.type === ComponentIDType.WORLD ? "world" : (entry.name ?? entry.id);
    const groupLabel = getComponentGroupLabel(entry.type);
    return {
      value: entry.id,
      label: `${label} (${groupLabel})`,
      hint: truncateHint(entry.path),
    };
  });

  const prompts = await import("npm:@clack/prompts");
  const selection = await prompts.multiselect({
    message:
      "インポートするコンポーネントを選択してください (Space で選択, Enter で確定)",
    options,
    required: true,
  });
  if (prompts.isCancel(selection) || !Array.isArray(selection)) {
    console.log("コンポーネントの選択をキャンセルしました。");
    return undefined;
  }
  if (selection.length === 0) {
    console.log("コンポーネントが選択されていません。");
    return undefined;
  }
  return selection as ComponentIDString[];
};

const runComponentsUpdate = async (
  args: string[],
  preselected?: ComponentIDString[],
) => {
  const selectionFromArgs = preselected?.length
    ? preselected
    : parseComponentArgs(args);
  if (selectionFromArgs === null) return;

  try {
    const properties = PropertiesManager.fromYaml(
      Deno.readTextFileSync("./crtb.properties.yml"),
    );
    const availableIds = new Set(
      properties
        .getComponentsAsArray()
        .map((component) => toComponentId(component)),
    );

    try {
      const currentComponents = await readComponents("./components");
      const unregisteredComponents = currentComponents.filter(
        (component) => !availableIds.has(component),
      );
      if (unregisteredComponents.length) {
        console.warn(
          `The following components exist locally but are not registered in crtb.properties.yml and were skipped: ${unregisteredComponents.join(
            ", ",
          )}`,
        );
      }
    } catch (error) {
      console.warn("Failed to scan ./components directory:", error);
    }

    let selectedSet: Set<ComponentIDString> | undefined;
    if (selectionFromArgs && selectionFromArgs.length) {
      const matched: ComponentIDString[] = [];
      const missing: ComponentIDString[] = [];
      for (const id of selectionFromArgs) {
        if (availableIds.has(id)) matched.push(id);
        else missing.push(id);
      }
      if (missing.length) {
        console.warn(
          `The following components are not registered and were skipped: ${missing.join(
            ", ",
          )}`,
        );
      }
      if (!matched.length) {
        console.error("指定されたコンポーネントが存在しません。");
        return;
      }
      selectedSet = new Set(matched);
    }

    await applyComponents(properties, selectedSet);
  } catch (e) {
    console.error("Error reading components:", e);
  }
};

const registerImportedComponent = (
  properties: PropertiesManager,
  entry: UnregisteredComponentEntry,
  source: SourceConfig,
): boolean => {
  const baseOptions = { source };
  const component = properties.properties.components;
  switch (entry.type) {
    case ComponentIDType.WORLD:
      component.world = new World(undefined, baseOptions);
      return true;
    case ComponentIDType.DATAPACKS:
      if (!entry.name) {
        console.warn(`Component ${entry.id} has no name; skipping import.`);
        return false;
      }
      component.datapacks ??= [];
      component.datapacks.push(
        new Datapack(entry.name, undefined, baseOptions),
      );
      return true;
    case ComponentIDType.PLUGINS:
      if (!entry.name) {
        console.warn(`Component ${entry.id} has no name; skipping import.`);
        return false;
      }
      component.plugins ??= [];
      component.plugins.push(new Plugin(entry.name, undefined, baseOptions));
      return true;
    case ComponentIDType.RESOURCEPACKS:
      if (!entry.name) {
        console.warn(`Component ${entry.id} has no name; skipping import.`);
        return false;
      }
      component.resourcepacks ??= [];
      component.resourcepacks.push(
        new Resourcepack(entry.name, undefined, baseOptions),
      );
      return true;
    case ComponentIDType.MODS:
      if (!entry.name) {
        console.warn(`Component ${entry.id} has no name; skipping import.`);
        return false;
      }
      component.mods ??= [];
      component.mods.push(new Mod(entry.name, undefined, baseOptions));
      return true;
    default:
      console.warn(`Unknown component type: ${entry.type}`);
      return false;
  }
};

const runComponentsImport = async (
  args: string[],
  preselected?: ComponentIDString[],
) => {
  const selectionFromArgs = preselected?.length
    ? preselected
    : parseComponentArgs(args);
  if (selectionFromArgs === null) return;

  let properties: PropertiesManager;
  try {
    properties = PropertiesManager.fromYaml(
      Deno.readTextFileSync("./crtb.properties.yml"),
    );
  } catch (error) {
    console.error("Failed to load crtb.properties.yml:", error);
    return;
  }

  const unregistered = await discoverUnregisteredComponents(properties);
  if (unregistered.size === 0) {
    console.log(
      "crtb.properties.yml に未登録のコンポーネントは見つかりませんでした。",
    );
    return;
  }

  let targetIds: ComponentIDString[];
  if (selectionFromArgs && selectionFromArgs.length) {
    const missing = selectionFromArgs.filter((id) => !unregistered.has(id));
    if (missing.length) {
      console.warn(
        `The following components are not available for import: ${missing.join(
          ", ",
        )}`,
      );
    }
    targetIds = selectionFromArgs.filter((id) => unregistered.has(id));
    if (!targetIds.length) {
      console.error("インポート対象のコンポーネントが見つかりませんでした。");
      return;
    }
  } else {
    targetIds = [...unregistered.keys()];
  }

  const imported: ComponentIDString[] = [];
  for (const id of targetIds) {
    const entry = unregistered.get(id);
    if (!entry) continue;
    const source = await detectComponentSource(entry.path);
    if (!source) {
      console.warn(`${id}: ソースが特定できなかったためスキップしました。`);
      continue;
    }
    const registered = registerImportedComponent(properties, entry, source);
    if (!registered) continue;
    imported.push(id);
  }

  if (!imported.length) {
    console.log("インポートされたコンポーネントはありません。");
    return;
  }

  try {
    Deno.writeTextFileSync("./crtb.properties.yml", properties.toYaml());
  } catch (error) {
    console.error("Failed to write crtb.properties.yml:", error);
    return;
  }

  console.log(
    `Imported ${imported.length} component(s): ${imported.join(", ")}`,
  );
};

const runComponentsImportInteractive = async () => {
  try {
    const properties = PropertiesManager.fromYaml(
      Deno.readTextFileSync("./crtb.properties.yml"),
    );
    const unregistered = await discoverUnregisteredComponents(properties);
    if (unregistered.size === 0) {
      console.log(
        "crtb.properties.yml に未登録のコンポーネントは見つかりませんでした。",
      );
      return;
    }
    const selection = await promptComponentsForImport(unregistered);
    if (!selection || selection.length === 0) {
      console.log(
        "コンポーネントが選択されていないため、インポートを中止しました。",
      );
      return;
    }
    await runComponentsImport([], selection);
  } catch (error) {
    console.error("Failed to prepare import flow:", error);
  }
};

const cmd: Command = {
  name: "components",
  description: "Show components information",
  subcommands: [
    {
      name: "list",
      description: "List all components",
      handler: renderComponentInventory,
    },
    {
      name: "import",
      description:
        "Register locally discovered components into crtb.properties.yml",
      handler: async (args: string[]) => {
        await runComponentsImport(args);
      },
      interactiveHandler: async () => {
        await runComponentsImportInteractive();
      },
    },
    {
      name: "update",
      description:
        "Update components (optionally pass selectors like dp:example to limit scope)",
      handler: async (args: string[]) => {
        await runComponentsUpdate(args);
      },
      interactiveHandler: async () => {
        const selection = await promptComponentsForUpdate();
        if (!selection || selection.length === 0) {
          console.log(
            "コンポーネントが選択されていないため、更新を中止しました。",
          );
          return;
        }
        await runComponentsUpdate([], selection);
      },
    },
  ],
  handler: async () => {
    await renderComponentInventory();
  },
};

export default cmd;
