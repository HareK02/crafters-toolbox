/**
 * レガシー設定のマイグレーション
 */
import {
  CRTBConfigSchema,
  DEFAULTS,
  ResolvedConfig,
  ResolvedGameServerConfig,
  ResolvedSSHConfig,
} from "./schema.ts";

/**
 * boolean値の合体（最初の有効な値を返す）
 */
function coalesceBoolean(
  ...values: Array<boolean | undefined | null>
): boolean | undefined {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    return value;
  }
  return undefined;
}

/**
 * 文字列値の合体（最初の有効な値を返す）
 */
function coalesceString(
  ...values: Array<string | undefined | null>
): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    return value;
  }
  return undefined;
}

/**
 * SSH設定を解決（レガシー設定を含む）
 */
export function resolveSSHConfig(config: CRTBConfigSchema): ResolvedSSHConfig {
  // enabled: 新形式 > レガシーdevelop_server > レガシートップレベル > デフォルト
  const enabled = coalesceBoolean(
    config.ssh?.enabled,
    config.develop_server?.ssh_enabled,
    config.ssh_enabled,
  ) ?? DEFAULTS.SSH_ENABLED;

  const passwordEnabled = coalesceBoolean(
    config.ssh?.auth?.password?.enabled,
  ) ?? DEFAULTS.SSH_PASSWORD_AUTH;

  const passwordValue = config.ssh?.auth?.password?.value?.trim();

  const keyEnabled = coalesceBoolean(
    config.ssh?.auth?.keys?.enabled,
  ) ?? DEFAULTS.SSH_KEY_AUTH;

  const port = coalesceString(config.ssh?.port) ?? DEFAULTS.SSH_PORT;

  return {
    enabled,
    port,
    passwordAuth: {
      enabled: passwordEnabled,
      value: passwordValue || undefined,
    },
    keyAuth: {
      enabled: keyEnabled,
    },
  };
}

/**
 * ゲームサーバー設定を解決
 */
export function resolveGameServerConfig(
  config: CRTBConfigSchema,
): ResolvedGameServerConfig {
  return {
    maxMemory: config.game_server?.max_memory ?? DEFAULTS.MAX_MEMORY,
    minMemory: config.game_server?.min_memory,
    port: config.game_server?.port ?? DEFAULTS.GAME_PORT,
    rconPort: config.game_server?.rcon_port ?? DEFAULTS.RCON_PORT,
  };
}

/**
 * 設定全体を解決
 */
export function resolveConfig(config: CRTBConfigSchema): ResolvedConfig {
  return {
    javaImage: config.runner?.java_base_image ?? DEFAULTS.JAVA_IMAGE,
    gameServer: resolveGameServerConfig(config),
    ssh: resolveSSHConfig(config),
    paths: {
      cacheRoot: DEFAULTS.CACHE_ROOT,
      componentsDir: DEFAULTS.COMPONENTS_DIR,
      serverRoot: DEFAULTS.SERVER_ROOT,
    },
    docker: {
      containerPrefix: DEFAULTS.CONTAINER_PREFIX,
      gameService: DEFAULTS.GAME_SERVICE,
      sshService: DEFAULTS.SSH_SERVICE,
    },
  };
}

/**
 * レガシー設定が使用されているかどうかをチェック
 */
export function hasLegacyConfig(config: CRTBConfigSchema): boolean {
  return (
    config.ssh_enabled !== undefined ||
    config.develop_server !== undefined
  );
}

/**
 * レガシー設定の警告メッセージを生成
 */
export function getLegacyConfigWarnings(
  config: CRTBConfigSchema,
): string[] {
  const warnings: string[] = [];

  if (config.ssh_enabled !== undefined) {
    warnings.push(
      "Deprecated: 'ssh_enabled' at root level. Use 'ssh.enabled' instead.",
    );
  }

  if (config.develop_server?.ssh_enabled !== undefined) {
    warnings.push(
      "Deprecated: 'develop_server.ssh_enabled'. Use 'ssh.enabled' instead.",
    );
  }

  if (config.develop_server?.watch_update !== undefined) {
    warnings.push(
      "Deprecated: 'develop_server.watch_update' is no longer supported.",
    );
  }

  return warnings;
}
