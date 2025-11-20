import {
  dirname,
  isAbsolute,
  join,
  resolve as resolvePath,
} from "https://deno.land/std@0.224.0/path/mod.ts";
import {
  DownloadResolution,
  DownloadServerJarOptions,
  HttpClient,
} from "./types.ts";

export const DEFAULT_USER_AGENT =
  "Crafter's Toolbox ServerJarDownloader (+https://github.com/crafters-toolbox)";

export function createHttpClient(
  options: Pick<DownloadServerJarOptions, "httpClient" | "userAgent">,
): HttpClient {
  if (options.httpClient) return options.httpClient;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", userAgent);
    if (!headers.has("Accept")) headers.set("Accept", "*/*");
    return fetch(input, { ...init, headers });
  };
}

export async function downloadBinary(
  client: HttpClient,
  url: string,
  destination: string,
): Promise<void> {
  const response = await client(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url} (${response.status} ${response.statusText}).`,
    );
  }

  const body = response.body;
  if (!body) {
    throw new Error(`Download response from ${url} did not include a body.`);
  }

  await ensureParentDirectory(destination);
  const file = await Deno.open(destination, {
    create: true,
    write: true,
    truncate: true,
  });
  try {
    const reader = body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) await file.write(value);
    }
  } finally {
    file.close();
  }
}

export async function determineOutputPath(
  userOutput: string,
  fallbackFileName: string,
): Promise<string> {
  const absolute = isAbsolute(userOutput)
    ? userOutput
    : resolvePath(Deno.cwd(), userOutput);
  try {
    const stat = await Deno.stat(absolute);
    if (stat.isDirectory) {
      return join(absolute, fallbackFileName);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return absolute;
}

export async function verifyChecksum(
  path: string,
  algorithm: "SHA-1" | "SHA-256",
  expectedHex: string,
) {
  const file = await Deno.readFile(path);
  const digest = await crypto.subtle.digest(algorithm, file);
  const actual = bufferToHex(new Uint8Array(digest));
  if (actual.toLowerCase() !== expectedHex.toLowerCase()) {
    throw new Error(
      `Checksum mismatch for ${path}: expected ${expectedHex}, got ${actual}`,
    );
  }
}

export async function fetchJson<T>(
  client: HttpClient,
  url: string,
): Promise<T> {
  const response = await client(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Request failed for ${url} (${response.status} ${response.statusText}).`,
    );
  }
  return await response.json() as T;
}

export async function fetchText(
  client: HttpClient,
  url: string,
): Promise<string> {
  const response = await client(url, {
    headers: { Accept: "application/xml,text/plain" },
  });
  if (!response.ok) {
    throw new Error(
      `Request failed for ${url} (${response.status} ${response.statusText}).`,
    );
  }
  return await response.text();
}

function bufferToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureParentDirectory(path: string) {
  const directory = dirname(path);
  await Deno.mkdir(directory, { recursive: true });
}
