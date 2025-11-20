import { Command } from "../command.ts";

const monitorCommand: Command = {
  name: "monitor",
  description: "(WIP) Run the monitoring utility with an attached shell",
  handler: (_args: string[]) => {
    console.log(
      "The monitor command is not implemented yet. It will eventually start an attached shell running inside the monitor container.",
    );
    console.log(
      "For now, use `docker compose up -d monitor-server` or `docker compose logs monitor-server` manually.",
    );
  },
};

export default monitorCommand;
