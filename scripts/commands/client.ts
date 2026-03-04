import { Command } from "../command.ts";
import { getClientConfig, loadConfig } from "../config.ts";

const clientCommand: Command = {
  name: "client",
  description: "Manage local client environment",
  subcommands: [
    {
      name: "start",
      description: "Run the configured launch command",
      handler: async (_args: string[]) => {
        const config = loadConfig();
        const { launchCommand } = getClientConfig(config);

        if (!launchCommand) {
          console.error(
            "[client] No launch_command configured. Set client.launch_command in crtb.config.yml.",
          );
          return;
        }

        console.log(`[client] Running: ${launchCommand}`);
        const cmd = new Deno.Command("sh", {
          args: ["-c", launchCommand],
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
        });
        const { code } = await cmd.spawn().status;
        if (code !== 0) {
          console.error(`[client] Command exited with code ${code}`);
        }
      },
    },
  ],
  handler: async (_args) => {
    await Promise.resolve();
    console.log("Use `crtb client start`");
  },
};

export default clientCommand;
