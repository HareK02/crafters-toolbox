import { Command } from "../command.ts";
import { dockerTest } from "../docker-test.ts";

const cmd: Command = {
  name: "start-server",
  description: "Start the server",
  handler: async (args: string[]) => {
    if (args.length === 0 || args[0] === "build") {
      console.log("Starting server...");

      if (!(await dockerTest())) return;

      const uid = Deno.build.os === "linux" ? Deno.uid() : 1000;
      const gid = Deno.build.os === "linux" ? Deno.gid() : 100;

      const dockercmd = new Deno.Command("docker", {
        args: [
          "compose",
          "up",
          "gameserver",
          args[0] === "build" ? "--build" : "-d",
        ],
        env: {
          USER_ID: `${uid}`,
          GROUP_ID: `${gid}`,
          MEM_MAX: "4G",
        },
      });
      const process = dockercmd.spawn();

      process.status.then((status) => {
        if (status.success) {
          console.log("Server started successfully.");
        } else {
          console.error("Failed to start server.");
        }
      });
    } else {
      console.log(`Unknown argument: ${args.join(", ")}`);
    }
  },
};

export default cmd;
