import { Command, COMMANDS } from "../command.ts";

const cmd: Command = {
  name: "help",
  description: "Show help information",
  handler: async (args: string[]) => {
    if (args.length === 0) {
      console.log(
        COMMANDS.map(
          (cmd) =>
            `- ${cmd.name}: ${cmd.description} ${
              cmd.subcommands
                ? `\n    subcommands ${
                  cmd.subcommands
                    .map((sub) => sub.name)
                    .join(", \n    ")
                }`
                : ""
            }`,
        ).join("\n\n"),
      );
    } else {
      const commandName = args[0];
      const command = COMMANDS.find((cmd) => cmd.name === commandName);
      if (command) {
        console.log(`${command.name}: ${command.description}`);
      } else {
        console.log(`Command "${commandName}" not found.`);
      }
    }
  },
};

export default cmd;
