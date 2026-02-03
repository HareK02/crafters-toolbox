import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { ensureDir } from "@std/fs";
import { stringify } from "@std/yaml";
import { Command } from "../command.ts";
import {
  createHttpClient,
  DEFAULT_USER_AGENT,
  fetchJson,
  fetchText,
} from "../server-jar-downloader/utils.ts";
import { deriveNeoForgePrefix } from "../server-jar-downloader/servers/neoforge.ts";
import setupCmd from "./setup.ts";
import { ServerType } from "../property.ts";

// Resolve paths relative to the current module to ensure they work in compiled binaries
const __dirname = dirname(fromFileUrl(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../");

const TEMPLATES_DIR = join(PROJECT_ROOT, "templates");

const TEMPLATE_FILES = [".gitignore"];

const DEFAULT_INIT_SETTINGS = {
  serverType: "paper" as ServerType,
  serverVersion: "latest",
  serverBuild: "latest",
  maxMemory: "8G",
  minMemory: "2G",
  sshEnabled: true,
  sshKeyAuth: true,
  sshPasswordAuth: false,
  sshPassword: "",
};

const MAX_VERSION_OPTIONS = 20;
const MAX_BUILD_OPTIONS = 20;
const PRE_RELEASE_PATTERN = /-(?:pre|rc|beta|alpha)/i;

// List of files to copy from docker/
// We need to list them explicitly or read the directory if --include supports listing (it does via Deno.readDir)
// But Deno.readDir might be tricky with --include if not fully supported in all versions,
// let's try dynamic reading first as it's cleaner, but fallback to explicit list if needed.
// 'docker' dir is included, so we should be able to read it.

const cmd: Command = {
  name: "init",
  description: "Initialize a new Crafters Toolbox project",
  handler: async (args: string[]) => {
    const noPrompt = args.includes("--no-prompt");
    const targetArg = args.find((arg) => !arg.startsWith("--"));
    const targetDir = targetArg ? resolve(targetArg) : Deno.cwd();

    console.log(`Initializing project in ${targetDir}...`);
    await ensureDir(targetDir);

    // Check if directory is empty-ish
    let isEmpty = true;
    for await (const _ of Deno.readDir(targetDir)) {
      isEmpty = false;
      break;
    }

    if (!isEmpty) {
      console.warn(`Warning: Directory ${targetDir} is not empty.`);
      // In a real CLI interactions we might ask for confirmation,
      // but for now let's just proceed with a warning or maybe fail?
      // Let's just warn.
    }

    const promptResult = noPrompt ? null : await promptInitSettings();
    if (!noPrompt && promptResult === null) {
      console.log("Initialization canceled.");
      return;
    }

    // 1. Create directories
    const dirsToCreate = ["server", "components"];
    for (const dir of dirsToCreate) {
      await ensureDir(join(targetDir, dir));
    }

    // 2. Copy templates
    // Because of 'deno compile --include', we can read files from the original source path relative to the module root (virtual fs)
    // We assume the binary runs with the virtual fs having 'templates/' and 'docker/' at root.
    // Actually, 'deno compile' includes typically map to the path relative to the entrypoint or CWD at build time?
    // It usually preserves the relative structure. configuration is at named paths.

    // Let's try reading from "./templates" and "./docker".

    // Copy base templates (e.g. .gitignore)
    for (const file of TEMPLATE_FILES) {
      const src = join(TEMPLATES_DIR, file);
      const dest = join(targetDir, file);
      try {
        const content = await Deno.readTextFile(src);
        await Deno.writeTextFile(dest, content);
        console.log(`Created ${file}`);
      } catch (e) {
        console.error(`Failed to copy template ${src}: ${e}`);
      }
    }

    // Write config files (prompted or default templates)
    if (promptResult) {
      await Deno.writeTextFile(
        join(targetDir, "crtb.properties.yml"),
        promptResult.propertiesYaml,
      );
      await Deno.writeTextFile(
        join(targetDir, "crtb.config.yml"),
        promptResult.configYaml,
      );
      console.log("Created crtb.properties.yml");
      console.log("Created crtb.config.yml");
    } else {
      await copyTemplateToTarget("crtb.properties.yml", targetDir);
      await copyTemplateToTarget("crtb.config.yml", targetDir);
    }

    console.log(`\nProject initialized successfully!`);

    if (!noPrompt) {
      const runSetup = await promptRunSetup();
      if (runSetup === true) {
        const previousCwd = Deno.cwd();
        try {
          Deno.chdir(targetDir);
          await setupCmd.handler([]);
        } finally {
          Deno.chdir(previousCwd);
        }
        return;
      }
      if (runSetup === null) {
        console.log("Initialization canceled.");
        return;
      }
    }

    console.log(`Run 'crtb setup' to get started.`);
  },
};

export default cmd;

async function copyTemplateToTarget(file: string, targetDir: string) {
  const src = join(TEMPLATES_DIR, file);
  const dest = join(targetDir, file);
  try {
    const content = await Deno.readTextFile(src);
    await Deno.writeTextFile(dest, content);
    console.log(`Created ${file}`);
  } catch (e) {
    console.error(`Failed to copy template ${src}: ${e}`);
  }
}

type InitPromptResult = {
  propertiesYaml: string;
  configYaml: string;
};

type PromptsModule = typeof import("@clack/prompts");

async function promptInitSettings(): Promise<InitPromptResult | null> {
  const prompts = await import("@clack/prompts");

  const serverType = await prompts.select({
    message: "Server type を選択してください",
    options: [
      { value: "vanilla", label: "vanilla" },
      { value: "paper", label: "paper" },
      { value: "spigot", label: "spigot" },
      { value: "forge", label: "forge" },
      { value: "fabric", label: "fabric" },
      { value: "bukkit", label: "bukkit" },
      { value: "neoforge", label: "neoforge" },
    ],
    initialValue: DEFAULT_INIT_SETTINGS.serverType,
  });
  if (prompts.isCancel(serverType)) return null;

  const serverVersion = await promptServerVersion(
    prompts,
    serverType as ServerType,
  );
  if (serverVersion === null) return null;

  const serverBuild = await promptServerBuild(
    prompts,
    serverType as ServerType,
    serverVersion,
  );
  if (serverBuild === null) return null;

  const maxMemory = await prompts.text({
    message: "ゲームサーバーの最大メモリを入力してください",
    initialValue: DEFAULT_INIT_SETTINGS.maxMemory,
    validate: (value: string) => {
      if (!value?.trim()) return "最大メモリを入力してください";
      return undefined;
    },
  });
  if (prompts.isCancel(maxMemory)) return null;

  const minMemory = await prompts.text({
    message: "ゲームサーバーの最小メモリを入力してください",
    initialValue: DEFAULT_INIT_SETTINGS.minMemory,
    validate: (value: string) => {
      if (!value?.trim()) return "最小メモリを入力してください";
      return undefined;
    },
  });
  if (prompts.isCancel(minMemory)) return null;

  const sshEnabled = await prompts.confirm({
    message: "SSH コンテナを有効にしますか？",
    initialValue: DEFAULT_INIT_SETTINGS.sshEnabled,
  });
  if (prompts.isCancel(sshEnabled)) return null;

  let sshKeyAuth = DEFAULT_INIT_SETTINGS.sshKeyAuth;
  let sshPasswordAuth = DEFAULT_INIT_SETTINGS.sshPasswordAuth;
  let sshPassword = DEFAULT_INIT_SETTINGS.sshPassword;

  if (sshEnabled) {
    const keyAuthResult = await prompts.confirm({
      message: "SSH 公開鍵認証を有効にしますか？",
      initialValue: DEFAULT_INIT_SETTINGS.sshKeyAuth,
    });
    if (prompts.isCancel(keyAuthResult)) return null;
    sshKeyAuth = keyAuthResult;

    const passwordAuthResult = await prompts.confirm({
      message: "SSH パスワード認証を有効にしますか？",
      initialValue: DEFAULT_INIT_SETTINGS.sshPasswordAuth,
    });
    if (prompts.isCancel(passwordAuthResult)) return null;
    sshPasswordAuth = passwordAuthResult;

    if (sshPasswordAuth) {
      const passwordValue = await prompts.text({
        message: "SSH パスワードを入力してください",
        placeholder: "password",
        validate: (value: string) => {
          if (!value?.trim()) return "パスワードを入力してください";
          return undefined;
        },
      });
      if (prompts.isCancel(passwordValue)) return null;
      sshPassword = String(passwordValue);
    }
  }

  const propertiesYaml = stringify({
    server: {
      type: serverType as ServerType,
      version: String(serverVersion).trim(),
      build: String(serverBuild).trim(),
    },
    components: {},
  });

  const config = {
    game_server: {
      max_memory: String(maxMemory).trim(),
      min_memory: String(minMemory).trim(),
    },
    ssh: {
      enabled: Boolean(sshEnabled),
      auth: {
        keys: {
          enabled: Boolean(sshEnabled && sshKeyAuth),
        },
        password: {
          enabled: Boolean(sshEnabled && sshPasswordAuth),
          value: sshEnabled && sshPasswordAuth ? sshPassword : "",
        },
      },
    },
  };

  const configYaml = stringify(config);

  return { propertiesYaml, configYaml };
}

async function promptRunSetup(): Promise<boolean | null> {
  const prompts = await import("@clack/prompts");
  const result = await prompts.confirm({
    message: "続けて setup を実行しますか？",
    initialValue: true,
  });
  if (prompts.isCancel(result)) return null;
  return Boolean(result);
}

async function promptServerVersion(
  prompts: PromptsModule,
  serverType: ServerType,
): Promise<string | null> {
  const supportsApi = ["vanilla", "paper", "fabric", "neoforge"].includes(
    serverType,
  );
  if (!supportsApi) {
    return await promptTextValue(
      prompts,
      "Server version を入力してください",
      DEFAULT_INIT_SETTINGS.serverVersion,
      "version を入力してください",
      "1.21.4",
    );
  }

  const versions = await fetchAvailableVersions(serverType);
  if (!versions?.length) {
    return await promptTextValue(
      prompts,
      "Server version を入力してください",
      DEFAULT_INIT_SETTINGS.serverVersion,
      "version を入力してください",
      "1.21.4",
    );
  }

  const options = [
    { value: "latest", label: "latest (stable)" },
    { value: "latest-beta", label: "latest-beta (snapshot/experimental)" },
    ...versions.slice(0, MAX_VERSION_OPTIONS).map((entry) => ({
      value: entry.value,
      label: entry.label,
      hint: entry.hint,
    })),
    { value: "enter", label: "Enter version" },
  ];

  const versionChoice = await prompts.select({
    message: "Server version を選択してください",
    options,
    initialValue: DEFAULT_INIT_SETTINGS.serverVersion,
  });
  if (prompts.isCancel(versionChoice)) return null;

  if (versionChoice === "enter") {
    return await promptTextValue(
      prompts,
      "Server version を入力してください",
      "",
      "version を入力してください",
      "1.21.4",
    );
  }

  return String(versionChoice);
}

async function promptServerBuild(
  prompts: PromptsModule,
  serverType: ServerType,
  serverVersion: string,
): Promise<string | null> {
  const supportsBuildList = ["paper", "fabric", "neoforge"].includes(
    serverType,
  );
  const isSpecialVersion = serverVersion === "latest" ||
    serverVersion === "latest-beta";

  if (!supportsBuildList || isSpecialVersion) {
    return await promptTextValue(
      prompts,
      "Server build を入力してください (latest も可)",
      DEFAULT_INIT_SETTINGS.serverBuild,
      "build を入力してください",
    );
  }

  const builds = await fetchAvailableBuilds(serverType, serverVersion);
  if (!builds?.length) {
    return await promptTextValue(
      prompts,
      "Server build を入力してください (latest も可)",
      DEFAULT_INIT_SETTINGS.serverBuild,
      "build を入力してください",
    );
  }

  const options = [
    { value: "latest", label: "latest (stable)" },
    { value: "latest-beta", label: "latest-beta (experimental)" },
    ...builds.slice(0, MAX_BUILD_OPTIONS).map((entry) => ({
      value: entry.value,
      label: entry.label,
      hint: entry.hint,
    })),
    { value: "enter", label: "Enter build" },
  ];

  const buildChoice = await prompts.select({
    message: "Server build を選択してください",
    options,
    initialValue: DEFAULT_INIT_SETTINGS.serverBuild,
  });
  if (prompts.isCancel(buildChoice)) return null;

  if (buildChoice === "enter") {
    return await promptTextValue(
      prompts,
      "Server build を入力してください",
      "",
      "build を入力してください",
    );
  }

  return String(buildChoice);
}

async function promptTextValue(
  prompts: PromptsModule,
  message: string,
  initialValue: string,
  validateMessage: string,
  placeholder?: string,
): Promise<string | null> {
  const value = await prompts.text({
    message,
    initialValue,
    placeholder,
    validate: (input: string) => {
      if (!input?.trim()) return validateMessage;
      return undefined;
    },
  });
  if (prompts.isCancel(value)) return null;
  return String(value).trim();
}

type VersionOption = { value: string; label: string; hint?: string };

async function fetchAvailableVersions(
  serverType: ServerType,
): Promise<VersionOption[] | null> {
  const client = createHttpClient({ userAgent: DEFAULT_USER_AGENT });
  try {
    switch (serverType) {
      case "vanilla": {
        const manifest = await fetchJson<{
          versions: { id: string; type: string }[];
        }>(
          client,
          "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
        );
        return manifest.versions.map((entry) => ({
          value: entry.id,
          label: entry.id,
          hint: entry.type,
        }));
      }
      case "paper": {
        const project = await fetchJson<{ versions: string[] }>(
          client,
          "https://api.papermc.io/v2/projects/paper",
        );
        return [...project.versions].reverse().map((version) => ({
          value: version,
          label: version,
          hint: PRE_RELEASE_PATTERN.test(version) ? "beta" : "stable",
        }));
      }
      case "fabric": {
        const versions = await fetchJson<
          { version: string; stable: boolean }[]
        >(client, "https://meta.fabricmc.net/v2/versions/game");
        return versions.map((entry) => ({
          value: entry.version,
          label: entry.version,
          hint: entry.stable ? "stable" : "beta",
        }));
      }
      case "neoforge": {
        const xml = await fetchText(
          client,
          "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
        );
        const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
          .map(([, version]) => version.trim())
          .filter(Boolean);
        return versions.reverse().map((version) => ({
          value: version,
          label: version,
          hint: PRE_RELEASE_PATTERN.test(version) ? "beta" : "stable",
        }));
      }
      default:
        return null;
    }
  } catch (error) {
    console.warn(
      `[init] Failed to fetch available versions from official API: ${error}`,
    );
    return null;
  }
}

type BuildOption = { value: string; label: string; hint?: string };

async function fetchAvailableBuilds(
  serverType: ServerType,
  version: string,
): Promise<BuildOption[] | null> {
  const client = createHttpClient({ userAgent: DEFAULT_USER_AGENT });
  try {
    switch (serverType) {
      case "paper": {
        const meta = await fetchJson<{ builds: number[] }>(
          client,
          `https://api.papermc.io/v2/projects/paper/versions/${version}`,
        );
        const sorted = [...meta.builds].sort((a, b) => b - a);
        return sorted.map((build) => ({
          value: String(build),
          label: String(build),
        }));
      }
      case "fabric": {
        const loaders = await fetchJson<
          { loader: { version: string; stable: boolean } }[]
        >(client, `https://meta.fabricmc.net/v2/versions/loader/${version}`);
        return loaders.map((entry) => ({
          value: entry.loader.version,
          label: entry.loader.version,
          hint: entry.loader.stable ? "stable" : "beta",
        }));
      }
      case "neoforge": {
        const xml = await fetchText(
          client,
          "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
        );
        const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
          .map(([, entry]) => entry.trim())
          .filter(Boolean);
        const prefix = deriveNeoForgePrefix(version);
        const filtered = prefix
          ? versions.filter((entry) => entry.startsWith(prefix))
          : versions;
        const ordered = [...filtered].reverse();
        return ordered.map((build) => ({
          value: build,
          label: build,
          hint: PRE_RELEASE_PATTERN.test(build) ? "beta" : "stable",
        }));
      }
      default:
        return null;
    }
  } catch (error) {
    console.warn(
      `[init] Failed to fetch available builds from official API: ${error}`,
    );
    return null;
  }
}
