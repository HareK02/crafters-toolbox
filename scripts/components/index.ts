/**
 * コンポーネント関連のエクスポート集約
 */

// Base component
export {
  Component,
  createComponent,
  createDatapack,
  createMod,
  createPlugin,
  createResourcepack,
  createWorld,
} from "./base.ts";

export type { ComponentOptions } from "./base.ts";

// Status manager
export {
  createStatusManager,
  getCurrentStatusManager,
  info,
  IS_TTY,
  safeLog,
  setCurrentStatusManager,
  warn,
} from "./status-manager.ts";

export type { StatusManager } from "./status-manager.ts";

// Source resolver
export {
  componentBasePath,
  copyToDir,
  downloadToCache,
  ensureLocalPresence,
  ensureWorldSource,
  resolveSourceConfig,
} from "./source-resolver.ts";

// Build runner
export { runBuild, streamComponentLogs } from "./build-runner.ts";

// Artifact resolver
export { pickArtifactFile, resolveArtifactBase } from "./artifact-resolver.ts";

// Deployer
export {
  applyComponents,
  DEPLOY_CONFIGS,
  deployEntry,
} from "./deployer.ts";

// Discovery
export {
  detectComponentSource,
  detectComponentType,
  discoverUnregisteredComponents,
  formatSourceSummary,
  loadPropertiesComponents,
  registerImportedComponent,
  renderComponentInventory,
  truncateHint,
} from "./discovery.ts";

export type {
  ComponentListEntry,
  UnregisteredComponentEntry,
} from "./discovery.ts";
