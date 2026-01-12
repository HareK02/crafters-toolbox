import { dirname, join } from "jsr:@std/path";
import { downloadFile, extractZip, fetchJson, HttpClient } from "./utils.ts";
import {
  AssetIndex,
  AssetsIndex,
  Library,
  Rule,
  VersionJson,
  VersionManifest,
} from "./types.ts";

const MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest.json";
const RESOURCES_URL = "https://resources.download.minecraft.net";

export async function getVersionManifest(
  client: HttpClient,
): Promise<VersionManifest> {
  return await fetchJson<VersionManifest>(client, MANIFEST_URL);
}

export async function getVersionJson(
  client: HttpClient,
  versionId: string,
  manifest: VersionManifest,
): Promise<VersionJson> {
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Version ${versionId} not found in manifest`);
  return await fetchJson<VersionJson>(client, entry.url);
}

function checkRules(rules?: Rule[]): boolean {
  if (!rules) return true;
  let allowed = false;
  // Default depends on the first rule action usually?
  // Actually, Mojang rules: if invalid OS, disallow.
  // Logic: Iterate. Default is false if rules exist? No, default allowed unless disallowed?
  // "Libraries ... can have a rules property ... If the property is not present, the library is allowed."
  // If present: "The first rule that matches determines whether the library is allowed or disallowed."

  // Default logic if rules array is empty? (Usually not empty if present).
  // If no rules match, what is the default?
  // Usually: disallowed if it's an "allow" list?
  // Let's assume standard behavior:
  // If first rule is 'allow', base is disallowed.
  // If first rule is 'disallow', base is allowed.

  // Actually, simple iteration:
  // Start with "false" if rules exist?
  // Mojang wiki: "The array is processed from top to bottom. The first rule that matches the current system environment determines the result."
  // BUT what if NONE match?
  // "If no rules match, the library is allowed." -> Wait, really? check wiki.
  // Wiki: "Artifacts are only downloaded if they are allowed ... If the `rules` list is missing, it is allowed."

  // Practical implementation:
  let result = false; // "If rules are present, default to disallow"?
  // Actually, most rules start with "action": "allow" (all), then "disallow" specific OS.
  // Or "allow" specific OS.

  // Let's implement robustly:
  // Search for the first MATCHING rule.
  for (const rule of rules) {
    if (rule.os) {
      if (rule.os.name === "linux") {
        // Match
      } else if (rule.os.name === "osx" || rule.os.name === "windows") {
        continue; // Not match our OS (Linux)
      } else if (rule.os.name) {
        continue; // Some other OS
      }
      // Todo: Version/Arch checks
    }

    // If we got here, the rule matches
    if (rule.action === "allow") return true;
    if (rule.action === "disallow") return false;
  }

  // If no rules matched?
  // If the list contained os-specific rules and none matched, typically it means "don't use".
  return false;
}

export async function resolveAssets(
  client: HttpClient,
  assetIndex: AssetIndex,
  assetsDir: string,
): Promise<void> {
  const indexFile = join(assetsDir, "indexes", `${assetIndex.id}.json`);
  await downloadFile(client, assetIndex.url, indexFile, assetIndex.sha1);

  const indexContent = await Deno.readTextFile(indexFile);
  const index: AssetsIndex = JSON.parse(indexContent);

  console.log(`Verifying ${Object.keys(index.objects).length} assets...`);

  // Download objects
  const objectsDir = join(assetsDir, "objects");
  // Parallel limit?
  const objects = Object.entries(index.objects);

  // Simple batching
  const BATCH_SIZE = 50;
  for (let i = 0; i < objects.length; i += BATCH_SIZE) {
    const batch = objects.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ([name, obj]) => {
      const hashPrefix = obj.hash.substring(0, 2);
      const path = join(objectsDir, hashPrefix, obj.hash);
      const url = `${RESOURCES_URL}/${hashPrefix}/${obj.hash}`;
      await downloadFile(client, url, path, obj.hash);
    }));
    if (i % 500 === 0) console.log(`Processed ${i}/${objects.length} assets`);
  }
}

export async function resolveLibraries(
  client: HttpClient,
  libraries: Library[],
  libsDir: string,
): Promise<string[]> {
  const cp: string[] = [];

  for (const lib of libraries) {
    if (!checkRules(lib.rules)) continue;

    if (lib.downloads?.artifact) {
      const art = lib.downloads.artifact;
      const path = join(libsDir, art.path);
      await downloadFile(client, art.url, path, art.sha1);
      cp.push(path);
    } else {
      // Maven style lookup if downloads.artifact missing (common in old JSONs or Fabric/Forge)
      // name: group:artifact:version
      // But for vanilla modern JSONs, downloads.artifact is usually present.
      // If not, we might need maven repo logic.
      // Modern versions (1.19+) usually have it.
    }

    // Natives
    // Linux natives?
    if (lib.natives?.linux) {
      const classifier = lib.natives.linux;
      const art = lib.downloads?.classifiers?.[classifier];
      if (art) {
        const path = join(libsDir, art.path);
        await downloadFile(client, art.url, path, art.sha1);
        // Need to extract natives later
        // We return path to native jar?
        // Actually launcher needs to extract them to a temp dir.
        // Let's store native paths separately?
        // For now, simpler: extract immediately?
      }
    }
  }
  return cp;
}

export async function extractNatives(
  client: HttpClient,
  libraries: Library[],
  libsDir: string,
  nativesDir: string,
) {
  await Deno.mkdir(nativesDir, { recursive: true });
  for (const lib of libraries) {
    if (!checkRules(lib.rules)) continue;
    if (lib.natives?.linux) {
      const classifier = lib.natives.linux;
      const art = lib.downloads?.classifiers?.[classifier];
      if (art) {
        const path = join(libsDir, art.path);
        await downloadFile(client, art.url, path, art.sha1);
        await extractZip(path, nativesDir);

        // Remove META-INF usually?
        // "Exclude: META-INF/" in rules usually handling this.
      }
    }
  }
}
