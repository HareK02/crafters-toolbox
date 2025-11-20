const VERSION = "0.0.1";

import { Command, COMMANDS } from "./scripts/command.ts";

const args = Deno.args;
if (!args[0]) {
  console.log(
    [
      "   ____            __ _            _       _____           _ _                \n",
      "  / ___|_ __ __ _ / _| |_ ___ _ __( )___  |_   _|__   ___ | | |__   _____  __ \n",
      " | |   | '__/ _` | |_| __/ _ [ '__|// __|   | |/ _ [ / _ [| | '_ [ / _ [ / /  \n",
      " | |___| | | (_| |  _| ||  __/ |    [__ [   | | (_) | (_) | | |_) | (_) >  <  \n",
      "  [____|_|  [__,_|_|  [__[___|_|    |___/   |_|[___/ [___/|_|_.__/ [___/_/[_[ ",
    ]
      .join("")
      .replace(/\[/g, "\\"),
  );

  console.log(
    `                      [ Version: ${VERSION} | Author: Hare ]\n` +
      "-------------------------------------------------------------------------------",
  );
  console.log("Type `help` to see all commands.");
} else {
  const commandName = args[0];

  const runCommand = (command: Command, args: string[]) => {
    const subcommand = command.subcommands?.find((cmd) => cmd.name === args[0]);
    if (subcommand) {
      subcommand.handler(args.slice(1));
    } else {
      command.handler(args);
    }
  };

  const command = COMMANDS.find((cmd) => cmd.name === commandName);
  if (command) {
    runCommand(command, args.slice(1));
  } else {
    console.log(`Command "${commandName}" not found.`);
  }
}
