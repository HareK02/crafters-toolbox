import { dirname, isAbsolute, join, resolve as resolvePath } from "@std/path";
import { ensureDir } from "@std/fs";

export const DEFAULT_USER_AGENT =
  "Crafter's Toolbox Launcher (+https://github.com/crafters-toolbox)";

export type HttpClient = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createHttpClient(userAgent?: string): HttpClient {
  const ua = userAgent ?? DEFAULT_USER_AGENT;
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", ua);
    return fetch(input, { ...init, headers });
  };
}

export async function downloadFile(
  client: HttpClient,
  url: string,
  destination: string,
  sha1?: string,
): Promise<void> {
  // Check if file exists and matches sha1
  if (sha1) {
    try {
      await verifyChecksum(destination, "SHA-1", sha1);
      return; // Skip download
    } catch {
      // Mismatch or not found, proceed to download
    }
  }

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

  await ensureDir(dirname(destination));
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

  if (sha1) {
    await verifyChecksum(destination, "SHA-1", sha1);
  }
}

export async function verifyChecksum(
  path: string,
  algorithm: "SHA-1",
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

function bufferToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchJson<T>(
  client: HttpClient,
  url: string,
): Promise<T> {
  const res = await client(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Failed to fetch JSON from ${url}: ${res.status}`);
  }
  return await res.json() as T;
}

export async function extractZip(zipPath: string, destDir: string) {
  const cmd = new Deno.Command("unzip", {
    args: ["-o", zipPath, "-d", destDir],
    stdout: "null",
    stderr: "null",
  });
  const { success } = await cmd.output();
  if (!success) throw new Error(`Failed to unzip ${zipPath}`);
}
