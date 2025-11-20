import { downloadServerJar, ServerFlavor } from "./mod.ts";

type CliFlags = {
  type?: string;
  version?: string;
  build?: string;
  loader?: string;
  installer?: string;
  output?: string;
  userAgent?: string;
  help?: boolean;
};

if (import.meta.main) {
  let flags: CliFlags;
  try {
    flags = parseArgs(Deno.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printUsage(message);
    Deno.exit(1);
  }
  if (flags.help) {
    printUsage();
    Deno.exit(0);
  }
  if (!flags.type || !flags.version) {
    printUsage("--type and --version are required");
    Deno.exit(1);
  }

  const flavor = castFlavor(flags.type);
  const output = flags.output ?? `${flavor}-server.jar`;
  const build = flavor === "fabric"
    ? (flags.loader ?? flags.build)
    : flags.build;

  try {
    const destination = await downloadServerJar({
      flavor,
      version: flags.version,
      build,
      installer: flags.installer,
      output,
      userAgent: flags.userAgent,
    });
    console.log(`Downloaded ${flavor} server to ${destination}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

function parseArgs(args: string[]): CliFlags {
  const flags: CliFlags = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    switch (token) {
      case "-t":
      case "--type":
        flags.type = expectValue(args, ++i, "type");
        break;
      case "-v":
      case "--version":
        flags.version = expectValue(args, ++i, "version");
        break;
      case "-b":
      case "--build":
        flags.build = expectValue(args, ++i, "build");
        break;
      case "--loader":
        flags.loader = expectValue(args, ++i, "loader");
        break;
      case "-i":
      case "--installer":
        flags.installer = expectValue(args, ++i, "installer");
        break;
      case "-o":
      case "--output":
        flags.output = expectValue(args, ++i, "output path");
        break;
      case "-u":
      case "--user-agent":
        flags.userAgent = expectValue(args, ++i, "user agent");
        break;
      case "-h":
      case "--help":
        flags.help = true;
        break;
      default:
        if (token.startsWith("-")) {
          throw new Error(`Unknown argument: ${token}`);
        }
    }
  }
  return flags;
}

function expectValue(args: string[], index: number, label: string): string {
  if (index >= args.length) {
    throw new Error(`Missing value for ${label}`);
  }
  return args[index];
}

function castFlavor(input: string): ServerFlavor {
  const value = input.toLowerCase();
  if (
    value === "vanilla" ||
    value === "paper" ||
    value === "fabric" ||
    value === "neoforge"
  ) {
    return value;
  }
  throw new Error(`Unknown server type: ${input}`);
}

function printUsage(message?: string) {
  if (message) console.error(message);
  console.log(
    `Usage: deno run -A scripts/server-jar-downloader/main.ts --type <flavor> --version <minecraft version> [options]

Options:
  -t, --type <vanilla|paper|fabric|neoforge>
  -v, --version <minecraft version>
  -b, --build <build number or loader/build id>
      --loader <fabric loader version> (alias of --build for Fabric)
  -i, --installer <fabric installer version>
  -o, --output <path to save jar>
  -u, --user-agent <custom HTTP user agent>
  -h, --help   Show this message

  (Use "latest" or "latest-beta" with --version/--build to auto-resolve releases.)

Examples:
  # Latest Paper build for 1.21.1
  deno run -A scripts/server-jar-downloader/main.ts -t paper -v 1.21.1

  # Fabric server with explicit loader/installer versions
  deno run -A scripts/server-jar-downloader/main.ts -t fabric -v 1.21.1 --loader 0.16.5 --installer 1.0.1
`,
  );
}
