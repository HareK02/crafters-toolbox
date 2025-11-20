import { getComposeEnv } from "./docker-env.ts";

const decoder = new TextDecoder();

export type ComposeServiceStatus = {
  Name?: string;
  Service?: string;
  State?: string;
  Status?: string;
  Ports?: string;
};

function parseJsonLines(text: string): unknown {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  try {
    return lines.map((line) => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

export async function getComposeServiceStatus(
  service: string,
): Promise<ComposeServiceStatus | undefined> {
  const command = new Deno.Command("docker", {
    args: ["compose", "ps", "--format", "json", service],
    env: getComposeEnv(),
  });

  const result = await command.output();
  if (!result.success) return undefined;

  const text = decoder.decode(result.stdout).trim();
  if (!text) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    parsed = parseJsonLines(text);
  }

  const list = Array.isArray(parsed) ? parsed : [parsed];
  const typed = list.filter((entry) =>
    entry && typeof entry === "object"
  ) as ComposeServiceStatus[];
  return typed.find((entry) => entry.Service === service) ?? typed[0];
}
