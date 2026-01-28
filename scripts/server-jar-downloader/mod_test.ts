import { assertEquals } from "@std/assert";
import { __internals, downloadServerJar } from "./mod.ts";
import type { HttpClient } from "./types.ts";
import { join } from "@std/path";

const { resolveVanilla, resolvePaper, resolveFabric, resolveNeoForge } =
  __internals;

Deno.test("resolveVanilla picks the correct server download", async () => {
  const client = createStubClient({
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json":
      jsonResponse({
        latest: { release: "1.20.4", snapshot: "1.20.4" },
        versions: [
          {
            id: "1.20.4",
            type: "release",
            url: "https://example.com/vanilla-1.20.4.json",
            time: "",
            releaseTime: "",
          },
        ],
      }),
    "https://example.com/vanilla-1.20.4.json": jsonResponse({
      downloads: {
        server: {
          sha1: "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
          size: 5,
          url: "https://example.com/server.jar",
        },
      },
    }),
  });

  const resolution = await resolveVanilla("1.20.4", client);
  assertEquals(resolution.fileName, "vanilla-1.20.4.jar");
  assertEquals(resolution.url, "https://example.com/server.jar");
});

Deno.test(
  "resolvePaper selects the latest build when none provided",
  async () => {
    const client = createStubClient({
      "https://api.papermc.io/v2/projects/paper/versions/1.20.6": jsonResponse({
        project_id: "paper",
        version: "1.20.6",
        builds: [1, 2, 3],
      }),
      "https://api.papermc.io/v2/projects/paper/versions/1.20.6/builds/3":
        jsonResponse({
          channel: "default",
          downloads: {
            application: { name: "paper-1.20.6-3.jar", sha256: "deadbeef" },
          },
        }),
    });

    const resolution = await resolvePaper(
      "1.20.6",
      { kind: "latest", channel: "stable" },
      client,
    );
    assertEquals(resolution.fileName, "paper-1.20.6-3.jar");
    assertEquals(
      resolution.url,
      "https://api.papermc.io/v2/projects/paper/versions/1.20.6/builds/3/downloads/paper-1.20.6-3.jar",
    );
  },
);

Deno.test("resolvePaper honors latest-beta channel requests", async () => {
  const client = createStubClient({
    "https://api.papermc.io/v2/projects/paper/versions/1.21.1": jsonResponse({
      project_id: "paper",
      version: "1.21.1",
      builds: [10, 11],
    }),
    "https://api.papermc.io/v2/projects/paper/versions/1.21.1/builds/11":
      jsonResponse({
        channel: "experimental",
        downloads: {
          application: { name: "paper-1.21.1-11.jar", sha256: "bead" },
        },
      }),
    "https://api.papermc.io/v2/projects/paper/versions/1.21.1/builds/10":
      jsonResponse({
        channel: "default",
        downloads: {
          application: { name: "paper-1.21.1-10.jar", sha256: "feed" },
        },
      }),
  });

  const resolution = await resolvePaper(
    "1.21.1",
    { kind: "latest", channel: "beta" },
    client,
  );
  assertEquals(resolution.fileName, "paper-1.21.1-11.jar");
});

Deno.test(
  "resolveFabric chooses stable loader and installer by default",
  async () => {
    const client = createStubClient({
      "https://meta.fabricmc.net/v2/versions/loader/1.21.1": jsonResponse([
        { loader: { version: "0.18.0", stable: false } },
        { loader: { version: "0.17.0", stable: true } },
      ]),
      "https://meta.fabricmc.net/v2/versions/installer": jsonResponse([
        { version: "1.0.0", stable: false },
        { version: "1.0.1", stable: true },
      ]),
    });

    const resolution = await resolveFabric(
      "1.21.1",
      { kind: "latest", channel: "stable" },
      undefined,
      client,
    );
    assertEquals(
      resolution.fileName,
      "fabric-server-mc.1.21.1-loader.0.17.0-launcher.1.0.1.jar",
    );
    assertEquals(
      resolution.url,
      "https://meta.fabricmc.net/v2/versions/loader/1.21.1/0.17.0/1.0.1/server/jar",
    );
  },
);

