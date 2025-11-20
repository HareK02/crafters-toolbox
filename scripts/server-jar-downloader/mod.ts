import {
  BuildSpecifier,
  DownloadResolution,
  DownloadServerJarOptions,
  HttpClient,
  ReleaseChannel,
  ServerFlavor,
} from "./types.ts";
export type { ServerFlavor } from "./types.ts";
import {
  createHttpClient,
  determineOutputPath,
  downloadBinary,
  verifyChecksum,
} from "./utils.ts";
import { getLatestVanillaVersion, resolveVanilla } from "./servers/vanilla.ts";
import { getLatestPaperVersion, resolvePaper } from "./servers/paper.ts";
import {
  getLatestFabricMinecraftVersion,
  pickFabricInstaller,
  resolveFabric,
} from "./servers/fabric.ts";
import {
  deriveNeoForgePrefix,
  fetchNeoForgeVersions,
  pickNeoForgeBuild,
  resolveNeoForge,
} from "./servers/neoforge.ts";

export async function downloadServerJar(
  options: DownloadServerJarOptions,
): Promise<string> {
  ensureOption(options.flavor, "flavor");
  ensureOption(options.version, "version");
  ensureOption(options.output, "output");

  const httpClient = createHttpClient(options);
  const version = await resolveVersion(
    options.flavor,
    options.version,
    httpClient,
  );
  const buildSpec = parseBuildSpecifier(options.build);
  const resolution = await resolveDownload(
    options.flavor,
    version,
    buildSpec,
    options.installer,
    httpClient,
  );
  const destination = await determineOutputPath(
    options.output,
    resolution.fileName,
  );

  await downloadBinary(httpClient, resolution.url, destination);
  if (resolution.checksum) {
    await verifyChecksum(
      destination,
      resolution.checksum.algorithm,
      resolution.checksum.value,
    );
  }

  return destination;
}

async function resolveDownload(
  flavor: ServerFlavor,
  resolvedVersion: string,
  build: BuildSpecifier,
  installer: string | undefined,
  client: HttpClient,
): Promise<DownloadResolution> {
  switch (flavor) {
    case "vanilla":
      return await resolveVanilla(resolvedVersion, client);
    case "paper":
      return await resolvePaper(resolvedVersion, build, client);
    case "fabric":
      return await resolveFabric(
        resolvedVersion,
        build,
        installer,
        client,
      );
    case "neoforge":
      return await resolveNeoForge(resolvedVersion, build, client);
    default:
      throw new Error(`Unsupported flavor: ${flavor}`);
  }
}

async function resolveVersion(
  flavor: ServerFlavor,
  versionInput: string,
  client: HttpClient,
): Promise<string> {
  const spec = parseVersionSpecifier(versionInput);
  if (spec.kind === "exact") return spec.value;

  switch (flavor) {
    case "vanilla":
      return await getLatestVanillaVersion(spec.channel, client);
    case "paper":
      return await getLatestPaperVersion(spec.channel, client);
    case "fabric":
      return await getLatestFabricMinecraftVersion(spec.channel, client);
    case "neoforge":
      // NeoForge tracks Minecraft versions, so follow Mojang's channel data.
      return await getLatestVanillaVersion(spec.channel, client);
    default:
      throw new Error(`Unsupported flavor: ${flavor}`);
  }
}

type VersionSpecifier =
  | { kind: "latest"; channel: ReleaseChannel }
  | { kind: "exact"; value: string };

function parseVersionSpecifier(input: string): VersionSpecifier {
  const normalized = input.trim().toLowerCase();
  if (normalized === "latest" || normalized === "latest-stable") {
    return { kind: "latest", channel: "stable" };
  }
  if (normalized === "latest-beta") {
    return { kind: "latest", channel: "beta" };
  }
  return { kind: "exact", value: input };
}

function parseBuildSpecifier(input?: string): BuildSpecifier {
  if (!input) {
    return { kind: "latest", channel: "stable" };
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "latest" || normalized === "latest-stable") {
    return { kind: "latest", channel: "stable" };
  }
  if (normalized === "latest-beta") {
    return { kind: "latest", channel: "beta" };
  }
  return { kind: "exact", value: input };
}

function ensureOption(value: string | undefined, label: string) {
  if (!value) throw new Error(`Missing required option: ${label}`);
}

export const __internals = {
  resolveDownload,
  resolveVersion,
  parseVersionSpecifier,
  parseBuildSpecifier,
  resolveVanilla,
  resolvePaper,
  resolveFabric,
  resolveNeoForge,
  pickFabricInstaller,
  fetchNeoForgeVersions,
  pickNeoForgeBuild,
  deriveNeoForgePrefix,
  determineOutputPath,
  verifyChecksum,
  createHttpClient,
};
