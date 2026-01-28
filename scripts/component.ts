import { IReference } from "./reference.ts";

const COMPONENT_ID_TYPES = {
  WORLD: "world",
  DATAPACKS: "datapack",
  PLUGINS: "plugin",
  RESOURCEPACKS: "resourcepack",
  MODS: "mod",
} as const;
export type ComponentIDType =
  (typeof COMPONENT_ID_TYPES)[keyof typeof COMPONENT_ID_TYPES];

export const ComponentIDType = {
  ...COMPONENT_ID_TYPES,
  toShortString: (type: string) => {
    switch (type) {
      case "world":
        return "world";
      case "datapack":
        return "dp";
      case "plugin":
        return "pl";
      case "resourcepack":
        return "rp";
      case "mod":
        return "mod";
      default:
        throw new Error(`Unknown component type: ${type}`);
    }
  },
  fromShortString: (type: string): ComponentIDType => {
    switch (type) {
      case "world":
        return COMPONENT_ID_TYPES.WORLD;
      case "dp":
        return COMPONENT_ID_TYPES.DATAPACKS;
      case "pl":
        return COMPONENT_ID_TYPES.PLUGINS;
      case "rp":
        return COMPONENT_ID_TYPES.RESOURCEPACKS;
      case "mod":
        return COMPONENT_ID_TYPES.MODS;
      default:
        throw new Error(`Unknown component type: ${type}`);
    }
  },
} as const;

export type ComponentIDString =
  | `dp:${string}`
  | `pl:${string}`
  | `rp:${string}`
  | `mod:${string}`
  | `world`;
export const ComponentIDString = {
  split: (
    id: ComponentIDString,
  ): {
    type: ComponentIDType;
    name?: string;
  } => {
    const spl = id.split(":");
    const type = ComponentIDType.fromShortString(spl[0]);
    const name = spl[1];
    return { type, name };
  },
};

export type SourceConfig =
  | { type: "local"; path: string }
  | { type: "http"; url: string }
  | { type: "git"; url: string; branch?: string; commit?: string };

export type BuildConfig =
  | { type?: "none" }
  | { type: "gradle"; task?: string; output?: string }
  | { type: "custom"; command: string; output?: string; workdir?: string };

export type ArtifactConfig = {
  type?: "raw" | "dir" | "file" | "jar" | "zip";
  path?: string;
  unzip?: boolean;
  target?: string;
  pattern?: string;
};

export interface IComponent {
  kind: ComponentIDType;
  name: string;
  path?: string;
  reference?: IReference;
  source?: SourceConfig;
  build?: BuildConfig;
  artifact?: ArtifactConfig;

  toIDString(): ComponentIDString;
}
