import componentCmd from "./commands/components.ts";
import helpCmd from "./commands/help.ts";
import initCmd from "./commands/init.ts";
import serverCmd from "./commands/server.ts";
import setupCmd from "./commands/setup.ts";
import sshCmd from "./commands/ssh.ts";
import terminalCmd from "./commands/terminal.ts";

export interface Command {
  name: string;
  description: string;
  subcommands?: Command[];
  handler: (args: string[]) => Promise<void>;
  interactiveHandler?: () => Promise<void>;
}

export const COMMANDS: Command[] = [
  initCmd,
  setupCmd,
  serverCmd,
  componentCmd,
  sshCmd,
  terminalCmd,
  helpCmd,
];
