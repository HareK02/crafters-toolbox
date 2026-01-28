import { assertEquals } from "@std/assert";
import { DEFAULTS } from "../config/schema.ts";
import {
  getLegacyConfigWarnings,
  hasLegacyConfig,
  resolveConfig,
  resolveGameServerConfig,
  resolveSSHConfig,
} from "../config/migrate.ts";

Deno.test("resolveSSHConfig - returns defaults for empty config", () => {
  const result = resolveSSHConfig({});

  assertEquals(result.enabled, DEFAULTS.SSH_ENABLED);
  assertEquals(result.port, DEFAULTS.SSH_PORT);
  assertEquals(result.passwordAuth.enabled, DEFAULTS.SSH_PASSWORD_AUTH);
  assertEquals(result.keyAuth.enabled, DEFAULTS.SSH_KEY_AUTH);
});

Deno.test("resolveSSHConfig - respects explicit config", () => {
  const result = resolveSSHConfig({
    ssh: {
      enabled: false,
      port: "3333",
      auth: {
        password: {
          enabled: true,
          value: "secret",
        },
        keys: {
          enabled: false,
        },
      },
    },
  });

  assertEquals(result.enabled, false);
  assertEquals(result.port, "3333");
  assertEquals(result.passwordAuth.enabled, true);
  assertEquals(result.passwordAuth.value, "secret");
  assertEquals(result.keyAuth.enabled, false);
});

Deno.test("resolveSSHConfig - handles legacy ssh_enabled", () => {
  const result = resolveSSHConfig({
    ssh_enabled: false,
  });

  assertEquals(result.enabled, false);
});

Deno.test("resolveSSHConfig - handles legacy develop_server.ssh_enabled", () => {
  const result = resolveSSHConfig({
    develop_server: {
      ssh_enabled: false,
    },
  });

  assertEquals(result.enabled, false);
});

Deno.test("resolveSSHConfig - new config takes precedence over legacy", () => {
  const result = resolveSSHConfig({
    ssh: {
      enabled: true,
    },
    ssh_enabled: false,
    develop_server: {
      ssh_enabled: false,
    },
  });

  assertEquals(result.enabled, true);
});

Deno.test("resolveGameServerConfig - returns defaults for empty config", () => {
  const result = resolveGameServerConfig({});

  assertEquals(result.maxMemory, DEFAULTS.MAX_MEMORY);
  assertEquals(result.minMemory, undefined);
  assertEquals(result.port, DEFAULTS.GAME_PORT);
  assertEquals(result.rconPort, DEFAULTS.RCON_PORT);
});

Deno.test("resolveGameServerConfig - respects explicit config", () => {
  const result = resolveGameServerConfig({
    game_server: {
      max_memory: "8G",
      min_memory: "4G",
      port: "25566",
      rcon_port: "25576",
    },
  });

  assertEquals(result.maxMemory, "8G");
  assertEquals(result.minMemory, "4G");
  assertEquals(result.port, "25566");
  assertEquals(result.rconPort, "25576");
});

Deno.test("hasLegacyConfig - detects ssh_enabled at root", () => {
  assertEquals(hasLegacyConfig({ ssh_enabled: true }), true);
  assertEquals(hasLegacyConfig({}), false);
});

Deno.test("hasLegacyConfig - detects develop_server", () => {
  assertEquals(
    hasLegacyConfig({ develop_server: { ssh_enabled: true } }),
    true,
  );
  assertEquals(
    hasLegacyConfig({ develop_server: { watch_update: true } }),
    true,
  );
});

Deno.test("getLegacyConfigWarnings - returns warnings for legacy config", () => {
  const warnings = getLegacyConfigWarnings({
    ssh_enabled: true,
    develop_server: {
      ssh_enabled: true,
      watch_update: true,
    },
  });

  assertEquals(warnings.length, 3);
  assertEquals(
    warnings.some((w) => w.includes("ssh_enabled")),
    true,
  );
  assertEquals(
    warnings.some((w) => w.includes("watch_update")),
    true,
  );
});

Deno.test("resolveConfig - creates complete resolved config", () => {
  const result = resolveConfig({
    runner: {
      java_base_image: "custom-image:latest",
    },
    game_server: {
      max_memory: "16G",
    },
    ssh: {
      enabled: true,
    },
  });

  assertEquals(result.javaImage, "custom-image:latest");
  assertEquals(result.gameServer.maxMemory, "16G");
  assertEquals(result.ssh.enabled, true);
  assertEquals(result.paths.cacheRoot, DEFAULTS.CACHE_ROOT);
  assertEquals(result.docker.containerPrefix, DEFAULTS.CONTAINER_PREFIX);
});
