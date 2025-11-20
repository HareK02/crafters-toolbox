const componentsDir = Deno.env.get("COMPONENTS_DIR") ??
  "/home/container/components";
const summaryInterval = Number(
  Deno.env.get("MONITOR_SUMMARY_INTERVAL") ?? "300",
);

const log = (message: string) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
};

const joinPath = (...segments: string[]) => {
  return segments
    .filter((segment, index) => !(index !== 0 && segment === ""))
    .map((segment, index) =>
      index === 0 ? segment.replace(/\/+$/g, "") : segment.replace(/^\/+/, "")
    )
    .filter((segment) => segment.length > 0)
    .join("/") || "/";
};

async function ensureDirectory(path: string) {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) return;
    throw error;
  }
}

async function collectStats(root: string) {
  const stack = [root];
  let files = 0;
  let directories = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    for await (const entry of Deno.readDir(current)) {
      if (entry.isSymlink) continue;
      const fullPath = joinPath(current, entry.name);
      if (entry.isDirectory) {
        directories += 1;
        stack.push(fullPath);
      } else {
        files += 1;
      }
    }
  }
  return { files, directories };
}

async function emitSummaries(root: string) {
  if (summaryInterval <= 0) return;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, summaryInterval * 1000));
    const { files, directories } = await collectStats(root);
    log(
      `[summary] ${directories} directories / ${files} files tracked within ${root}`,
    );
  }
}

function relativePaths(paths: string[], root: string) {
  const normalized = root.endsWith("/") ? root : `${root}/`;
  return paths.map((path) => {
    if (path === root) return ".";
    return path.startsWith(normalized) ? path.slice(normalized.length) : path;
  });
}

async function watchComponents(root: string) {
  for await (const event of Deno.watchFs(root, { recursive: true })) {
    const relPaths = relativePaths(event.paths, root);
    log(`[watch] ${event.kind} -> ${relPaths.join(", ")}`);
  }
}

async function main() {
  await ensureDirectory(componentsDir);
  log(`Monitoring ${componentsDir}`);

  emitSummaries(componentsDir);
  await watchComponents(componentsDir);
}

main().catch((error) => {
  console.error("Monitor crashed", error);
  Deno.exit(1);
});
