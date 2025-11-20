import { Command } from "../command.ts";
import { dockerTest } from "../docker-test.ts";
import { resolveServiceSelection, serviceToContainer } from "../services.ts";

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
    const container = serviceToContainer(service);
    if (!container) {
      console.error(`Unable to determine container for service ${service}.`);
      return;
    }

    console.log(`Attaching to ${container}. Press CTRL-p CTRL-q to detach.`);
    const dockercmd = new Deno.Command("docker", {
      args: ["attach", container],
    });
    const process = dockercmd.spawn({
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    await process.status;
    console.log("Detached from container.");
  },
};

export default cmd;

// docker container list --format json | jq --slurp 'map(select(.Names == "crafters-toolbox-game")) | .[-1].ID'
