import { Command } from "../command.ts";
import { dockerTest } from "../docker-test.ts";
import { resolveServiceSelection } from "../services.ts";
import { attachContainer, getContainerName } from "../docker-runner.ts";

const cmd: Command = {
  name: "terminal",
  description: "Attach to a running container console (default: game)",
  handler: async (args: string[]) => {
    if (!(await dockerTest())) return;

    const targetToken = args[0] ?? "game";
    if (targetToken === "all") {
      console.error("Please specify a single service (game, ssh, monitor).");
      return;
    }

    const { services, unknown } = resolveServiceSelection([targetToken]);
    if (unknown.length || services.length === 0) {
      console.error(
        `Unknown service argument: ${targetToken}. Use game, ssh, or monitor.`,
      );
      return;
    }

    const service = services[0];
    const containerName = getContainerName(service);
    await attachContainer(containerName);
  },
};

export default cmd;

// docker container list --format json | jq --slurp 'map(select(.Names == "crafters-toolbox-game")) | .[-1].ID'
