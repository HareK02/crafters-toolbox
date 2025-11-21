import { runTerminalSession } from "./session.ts";

export type AttachOptions = {
  title?: string;
};

export async function attachContainerConsole(
  containerName: string,
  options: AttachOptions = {},
) {
  const title = options.title ?? containerName;
  await runTerminalSession({
    title,
    command: "docker",
    args: ["attach", "--sig-proxy=false", containerName],
    startMessage:
      `${title}: Attaching to container console. Press Ctrl+C to detach without stopping the server.`,
    exitMessage: `${title}: Console closed.`,
  });
}
