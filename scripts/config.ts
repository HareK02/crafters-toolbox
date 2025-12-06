import { parse } from "jsr:@std/yaml";

type RunnerConfig = {
  java_base_image?: string;
};

type GameServerConfig = {
  max_memory?: string;
  min_memory?: string;
};

type SSHPasswordConfig = {
  enabled?: boolean;
  value?: string;
};

type SSHKeyConfig = {
  enabled?: boolean;
};

type SSHAuthConfig = {
  password?: SSHPasswordConfig;
  keys?: SSHKeyConfig;
};

type SSHConfig = {
  enabled?: boolean;
  auth?: SSHAuthConfig;
};

export type CRTBConfig = {
  runner?: RunnerConfig;
  game_server?: GameServerConfig;
  ssh?: SSHConfig;
  ssh_enabled?: boolean; // legacy fallback
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

export type ResolvedSSHConfig = {
  enabled: boolean;
  passwordAuth: {
    enabled: boolean;
    value?: string;
  };
  keyAuth: {
    enabled: boolean;
  };
};

export function getSSHConfig(config: CRTBConfig): ResolvedSSHConfig {
  const enabled = coalesceBoolean(
    config.ssh?.enabled,
    config.develop_server?.ssh_enabled,
    config.ssh_enabled,
  );

  const passwordEnabled = coalesceBoolean(
    config.ssh?.auth?.password?.enabled,
    false,
  ) ?? false;
  const passwordValue = config.ssh?.auth?.password?.value?.trim();
  const keyEnabled = coalesceBoolean(config.ssh?.auth?.keys?.enabled, true) ?? true;

  return {
    enabled: enabled ?? true,
    passwordAuth: {
      enabled: passwordEnabled,
      value: passwordValue ? passwordValue : undefined,
    },
    keyAuth: {
      enabled: keyEnabled,
    },
  };
}

function coalesceBoolean(
  ...values: Array<boolean | undefined | null>
): boolean | undefined {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    return value;
  }
  return undefined;
}
