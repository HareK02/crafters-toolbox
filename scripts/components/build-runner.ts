/**
 * コンポーネントビルド実行
 */
import { isAbsolute, join } from "@std/path";
import { BuildConfig, ComponentIDType, IComponent } from "../component.ts";
import { getLocalIdentity, HOST_SUPPORTS_POSIX_IDS } from "../docker-env.ts";
import { info, safeLog, warn } from "./status-manager.ts";

const STREAM_COMPONENT_LOGS = !(
  Deno.env.get("CRTB_COMPONENTS_STREAM_LOGS") === "0"
);

type LocalIdentity = ReturnType<typeof getLocalIdentity>;

const buildIdentityArgs = (
  identity: LocalIdentity,
  extraEnv: string[] = [],
) => {
  const args = [
    "-e",
    `LOCAL_UID=${identity.uid}`,
    "-e",
    `LOCAL_GID=${identity.gid}`,
    "-e",
    `LOCAL_USER=${identity.username}`,
    ...extraEnv,
  ];
  if (HOST_SUPPORTS_POSIX_IDS) {
    args.unshift(`${identity.uid}:${identity.gid}`);
    args.unshift("-u");
  }
  return args;
};

const getComponentLogLabel = (component: IComponent) => {
  if (component.kind === ComponentIDType.WORLD) return "world";
  if (component.name && component.name.length > 0) return component.name;
  return ComponentIDType.toShortString(component.kind);
};

const flushLogBuffer = (buffer: string, prefix: string, isError: boolean) => {
  if (!buffer.length) return "";
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  const remainder = parts.pop() ?? "";
  for (const part of parts) {
    safeLog(`${prefix} ${part}`, isError);
  }
  return remainder;
};

const streamPrefixedLines = async (
  stream: ReadableStream<Uint8Array> | null,
  prefix: string,
  isError: boolean,
) => {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = flushLogBuffer(buffer, prefix, isError);
  }
  buffer += decoder.decode();
  if (buffer.length) {
    safeLog(`${prefix} ${buffer}`, isError);
  }
};

export const streamComponentLogs = async (
  child: Deno.ChildProcess,
  component: IComponent,
) => {
  const prefix = `[${getComponentLogLabel(component)}]`;
  await Promise.all([
    streamPrefixedLines(child.stdout, prefix, false),
    streamPrefixedLines(child.stderr, prefix, true),
  ]);
};

const runBuildCommand = async (
  component: IComponent,
  command: Deno.Command,
  failureMessage: string,
) => {
  if (STREAM_COMPONENT_LOGS) {
    const child = command.spawn();
    const [status] = await Promise.all([
      child.status,
      streamComponentLogs(child, component),
    ]);
    if (!status.success) {
      warn(`${failureMessage} (exit code ${status.code})`);
    }
    return status.success;
  }
  const output = await command.output();
  if (!output.success) {
    const msg = new TextDecoder().decode(output.stderr) || failureMessage;
    warn(msg.trim());
  }
  return output.success;
};

const hasCommand = async (cmd: string) => {
  try {
    const command = new Deno.Command(cmd, {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    });
    const { success } = await command.spawn().status;
    return success;
  } catch {
    return false;
  }
};

const resolveOutputPath = (base: string, output?: string) => {
  if (!output) return base;
  if (output.startsWith("/")) return output;
  return join(base, output);
};

export const runBuild = async (
  component: IComponent,
  workdir: string,
  runnerImage: string,
): Promise<string> => {
  const absWorkdir = await Deno.realPath(workdir).catch(() => workdir);
  const build = component.build as BuildConfig | undefined;
  if (!build || build.type === undefined || build.type === "none") {
    return workdir;
  }

  switch (build.type) {
    case "gradle": {
      const task = build.task ?? "build";
      const gradlew = join(absWorkdir, "gradlew");
      const useGradlew = await Deno.stat(gradlew)
        .then(() => true)
        .catch(() => false);

      const hasJava = await hasCommand("java");
      const canRunLocally = useGradlew ? hasJava : await hasCommand("gradle");

      if (!canRunLocally) {
        const required = useGradlew ? "java" : "gradle";
        throw new Error(
          `Gradle build requires ${required} to be installed and available in PATH.`,
        );
      }

      info(`Building ${component.name} locally...`);
      const cmd = useGradlew ? [gradlew, task] : ["gradle", task];
      const command = new Deno.Command(cmd[0], {
        args: cmd.slice(1),
        cwd: absWorkdir,
        stdout: "piped",
        stderr: "piped",
        env: {
          TERM: "dumb",
        },
      });
      const success = await runBuildCommand(
        component,
        command,
        "Local Gradle build failed",
      );
      if (!success) {
        throw new Error("Local Gradle build failed");
      }
      return resolveOutputPath(absWorkdir, build.output);
    }
    case "custom": {
      const base = build.workdir
        ? isAbsolute(build.workdir)
          ? build.workdir
          : join(absWorkdir, build.workdir)
        : absWorkdir;
      const identity = getLocalIdentity();
      const userArgs = buildIdentityArgs(identity);
      const dockerCmd = new Deno.Command("docker", {
        args: [
          "run",
          "--rm",
          ...userArgs,
          "-e",
          "CI=1",
          "-e",
          "TERM=dumb",
          "-v",
          `${base}:${base}`,
          "-w",
          base,
          runnerImage,
          "bash",
          "-lc",
          build.command,
        ],
        stdout: "piped",
        stderr: "piped",
      });
      const success = await runBuildCommand(
        component,
        dockerCmd,
        "Custom build failed",
      );
      if (!success) {
        throw new Error("Custom build failed");
      }
      return resolveOutputPath(base, build.output);
    }
    default:
      warn(
        `Unsupported build type ${
          (build as { type: string }).type
        } for ${component.name}`,
      );
      return workdir;
  }
};
