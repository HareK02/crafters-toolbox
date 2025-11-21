import { TerminalDisplay } from "./ui.ts";

export type TerminalSessionOptions = {
  title: string;
  startMessage?: string;
  exitMessage?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export async function runTerminalSession(
  options: TerminalSessionOptions,
) {
  const display = new TerminalDisplay();
  const args = options.args ?? [];
  display.info(
    options.startMessage ??
      `${options.title}: Attaching console (Ctrl+C to detach)...`,
  );

  const command = new Deno.Command(options.command, {
    args,
    env: options.env,
    cwd: options.cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const child = command.spawn();

  let interrupted = false;
  const sigintHandler = () => {
    interrupted = true;
    display.setStatus(`${options.title}: Detaching (server keeps running)...`);
  };

  Deno.addSignalListener("SIGINT", sigintHandler);
  try {
    const status = await child.status;
    display.clearStatus();
    if (interrupted) {
      display.info(`${options.title}: Detached from console.`);
      return;
    }
    if (!status.success) {
      throw new Error(
        `${options.title} console exited with status ${status.code}`,
      );
    }
    display.info(
      options.exitMessage ?? `${options.title}: Console session ended.`,
    );
  } finally {
    Deno.removeSignalListener("SIGINT", sigintHandler);
    display.close();
  }
}
