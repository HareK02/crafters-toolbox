import { dirname, isAbsolute, join, relative } from "jsr:@std/path";

const MANIFEST_VERSION = 1;

export type DeploymentManifestData = {
  version: number;
  entries: Record<string, string[]>;
};

const DEFAULT_DATA: DeploymentManifestData = {
  version: MANIFEST_VERSION,
  entries: {},
};

export class DeploymentManifest {
  #data: DeploymentManifestData;
  #dirty = false;

  private constructor(
    private readonly serverRoot: string,
    private readonly manifestPath: string,
    data?: DeploymentManifestData,
  ) {
    this.#data = data ?? { ...DEFAULT_DATA, entries: {} };
    if (!this.#data.entries) this.#data.entries = {};
  }

  static async load(
    serverRoot: string,
    options: { path?: string } = {},
  ): Promise<DeploymentManifest> {
    const absRoot = await Deno.realPath(serverRoot).catch(() => serverRoot);
    const manifestPath = options.path ?? join(absRoot, ".crtb-deploy.json");
    let data: DeploymentManifestData | undefined;
    try {
      const content = await Deno.readTextFile(manifestPath);
      const parsed = JSON.parse(content);
      if (
        parsed && typeof parsed === "object" &&
        parsed.version === MANIFEST_VERSION &&
        parsed.entries && typeof parsed.entries === "object"
      ) {
        data = {
          version: MANIFEST_VERSION,
          entries: { ...parsed.entries },
        };
      } else {
        console.warn(
          `Ignoring invalid deployment manifest at ${manifestPath}, resetting.`,
        );
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn(
          `Failed to read deployment manifest ${manifestPath}:`,
          error,
        );
      }
    }
    return new DeploymentManifest(absRoot, manifestPath, data);
  }

  getAbsolutePaths(componentId: string): string[] {
    const stored = this.#data.entries[componentId] ?? [];
    return stored.map((entry) => this.toAbsolute(entry));
  }

  setPaths(componentId: string, absolutePaths: string[]): void {
    if (!absolutePaths.length) {
      if (componentId in this.#data.entries) {
        delete this.#data.entries[componentId];
        this.#dirty = true;
      }
      return;
    }
    this.#data.entries[componentId] = absolutePaths.map((path) =>
      this.toStored(path)
    );
    this.#dirty = true;
  }

  async saveIfDirty(): Promise<void> {
    if (!this.#dirty) return;
    const content = JSON.stringify(this.#data, null, 2) + "\n";
    await Deno.mkdir(dirname(this.manifestPath), { recursive: true });
    await Deno.writeTextFile(this.manifestPath, content);
    this.#dirty = false;
  }

  private toStored(path: string): string {
    const absolute = isAbsolute(path) ? path : join(this.serverRoot, path);
    const rel = relative(this.serverRoot, absolute);
    return rel && !rel.startsWith("..") ? (rel || "") : absolute;
  }

  private toAbsolute(path: string): string {
    if (isAbsolute(path)) return path;
    return join(this.serverRoot, path);
  }
}
