import { str } from "https://jsr.io/@std/yaml/1.0.5/_type/str.ts";
import { Datapack } from "./components/datapack.ts";
import { Mod } from "./components/mod.ts";
import { Plugin } from "./components/plugin.ts";
import { Resourcepack } from "./components/resourcepack.ts";
import { World } from "./components/world.ts";
import {
  ArtifactConfig,
  BuildConfig,
  IComponent,
  SourceConfig,
} from "./component.ts";
import { parse, stringify } from "jsr:@std/yaml";

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
    world?: World;
    datapacks?: Datapack[];
    plugins?: Plugin[];
    resourcepacks?: Resourcepack[];
    mods?: Mod[];
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
      const property = parse(yaml) as Properties;
      if (!property.components) {
        property.components = {};
      }
      const extractOptions = (
        raw: {
          reference?: unknown;
          source?: SourceConfig;
          build?: BuildConfig;
          artifact?: ArtifactConfig;
        },
      ) => {
        const source = raw.source ??
          (raw.reference
            ? "path" in (raw.reference as Record<string, unknown>)
              ? {
                type: "local",
                path: (raw.reference as { path: string }).path,
              }
              : "url" in (raw.reference as Record<string, unknown>)
              ? { type: "http", url: (raw.reference as { url: string }).url }
              : undefined
            : undefined);
        return {
          reference: raw.reference,
          source,
          build: raw.build,
          artifact: raw.artifact,
        };
      };

      const normalize = <T extends IComponent>(
        input:
          | Record<string, Partial<IComponent>>
          | Partial<IComponent>[]
          | undefined,
        factory: (name: string, opts: Partial<IComponent>) => T,
      ): T[] | undefined => {
        if (input === undefined) return undefined;
        if (Array.isArray(input)) {
          return input.map((item) =>
            factory(item.name ?? "", extractOptions(item as any))
          );
        }
        return Object.entries(input).map(([key, value]) =>
          factory(key, extractOptions(value as any))
        );
      };

      if (property.components.world) {
        const opts = extractOptions(
          property.components.world as unknown as any,
        );
        property.components.world = new World(opts.reference, {
          source: opts.source,
          build: opts.build,
          artifact: opts.artifact,
        });
      }
      property.components.datapacks = normalize(
        property.components.datapacks as never,
        (name, opts) =>
          new Datapack(name, opts.reference, {
            source: opts.source,
            build: opts.build,
            artifact: opts.artifact,
          }),
      );
      property.components.plugins = normalize(
        property.components.plugins as never,
        (name, opts) =>
          new Plugin(name, opts.reference, {
            source: opts.source,
            build: opts.build,
            artifact: opts.artifact,
          }),
      );
      property.components.resourcepacks = normalize(
        property.components.resourcepacks as never,
        (name, opts) =>
          new Resourcepack(name, opts.reference, {
            source: opts.source,
            build: opts.build,
            artifact: opts.artifact,
          }),
      );
      property.components.mods = normalize(
        property.components.mods as never,
        (name, opts) =>
          new Mod(name, opts.reference, {
            source: opts.source,
            build: opts.build,
            artifact: opts.artifact,
          }),
      );

      return new PropertiesManager(property);
    } catch (error) {
      throw new Error("Failed to parse YAML: " + error);
    }
  }
  toYaml(): string {
    // if contains undefined, remove it
    const data = JSON.parse(JSON.stringify(this.properties));
    for (const key in data) {
      if (data[key] === undefined) {
        delete data[key];
      }
    }

    data.components = {};
    if (this.properties.components.world !== undefined) {
      data.components.world = this.properties.components.world;
    }

    const list = [];
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
    for (const c of Object.values(list)) {
      const type = c.kind + "s";
      const obj = JSON.parse(JSON.stringify(c));
      const name = obj.name;
      delete obj.kind;
      delete obj.name;
      if (data.components[type] === undefined) {
        data.components[type] = {};
      }
      data.components[type][name] = obj;
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
