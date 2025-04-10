import { Command } from "../command.ts";

const cmd: Command = {
  name: "setup",
  description: "Setup the environment",
  handler: async (args: string[]) => {
    if (args.length === 0) {
      console.log("Running setup process...");
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

      Deno.mkdir("./.app", { recursive: true });
      Deno.mkdir("./.cache", { recursive: true });

      // docker build -f ./docker/setup/Dockerfile -t crafters-workshop-setup .
      // docker run \
      //     --env USER_ID=$USERID \
      //     --env GROUP_ID=$GROUPID \
      //     --rm \
      //     -v ./.app:/app \
      //     -v ./.cache:/usr/cache \
      //     crafters-workshop-setup
      const dockerbuild = new Deno.Command("docker", {
        args: [
          "build",
          "-f",
          "./docker/setup/Dockerfile",
          "-t",
          "crafters-workshop-setup",
          ".",
        ],
      }).spawn();
      dockerbuild.status.then((status) => {
        if (status.success) {
          console.log("Docker image built successfully.");
        } else {
          console.error("Failed to build Docker image.");
        }
      });

      const dockercmd = new Deno.Command("docker", {
        args: [
          "run",
          "--env",
          `USER_ID=${uid}`,
          "--env",
          `GROUP_ID=${gid}`,
          "--rm",
          "-v",
          "./.app:/app",
          "-v",
          "./.cache:/usr/cache",
          "crafters-workshop-setup",
        ],
      }).spawn();
      dockercmd.status.then((status) => {
        if (status.success) {
          console.log("Docker container ran successfully.");
        } else {
          console.error("Failed to run Docker container.");
        }
      });
    } else {
      console.log(`Unknown argument: ${args.join(", ")}`);
    }
  },
};

export default cmd;
