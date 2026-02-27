/**
 * コンポーネントソースの解決とキャッシング
 */
import { copy } from "@std/fs";
import { basename, dirname, join } from "@std/path";
import { IComponent, SourceConfig } from "../component.ts";
import { getGitSubmoduleDefault, loadConfig } from "../config.ts";
import { info, warn } from "./status-manager.ts";

const CACHE_ROOT = "./.cache/components";

export const resolveSourceConfig = (
  component: IComponent,
): SourceConfig | undefined => {
  if (component.source) return component.source;
  return undefined;
};

const saveResponse = async (
  res: Response,
  contentDir: string,
  metaFile: string,
  url: string,
  fallbackName: string,
) => {
  try {
    for await (const entry of Deno.readDir(contentDir)) {
      await Deno.remove(join(contentDir, entry.name), { recursive: true });
    }
  } catch {
    // ignore
  }

  const fileName = basename(new URL(url).pathname) ||
    fallbackName.replace(/[/\\]/g, "");
  const dest = join(contentDir, fileName);
  await Deno.mkdir(contentDir, { recursive: true });

  const file = await Deno.open(dest, {
    create: true,
    write: true,
    truncate: true,
  });
  if (res.body) {
    await res.body.pipeTo(file.writable);
  } else {
    file.close();
  }

  const meta = {
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    filename: fileName,
    url,
  };
  await Deno.writeTextFile(metaFile, JSON.stringify(meta, null, 2));

  return contentDir;
};

export const downloadToCache = async (
  url: string,
  componentName: string,
  forcePull?: boolean,
): Promise<{ path: string; cached: boolean } | undefined> => {
  const baseCacheDir = join(CACHE_ROOT, "http", componentName);
  const contentDir = join(baseCacheDir, "content");
  const metaFile = join(baseCacheDir, "meta.json");

  await Deno.mkdir(baseCacheDir, { recursive: true });

  let meta:
    | { etag?: string; lastModified?: string; url?: string; filename: string }
    | undefined;
  try {
    const txt = await Deno.readTextFile(metaFile);
    meta = JSON.parse(txt);
  } catch {
    // ignore
  }

  if (meta && meta.url !== url) {
    meta = undefined;
  }

  const headers: Record<string, string> = {};
  if (meta?.etag) headers["If-None-Match"] = meta.etag;
  if (meta?.lastModified) headers["If-Modified-Since"] = meta.lastModified;

  if (!forcePull && meta) {
    const cachedFile = join(contentDir, meta.filename);
    const exists = await Deno.stat(cachedFile).then(() => true).catch(() =>
      false
    );
    if (exists) {
      return { path: contentDir, cached: true };
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);

    if (res.status === 304 && meta) {
      const cachedFile = join(contentDir, meta.filename);
      const exists = await Deno.stat(cachedFile)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        info(`Cache hit for ${componentName}`);
        return { path: contentDir, cached: true };
      }
      const retryRes = await fetch(url);
      if (!retryRes.ok) {
        warn(`Failed to download ${url} (status: ${retryRes.status})`);
        return undefined;
      }
      const path = await saveResponse(
        retryRes,
        contentDir,
        metaFile,
        url,
        componentName,
      );
      return { path, cached: false };
    }

    if (!res.ok) {
      warn(`Failed to download ${url} (status: ${res.status})`);
      return undefined;
    }

    const path = await saveResponse(
      res,
      contentDir,
      metaFile,
      url,
      componentName,
    );
    return { path, cached: false };
  } catch (error) {
    warn(`Unable to download ${url}: ${error}`);
    return undefined;
  }
};

export const copyToDir = async (
  srcPath: string,
  destDir: string,
  componentName?: string,
): Promise<string> => {
  const targetPath = join(destDir, componentName ?? basename(srcPath));
  const normalizedSrc = await Deno.realPath(srcPath).catch(() => srcPath);
  const normalizedDest = await Deno.realPath(targetPath).catch(
    () => targetPath,
  );
  if (normalizedSrc === normalizedDest) return normalizedDest;

  const stat = await Deno.stat(srcPath);
  await Deno.mkdir(destDir, { recursive: true });
  const targetName = stat.isDirectory
    ? (componentName ?? basename(srcPath))
    : basename(srcPath);
  const dest = join(destDir, targetName);
  try {
    await Deno.remove(dest, { recursive: true });
  } catch {
    // ignore if not exists
  }
  await copy(srcPath, dest, { overwrite: true });
  return dest;
};

