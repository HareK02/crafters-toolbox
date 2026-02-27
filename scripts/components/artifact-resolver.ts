/**
 * コンポーネントアーティファクト解決
 */
import { join } from "@std/path";
import { ArtifactConfig, ComponentIDType, IComponent } from "../component.ts";
import { warn } from "./status-manager.ts";

const resolveOutputPath = (base: string, output?: string) => {
  if (!output) return base;
  if (output.startsWith("/")) return output;
  return join(base, output);
};

export const resolveArtifactBase = (
  component: IComponent,
  buildOutputPath: string,
): { path: string; config: ArtifactConfig } => {
  const artifact: ArtifactConfig = component.artifact ?? {};
  const basePath = resolveOutputPath(buildOutputPath, artifact.path);
  if (!artifact.type) {
    switch (component.kind) {
      case ComponentIDType.PLUGINS:
      case ComponentIDType.MODS:
        artifact.type = "jar";
        break;
      case ComponentIDType.DATAPACKS:
      case ComponentIDType.RESOURCEPACKS:
      case ComponentIDType.WORLD:
        artifact.type = "dir";
        break;
      default:
        artifact.type = "raw";
    }
  }
  return { path: basePath, config: artifact };
};

export const pickArtifactFile = async (
  basePath: string,
  preferredExts: string[],
  pattern?: string,
): Promise<string | undefined> => {
  let regex: RegExp | undefined;
  if (pattern) {
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      warn(`Invalid artifact.pattern /${pattern}/: ${error}`);
    }
  }

  const candidates: { name: string; mtimeMs: number }[] = [];
  for await (const entry of Deno.readDir(basePath)) {
    if (!entry.isFile) continue;
    if (regex && !regex.test(entry.name)) continue;
    if (preferredExts.length) {
      const lower = entry.name.toLowerCase();
      const matchesExt = preferredExts.some((ext) => lower.endsWith(ext));
      if (!matchesExt) continue;
    }
    const fullPath = join(basePath, entry.name);
    const stat = await Deno.stat(fullPath).catch(() => undefined);
    if (!stat) continue;
    const mtimeMs = stat.mtime?.getTime() ?? 0;
    candidates.push({ name: entry.name, mtimeMs });
  }

  if (candidates.length === 0) return undefined;
  candidates.sort(
    (a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name),
  );
  return join(basePath, candidates[0].name);
};
