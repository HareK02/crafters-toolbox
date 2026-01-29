/**
 * テストコンテキストとヘルパー
 */
import { join } from "@std/path";

/**
 * テスト用の一時ディレクトリを作成
 */
export async function createTempDir(): Promise<string> {
  const tempDir = await Deno.makeTempDir({ prefix: "crtb-test-" });
  return tempDir;
}

/**
 * 一時ディレクトリをクリーンアップ
 */
export async function cleanupTempDir(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * テストファイルを作成
 */
export async function createTestFile(
  dir: string,
  name: string,
  content: string,
): Promise<string> {
  const path = join(dir, name);
  await Deno.mkdir(join(dir, ...name.split("/").slice(0, -1)), {
    recursive: true,
  }).catch(() => {});
  await Deno.writeTextFile(path, content);
  return path;
}

/**
 * テストディレクトリを作成
 */
export async function createTestDir(
  baseDir: string,
  name: string,
): Promise<string> {
  const path = join(baseDir, name);
  await Deno.mkdir(path, { recursive: true });
  return path;
}

/**
 * テストコンテキスト
 */
export interface TestContext {
  tempDir: string;
  createFile: (name: string, content: string) => Promise<string>;
  createDir: (name: string) => Promise<string>;
  cleanup: () => Promise<void>;
}

/**
 * テストコンテキストを作成
 */
export async function setupTestContext(): Promise<TestContext> {
  const tempDir = await createTempDir();

  return {
    tempDir,
    createFile: (name, content) => createTestFile(tempDir, name, content),
    createDir: (name) => createTestDir(tempDir, name),
    cleanup: () => cleanupTempDir(tempDir),
  };
}
