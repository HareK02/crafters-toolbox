import {
  BuildSpecifier,
  DownloadResolution,
  HttpClient,
  ReleaseChannel,
} from "../types.ts";
import { fetchText } from "../utils.ts";

const NEOFORGE_MAVEN_BASE =
  "https://maven.neoforged.net/releases/net/neoforged/neoforge";
const NEOFORGE_METADATA = `${NEOFORGE_MAVEN_BASE}/maven-metadata.xml`;

export async function resolveNeoForge(
  minecraftVersion: string,
  buildSpec: BuildSpecifier,
  client: HttpClient,
): Promise<DownloadResolution> {
  const versions = await fetchNeoForgeVersions(client);
  if (!versions.length) {
    throw new Error("NeoForge metadata is empty.");
  }

  const buildVersion = await pickNeoForgeBuild(
    versions,
    minecraftVersion,
    buildSpec,
  );
  const fileName = `neoforge-${buildVersion}-installer.jar`;

  return {
    url: `${NEOFORGE_MAVEN_BASE}/${buildVersion}/${fileName}`,
    fileName,
  };
}

export async function fetchNeoForgeVersions(
  client: HttpClient,
): Promise<string[]> {
  const xml = await fetchText(client, NEOFORGE_METADATA);
  const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(([
    ,
    version,
  ]) => version.trim()).filter(Boolean);
  return matches;
}

export async function pickNeoForgeBuild(
  versions: string[],
  minecraftVersion: string,
  spec: BuildSpecifier,
): Promise<string> {
  await Promise.resolve(); // Maintain async signature for caller compatibility
  if (spec.kind === "exact") {
    if (!versions.includes(spec.value)) {
      throw new Error(`NeoForge build ${spec.value} was not found.`);
    }
    return spec.value;
  }

  const prefix = deriveNeoForgePrefix(minecraftVersion);
  const subset = prefix
    ? versions.filter((version) => version.startsWith(prefix))
    : versions;
  const channelMatches = subset.filter((version) =>
    classifyNeoForgeChannel(version) === spec.channel
  );
  const selection = channelMatches.at(-1) ?? subset.at(-1) ?? versions.at(-1);
  if (!selection) {
    throw new Error("NeoForge build list is empty.");
  }
  return selection;
}

export function deriveNeoForgePrefix(
  minecraftVersion: string,
): string | undefined {
  const segments = minecraftVersion.split(".").filter((seg) => seg.length);
  if (!segments.length) return undefined;
  if (segments[0] === "1") segments.shift();
  if (!segments.length) return undefined;
  return segments.join(".");
}

function classifyNeoForgeChannel(version: string): ReleaseChannel {
  return /-(?:beta|alpha|rc)/i.test(version) ? "beta" : "stable";
}
