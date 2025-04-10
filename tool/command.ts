// command type
export type Command = {
  name: string;
  description: string;
  subcommands?: Command[];
  handler: (args: string[]) => void;
};

import help from "./commands/help.ts";
import components from "./commands/components.ts";
import setup from "./commands/setup.ts";
import startServer from "./commands/start-server.ts";

export const COMMANDS: Command[] = [help, components, setup, startServer];
