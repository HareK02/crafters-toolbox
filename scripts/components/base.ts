import {
  ArtifactConfig,
  BuildConfig,
  ComponentIDString,
  ComponentIDType,
  IComponent,
  ModTarget,
  SourceConfig,
} from "../component.ts";

/**
 * コンポーネントの作成オプション
 */
export interface ComponentOptions {
  path?: string;
  source?: SourceConfig;
  build?: BuildConfig;
  artifact?: ArtifactConfig;
  target?: ModTarget;
}

/**
 * 統合コンポーネントクラス
 * 以前は Datapack, Plugin, Mod, Resourcepack, World として個別に定義されていた
 */
export class Component implements IComponent {
  readonly kind: ComponentIDType;
  readonly name: string;
  path?: string;
  source?: SourceConfig;
  build?: BuildConfig;
  artifact?: ArtifactConfig;
  target?: ModTarget;

  constructor(
    kind: ComponentIDType,
    name: string,
    options?: ComponentOptions,
  ) {
    this.kind = kind;
    this.name = name;
    this.path = options?.path;
    this.source = options?.source;
    this.build = options?.build;
    this.artifact = options?.artifact;
    this.target = options?.target;
  }

  toIDString(): ComponentIDString {
    if (this.kind === ComponentIDType.WORLD) {
      return "world";
    }
    const prefix = ComponentIDType.toShortString(this.kind);
    return `${prefix}:${this.name}` as ComponentIDString;
  }
}

/**
 * ファクトリ関数: Datapackコンポーネントを作成
 */
export function createDatapack(
  name: string,
  options?: ComponentOptions,
): Component {
  return new Component(ComponentIDType.DATAPACKS, name, options);
}

/**
 * ファクトリ関数: Pluginコンポーネントを作成
 */
export function createPlugin(
  name: string,
  options?: ComponentOptions,
): Component {
  return new Component(ComponentIDType.PLUGINS, name, options);
}

/**
 * ファクトリ関数: Modコンポーネントを作成
 */
export function createMod(
  name: string,
  options?: ComponentOptions,
): Component {
  return new Component(ComponentIDType.MODS, name, options);
}

/**
 * ファクトリ関数: Resourcepackコンポーネントを作成
 */
export function createResourcepack(
  name: string,
  options?: ComponentOptions,
): Component {
  return new Component(ComponentIDType.RESOURCEPACKS, name, options);
}

/**
 * ファクトリ関数: Worldコンポーネントを作成
 */
export function createWorld(options?: ComponentOptions): Component {
  return new Component(ComponentIDType.WORLD, "world", options);
}

/**
 * 種類に基づいてコンポーネントを作成するファクトリ関数
 */
export function createComponent(
  kind: ComponentIDType,
  name: string,
  options?: ComponentOptions,
): Component {
  return new Component(kind, name, options);
}
