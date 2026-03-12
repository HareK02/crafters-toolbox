import { BuildSpecifier, DownloadResolution, HttpClient, ReleaseChannel } from "../types.ts";
import {
  getLatestPaperMCProjectVersion,
  resolvePaperMCProject,
} from "./paper.ts";

export async function getLatestFoliaVersion(
  channel: ReleaseChannel,
  client: HttpClient,
): Promise<string> {
  return await getLatestPaperMCProjectVersion("folia", channel, client);
}

export async function resolveFolia(
  version: string,
  buildSpec: BuildSpecifier,
  client: HttpClient,
): Promise<DownloadResolution> {
  return await resolvePaperMCProject("folia", version, buildSpec, client);
}
