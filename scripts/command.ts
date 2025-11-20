// command type
export type Command = {
  name: string;
  description: string;
  subcommands?: Command[];
  handler: (args: string[]) => void | Promise<void>;
};

import help from "./commands/help.ts";
import components from "./commands/components.ts";
import setup from "./commands/setup.ts";
import server from "./commands/server.ts";
import ssh from "./commands/ssh.ts";
import monitor from "./commands/monitor.ts";
import terminal from "./commands/terminal.ts";

export const COMMANDS: Command[] = [
  help,
  components,
  setup,
  server,
  ssh,
  monitor,
  terminal,
];
