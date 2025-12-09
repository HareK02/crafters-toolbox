#!/usr/bin/env -S deno run -A
/**
 * Cross-platform installer for crafters-toolbox
 * Handles compilation, Docker image building, and binary installation
 */

const REPO_URL = "https://github.com/HareK02/crafters-toolbox.git";
const BINARY_NAME = "crtb";
const DEFAULT_INSTALL_DIR = Deno.build.os === "windows"
    ? `${Deno.env.get("USERPROFILE")}\\AppData\\Local\\Programs\\crtb`
    : `${Deno.env.get("HOME")}/.local/bin`;

// Colors for terminal output
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    blue: "\x1b[34m",
    yellow: "\x1b[33m",
};

function logInfo(msg: string) {
    console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`);
}

function logSuccess(msg: string) {
    console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`);
}

function logError(msg: string) {
    console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`);
}

function logWarn(msg: string) {
    console.warn(`${colors.yellow}[WARN]${colors.reset} ${msg}`);
}

async function checkCommand(cmd: string): Promise<boolean> {
    try {
        const command = new Deno.Command(cmd, {
            args: ["--version"],
            stdout: "null",
            stderr: "null",
        });
        const { success } = await command.output();
        return success;
    } catch {
        return false;
    }
}

async function isLocalProject(): Promise<boolean> {
    try {
        const [denoJson, mainTs] = await Promise.all([
            Deno.stat("deno.json"),
            Deno.stat("main.ts"),
        ]);
        return denoJson.isFile && mainTs.isFile;
    } catch {
        return false;
    }
}

async function cloneRepository(tempDir: string): Promise<void> {
    logInfo(`Cloning repository into ${tempDir}...`);

    const command = new Deno.Command("git", {
        args: ["clone", "--depth", "1", REPO_URL, tempDir],
        stdout: "inherit",
        stderr: "inherit",
    });

    const { success } = await command.output();
    if (!success) {
        throw new Error("Failed to clone repository");
    }
}

async function compileBinary(): Promise<void> {
    logInfo("Compiling crtb binary...");

    const command = new Deno.Command("deno", {
        args: ["task", "compile"],
        stdout: "inherit",
        stderr: "inherit",
    });

    const { success } = await command.output();
    if (!success) {
        throw new Error("Compilation failed");
    }
}

async function buildDockerImage(skipBuild = false): Promise<void> {
    if (skipBuild) {
        logInfo("Skipping Docker image build (--skip-build-image flag)");
        return;
    }

    logInfo("Checking for Docker...");


    const hasDocker = await checkCommand("docker");
    if (!hasDocker) {
        logWarn("Docker not found. Skipping Docker image build.");
        logWarn("You can build the image later by running: nix build ./docker#dockerImage && docker load < result");
        return;
    }

    logInfo("Building Docker image (this may take a few minutes)...");

    // Check if we should use Nix-based build
    const hasNix = await checkCommand("nix");

    if (hasNix) {
        logInfo("Using Nix flake to build Docker image...");
        const command = new Deno.Command("nix", {
            args: ["build", "./docker#dockerImage", "--out-link", "docker-image-result"],
            stdout: "inherit",
            stderr: "inherit",
        });

        const { success } = await command.output();
        if (success) {
            logInfo("Loading Docker image from Nix build...");
            const loadCommand = new Deno.Command("docker", {
                args: ["load", "-i", "docker-image-result"],
                stdout: "inherit",
                stderr: "inherit",
            });
            const loadResult = await loadCommand.output();

            // Clean up result symlink
            try {
                await Deno.remove("docker-image-result");
            } catch {
                // Ignore cleanup errors
            }

            if (loadResult.success) {
                logSuccess("Docker image built and loaded successfully via Nix");
                return;
            }
        }
        logWarn("Nix build failed. You can build it later manually with: nix build ./docker#dockerImage && docker load < result");
    } else {
        logWarn("Nix not found. Docker image build requires Nix.");
        logWarn("Install Nix from https://nixos.org/download.html or build manually later.");
    }
}

async function installBinary(installDir: string): Promise<void> {
    logInfo(`Installing to ${installDir}...`);

    // Create install directory if it doesn't exist
    await Deno.mkdir(installDir, { recursive: true });

    const binaryExt = Deno.build.os === "windows" ? ".exe" : "";
    const sourcePath = `${BINARY_NAME}${binaryExt}`;
    const targetPath = `${installDir}/${BINARY_NAME}${binaryExt}`;

    // Copy binary to install directory
    await Deno.copyFile(sourcePath, targetPath);

    // Make executable on Unix-like systems
    if (Deno.build.os !== "windows") {
        await Deno.chmod(targetPath, 0o755);
    }

    logSuccess(`${BINARY_NAME} installed successfully at ${targetPath}`);
}

function checkPathIncludes(dir: string): boolean {
    const path = Deno.env.get("PATH") || "";
    const pathSep = Deno.build.os === "windows" ? ";" : ":";
    return path.split(pathSep).includes(dir);
}

function displayPathInstructions(installDir: string): void {
    if (checkPathIncludes(installDir)) {
        return;
    }

    console.log();
    console.log(`${colors.blue}Note:${colors.reset} ${installDir} is not in your PATH.`);
    console.log("Add the following line to your shell configuration file:");
    console.log();

    if (Deno.build.os === "windows") {
        console.log(`  setx PATH "%PATH%;${installDir}"`);
    } else {
        console.log(`  export PATH="${installDir}:$PATH"  # bash/zsh (.bashrc, .zshrc)`);
        console.log(`  set -Ux fish_user_paths ${installDir} $fish_user_paths  # fish (config.fish)`);
    }
    console.log();
}

async function main() {
    let workDir = Deno.cwd();
    let tempDir: string | null = null;

    // Parse command line arguments
    const args = Deno.args;
    const skipBuildImage = args.includes("--skip-build-image");

    try {
        // Check if we're in a local project
        const isLocal = await isLocalProject();

        if (!isLocal) {
            logInfo("Project not found in current directory. Cloning repository...");

            // Check for git
            const hasGit = await checkCommand("git");
            if (!hasGit) {
                logError("Git is required to install from remote. Please install git.");
                Deno.exit(1);
            }

            // Create temp directory and clone
            tempDir = await Deno.makeTempDir();
            await cloneRepository(tempDir);
            workDir = tempDir;
            Deno.chdir(workDir);
        } else {
            logInfo("Detected local project root.");
        }

        // Compile binary
        await compileBinary();

        // Build Docker image (unless skipped)
        await buildDockerImage(skipBuildImage);

        // Determine install directory
        const installDir = Deno.env.get("INSTALL_DIR_OVERRIDE") || DEFAULT_INSTALL_DIR;

        // Install binary
        await installBinary(installDir);

        // Display PATH instructions if needed
        displayPathInstructions(installDir);

        logSuccess("Installation complete!");

    } catch (error) {
        logError(`Installation failed: ${error.message}`);
        Deno.exit(1);
    } finally {
        // Cleanup temp directory
        if (tempDir) {
            try {
                await Deno.remove(tempDir, { recursive: true });
            } catch {
                // Ignore cleanup errors
            }
        }
    }
}

if (import.meta.main) {
    await main();
}
