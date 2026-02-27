import { assertEquals } from "@std/assert";
import {
  Component,
  createComponent,
  createDatapack,
  createMod,
  createPlugin,
  createResourcepack,
  createWorld,
} from "./base.ts";
import { ComponentIDType } from "../component.ts";

Deno.test("Component - toIDString returns correct format for each type", () => {
  const datapack = new Component(ComponentIDType.DATAPACKS, "my-datapack");
  assertEquals(datapack.toIDString(), "dp:my-datapack");

  const plugin = new Component(ComponentIDType.PLUGINS, "my-plugin");
  assertEquals(plugin.toIDString(), "pl:my-plugin");

  const mod = new Component(ComponentIDType.MODS, "my-mod");
  assertEquals(mod.toIDString(), "mod:my-mod");

  const resourcepack = new Component(
    ComponentIDType.RESOURCEPACKS,
    "my-resourcepack",
  );
  assertEquals(resourcepack.toIDString(), "rp:my-resourcepack");

  const world = new Component(ComponentIDType.WORLD, "world");
  assertEquals(world.toIDString(), "world");
});

Deno.test("Component - constructor sets all options correctly", () => {
  const component = new Component(ComponentIDType.PLUGINS, "test-plugin", {
    path: "./custom/path",
    source: { type: "local", path: "./local/source" },
    build: { type: "gradle", task: "build" },
    artifact: { type: "jar", path: "build/libs/plugin.jar" },
  });

  assertEquals(component.kind, ComponentIDType.PLUGINS);
  assertEquals(component.name, "test-plugin");
  assertEquals(component.path, "./custom/path");
  assertEquals(component.source, { type: "local", path: "./local/source" });
  assertEquals(component.build, { type: "gradle", task: "build" });
  assertEquals(component.artifact, { type: "jar", path: "build/libs/plugin.jar" });
});

Deno.test("createDatapack - creates a Datapack component", () => {
  const datapack = createDatapack("my-datapack", {
    source: { type: "http", url: "https://example.com/datapack.zip" },
  });

  assertEquals(datapack.kind, ComponentIDType.DATAPACKS);
  assertEquals(datapack.name, "my-datapack");
  assertEquals(datapack.toIDString(), "dp:my-datapack");
  assertEquals(datapack.source, {
    type: "http",
    url: "https://example.com/datapack.zip",
  });
});

Deno.test("createPlugin - creates a Plugin component", () => {
  const plugin = createPlugin("my-plugin", {
    build: { type: "gradle", task: "shadowJar" },
  });

  assertEquals(plugin.kind, ComponentIDType.PLUGINS);
  assertEquals(plugin.name, "my-plugin");
  assertEquals(plugin.toIDString(), "pl:my-plugin");
  assertEquals(plugin.build, { type: "gradle", task: "shadowJar" });
});

Deno.test("createMod - creates a Mod component", () => {
  const mod = createMod("my-mod", {
    source: { type: "git", url: "https://github.com/example/mod.git" },
  });

  assertEquals(mod.kind, ComponentIDType.MODS);
  assertEquals(mod.name, "my-mod");
  assertEquals(mod.toIDString(), "mod:my-mod");
});

Deno.test("createResourcepack - creates a Resourcepack component", () => {
  const resourcepack = createResourcepack("my-resourcepack");

  assertEquals(resourcepack.kind, ComponentIDType.RESOURCEPACKS);
  assertEquals(resourcepack.name, "my-resourcepack");
  assertEquals(resourcepack.toIDString(), "rp:my-resourcepack");
});

Deno.test("createWorld - creates a World component", () => {
  const world = createWorld({
    source: { type: "local", path: "./my-world" },
  });

  assertEquals(world.kind, ComponentIDType.WORLD);
  assertEquals(world.name, "world");
  assertEquals(world.toIDString(), "world");
  assertEquals(world.source, { type: "local", path: "./my-world" });
});

Deno.test("createComponent - creates component based on kind", () => {
  const datapack = createComponent(ComponentIDType.DATAPACKS, "test-dp");
  assertEquals(datapack.kind, ComponentIDType.DATAPACKS);
  assertEquals(datapack.toIDString(), "dp:test-dp");

  const plugin = createComponent(ComponentIDType.PLUGINS, "test-pl");
  assertEquals(plugin.kind, ComponentIDType.PLUGINS);
  assertEquals(plugin.toIDString(), "pl:test-pl");

  const mod = createComponent(ComponentIDType.MODS, "test-mod");
  assertEquals(mod.kind, ComponentIDType.MODS);
  assertEquals(mod.toIDString(), "mod:test-mod");

  const resourcepack = createComponent(
    ComponentIDType.RESOURCEPACKS,
    "test-rp",
  );
  assertEquals(resourcepack.kind, ComponentIDType.RESOURCEPACKS);
  assertEquals(resourcepack.toIDString(), "rp:test-rp");

  const world = createComponent(ComponentIDType.WORLD, "world");
  assertEquals(world.kind, ComponentIDType.WORLD);
  assertEquals(world.toIDString(), "world");
});

Deno.test("Component - kind and name are set at construction", () => {
  const component = new Component(ComponentIDType.PLUGINS, "test");

  // Verify initial values are correctly set
  assertEquals(component.kind, ComponentIDType.PLUGINS);
  assertEquals(component.name, "test");
});
