export type ServerFlavor = "vanilla" | "paper" | "fabric" | "neoforge";

export type ReleaseChannel = "stable" | "beta";

export type BuildSpecifier =
  | { kind: "latest"; channel: ReleaseChannel }
  | { kind: "exact"; value: string };

export type HttpClient = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface DownloadResolution {
  url: string;
  fileName: string;
  checksum?: { algorithm: "SHA-1" | "SHA-256"; value: string };
}

export interface DownloadServerJarOptions {
  flavor: ServerFlavor;
  version: string;
  build?: string;
  output: string;
  installer?: string;
  userAgent?: string;
  httpClient?: HttpClient;
}
