import { Command } from "../command.ts";
import { dockerTest } from "../docker-test.ts";

const cmd: Command = {
  name: "terminal",
  description: "Open a server terminal",
  handler: async (args: string[]) => {
    if (args.length === 0) {
      console.log("Opening server terminal...");

      if (!(await dockerTest())) return;

      const dockercmd = new Deno.Command("docker", {
        args: ["attach", "crafters-toolbox-gameserver"],
      });
      const process = dockercmd.spawn();

      process.status.then((_) => {
        console.log("quitted");
      });
    } else {
      console.log(`Unknown argument: ${args.join(", ")}`);
    }
  },
};

export default cmd;

// docker container list --format json | jq --slurp 'map(select(.Names == "crafters-toolbox-gameserver")) | .[-1].ID'
