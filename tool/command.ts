// command type
export type Command = {
  name: string;
  description: string;
  subcommands?: Command[];
  handler: (args: string[]) => void;
};

import help from "./commands/help.ts";
import components from "./commands/components.ts";

export const COMMANDS: Command[] = [help, components];
