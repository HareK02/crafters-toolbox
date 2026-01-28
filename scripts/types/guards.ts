/**
 * 型ガード関数集
 */

import { SourceConfig } from "../component.ts";

/**
 * 値が非null/undefinedかどうかをチェック
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * 値が文字列かどうかをチェック
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * 値がオブジェクトかどうかをチェック
 */
export function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * SourceConfigがlocalタイプかどうかをチェック
 */
export function isLocalSource(
  source: SourceConfig,
): source is { type: "local"; path: string } {
  return source.type === "local";
}

/**
 * SourceConfigがhttpタイプかどうかをチェック
 */
export function isHttpSource(
  source: SourceConfig,
): source is { type: "http"; url: string } {
  return source.type === "http";
}

/**
 * SourceConfigがgitタイプかどうかをチェック
 */
export function isGitSource(
  source: SourceConfig,
): source is { type: "git"; url: string; branch?: string; commit?: string } {
  return source.type === "git";
}

/**
 * 配列の要素がすべて文字列かどうかをチェック
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/**
 * プロパティを持つオブジェクトかどうかをチェック
 */
export function hasProperty<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}
