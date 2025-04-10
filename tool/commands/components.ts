import { Command } from "../command.ts";

const cmd: Command = {
  name: "components",
  description: "Show components information",
  subcommands: [
    {
      name: "list",
      description: "List all components",
      handler: () => {
        console.log("Available components:");
        console.log("  - component1");
        console.log("  - component2");
      },
    },
  ],
  handler: (args: string[]) => {
    const componentName = args[0];
    if (componentName) {
      console.log(`Component: ${componentName}`);
      console.log(`Description: Description of ${componentName}`);
    } else {
      console.log("Available components:");
      console.log("  - component1");
      console.log("  - component2");
    }
  },
};

export default cmd;
