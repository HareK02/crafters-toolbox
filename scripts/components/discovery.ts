/**
 * ローカルコンポーネントの発見と管理
 */
import { join } from "@std/path";
import { ComponentIDType, IComponent, SourceConfig } from "../component.ts";
import { readComponents } from "../components_reader.ts";
import { PropertiesManager } from "../property.ts";
import {
  createDatapack,
  createMod,
  createPlugin,
  createResourcepack,
  createWorld,
} from "./base.ts";
import { componentBasePath } from "./source-resolver.ts";

const COMPONENTS_BASE_DIR = "./components";
const WORLD_DEFAULT_PATH = "./server/world";

type ComponentIDString = string;

export type ComponentListEntry = {
  name: string;
  component?: IComponent;
  registered: boolean;
};

export type UnregisteredComponentEntry = {
  name: string;
  path: string;
};

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  world: "world",
  datapack: "datapack",
  plugin: "plugin",
  resourcepack: "resourcepack",
  mod: "mod",
};

const resolveLocalComponentPath = (name: string): string => {
  return join(COMPONENTS_BASE_DIR, name);
};

const pathExists = async (path: string) => {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
};

export const discoverUnregisteredComponents = async (
  properties: PropertiesManager,
): Promise<Map<string, UnregisteredComponentEntry>> => {
  const entries = new Map<string, UnregisteredComponentEntry>();

  const registeredNames = new Set<string>();
  const registeredPaths = new Set<string>();
  for (const component of properties.getComponentsAsArray()) {
    registeredNames.add(component.name);
    const path = componentBasePath(component);
    registeredPaths.add(path);
  }

  try {
    const dirNames = await readComponents(COMPONENTS_BASE_DIR);
    for (const name of dirNames) {
      const path = resolveLocalComponentPath(name);
      if (registeredNames.has(name) || registeredPaths.has(path)) continue;
      entries.set(name, { name, path });
    }
  } catch (error) {
    console.warn("Failed to scan ./components directory:", error);
  }

  if (!registeredNames.has("world")) {
    if (await pathExists(WORLD_DEFAULT_PATH)) {
      entries.set("world", {
        name: "world",
        path: WORLD_DEFAULT_PATH,
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

export const detectComponentSource = async (
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
    if (remote.success) {
      return { type: "git", url: remote.stdout.trim() };
    }
  }

  return { type: "local", path: relativePath };
};

const fallbackLocalPath = (name: string) => {
  if (name === "world") return WORLD_DEFAULT_PATH;
  return `${COMPONENTS_BASE_DIR}/${name}`;
};

export const formatSourceSummary = (
  component: IComponent | undefined,
  name: string,
) => {
  const source = component?.source;
  if (source) {
    switch (source.type) {
      case "local": {
        return source.path ? `local ${source.path}` : "local";
      }
      case "git": {
        if (!source.url && "path" in source) {
          return `(configuration error: use 'url' instead of 'path' for git source)`;
        }
        const branch = source.branch ? `+${source.branch}` : "";
        const commit = !branch && source.commit
          ? `@${source.commit.slice(0, 7)}`
          : "";
        const label = branch || commit ? `git${branch || commit}` : "git";
        return `${label} ${source.url}`;
      }
      case "http": {
        const isZip = component?.artifact?.type === "zip" ||
          Boolean(component?.artifact?.unzip) ||
          source.url.toLowerCase().endsWith(".zip");
        const label = isZip ? "http(zip)" : "http";
        return `${label} ${source.url}`;
      }
    }
  }

  const fallback = fallbackLocalPath(name);
  return `local ${fallback}`;
};

export const loadPropertiesComponents = async () => {
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

export const renderComponentInventory = async () => {
  const componentsConfig = await loadPropertiesComponents();

  const registeredMap = new Map<string, IComponent>();
  if (componentsConfig?.world) {
    registeredMap.set("world", componentsConfig.world);
  }
  componentsConfig?.datapacks?.forEach((c) => registeredMap.set(c.name, c));
  componentsConfig?.plugins?.forEach((c) => registeredMap.set(c.name, c));
  componentsConfig?.resourcepacks?.forEach((c) => registeredMap.set(c.name, c));
  componentsConfig?.mods?.forEach((c) => registeredMap.set(c.name, c));

  let discoveredNames: string[] = [];
  try {
    discoveredNames = await readComponents(COMPONENTS_BASE_DIR);
  } catch (error) {
    console.warn("Failed to scan ./components directory:", error);
  }

  const allNames = new Set<string>();
  discoveredNames.forEach((name) => allNames.add(name));
  registeredMap.forEach((_component, name) => allNames.add(name));

  const entries: ComponentListEntry[] = [];
  for (const name of allNames) {
    entries.push({
      name,
      component: registeredMap.get(name),
      registered: registeredMap.has(name),
    });
  }

  entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  if (entries.length === 0) {
    console.log(
      "No components detected. Add entries under ./components or register them in crtb.properties.yml.",
    );
    return;
  }

  const nameWidth = entries.reduce(
    (width, entry) => Math.max(width, entry.name.length),
    0,
  );

  console.log("Components:");
  for (const entry of entries) {
    let summary = formatSourceSummary(entry.component, entry.name);

    if (!entry.registered) {
      const path = resolveLocalComponentPath(entry.name);
      const detected = await detectComponentSource(path);
      if (detected?.type === "git") {
        const url = detected.url || "(no remote)";
        const branch = detected.branch ? `+${detected.branch}` : "";
        summary = `git${branch} ${url}`;
      }
    }

    const typeLabel = entry.component
      ? ` [${COMPONENT_TYPE_LABELS[entry.component.kind]}]`
      : "";
    const suffix = entry.registered ? "" : "  (unregistered)";
    console.log(
      `  - ${entry.name.padEnd(nameWidth)}${typeLabel}  ${summary}${suffix}`,
    );
  }
};

export const detectComponentType = async (
  path: string,
): Promise<string | undefined> => {
  try {
    const packMcmetaPath = join(path, "pack.mcmeta");
    try {
      await Deno.stat(packMcmetaPath);
      const dataPath = join(path, "data");
      const assetsPath = join(path, "assets");
      const hasData = await Deno.stat(dataPath).then(() => true).catch(() =>
        false
      );
      const hasAssets = await Deno.stat(assetsPath).then(() => true).catch(() =>
        false
      );
      if (hasData) return ComponentIDType.DATAPACKS;
      if (hasAssets) return ComponentIDType.RESOURCEPACKS;
      return ComponentIDType.DATAPACKS;
    } catch {
      // pack.mcmeta not found
    }

    const buildGradlePath = join(path, "build.gradle");
    const buildGradleKtsPath = join(path, "build.gradle.kts");
    const hasBuildGradle = await Deno.stat(buildGradlePath).then(() => true)
      .catch(() => false);
    const hasBuildGradleKts = await Deno.stat(buildGradleKtsPath).then(() =>
      true
    ).catch(() => false);
    if (hasBuildGradle || hasBuildGradleKts) {
      const fabricModJsonPath = join(
        path,
        "src/main/resources/fabric.mod.json",
      );
      const hasFabricMod = await Deno.stat(fabricModJsonPath).then(() => true)
        .catch(() => false);
      if (hasFabricMod) return ComponentIDType.MODS;
      const modsTomlPath = join(path, "src/main/resources/META-INF/mods.toml");
      const hasModsToml = await Deno.stat(modsTomlPath).then(() => true).catch(
        () => false,
      );
      if (hasModsToml) return ComponentIDType.MODS;
      const pluginYmlPath = join(path, "src/main/resources/plugin.yml");
      const hasPluginYml = await Deno.stat(pluginYmlPath).then(() => true)
        .catch(() => false);
      if (hasPluginYml) return ComponentIDType.PLUGINS;
      const paperPluginYmlPath = join(
        path,
        "src/main/resources/paper-plugin.yml",
      );
      const hasPaperPluginYml = await Deno.stat(paperPluginYmlPath).then(() =>
        true
      ).catch(() => false);
      if (hasPaperPluginYml) return ComponentIDType.PLUGINS;
      return ComponentIDType.PLUGINS;
    }

    const levelDatPath = join(path, "level.dat");
    const hasLevelDat = await Deno.stat(levelDatPath).then(() => true).catch(
      () => false,
    );
    if (hasLevelDat) return ComponentIDType.WORLD;
  } catch {
    // detection failed
  }
  return undefined;
};

export const registerImportedComponent = async (
  properties: PropertiesManager,
  entry: UnregisteredComponentEntry,
  source: SourceConfig,
): Promise<boolean> => {
  const componentType = entry.name === "world"
    ? ComponentIDType.WORLD
    : await detectComponentType(entry.path);

  if (!componentType) {
    console.warn(
      `${entry.name}: タイプを自動検出できませんでした。スキップします。`,
    );
    return false;
  }

  const baseOptions = { source };
  const component = properties.properties.components;

  switch (componentType) {
    case ComponentIDType.WORLD:
      component.world = createWorld(baseOptions);
      return true;
    case ComponentIDType.DATAPACKS:
      component.datapacks ??= [];
      component.datapacks.push(createDatapack(entry.name, baseOptions));
      return true;
    case ComponentIDType.PLUGINS:
      component.plugins ??= [];
      component.plugins.push(createPlugin(entry.name, baseOptions));
      return true;
    case ComponentIDType.RESOURCEPACKS:
      component.resourcepacks ??= [];
      component.resourcepacks.push(createResourcepack(entry.name, baseOptions));
      return true;
    case ComponentIDType.MODS:
      component.mods ??= [];
      component.mods.push(createMod(entry.name, baseOptions));
      return true;
    default:
      console.warn(`Unknown component type: ${componentType}`);
      return false;
  }
};

export const truncateHint = (text: string, max = 60) => {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
};
