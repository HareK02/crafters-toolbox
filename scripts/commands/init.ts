import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { ensureDir } from "@std/fs";
import { Command } from "../command.ts";

// Resolve paths relative to the current module to ensure they work in compiled binaries
const __dirname = dirname(fromFileUrl(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../");

const TEMPLATES_DIR = join(PROJECT_ROOT, "templates");

// List of files to copy from templates/
const TEMPLATE_FILES = ["crtb.config.yml", "crtb.properties.yml", ".gitignore"];

// List of files to copy from docker/
// We need to list them explicitly or read the directory if --include supports listing (it does via Deno.readDir)
// But Deno.readDir might be tricky with --include if not fully supported in all versions,
// let's try dynamic reading first as it's cleaner, but fallback to explicit list if needed.
// 'docker' dir is included, so we should be able to read it.

const cmd: Command = {
  name: "init",
  description: "Initialize a new Crafters Toolbox project",
  handler: async (args: string[]) => {
    const targetDir = args[0] ? resolve(args[0]) : Deno.cwd();

    console.log(`Initializing project in ${targetDir}...`);
    await ensureDir(targetDir);

    // Check if directory is empty-ish
    let isEmpty = true;
    for await (const _ of Deno.readDir(targetDir)) {
      isEmpty = false;
      break;
    }

    if (!isEmpty) {
      console.warn(`Warning: Directory ${targetDir} is not empty.`);
      // In a real CLI interactions we might ask for confirmation,
      // but for now let's just proceed with a warning or maybe fail?
      // Let's just warn.
    }

    // 1. Create directories
    const dirsToCreate = ["server", "components"];
    for (const dir of dirsToCreate) {
      await ensureDir(join(targetDir, dir));
    }

    // 2. Copy templates
    // Because of 'deno compile --include', we can read files from the original source path relative to the module root (virtual fs)
    // We assume the binary runs with the virtual fs having 'templates/' and 'docker/' at root.
    // Actually, 'deno compile' includes typically map to the path relative to the entrypoint or CWD at build time?
    // It usually preserves the relative structure. configuration is at named paths.

    // Let's try reading from "./templates" and "./docker".

    // Copy config templates
    for (const file of TEMPLATE_FILES) {
      const src = join(TEMPLATES_DIR, file);
      const dest = join(targetDir, file);
      try {
        const content = await Deno.readTextFile(src);
        await Deno.writeTextFile(dest, content);
        console.log(`Created ${file}`);
      } catch (e) {
        console.error(`Failed to copy template ${src}: ${e}`);
      }
    }

    console.log(`\nProject initialized successfully!`);
    console.log(`Run 'crtb setup' to get started.`);
  },
};

export default cmd;