export const componentBasePath = (component: IComponent): string => {
  if (component.path) return component.path;
  if (component.kind === "world") return "./server/world";
  return `./components/${component.name}`;
};

export const ensureLocalPresence = async (
  component: IComponent,
  options?: { pull?: boolean },
): Promise<{ path: string; cached: boolean } | undefined> => {
  if (component.kind === "world") return undefined;
  const dest = componentBasePath(component);

  const source = resolveSourceConfig(component);

  if (source) {
    if (source.type === "local") {
      if (!component.path && source.path) {
        warn(
          `Local source path for ${component.name} is ignored. Use component.path instead.`,
        );
      }
      try {
        const stat = await Deno.stat(dest);
        if (stat.isDirectory) {
          for await (const _entry of Deno.readDir(dest)) {
            return { path: dest, cached: false };
          }
        } else {
          return { path: dest, cached: false };
        }
      } catch {
        warn(`Local component ${component.name} not found at ${dest}`);
        return undefined;
      }
    }

    if (!options?.pull) {
      try {
        const stat = await Deno.stat(dest);
        if (stat.isDirectory) {
          for await (const _entry of Deno.readDir(dest)) {
            return { path: dest, cached: false };
          }
        } else {
          return { path: dest, cached: false };
        }
      } catch {
        // not exists, proceed to fetch
      }
    }

    if (source.type === "http") {
      const result = await downloadToCache(
        source.url,
        component.name,
        options?.pull,
      );
      if (!result) return undefined;
      const targetPath = component.path;
      if (options?.pull && targetPath) {
        const entries = [];
        for await (const entry of Deno.readDir(result.path)) {
          entries.push(entry);
        }
        const singleFile = entries.length === 1 && entries[0].isFile;
        const pathLooksLikeFile = basename(targetPath).includes(".");

        if (singleFile && pathLooksLikeFile) {
          const filePath = join(result.path, entries[0].name);
          try {
            await Deno.remove(targetPath, { recursive: true });
          } catch {
            // ignore if not exists
          }
          await Deno.mkdir(dirname(targetPath), { recursive: true });
          await copy(filePath, targetPath, { overwrite: true });
          return { path: targetPath, cached: result.cached };
        }

        try {
          await Deno.remove(targetPath, { recursive: true });
        } catch {
          // ignore if not exists
        }
        await Deno.mkdir(targetPath, { recursive: true });
        for (const entry of entries) {
          const from = join(result.path, entry.name);
          const to = join(targetPath, entry.name);
          await copy(from, to, { overwrite: true });
        }
        return { path: targetPath, cached: result.cached };
      }
      return result;
    }
    if (source.type === "git") {
      const config = loadConfig();
      const useSubmodule = source.submodule ?? getGitSubmoduleDefault(config);

      const exists = await Deno.stat(dest)
        .then(() => true)
        .catch(() => false);
      const isGit = await Deno.stat(join(dest, ".git"))
        .then(() => true)
        .catch(() => false);

      if (exists && !isGit) {
        if (options?.pull) {
          warn(
            `Path ${dest} exists and is not a git repository. Replacing with ${
              useSubmodule ? "submodule" : "clone"
            }.`,
          );
          try {
            await Deno.remove(dest, { recursive: true });
          } catch {
            // ignore if removal fails; clone will report error
          }
        } else {
          warn(`Path ${dest} exists and is not a git repository. Skipping.`);
          return undefined;
        }
      }

      if (useSubmodule) {
        if (!exists || (exists && !isGit && options?.pull)) {
          info(`Adding submodule for ${component.name}...`);
          await Deno.mkdir(dirname(dest), { recursive: true });
          const args = ["submodule", "add", "--force"];
          if (source.branch) args.push("-b", source.branch);
          args.push(source.url, dest);

          const cmd = new Deno.Command("git", {
            args,
            stdout: "inherit",
            stderr: "inherit",
          });
          const status = await cmd.spawn().status;
          if (!status.success) {
            warn(`Failed to add submodule ${component.name}`);
            return undefined;
          }
        } else if (options?.pull) {
          info(`Updating submodule for ${component.name}...`);
          const cmd = new Deno.Command("git", {
            args: [
              "submodule",
              "update",
              "--init",
              "--remote",
              "--recursive",
              dest,
            ],
            stdout: "inherit",
            stderr: "inherit",
          });
          const status = await cmd.spawn().status;
          if (!status.success) {
            warn(`Failed to update submodule ${component.name}`);
            return undefined;
          }
        }
      } else {
        if (!exists || (exists && !isGit && options?.pull)) {
          info(`Cloning ${component.name}...`);
          await Deno.mkdir(dirname(dest), { recursive: true });
          const args = ["clone"];
          if (source.branch) args.push("-b", source.branch);
          args.push(source.url, dest);
          const cmd = new Deno.Command("git", {
            args,
            stdout: "inherit",
            stderr: "inherit",
          });
          const status = await cmd.spawn().status;
          if (!status.success) {
            warn(`Failed to clone ${component.name}`);
            return undefined;
          }
          const subCmd = new Deno.Command("git", {
            args: ["-C", dest, "submodule", "update", "--init", "--recursive"],
            stdout: "inherit",
            stderr: "inherit",
          });
          await subCmd.spawn().status;
        } else if (options?.pull) {
          if (source.branch) {
            const checkoutCmd = new Deno.Command("git", {
              args: ["-C", dest, "checkout", source.branch],
              stdout: "inherit",
              stderr: "inherit",
            });
            await checkoutCmd.spawn().status;
          }
          info(`Pulling ${component.name}...`);
          const cmd = new Deno.Command("git", {
            args: ["-C", dest, "pull"],
            stdout: "inherit",
            stderr: "inherit",
          });
          const status = await cmd.spawn().status;
          if (!status.success) {
            warn(`Failed to pull ${component.name}`);
            return undefined;
          }
          const subCmd = new Deno.Command("git", {
            args: ["-C", dest, "submodule", "update", "--init", "--recursive"],
            stdout: "inherit",
            stderr: "inherit",
          });
          await subCmd.spawn().status;
        }
      }

      if (source.commit) {
        const cmd = new Deno.Command("git", {
          args: ["-C", dest, "checkout", source.commit],
          stdout: "inherit",
          stderr: "inherit",
        });
        await cmd.spawn().status;
        if (!useSubmodule) {
          const subCmd = new Deno.Command("git", {
            args: ["-C", dest, "submodule", "update", "--init", "--recursive"],
            stdout: "inherit",
            stderr: "inherit",
          });
          await subCmd.spawn().status;
        } else {
          const subCmd = new Deno.Command("git", {
            args: ["submodule", "update", "--init", "--recursive", dest],
            stdout: "inherit",
            stderr: "inherit",
          });
          await subCmd.spawn().status;
        }
      }

      return { path: dest, cached: false };
    }
  }

  try {
    const stat = await Deno.stat(dest);
    if (stat.isDirectory) {
      for await (const _entry of Deno.readDir(dest)) {
        return { path: dest, cached: false };
      }
    } else {
      return { path: dest, cached: false };
    }
  } catch {
    // not exists
  }

  if (!source) {
    warn(
      `Component ${component.name} has no source/reference; cannot fetch to ${dest}`,
    );
  }
  return undefined;
};

export const ensureWorldSource = async (
  component: IComponent,
  options?: { pull?: boolean },
): Promise<{ path: string; cached: boolean } | undefined> => {
  const source = resolveSourceConfig(component);
  if (!source) return undefined;
  if (source.type === "local") return { path: source.path, cached: false };

  if (source.type === "http") {
    return downloadToCache(
      source.url,
      component.name ?? "world",
      options?.pull,
    );
  }

  if (source.type === "git") {
    warn(`World ${component.name} uses git source; fetch not implemented yet.`);
  }
  return undefined;
};
