import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { createHttpClient, downloadFile } from "./utils.ts";
import { LauncherOptions } from "./types.ts";
import {
  extractNatives,
  getVersionJson,
  getVersionManifest,
  resolveAssets,
  resolveLibraries,
} from "./mojang.ts";
import { getFabricProfile, resolveFabricLibraries } from "./fabric.ts";

export async function launchClient(options: LauncherOptions) {
  const client = createHttpClient();
  console.log(`\nLocal Launcher: Preparing ${options.version}...`);

  // 1. Mojang Manifest & Version JSON
  const manifest = await getVersionManifest(client);
  const versionJson = await getVersionJson(client, options.version, manifest);

  // 2. Assets
  console.log("Checking assets...");
  await resolveAssets(client, versionJson.assetIndex, options.assetsDir);

  // 3. Vanilla Libraries & Natives
  console.log("Checking libraries...");
  const vanillaCp = await resolveLibraries(
    client,
    versionJson.libraries,
    options.librariesDir,
  );
  await extractNatives(
    client,
    versionJson.libraries,
    options.librariesDir,
    options.nativesDir,
  );

  let mainClass = versionJson.mainClass;
  let gameArgs = versionJson.arguments?.game || [];
  let jvmArgs = versionJson.arguments?.jvm || [];

  // 4. Fabric (if requested)
  let fabricCp: string[] = [];
  if (options.fabricVersion) {
    console.log(`Resolving Fabric Loader ${options.fabricVersion}...`);
    const fabricProfile = await getFabricProfile(
      client,
      options.version,
      options.fabricVersion === "latest" ? undefined : options.fabricVersion,
    );

    fabricCp = await resolveFabricLibraries(
      client,
      fabricProfile.launcherMeta.libraries.common,
      options.librariesDir,
    );
    fabricCp.push(
      ...await resolveFabricLibraries(
        client,
        fabricProfile.launcherMeta.libraries.client,
        options.librariesDir,
      ),
    );
    // Server libs not needed for client

    mainClass = fabricProfile.launcherMeta.mainClass.client;

    // Fabric doesn't usually supply arguments in the profile JSON in the same way,
    // it expects the main class to handle it.
    // But we need to ensure the fabric-loader jar is in classpath, which is one of the libs.
  }

  // 5. Client Jar
  const clientJar = join(
    options.librariesDir,
    "com/mojang/minecraft",
    options.version,
    `minecraft-${options.version}-client.jar`,
  );
  await downloadFile(
    client,
    versionJson.downloads.client.url,
    clientJar,
    versionJson.downloads.client.sha1,
  );

  // 6. Build Classpath
  const classpath = [
    ...fabricCp,
    ...vanillaCp,
    clientJar, // Fabric puts itself first usually?
    // Actually fabric loader jar should be in fabricCp.
    // Minecraft client jar must be in classpath.
  ].join(":"); // Linux separator

  // 7. Construct Args
  // Resolve arguments
  const resolveArg = (arg: any): string[] => {
    if (typeof arg === "string") return [replaceVars(arg)];
    // Rule check for args
    // If rules present and fail, return []
    // For simplicity, launch args usually complex.

    // Simplified: just string args?
    // Modern MC (1.19+) uses complex argument objects.
    if (arg.value) {
      return Array.isArray(arg.value)
        ? arg.value.map(replaceVars)
        : [replaceVars(arg.value)];
    }
    return [];
  };

  const replaceVars = (str: string) => {
    return str
      .replace("${auth_player_name}", options.user?.username || "Steve")
      .replace("${version_name}", options.version)
      .replace("${game_directory}", options.gameDir)
      .replace("${assets_root}", options.assetsDir)
      .replace("${assets_index_name}", versionJson.assetIndex.id)
      .replace(
        "${auth_uuid}",
        options.user?.uuid || "00000000-0000-0000-0000-000000000000",
      )
      .replace("${auth_access_token}", options.user?.accessToken || "token")
      .replace("${user_type}", "mojang")
      .replace("${version_type}", "release")
      .replace("${natives_directory}", options.nativesDir)
      .replace("${launcher_name}", "crtb-launcher")
      .replace("${launcher_version}", "1.0");
  };

  const finalGameArgs: string[] = [];
  if (Array.isArray(gameArgs)) {
    gameArgs.forEach((arg) => finalGameArgs.push(...resolveArg(arg)));
  } else {
    // Legacy string?
  }

  const finalJvmArgs: string[] = [];
  if (Array.isArray(jvmArgs)) {
    jvmArgs.forEach((arg) => finalJvmArgs.push(...resolveArg(arg)));
  }

  // Default JVM args if missing (older versions)
  if (finalJvmArgs.length === 0) {
    finalJvmArgs.push(`-Djava.library.path=${options.nativesDir}`);
    finalJvmArgs.push("-cp", classpath);
  } else {
    // Add classpath to jvm args if not present (usually handled by ${classpath} var in arg?)
    // Modern JSON has "-cp ${classpath}" in jvm args.
    // We need to find and replace it.
    const cpIndex = finalJvmArgs.findIndex((a) => a.includes("${classpath}"));
    if (cpIndex !== -1) {
      finalJvmArgs[cpIndex] = finalJvmArgs[cpIndex].replace(
        "${classpath}",
        classpath,
      );
    } else {
      // Force it
      finalJvmArgs.push("-cp", classpath);
    }
  }

  console.log(`\nLaunching ${mainClass}...`);

  const cmd = new Deno.Command(options.javaPath, {
    args: [
      ...finalJvmArgs,
      mainClass,
      ...finalGameArgs,
    ],
    cwd: options.gameDir,
    stdout: "inherit",
    stderr: "inherit",
  });

  const process = cmd.spawn();
  await process.status;
}
