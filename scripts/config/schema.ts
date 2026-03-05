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
  GAME_NETWORK: "bridge",

  // SSH
  SSH_ENABLED: true,
  SSH_PASSWORD_AUTH: false,
  SSH_KEY_AUTH: true,

  // Components
  GIT_SUBMODULE_DEFAULT: true,
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
  network?: string;
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
 * コンポーネント設定型
 */
export type ComponentsConfig = {
  git_submodule?: boolean;
};

/**
 * レガシーサーバー設定型（下位互換性）
 */
export type LegacyDevelopServerConfig = {
  ssh_enabled?: boolean;
  watch_update?: boolean;
};

/**
 * クライアント設定型
 */
export type ClientConfig = {
  /** mod のデプロイ先ディレクトリ。~ 展開あり。デフォルト: .minecraft/mods */
  mods_dir?: string;
  /** client start で実行するコマンド */
  launch_command?: string;
};

/**
 * CRTB設定ファイルの完全な型
 */
export type CRTBConfigSchema = {
  runner?: RunnerConfig;
  game_server?: GameServerConfig;
  ssh?: SSHConfig;
  components?: ComponentsConfig;
  client?: ClientConfig;
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
  network: string;
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
