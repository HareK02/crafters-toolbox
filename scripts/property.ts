import {
  Component,
  createDatapack,
  createMod,
  createPlugin,
  createResourcepack,
  createWorld,
} from "./components/index.ts";
import {
  ArtifactConfig,
  BuildConfig,
  ComponentIDType,
  IComponent,
  SourceConfig,
} from "./component.ts";
import { parse, stringify } from "@std/yaml";

/**
 * レガシー形式のリファレンス定義
 * 以前の crtb.properties.yml 形式との互換性のため
 */
type LegacyReference =
  | { path: string }
  | { url: string }
  | { url: string; branch?: string; commit?: string };

type VersionString =
  | `${number}.${number}.${number}`
  | `${number}.${number}`
  | `${number}`;

export type ServerType =
  | "vanilla"
  | "paper"
  | "spigot"
  | "forge"
  | "fabric"
  | "bukkit"
  | "neoforge";

export type ServerProperty = {
  type: ServerType;
  version: VersionString;
  build: string;
};

export type Properties = {
  server: ServerProperty;
  components: {
    world?: Component;
    datapacks?: Component[];
    plugins?: Component[];
    resourcepacks?: Component[];
    mods?: Component[];
  };
  exports: {
    [key: string]: {
      world: {
        server: {
          enable: boolean;
          server?: ServerProperty;
          list_type: "include" | "exclude";
          list: string[];
        };
        world: {
          enable: boolean;
          list_type: "include" | "exclude";
          list: string[];
        };
        client: {
          enable: boolean;
          list_type: "include" | "exclude";
          list: string[];
        };
      };
    };
  };
};

export class PropertiesManager {
  properties: Properties;
  constructor(properties: Properties) {
    this.properties = properties;
  }
  static fromYaml(yaml: string): PropertiesManager {
    try {
      const rawProperty = parse(yaml) as {
        server: Properties["server"];
        components?: Record<
          string,
          {
            type: string;
            path?: string;
            reference?: LegacyReference;
            source?: SourceConfig;
            build?: BuildConfig;
            artifact?: ArtifactConfig;
          }
        >;
        exports?: Properties["exports"];
      };

      const property: Properties = {
        server: rawProperty.server,
        components: {},
        exports: rawProperty.exports ?? {},
      };

      /**
       * レガシー参照形式からSourceConfigに変換
       */
      const convertLegacyReference = (
        ref: LegacyReference | undefined,
      ): SourceConfig | undefined => {
        if (!ref) return undefined;
        if ("path" in ref) {
          return { type: "local", path: ref.path };
        }
        if ("url" in ref) {
          return { type: "http", url: ref.url };
        }
        return undefined;
      };

      /**
       * 生のコンポーネントデータからオプションを抽出
       */
      const extractOptions = (raw: {
        path?: string;
        reference?: LegacyReference;
        source?: SourceConfig;
        build?: BuildConfig;
        artifact?: ArtifactConfig;
      }) => {
        const source = raw.source ?? convertLegacyReference(raw.reference);
        return {
          path: raw.path,
          source,
          build: raw.build,
          artifact: raw.artifact,
        };
      };

      if (
        rawProperty.components && typeof rawProperty.components === "object"
      ) {
        for (
          const [name, rawComponent] of Object.entries(rawProperty.components)
        ) {
          if (!rawComponent || typeof rawComponent !== "object") continue;
          const opts = extractOptions(rawComponent);
          const componentType = rawComponent.type as string;

          switch (componentType) {
            case ComponentIDType.WORLD:
              property.components.world = createWorld(opts);
              break;
            case ComponentIDType.DATAPACKS:
              property.components.datapacks ??= [];
              property.components.datapacks.push(createDatapack(name, opts));
              break;
            case ComponentIDType.PLUGINS:
              property.components.plugins ??= [];
              property.components.plugins.push(createPlugin(name, opts));
              break;
            case ComponentIDType.RESOURCEPACKS:
              property.components.resourcepacks ??= [];
              property.components.resourcepacks.push(
                createResourcepack(name, opts),
              );
              break;
            case ComponentIDType.MODS:
              property.components.mods ??= [];
              property.components.mods.push(createMod(name, opts));
              break;
            default:
              console.warn(
                `Unknown component type: ${componentType} for ${name}`,
              );
          }
        }
      }

      return new PropertiesManager(property);
    } catch (error) {
      throw new Error("Failed to parse YAML: " + error);
    }
  }
  toYaml(): string {
    // if contains undefined, remove it
    const data: Record<string, unknown> = {
      server: this.properties.server,
      components: {} as Record<string, unknown>,
    };

    if (
      this.properties.exports && Object.keys(this.properties.exports).length > 0
    ) {
      data.exports = this.properties.exports;
    }

    const components = data.components as Record<string, unknown>;

    const serializeComponent = (c: IComponent): Record<string, unknown> => {
      const obj: Record<string, unknown> = {
        type: c.kind,
      };

      // pathはデフォルト値と異なる場合のみ出力
      const defaultPath = c.kind === ComponentIDType.WORLD
        ? "./server/world"
        : `./components/${c.name}`;
      if (c.path && c.path !== defaultPath) {
        obj.path = c.path;
      }

      if (c.source) obj.source = c.source;
      if (c.build) obj.build = c.build;
      if (c.artifact) obj.artifact = c.artifact;

      return obj;
    };

    if (this.properties.components.world !== undefined) {
      components["world"] = serializeComponent(
        this.properties.components.world,
      );
    }

    const list: IComponent[] = [];
    if (this.properties.components.datapacks !== undefined) {
      list.push(...Object.values(this.properties.components.datapacks));
    }
    if (this.properties.components.plugins !== undefined) {
      list.push(...Object.values(this.properties.components.plugins));
    }
    if (this.properties.components.resourcepacks !== undefined) {
      list.push(...Object.values(this.properties.components.resourcepacks));
    }
    if (this.properties.components.mods !== undefined) {
      list.push(...Object.values(this.properties.components.mods));
    }

    for (const c of list) {
      components[c.name] = serializeComponent(c);
    }

    return stringify(data);
  }

  getComponentsAsArray(): IComponent[] {
    const components: IComponent[] = [];
    if (this.properties.components === null) return components;
    if (this.properties.components.world) {
      components.push(this.properties.components.world);
    }
    if (this.properties.components.datapacks) {
      components.push(...Object.values(this.properties.components.datapacks));
    }
    if (this.properties.components.plugins) {
      components.push(...Object.values(this.properties.components.plugins));
    }
    if (this.properties.components.resourcepacks) {
      components.push(
        ...Object.values(this.properties.components.resourcepacks),
      );
    }
    if (this.properties.components.mods) {
      components.push(...Object.values(this.properties.components.mods));
    }
    return components;
  }
}