Deno.test("resolveFabric supports latest-beta loader selection", async () => {
  const client = createStubClient({
    "https://meta.fabricmc.net/v2/versions/loader/1.20.1": jsonResponse([
      { loader: { version: "0.19.0", stable: false } },
      { loader: { version: "0.18.5", stable: true } },
    ]),
    "https://meta.fabricmc.net/v2/versions/installer": jsonResponse([
      { version: "1.0.1", stable: true },
    ]),
  });

  const resolution = await resolveFabric(
    "1.20.1",
    { kind: "latest", channel: "beta" },
    undefined,
    client,
  );
  assertEquals(
    resolution.fileName,
    "fabric-server-mc.1.20.1-loader.0.19.0-launcher.1.0.1.jar",
  );
});

Deno.test(
  "resolveNeoForge filters builds by Minecraft version prefix",
  async () => {
    const client = createStubClient({
      "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml":
        textResponse(`<?xml version="1.0"?>
      <metadata>
        <versioning>
          <versions>
            <version>20.4.100</version>
            <version>20.4.101</version>
            <version>21.1.10</version>
          </versions>
        </versioning>
      </metadata>`),
    });

    const resolution = await resolveNeoForge(
      "1.20.4",
      { kind: "latest", channel: "stable" },
      client,
    );
    assertEquals(resolution.fileName, "neoforge-20.4.101-installer.jar");
    assertEquals(
      resolution.url,
      "https://maven.neoforged.net/releases/net/neoforged/neoforge/20.4.101/neoforge-20.4.101-installer.jar",
    );
  },
);

Deno.test(
  "resolveNeoForge supports latest-beta build selection",
  async () => {
    const client = createStubClient({
      "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml":
        textResponse(`<?xml version="1.0"?>
      <metadata>
        <versioning>
          <versions>
            <version>20.4.100</version>
            <version>20.4.101-beta</version>
            <version>20.4.102-beta</version>
          </versions>
        </versioning>
      </metadata>`),
    });

    const resolution = await resolveNeoForge(
      "1.20.4",
      { kind: "latest", channel: "beta" },
      client,
    );
    assertEquals(
      resolution.fileName,
      "neoforge-20.4.102-beta-installer.jar",
    );
  },
);

Deno.test(
  "downloadServerJar writes the jar and validates checksum",
  async () => {
    const manifestUrl =
      "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    const detailUrl = "https://example.com/vanilla-1.20.4.json";
    const jarUrl = "https://example.com/server.jar";
    const data = new TextEncoder().encode("hello");
    const client = createStubClient({
      [manifestUrl]: jsonResponse({
        latest: { release: "1.20.4", snapshot: "1.20.4" },
        versions: [
          {
            id: "1.20.4",
            type: "release",
            url: detailUrl,
            time: "",
            releaseTime: "",
          },
        ],
      }),
      [detailUrl]: jsonResponse({
        downloads: {
          server: {
            sha1: "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
            size: data.length,
            url: jarUrl,
          },
        },
      }),
      [jarUrl]: () => new Response(data, { status: 200 }),
    });

    const tmp = await Deno.makeTempDir();
    const destination = join(tmp, "server.jar");
    const result = await downloadServerJar({
      flavor: "vanilla",
      version: "latest",
      output: destination,
      httpClient: client,
    });

    assertEquals(result, destination);
    const saved = await Deno.readTextFile(destination);
    assertEquals(saved, "hello");
  },
);

type StubMap = Record<string, Response | (() => Response | Promise<Response>)>;

function createStubClient(responses: StubMap): HttpClient {
  return async (input: RequestInfo | URL) => {
    const url = normalizeRequestUrl(input);
    const entry = responses[url];
    if (!entry) {
      throw new Error(`Unexpected request: ${url}`);
    }
    const response = typeof entry === "function" ? await entry() : entry;
    return response.clone();
  };
}

function normalizeRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
}
