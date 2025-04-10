import { Command } from "../command.ts";
import { dockerTest } from "../docker-test.ts";

const cmd: Command = {
  name: "stop-server",
  description: "Stop the server",
  handler: async (args: string[]) => {
    if (args.length === 0) {
      console.log("Stopping server...");

      if (!(await dockerTest())) return;

      const dockercmd = new Deno.Command("docker", {
        args: ["compose", "down"],
      });
      const process = dockercmd.spawn();

      process.status.then((status) => {
        if (status.success) {
          console.log("Server stopped successfully.");
        } else {
          console.error("Failed to stop server.");
        }
      });
    } else {
      console.log(`Unknown argument: ${args.join(", ")}`);
    }
  },
};

export default cmd;
