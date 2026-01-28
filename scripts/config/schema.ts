/**
 * 設定スキーマとデフォルト値
 */

/**
 * デフォルト値定義
 */
export const DEFAULTS = {
  // Java
  JAVA_IMAGE: "eclipse-temurin:21-jdk",

  // メモリ
  MAX_MEMORY: "4G",
  MIN_MEMORY: undefined as string | undefined,

  // ネットワーク
  SSH_PORT: "2222",
  GAME_PORT: "25565",
  RCON_PORT: "25575",

  // タイミング
  MONITOR_INTERVAL_SECONDS: 300,
  HEALTH_CHECK_INTERVAL_SECONDS: 30,

  // パス
  CACHE_ROOT: "./.cache/components",
  COMPONENTS_DIR: "./components",
  SERVER_ROOT: "./server",

  // Docker
  CONTAINER_PREFIX: "ctbx",
  GAME_SERVICE: "game-server",
  SSH_SERVICE: "ssh-server",

  // SSH
  SSH_ENABLED: true,
  SSH_PASSWORD_AUTH: false,
  SSH_KEY_AUTH: true,
} as const;

/**
 * ランナー設定型
 */
export type RunnerConfig = {
  java_base_image?: string;
};

/**
 * ゲームサーバー設定型
 */
export type GameServerConfig = {
  max_memory?: string;
  min_memory?: string;
  port?: string;
  rcon_port?: string;
};

/**
 * SSHパスワード認証設定型
 */
export type SSHPasswordConfig = {
  enabled?: boolean;
  value?: string;
};

/**
 * SSHキー認証設定型
 */
export type SSHKeyConfig = {
  enabled?: boolean;
};

/**
 * SSH認証設定型
 */
export type SSHAuthConfig = {
  password?: SSHPasswordConfig;
  keys?: SSHKeyConfig;
};

/**
 * SSH設定型
 */
export type SSHConfig = {
  enabled?: boolean;
  port?: string;
  auth?: SSHAuthConfig;
};

/**
 * レガシーサーバー設定型（下位互換性）
 */
export type LegacyDevelopServerConfig = {
  ssh_enabled?: boolean;
  watch_update?: boolean;
};

/**
 * CRTB設定ファイルの完全な型
 */
export type CRTBConfigSchema = {
  runner?: RunnerConfig;
  game_server?: GameServerConfig;
  ssh?: SSHConfig;
  // レガシーフォールバック
  ssh_enabled?: boolean;
  develop_server?: LegacyDevelopServerConfig;
};

/**
 * 解決済みSSH設定型
 */
export type ResolvedSSHConfig = {
  enabled: boolean;
  port: string;
  passwordAuth: {
    enabled: boolean;
    value?: string;
  };
  keyAuth: {
    enabled: boolean;
  };
};

/**
 * 解決済みゲームサーバー設定型
 */
export type ResolvedGameServerConfig = {
  maxMemory: string;
  minMemory?: string;
  port: string;
  rconPort: string;
};

/**
 * 解決済み設定型（全てのデフォルト適用済み）
 */
export type ResolvedConfig = {
  javaImage: string;
  gameServer: ResolvedGameServerConfig;
  ssh: ResolvedSSHConfig;
  paths: {
    cacheRoot: string;
    componentsDir: string;
    serverRoot: string;
  };
  docker: {
    containerPrefix: string;
    gameService: string;
    sshService: string;
  };
};
