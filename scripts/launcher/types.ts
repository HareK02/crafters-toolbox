export type Rule = {
  action: "allow" | "disallow";
  os?: {
    name?: "linux" | "windows" | "osx";
    version?: string;
    arch?: string;
  };
  features?: Record<string, boolean>;
};

export type Artifact = {
  path: string;
  sha1: string;
  size: number;
  url: string;
};

export type Library = {
  name: string;
  downloads?: {
    artifact?: Artifact;
    classifiers?: Record<string, Artifact>;
  };
  natives?: Record<string, string>;
  rules?: Rule[];
};

export type AssetIndex = {
  id: string;
  sha1: string;
  size: number;
  totalSize: number;
  url: string;
};

export type AssetObject = {
  hash: string;
  size: number;
};

export type AssetsIndex = {
  objects: Record<string, AssetObject>;
};

export type Argument = string | {
  rules: Rule[];
  value: string | string[];
};

export type VersionJson = {
  id: string;
  arguments?: {
    game?: Argument[];
    jvm?: Argument[];
  };
  minecraftArguments?: string; // Legacy
  mainClass: string;
  libraries: Library[];
  assetIndex: AssetIndex;
  assets: string;
  downloads: {
    client: Artifact;
    server?: Artifact;
  };
};

export type VersionManifestEntry = {
  id: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha";
  url: string;
  time: string;
  releaseTime: string;
};

export type VersionManifest = {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: VersionManifestEntry[];
};

export type FabricLoaderVersion = {
  loader: {
    version: string;
  };
  intermediary: {
    version: string;
  };
  launcherMeta: {
    version: 1;
    libraries: {
      client: Library[];
      common: Library[];
      server: Library[];
    };
    mainClass: {
      client: string;
      server: string;
    };
  };
};

export type LauncherOptions = {
  version: string; // Minecraft version
  gameDir: string;
  assetsDir: string;
  librariesDir: string;
  nativesDir: string;
  javaPath: string;
  user?: {
    uuid: string;
    accessToken: string;
    username: string; // Player name
  };
  fabricVersion?: string; // If present, use Fabric
  mods?: string[]; // Paths to mods
  quickPlay?: {
    singleplayer?: string; // World name
    multiplayer?: string; // Server IP
  };
};
