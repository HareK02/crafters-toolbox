import { Command } from "../command.ts";
import { dockerTest } from "../docker-test.ts";
import { getComposeEnv } from "../docker-env.ts";
import { getComposeServiceStatus } from "../docker-compose-status.ts";

const SSH_SERVICE = "ssh-server";

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

async function showStatus() {
  const status = await getComposeServiceStatus(SSH_SERVICE);
  if (!status) {
    console.log(
      "SSH server is not running. Use `crtb ssh up` to start the collaboration SSH container.",
    );
    return;
  }
  console.log(
    `ssh-server: ${status.State ?? "unknown"} (${status.Status ?? "n/a"})`,
  );
  if (status.Ports) console.log(`Ports: ${status.Ports}`);
}

const sshCommand: Command = {
  name: "ssh",
  description: "Manage the SSH collaboration container",
  subcommands: [
    {
      name: "up",
      description: "Start the SSH container in detached mode",
      handler: async (_args: string[]) => {
        if (!(await dockerTest())) return;
        console.log("Starting ssh-server in detached mode...");
        await runCompose(["up", "-d", SSH_SERVICE]);
      },
    },
    {
      name: "down",
      description: "Stop the SSH container",
      handler: async (_args: string[]) => {
        if (!(await dockerTest())) return;
        console.log("Stopping ssh-server...");
        await runCompose(["stop", SSH_SERVICE]);
      },
    },
  ],
  handler: async (args: string[]) => {
    if (args.length) {
      console.error(
        `Unknown ssh subcommand: ${
          args[0]
        }. Use up, down, or no subcommand to view status.`,
      );
      return;
    }
    if (!(await dockerTest())) return;
    await showStatus();
  },
};

export default sshCommand;
