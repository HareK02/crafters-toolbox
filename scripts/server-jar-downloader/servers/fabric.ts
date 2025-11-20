import {
  BuildSpecifier,
  DownloadResolution,
  HttpClient,
  ReleaseChannel,
} from "../types.ts";
import { fetchJson } from "../utils.ts";

const FABRIC_META_BASE = "https://meta.fabricmc.net";

interface FabricLoaderEntry {
  loader: { version: string; stable: boolean };
}

interface FabricInstallerEntry {
  version: string;
  stable: boolean;
}

interface FabricGameVersionEntry {
  version: string;
  stable: boolean;
}

export async function getLatestFabricMinecraftVersion(
  channel: ReleaseChannel,
  client: HttpClient,
): Promise<string> {
  const entries = await fetchJson<FabricGameVersionEntry[]>(
    client,
    `${FABRIC_META_BASE}/v2/versions/game`,
  );
  if (!entries.length) {
    throw new Error("Fabric Meta returned an empty game version list.");
  }
  const filtered = entries.filter((entry) =>
    channel === "beta" ? !entry.stable : entry.stable
  );
  const selection = (filtered.length ? filtered : entries).at(0);
  if (!selection) {
    throw new Error(
      "Unable to determine Fabric's latest supported game version.",
    );
  }
  return selection.version;
}

export async function resolveFabric(
  minecraftVersion: string,
  loaderSpecifier: BuildSpecifier,
  requestedInstaller: string | undefined,
  client: HttpClient,
): Promise<DownloadResolution> {
  const loaderEntries = await fetchJson<FabricLoaderEntry[]>(
    client,
    `${FABRIC_META_BASE}/v2/versions/loader/${minecraftVersion}`,
  );
  if (!loaderEntries.length) {
    throw new Error(
      `Fabric does not provide loader builds for Minecraft ${minecraftVersion}.`,
    );
  }

  const loaderEntry = selectFabricLoader(loaderEntries, loaderSpecifier);
  if (!loaderEntry) {
    if (loaderSpecifier.kind === "exact") {
      throw new Error(
        `Requested Fabric loader ${loaderSpecifier.value} was not found for ${minecraftVersion}.`,
      );
    }
    throw new Error("Fabric Meta did not report any loader versions.");
  }

  const installerVersion = await pickFabricInstaller(
    client,
    requestedInstaller,
  );
  const loaderVersion = loaderEntry.loader.version;
  const fileName =
    `fabric-server-mc.${minecraftVersion}-loader.${loaderVersion}-launcher.${installerVersion}.jar`;

  return {
    url:
      `${FABRIC_META_BASE}/v2/versions/loader/${minecraftVersion}/${loaderVersion}/${installerVersion}/server/jar`,
    fileName,
  };
}

function selectFabricLoader(
  entries: FabricLoaderEntry[],
  spec: BuildSpecifier,
): FabricLoaderEntry | undefined {
  if (spec.kind === "exact") {
    return entries.find((entry) => entry.loader.version === spec.value);
  }
  const filtered = entries.filter((entry) =>
    spec.channel === "beta" ? !entry.loader.stable : entry.loader.stable
  );
  return (filtered.length ? filtered : entries)[0];
}

export async function pickFabricInstaller(
  client: HttpClient,
  requestedInstaller?: string,
): Promise<string> {
  const installers = await fetchJson<FabricInstallerEntry[]>(
    client,
    `${FABRIC_META_BASE}/v2/versions/installer`,
  );
  if (!installers.length) {
    throw new Error("Fabric installer list is empty.");
  }

  if (requestedInstaller) {
    const match = installers.find(
      (entry) => entry.version === requestedInstaller,
    );
    if (!match) {
      throw new Error(
        `Installer version ${requestedInstaller} was not found on Fabric Meta.`,
      );
    }
    return match.version;
  }

  return (
    installers.find((entry) => entry.stable)?.version ?? installers[0].version
  );
}
