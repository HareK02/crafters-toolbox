import { Command } from "../command.ts";
import { dockerTest } from "../docker-test.ts";
import {
  runContainer,
  stopContainer,
  getContainerStatus,
  getContainerName,
  getGameServerConfig,
  attachContainer,
} from "../docker-runner.ts";
import { isTerminal } from "../terminal/tty.ts";

const GAME_SERVICE = "game-server";

async function showStatusMessage() {
  const containerName = getContainerName(GAME_SERVICE);
  const status = await getContainerStatus(containerName);

  if (!status.exists) {
    console.log(
      "game-server is not running. Use `crtb server start` to launch it.",
    );
    return;
  }

  console.log(
    `game-server: ${status.running ? "running" : "stopped"} (${status.state ?? "unknown"})`,
  );
}

const serverCommand: Command = {
  name: "server",
  description: "Manage the primary game server container",
  subcommands: [
    {
      name: "start",
      description:
        "Start the game server container in detached mode, then attach its console",
      handler: async (_args: string[]) => {
        if (!(await dockerTest())) return;

        console.log(`Starting ${GAME_SERVICE}...`);
        const config = getGameServerConfig();
        const started = await runContainer(GAME_SERVICE, config);

        if (started) {
          await maybeAttachGameConsole();
        } else {
          console.error("Failed to start game server");
        }
      },
    },
    {
      name: "stop",
      description: "Stop the running game server container",
      handler: async (_args: string[]) => {
        if (!(await dockerTest())) return;
        console.log("Stopping game-server...");
        const containerName = getContainerName(GAME_SERVICE);
        await stopContainer(containerName);
      },
    },
    {
      name: "restart",
      description: "Restart the game server container",
      handler: async (_args: string[]) => {
        if (!(await dockerTest())) return;
        console.log("Restarting game-server...");
        const containerName = getContainerName(GAME_SERVICE);
        await stopContainer(containerName);

        const config = getGameServerConfig();
        await runContainer(GAME_SERVICE, config);
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
  const interactive = isTerminal(Deno.stdin) && isTerminal(Deno.stdout);
  if (!interactive) {
    console.log(
      "game-server is running in detached mode. Use `crtb terminal game` to attach.",
    );
    return;
  }

  try {
    const containerName = getContainerName(GAME_SERVICE);
    await attachContainer(containerName);
  } catch (error) {
    console.error("Failed to attach to game-server console:", error);
  }
};

export default serverCommand;
