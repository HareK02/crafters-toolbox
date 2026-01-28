import { join } from "@std/path";
import { downloadFile, fetchJson, HttpClient } from "./utils.ts";
import { FabricLoaderVersion, Library } from "./types.ts";

const FABRIC_META_URL = "https://meta.fabricmc.net";

export async function getFabricProfile(
  client: HttpClient,
  minecraftVersion: string,
  loaderVersion?: string,
): Promise<FabricLoaderVersion> {
  // If loaderVersion not specified, get latest?
  let loadedLoaderVersion = loaderVersion;
  if (!loadedLoaderVersion) {
    const loaders = await fetchJson<{ version: string; stable: boolean }[]>(
      client,
      `${FABRIC_META_URL}/v2/versions/loader/${minecraftVersion}`,
    );
    const stable = loaders.find((l) => l.stable) || loaders[0];
    if (!stable) {
      throw new Error(`No fabric loader found for ${minecraftVersion}`);
    }
    loadedLoaderVersion = stable.version;
  }

  const url =
    `${FABRIC_META_URL}/v2/versions/loader/${minecraftVersion}/${loadedLoaderVersion}/profile/json`;
  return await fetchJson<FabricLoaderVersion>(client, url);
}

export async function resolveFabricLibraries(
  client: HttpClient,
  libraries: Library[],
  libsDir: string,
): Promise<string[]> {
  const cp: string[] = [];

  for (const lib of libraries) {
    // Fabric libraries usually don't have 'downloads.artifact'.
    // They follow maven layout.
    // name: "net.fabricmc:intermediary:1.21.1"
    // url: "https://maven.fabricmc.net/" (base url for download)

    const [group, artifact, version] = lib.name.split(":");
    const path = `${
      group.replace(/\./g, "/")
    }/${artifact}/${version}/${artifact}-${version}.jar`;

    // Library URL: use explicit url property or fall back to maven central
    const libraryUrl = lib.url || "https://repo1.maven.org/maven2/";
    const fullUrl = lib.downloads?.artifact?.url || `${libraryUrl}${path}`;

    const localPath = join(libsDir, path);

    await downloadFile(client, fullUrl, localPath); // Checksum? Fabric doesn't always provide in profile.
    cp.push(localPath);
  }
  return cp;
}
