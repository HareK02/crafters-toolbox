/**
 * コンポーネント管理コマンド
 */
import { Command } from "../command.ts";
import { readComponents } from "../components_reader.ts";
import { PropertiesManager } from "../property.ts";
import {
  applyComponents,
  detectComponentSource,
  discoverUnregisteredComponents,
  formatSourceSummary,
  registerImportedComponent,
  renderComponentInventory,
  truncateHint,
} from "../components/index.ts";

const COMPONENTS_BASE_DIR = "./components";

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  world: "world",
  datapack: "datapack",
  plugin: "plugin",
  resourcepack: "resourcepack",
  mod: "mod",
};

const promptComponentsForUpdate = async (
  initialNames: string[] = [],
): Promise<string[] | undefined> => {
  try {
    const yaml = await Deno.readTextFile("./crtb.properties.yml");
    const manager = PropertiesManager.fromYaml(yaml);
    const defined = manager.getComponentsAsArray();
    if (!defined.length) {
      console.log("crtb.properties.yml に定義済みコンポーネントがありません。");
      return undefined;
    }
    const options = defined.map((component) => {
      const typeLabel = COMPONENT_TYPE_LABELS[component.kind];
      const summary = formatSourceSummary(component, component.name);
      return {
        value: component.name,
        label: `${component.name} [${typeLabel}]`,
        hint: truncateHint(summary),
      };
    });

    const prompts = await import("npm:@clack/prompts");
    const selection = await prompts.multiselect({
      message:
        "更新するコンポーネントを選択してください (Space で選択, Enter で確定)",
      options,
      required: true,
      initialValues: initialNames,
      cursorAt: initialNames[0],
    });
    if (prompts.isCancel(selection) || !Array.isArray(selection)) {
      return undefined;
    }
    if (selection.length === 0) {
      console.log("コンポーネントが選択されていません。");
      return undefined;
    }
    return selection as string[];
  } catch (error) {
    console.error("Failed to load components for selection:", error);
    return undefined;
  }
};

