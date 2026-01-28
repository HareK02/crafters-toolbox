import { assertEquals, assertThrows } from "@std/assert";
import { PropertiesManager } from "../property.ts";
import { ComponentIDType } from "../component.ts";
import {
  LEGACY_PROPERTIES,
  MINIMAL_PROPERTIES,
  PROPERTIES_WITH_BUILD,
  PROPERTIES_WITH_COMPONENTS,
  PROPERTIES_WITH_WORLD,
} from "./fixtures/properties.ts";

Deno.test("PropertiesManager.fromYaml - parses minimal properties", () => {
  const manager = PropertiesManager.fromYaml(MINIMAL_PROPERTIES);

  assertEquals(manager.properties.server.type, "paper");
  assertEquals(manager.properties.server.version, "1.21.1");
  assertEquals(manager.properties.server.build, "latest");
  assertEquals(manager.getComponentsAsArray().length, 0);
});

Deno.test("PropertiesManager.fromYaml - parses components", () => {
  const manager = PropertiesManager.fromYaml(PROPERTIES_WITH_COMPONENTS);
  const components = manager.getComponentsAsArray();

  assertEquals(components.length, 2);

  const plugin = components.find((c) => c.name === "my-plugin");
  assertEquals(plugin?.kind, ComponentIDType.PLUGINS);
  assertEquals(plugin?.source?.type, "local");

  const datapack = components.find((c) => c.name === "my-datapack");
  assertEquals(datapack?.kind, ComponentIDType.DATAPACKS);
  assertEquals(datapack?.source?.type, "git");
});

Deno.test("PropertiesManager.fromYaml - parses world component", () => {
  const manager = PropertiesManager.fromYaml(PROPERTIES_WITH_WORLD);

  assertEquals(manager.properties.components.world?.kind, ComponentIDType.WORLD);
  assertEquals(manager.properties.components.world?.source?.type, "local");
});

Deno.test("PropertiesManager.fromYaml - parses build config", () => {
  const manager = PropertiesManager.fromYaml(PROPERTIES_WITH_BUILD);
  const components = manager.getComponentsAsArray();

  const plugin = components.find((c) => c.name === "gradle-plugin");
  assertEquals(plugin?.build?.type, "gradle");
  if (plugin?.build?.type === "gradle") {
    assertEquals(plugin.build.task, "shadowJar");
  }
  assertEquals(plugin?.artifact?.type, "jar");
  assertEquals(plugin?.artifact?.pattern, ".*-all\\.jar$");
});

Deno.test("PropertiesManager.fromYaml - handles legacy reference format", () => {
  const manager = PropertiesManager.fromYaml(LEGACY_PROPERTIES);
  const components = manager.getComponentsAsArray();

  const plugin = components.find((c) => c.name === "old-plugin");
  assertEquals(plugin?.kind, ComponentIDType.PLUGINS);
  // Legacy reference should be converted to source
  assertEquals(plugin?.source?.type, "local");
  if (plugin?.source?.type === "local") {
    assertEquals(plugin.source.path, "./components/old-plugin");
  }
});

Deno.test("PropertiesManager.toYaml - serializes and parses back", () => {
  const manager = PropertiesManager.fromYaml(PROPERTIES_WITH_COMPONENTS);
  const yaml = manager.toYaml();
  const reparsed = PropertiesManager.fromYaml(yaml);

  assertEquals(reparsed.properties.server.type, manager.properties.server.type);
  assertEquals(
    reparsed.getComponentsAsArray().length,
    manager.getComponentsAsArray().length,
  );
});

Deno.test("PropertiesManager.fromYaml - throws on invalid YAML", () => {
  const invalidYaml = "invalid: [yaml: broken";
  assertThrows(
    () => PropertiesManager.fromYaml(invalidYaml),
    Error,
    "Failed to parse YAML",
  );
});

Deno.test("PropertiesManager.getComponentsAsArray - returns all components", () => {
  const yaml = `
server:
  type: fabric
  version: "1.21.1"
  build: latest
components:
  world:
    type: world
  dp1:
    type: datapack
  dp2:
    type: datapack
  plugin1:
    type: plugin
  rp1:
    type: resourcepack
  mod1:
    type: mod
`;
  const manager = PropertiesManager.fromYaml(yaml);
  const components = manager.getComponentsAsArray();

  assertEquals(components.length, 6);
  assertEquals(components.filter((c) => c.kind === ComponentIDType.WORLD).length, 1);
  assertEquals(
    components.filter((c) => c.kind === ComponentIDType.DATAPACKS).length,
    2,
  );
  assertEquals(
    components.filter((c) => c.kind === ComponentIDType.PLUGINS).length,
    1,
  );
  assertEquals(
    components.filter((c) => c.kind === ComponentIDType.RESOURCEPACKS).length,
    1,
  );
  assertEquals(components.filter((c) => c.kind === ComponentIDType.MODS).length, 1);
});
