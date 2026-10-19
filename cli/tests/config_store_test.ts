/**
 * The config file's rules (pure) and the real file adapter (in a temp dir).
 *
 * Nothing here touches the real `~/.config`: paths come from a fake env reader
 * pointed at `Deno.makeTempDir()`.
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { ConfigError } from "@w6w/sdk";
import { configPath, loadConfig, NO_CONFIG, parseConfig, serializeConfig } from "../mod.ts";
import { fsConfigStore } from "../src/store-fs.ts";

const env = (values: Record<string, string>) => (name: string) => values[name];

Deno.test("configPath: win32 uses %APPDATA%", () => {
  assertEquals(
    configPath(env({ APPDATA: "C:\\Users\\u\\AppData\\Roaming", HOME: "/h" }), "win32"),
    "C:\\Users\\u\\AppData\\Roaming\\w6w\\config.json",
  );
  assertEquals(configPath(env({ HOME: "/h" }), "win32"), undefined);
});

Deno.test("configPath: an absolute XDG_CONFIG_HOME wins, a relative or blank one is ignored", () => {
  assertEquals(
    configPath(env({ XDG_CONFIG_HOME: "/x/cfg", HOME: "/h" }), "linux"),
    "/x/cfg/w6w/config.json",
  );
  assertEquals(
    configPath(env({ XDG_CONFIG_HOME: "rel/cfg", HOME: "/h" }), "linux"),
    "/h/.config/w6w/config.json",
  );
  assertEquals(
    configPath(env({ XDG_CONFIG_HOME: "  ", HOME: "/h" }), "darwin"),
    "/h/.config/w6w/config.json",
  );
});

Deno.test("configPath: no usable home is unresolvable", () => {
  assertEquals(configPath(env({}), "linux"), undefined);
  assertEquals(configPath(env({ XDG_CONFIG_HOME: "rel", HOME: "" }), "linux"), undefined);
});

Deno.test("parseConfig: the pinned shape round-trips; anything else names the path", () => {
  const good = {
    version: 1 as const,
    baseUrl: "https://a.example",
    hosts: { "https://a.example": { token: "t" } },
  };
  assertEquals(parseConfig(serializeConfig(good), "/p"), good);
  assertEquals(JSON.parse(serializeConfig(good)), good);
  const bad = [
    "not json",
    "[]",
    "null",
    '{"version":2,"baseUrl":"x","hosts":{}}',
    '{"baseUrl":"x","hosts":{}}',
    '{"version":1,"baseUrl":1,"hosts":{}}',
    '{"version":1,"baseUrl":"x","hosts":[]}',
    '{"version":1,"baseUrl":"x","hosts":{"h":{"token":1}}}',
    '{"version":1,"baseUrl":"x","hosts":{"h":"SECRET_TOKEN_VALUE"}}',
  ];
  for (const text of bad) {
    const error = assertThrows(() => parseConfig(text, "/the/path.json"), ConfigError);
    assertStringIncludes(error.message, "/the/path.json");
    assert(!error.message.includes("SECRET_TOKEN_VALUE"), "message echoed file content");
  }
});

Deno.test("loadConfig: a missing file is nothing stored", async () => {
  const config = await loadConfig({
    path: "/p",
    read: () => Promise.resolve(undefined),
    write: () => Promise.resolve(),
  });
  assertEquals(config, NO_CONFIG);
});

Deno.test("fs store: round trip, modes 0700/0600, tightening, rename, no residue", async () => {
  if (Deno.build.os === "windows") return;
  const root = await Deno.makeTempDir({ prefix: "w6w-store-" });
  try {
    const store = fsConfigStore(env({ XDG_CONFIG_HOME: root }));
    const path = `${root}/w6w/config.json`;
    assertEquals(store.path, path);
    assertEquals(await store.read(), undefined);

    await store.write("one\n");
    assertEquals(await store.read(), "one\n");
    assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600);
    assertEquals((await Deno.stat(`${root}/w6w`)).mode! & 0o777, 0o700);

    // Looser pre-existing modes end tightened, and the file is replaced by rename.
    await Deno.chmod(path, 0o644);
    await Deno.chmod(`${root}/w6w`, 0o755);
    const inode = (await Deno.stat(path)).ino;
    await store.write("two\n");
    assertEquals(await store.read(), "two\n");
    assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600);
    assertEquals((await Deno.stat(`${root}/w6w`)).mode! & 0o777, 0o700);
    assert((await Deno.stat(path)).ino !== inode, "written in place, not replaced");
    const names = [];
    for await (const entry of Deno.readDir(`${root}/w6w`)) names.push(entry.name);
    assertEquals(names, ["config.json"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
