import {
  BuildSpecifier,
  DownloadResolution,
  HttpClient,
  ReleaseChannel,
} from "../types.ts";
import { fetchJson } from "../utils.ts";

const PAPER_API_BASE = "https://api.papermc.io/v2/projects/paper";
const PAPER_PROJECT_ENDPOINT = PAPER_API_BASE;
const PRE_RELEASE_PATTERN = /-(?:pre|rc|beta|alpha)/i;

interface PaperProjectMeta {
  versions: string[];
}

interface PaperVersionMeta {
  project_id: string;
  version: string;
  builds: number[];
}

interface PaperBuildMeta {
  channel?: string;
  downloads: {
    application?: { name: string; sha256: string };
  };
}

export async function getLatestPaperVersion(
  channel: ReleaseChannel,
  client: HttpClient,
): Promise<string> {
  const project = await fetchJson<PaperProjectMeta>(
    client,
    PAPER_PROJECT_ENDPOINT,
  );
  if (!project.versions.length) {
    throw new Error("Paper API did not return any versions.");
  }

  const filtered = project.versions.filter((version) => {
    const isPreRelease = PRE_RELEASE_PATTERN.test(version);
    return channel === "beta" ? isPreRelease : !isPreRelease;
  });
  const result = (filtered.length ? filtered : project.versions).at(-1);
  if (!result) {
    throw new Error("Unable to determine the latest Paper version.");
  }
  return result;
}

export async function resolvePaper(
  version: string,
  buildSpec: BuildSpecifier,
  client: HttpClient,
): Promise<DownloadResolution> {
  const versionMeta = await fetchJson<PaperVersionMeta>(
    client,
    `${PAPER_API_BASE}/versions/${version}`,
  );
  const builds = versionMeta.builds;
  if (!builds.length) {
    throw new Error(`Paper ${version} does not have any builds yet.`);
  }

  const { buildNumber, buildMeta } = await selectPaperBuild(
    version,
    builds,
    buildSpec,
    client,
  );
  const artifact = buildMeta.downloads.application;
  if (!artifact) {
    throw new Error(
      `Paper build ${version}#${buildNumber} is missing the application jar entry.`,
    );
  }

  return {
    url:
      `${PAPER_API_BASE}/versions/${version}/builds/${buildNumber}/downloads/${artifact.name}`,
    fileName: artifact.name,
    checksum: { algorithm: "SHA-256", value: artifact.sha256 },
  };
}

async function selectPaperBuild(
  version: string,
  builds: number[],
  spec: BuildSpecifier,
  client: HttpClient,
): Promise<{ buildNumber: number; buildMeta: PaperBuildMeta }> {
  if (spec.kind === "exact") {
    const buildNumber = Number(spec.value);
    if (!Number.isInteger(buildNumber)) {
      throw new Error(`Paper build must be a number: received ${spec.value}`);
    }
    if (!builds.includes(buildNumber)) {
      throw new Error(`Paper ${version} does not have build ${spec.value}.`);
    }
    const buildMeta = await fetchBuildMeta(version, buildNumber, client);
    return { buildNumber, buildMeta };
  }

  const ordered = [...builds].sort((a, b) => a - b).reverse();
  let fallback: { buildNumber: number; buildMeta: PaperBuildMeta } | undefined;
  for (const buildNumber of ordered) {
    const buildMeta = await fetchBuildMeta(version, buildNumber, client);
    const channel = classifyPaperChannel(buildMeta.channel);
    if (channel === spec.channel) {
      return { buildNumber, buildMeta };
    }
    if (!fallback) fallback = { buildNumber, buildMeta };
  }
  if (!fallback) {
    throw new Error(`Paper ${version} does not have any builds to download.`);
  }
  return fallback;
}

async function fetchBuildMeta(
  version: string,
  buildNumber: number,
  client: HttpClient,
): Promise<PaperBuildMeta> {
  return await fetchJson<PaperBuildMeta>(
    client,
    `${PAPER_API_BASE}/versions/${version}/builds/${buildNumber}`,
  );
}

function classifyPaperChannel(channel: string | undefined): ReleaseChannel {
  const normalized = (channel ?? "default").toLowerCase();
  return normalized === "default" || normalized === "stable" ||
      normalized === "recommended"
    ? "stable"
    : "beta";
}