const promptComponentsForImport = async (
  unregistered: Map<string, { name: string; path: string }>,
  initialNames: string[] = [],
): Promise<string[] | undefined> => {
  if (unregistered.size === 0) {
    console.log("インポート可能なコンポーネントはありません。");
    return undefined;
  }

  const sorted = [...unregistered.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  const options = sorted.map((entry) => {
    return {
      value: entry.name,
      label: entry.name,
      hint: truncateHint(entry.path),
    };
  });

  const prompts = await import("npm:@clack/prompts");
  const selection = await prompts.multiselect({
    message:
      "インポートするコンポーネントを選択してください (Space で選択, Enter で確定)",
    options,
    required: true,
    initialValues: initialNames,
    cursorAt: initialNames[0],
  });
  if (prompts.isCancel(selection) || !Array.isArray(selection)) {
    return undefined;
  }
  if (selection.length === 0) {
    console.log("コンポーネントが選択されていません。");
    return undefined;
  }
  return selection as string[];
};

const runComponentsUpdate = async (
  args: string[],
  preselectedNames?: string[],
  options?: { pull?: boolean },
) => {
  const selectedNames = preselectedNames?.length ? preselectedNames : args;

  try {
    const properties = PropertiesManager.fromYaml(
      Deno.readTextFileSync("./crtb.properties.yml"),
    );
    const availableNames = new Set(
      properties.getComponentsAsArray().map((component) => component.name),
    );

    try {
      const discoveredNames = await readComponents(COMPONENTS_BASE_DIR);
      const unregisteredNames = discoveredNames.filter(
        (name) => !availableNames.has(name),
      );
      if (unregisteredNames.length) {
        console.warn(
          `The following components exist locally but are not registered in crtb.properties.yml and were skipped: ${
            unregisteredNames.join(", ")
          }`,
        );
      }
    } catch (error) {
      console.warn("Failed to scan ./components directory:", error);
    }

    let selectedSet: Set<string> | undefined;
    if (selectedNames && selectedNames.length) {
      const matched: string[] = [];
      const missing: string[] = [];
      for (const name of selectedNames) {
        if (availableNames.has(name)) matched.push(name);
        else missing.push(name);
      }
      if (missing.length) {
        console.warn(
          `The following components are not registered and were skipped: ${
            missing.join(", ")
          }`,
        );
      }
      if (!matched.length) {
        console.error("指定されたコンポーネントが存在しません。");
        return;
      }
      selectedSet = new Set(matched);
    }

    await applyComponents(properties, selectedSet, options);
  } catch (e) {
    console.error("Error reading components:", e);
  }
};

const runComponentsImport = async (
  args: string[],
  preselectedNames?: string[],
) => {
  const selectedNames = preselectedNames?.length ? preselectedNames : args;

  let properties: PropertiesManager;
  try {
    properties = PropertiesManager.fromYaml(
      Deno.readTextFileSync("./crtb.properties.yml"),
    );
  } catch (error) {
    console.error("Failed to load crtb.properties.yml:", error);
    return;
  }

  const unregistered = await discoverUnregisteredComponents(properties);
  if (unregistered.size === 0) {
    console.log(
      "crtb.properties.yml に未登録のコンポーネントは見つかりませんでした。",
    );
    return;
  }

  let targetNames: string[];
  if (selectedNames && selectedNames.length) {
    const missing = selectedNames.filter((name) => !unregistered.has(name));
    if (missing.length) {
      console.warn(
        `The following components are not available for import: ${
          missing.join(", ")
        }`,
      );
    }
    targetNames = selectedNames.filter((name) => unregistered.has(name));
    if (!targetNames.length) {
      console.error("インポート対象のコンポーネントが見つかりませんでした。");
      return;
    }
  } else {
    targetNames = [...unregistered.keys()];
  }

  const imported: string[] = [];
  for (const name of targetNames) {
    const entry = unregistered.get(name);
    if (!entry) continue;
    const source = await detectComponentSource(entry.path);
    if (!source) {
      console.warn(`${name}: ソースが特定できなかったためスキップしました。`);
      continue;
    }
    const registered = await registerImportedComponent(
      properties,
      entry,
      source,
    );
    if (!registered) continue;
    imported.push(name);
  }

  if (!imported.length) {
    console.log("インポートされたコンポーネントはありません。");
    return;
  }

  try {
    Deno.writeTextFileSync("./crtb.properties.yml", properties.toYaml());
  } catch (error) {
    console.error("Failed to write crtb.properties.yml:", error);
    return;
  }

  console.log(
    `Imported ${imported.length} component(s): ${imported.join(", ")}`,
  );
};

const runComponentsImportInteractive = async () => {
  let lastSelection: string[] = [];
  while (true) {
    try {
      const properties = PropertiesManager.fromYaml(
        Deno.readTextFileSync("./crtb.properties.yml"),
      );
      const unregistered = await discoverUnregisteredComponents(properties);
      if (unregistered.size === 0) {
        console.log(
          "crtb.properties.yml に未登録のコンポーネントは見つかりませんでした。",
        );
        return;
      }

      lastSelection = lastSelection.filter((name) => unregistered.has(name));

      const selection = await promptComponentsForImport(
        unregistered,
        lastSelection,
      );
      if (!selection || selection.length === 0) {
        console.log(
          "コンポーネントが選択されていないため、インポートを終了します。",
        );
        return;
      }
      await runComponentsImport([], selection);
      lastSelection = selection;
    } catch (error) {
      console.error("Failed to prepare import flow:", error);
      break;
    }
  }
};

const componentsCommand: Command = {
  name: "components",
  description: "Show components information",
  subcommands: [
    {
      name: "list",
      description: "List all components",
      handler: renderComponentInventory,
    },
    {
      name: "import",
      description:
        "Register locally discovered components into crtb.properties.yml",
      handler: async (args: string[]) => {
        await runComponentsImport(args);
      },
      interactiveHandler: async () => {
        await runComponentsImportInteractive();
      },
    },
    {
      name: "update",
      description:
        "Update components (optionally pass component names to limit scope)",
      handler: async (args: string[]) => {
        await runComponentsUpdate(args);
      },
      interactiveHandler: async () => {
        let lastSelection: string[] = [];
        while (true) {
          const selection = await promptComponentsForUpdate(lastSelection);
          if (!selection || selection.length === 0) {
            return;
          }
          lastSelection = selection;
          await runComponentsUpdate([], selection);
          console.log("");
        }
      },
    },
    {
      name: "pull",
      description:
        "Fetch and update component sources from remote (overwrites local changes)",
      handler: async (args: string[]) => {
        await runComponentsUpdate(args, undefined, { pull: true });
      },
      interactiveHandler: async () => {
        let lastSelection: string[] = [];
        while (true) {
          const selection = await promptComponentsForUpdate(lastSelection);
          if (!selection || selection.length === 0) {
            return;
          }
          lastSelection = selection;
          await runComponentsUpdate([], selection, { pull: true });
          console.log("");
        }
      },
    },
  ],
  handler: async () => {
    await renderComponentInventory();
  },
};

export default componentsCommand;
