import { Command } from "../command.ts";
import { dockerTest } from "../docker-test.ts";
import { getComposeEnv } from "../docker-env.ts";
import { getComposeServiceStatus } from "../docker-compose-status.ts";
import { attachContainerConsole } from "../terminal/docker.ts";

const GAME_SERVICE = "game-server";

async function runCompose(args: string[]) {
  const composeArgs = ["compose", ...args];
  const command = new Deno.Command("docker", {
    args: composeArgs,
    env: getComposeEnv(),
  });
  const process = command.spawn({ stdout: "inherit", stderr: "inherit" });
  const status = await process.status;
  if (!status.success) {
    console.error("docker compose command failed");
  }
  return status.success;
}

function parseBuildFlag(args: string[]) {
  const build = args.includes("--build");
  const unknown = args.filter((arg) => arg !== "--build");
  return { build, unknown };
}

async function showStatusMessage() {
  const status = await getComposeServiceStatus(GAME_SERVICE);
  if (!status) {
    console.log(
      "game-server is not running. Use `crtb server start` to launch it.",
    );
    return;
  }
  console.log(
    `game-server: ${status.State ?? "unknown"} (${status.Status ?? "n/a"})`,
  );
  if (status.Ports) console.log(`Ports: ${status.Ports}`);
}

const serverCommand: Command = {
  name: "server",
  description: "Manage the primary game server container",
  subcommands: [
    {
      name: "start",
      description:
        "Start the game server container in detached mode, then attach its console (use --build to rebuild)",
      handler: async (args: string[]) => {
        if (!(await dockerTest())) return;
        const { build, unknown } = parseBuildFlag(args);
        if (unknown.length) {
          console.error(
            `Unknown option(s): ${
              unknown.join(", ")
            }. Only --build is supported.`,
          );
          return;
        }
        const composeArgs = ["up"];
        if (build) composeArgs.push("--build");
        composeArgs.push("-d", GAME_SERVICE);
        console.log(
          `Starting ${GAME_SERVICE} in detached mode${
            build ? " with rebuild" : ""
          }...`,
        );
        const started = await runCompose(composeArgs);
        if (started) await maybeAttachGameConsole();
      },
    },
    {
      name: "stop",
      description: "Stop the running game server container",
      handler: async (_args: string[]) => {
        if (!(await dockerTest())) return;
        console.log("Stopping game-server...");
        await runCompose(["stop", GAME_SERVICE]);
      },
    },
    {
      name: "restart",
      description: "Restart the game server container",
      handler: async (_args: string[]) => {
        if (!(await dockerTest())) return;
        console.log("Restarting game-server...");
        await runCompose(["restart", GAME_SERVICE]);
      },
    },
  ],
  handler: async (args: string[]) => {
    if (args.length) {
      console.error(
        `Unknown server subcommand: ${args[0]}. Use start, stop, or restart.`,
      );
      return;
    }
    if (!(await dockerTest())) return;
    await showStatusMessage();
  },
};

const maybeAttachGameConsole = async () => {
  const interactive = Deno.isatty(Deno.stdin.rid) &&
    Deno.isatty(Deno.stdout.rid);
  if (!interactive) {
    console.log(
      "game-server is running in detached mode. Use `crtb terminal game` to attach.",
    );
    return;
  }

  try {
    await attachContainerConsole("crafters-toolbox-game", {
      title: "game-server",
    });
  } catch (error) {
    console.error("Failed to attach to game-server console:", error);
  }
};

export default serverCommand;
