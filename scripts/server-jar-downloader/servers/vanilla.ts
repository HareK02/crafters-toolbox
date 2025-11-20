import { DownloadResolution, HttpClient, ReleaseChannel } from "../types.ts";
import { fetchJson } from "../utils.ts";

const PISTON_MANIFEST =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

interface VanillaManifest {
  latest: { release: string; snapshot: string };
  versions: {
    id: string;
    type: string;
    url: string;
    time: string;
    releaseTime: string;
  }[];
}

interface VanillaVersionDetail {
  downloads: {
    server?: { sha1: string; size: number; url: string };
  };
}

export async function getLatestVanillaVersion(
  channel: ReleaseChannel,
  client: HttpClient,
): Promise<string> {
  const manifest = await fetchManifest(client);
  if (channel === "beta") {
    return manifest.latest.snapshot || findLatestByType(manifest, "snapshot") ||
      manifest.latest.release;
  }
  return manifest.latest.release || findLatestByType(manifest, "release") ||
    manifest.latest.snapshot;
}

export async function resolveVanilla(
  version: string,
  client: HttpClient,
): Promise<DownloadResolution> {
  const manifest = await fetchManifest(client);
  const entry = manifest.versions.find((candidate) => candidate.id === version);
  if (!entry) {
    throw new Error(
      `Version ${version} was not found in Mojang's version manifest.`,
    );
  }

  const detail = await fetchJson<VanillaVersionDetail>(client, entry.url);
  const serverInfo = detail.downloads.server;
  if (!serverInfo) {
    throw new Error(
      `Version ${version} does not expose a dedicated server download.`,
    );
  }

  return {
    url: serverInfo.url,
    fileName: `vanilla-${version}.jar`,
    checksum: { algorithm: "SHA-1", value: serverInfo.sha1 },
  };
}

async function fetchManifest(client: HttpClient): Promise<VanillaManifest> {
  return await fetchJson<VanillaManifest>(client, PISTON_MANIFEST);
}

function findLatestByType(
  manifest: VanillaManifest,
  type: "release" | "snapshot",
): string {
  const entry = manifest.versions.find((candidate) => candidate.type === type);
  if (!entry) {
    throw new Error(`Unable to locate a ${type} entry in Mojang's manifest.`);
  }
  return entry.id;
}
