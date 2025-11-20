import { parse } from "jsr:@std/yaml";

type RunnerConfig = {
  java_base_image?: string;
};

type GameServerConfig = {
  max_memory?: string;
  min_memory?: string;
};

export type CRTBConfig = {
  runner?: RunnerConfig;
  game_server?: GameServerConfig;
  develop_server?: {
    ssh_enabled?: boolean;
    watch_update?: boolean;
  };
};

const DEFAULT_JAVA_IMAGE = "eclipse-temurin:21-jdk";

export function loadConfig(path = "./crtb.config.yml"): CRTBConfig {
  try {
    const text = Deno.readTextFileSync(path);
    const data = parse(text) as CRTBConfig;
    return data ?? {};
  } catch {
    return {};
  }
}

export function getJavaImage(config: CRTBConfig): string {
  return config.runner?.java_base_image ?? DEFAULT_JAVA_IMAGE;
}

export function getGameServerMemory(config: CRTBConfig): {
  max: string;
  min?: string;
} {
  return {
    max: config.game_server?.max_memory ?? "4G",
    min: config.game_server?.min_memory,
  };
}
