import { join } from "jsr:@std/path";
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

    // Base URL: lib.url or maven central or fabric maven
    const baseUrl = lib.downloads?.artifact?.url
      ? ""
      : (lib.name.includes("fabric")
        ? FABRIC_META_URL
        : "https://repo1.maven.org/maven2/");
    // Wait, Fabric JSON usually provides 'url' property in the library object if it's external?
    // Let's check type definition. Common library format:
    // { name, url (optional, base maven repo) }

    // We need to support the 'url' property on Library type (I missed adding it to type definition?)
    // Let's assume standard Maven resolution if no explicit artifact.

    const libraryUrl = (lib as any).url || "https://repo1.maven.org/maven2/"; // Fallback to central
    const fullUrl = lib.downloads?.artifact?.url || `${libraryUrl}${path}`;

    const localPath = join(libsDir, path);

    await downloadFile(client, fullUrl, localPath); // Checksum? Fabric doesn't always provide in profile.
    cp.push(localPath);
  }
  return cp;
}
