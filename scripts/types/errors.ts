/**
 * カスタムエラークラス集
 */

/**
 * アプリケーション基底エラー
 */
export class AppError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * 設定関連エラー
 */
export class ConfigError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "ConfigError";
  }
}

/**
 * ファイル操作関連エラー
 */
export class FileError extends AppError {
  constructor(
    message: string,
    public readonly path: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "FileError";
  }
}

/**
 * ネットワーク関連エラー
 */
export class NetworkError extends AppError {
  constructor(
    message: string,
    public readonly url?: string,
    public readonly statusCode?: number,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "NetworkError";
  }
}

/**
 * Docker関連エラー
 */
export class DockerError extends AppError {
  constructor(
    message: string,
    public readonly containerName?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "DockerError";
  }
}

/**
 * コンポーネント関連エラー
 */
export class ComponentError extends AppError {
  constructor(
    message: string,
    public readonly componentName: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "ComponentError";
  }
}

/**
 * ビルド関連エラー
 */
export class BuildError extends AppError {
  constructor(
    message: string,
    public readonly componentName: string,
    public readonly exitCode?: number,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "BuildError";
  }
}

/**
 * バリデーションエラー
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly field?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "ValidationError";
  }
}

/**
 * エラーをフォーマットして文字列として返す
 */
export function formatError(error: unknown): string {
  if (error instanceof AppError) {
    const parts = [error.message];
    if (error.cause) {
      parts.push(`Caused by: ${formatError(error.cause)}`);
    }
    return parts.join("\n");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * エラーを安全にログ出力
 */
export function logError(
  error: unknown,
  context?: string,
): void {
  const prefix = context ? `[${context}] ` : "";
  console.error(`${prefix}${formatError(error)}`);
}
