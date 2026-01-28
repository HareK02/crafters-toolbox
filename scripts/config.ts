/**
 * 設定管理
 */
import { parse } from "@std/yaml";
import {
  CRTBConfigSchema,
  DEFAULTS,
  ResolvedSSHConfig,
} from "./config/schema.ts";
import {
  getLegacyConfigWarnings,
  hasLegacyConfig,
  resolveSSHConfig,
} from "./config/migrate.ts";

// 下位互換性のため再エクスポート
export type { CRTBConfigSchema as CRTBConfig, ResolvedSSHConfig };
export { DEFAULTS };

/**
 * 設定ファイルを読み込む
 */
export function loadConfig(path = "./crtb.config.yml"): CRTBConfigSchema {
  try {
    const text = Deno.readTextFileSync(path);
    const data = parse(text) as CRTBConfigSchema;
    const config = data ?? {};

    // レガシー設定の警告を出力
    if (hasLegacyConfig(config)) {
      const warnings = getLegacyConfigWarnings(config);
      for (const warning of warnings) {
        console.warn(`[config] ${warning}`);
      }
    }

    return config;
  } catch (error) {
    // Config file may not exist - this is normal for first-time setup
    if (!(error instanceof Deno.errors.NotFound)) {
      console.warn(`Warning: Failed to load config from ${path}:`, error);
    }
    return {};
  }
}

/**
 * Javaイメージを取得
 */
export function getJavaImage(config: CRTBConfigSchema): string {
  return config.runner?.java_base_image ?? DEFAULTS.JAVA_IMAGE;
}

/**
 * ゲームサーバーのメモリ設定を取得
 */
export function getGameServerMemory(config: CRTBConfigSchema): {
  max: string;
  min?: string;
} {
  return {
    max: config.game_server?.max_memory ?? DEFAULTS.MAX_MEMORY,
    min: config.game_server?.min_memory,
  };
}

/**
 * SSH設定を取得
 */
export function getSSHConfig(config: CRTBConfigSchema): ResolvedSSHConfig {
  return resolveSSHConfig(config);
}
