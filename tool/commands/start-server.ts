import { Command } from "../command.ts";

const cmd: Command = {
  name: "start-server",
  description: "Start the server",
  handler: async (args: string[]) => {
    if (args.length === 0) {
      console.log("Starting server...");
      // Check if docker is installed
      const dockerCheck = new Deno.Command("docker", {
        args: ["--version"],
      });
      const dockerCheckResult = dockerCheck.spawn();
      const res = await dockerCheckResult.status;
      if (!res.success) {
        console.error("Docker is not installed. Please install Docker.");
        return;
      }

      
      const uid = Deno.build.os === "linux" ? Deno.uid() : 1000;
      const gid = Deno.build.os === "linux" ? Deno.gid() : 100;

      const dockercmd = new Deno.Command("docker", {
        args: ["compose", "up", "gameserver", "--build"],
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
