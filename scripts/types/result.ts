/**
 * Result型 - 成功/失敗を明示的に表現する型
 */

/**
 * 成功を表す型
 */
export type Ok<T> = {
  readonly ok: true;
  readonly value: T;
};

/**
 * 失敗を表す型
 */
export type Err<E> = {
  readonly ok: false;
  readonly error: E;
};

/**
 * Result型 - 成功または失敗を表す
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/**
 * 成功結果を作成
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * 失敗結果を作成
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Resultが成功かどうかをチェック
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Resultが失敗かどうかをチェック
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * 成功の場合のみ値を取得（失敗時はデフォルト値）
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * 成功の場合のみ値を変換
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * 失敗の場合のみエラーを変換
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/**
 * Promiseをキャッチしてを返す
 */
export async function tryCatch<T>(
  promise: Promise<T>,
): Promise<Result<T, Error>> {
  try {
    const value = await promise;
    return ok(value);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * 同期関数をキャッチしてResultを返す
 */
export function tryCatchSync<T>(fn: () => T): Result<T, Error> {
  try {
    const value = fn();
    return ok(value);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
