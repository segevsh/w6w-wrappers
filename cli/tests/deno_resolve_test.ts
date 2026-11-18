/**
 * Which `deno` the app toolchain spawns ({@linkcode resolveDeno}).
 *
 * The npm CLI carries its own Deno as optional `@deno/<platform>` dependencies, so
 * `w6w apps build` must work on a machine with no Deno on PATH. Every branch is
 * probed through an injected host: no binary is resolved or started for real.
 */

import { assertEquals } from "@std/assert";
import { BUNDLED_DENO_PACKAGES, type DenoHost, resolveDeno } from "../src/app-toolchain.ts";

const DENO_PACKAGE_VERSION = "2.8.2";

function fakeHost(overrides: Partial<DenoHost> & { files?: string[] } = {}): DenoHost {
  const files = new Set(overrides.files ?? []);
  return {
    env: () => undefined,
    denoExecPath: () => undefined,
    platform: "linux",
    arch: "x64",
    resolvePackage: () => undefined,
    isFile: (path) => Promise.resolve(files.has(path)),
    ...overrides,
  };
}

const installed = (map: Record<string, string>) => (name: string) => map[name];

Deno.test("W6W_DENO wins over everything", async () => {
  const h = fakeHost({
    env: (n) => n === "W6W_DENO" ? "/opt/deno/deno" : undefined,
    denoExecPath: () => "/self/deno",
  });
  assertEquals(await resolveDeno(h), "/opt/deno/deno");
});

Deno.test("under Deno, the running binary is reused", async () => {
  assertEquals(await resolveDeno(fakeHost({ denoExecPath: () => "/self/deno" })), "/self/deno");
});

Deno.test("under Node, the bundled platform package's binary is used", async () => {
  const h = fakeHost({
    resolvePackage: installed({
      "@deno/linux-x64-glibc": "/g/node_modules/@deno/linux-x64-glibc/package.json",
    }),
    files: ["/g/node_modules/@deno/linux-x64-glibc/deno"],
  });
  assertEquals(await resolveDeno(h), "/g/node_modules/@deno/linux-x64-glibc/deno");
});

Deno.test("on Windows the bundled binary is deno.exe", async () => {
  const h = fakeHost({
    platform: "win32",
    resolvePackage: installed({
      "@deno/win32-x64": "C:\\npm\\node_modules\\@deno\\win32-x64\\package.json",
    }),
    files: ["C:\\npm\\node_modules\\@deno\\win32-x64\\deno.exe"],
  });
  assertEquals(await resolveDeno(h), "C:\\npm\\node_modules\\@deno\\win32-x64\\deno.exe");
});

Deno.test("another platform's package is never picked", async () => {
  const h = fakeHost({
    platform: "darwin",
    arch: "arm64",
    resolvePackage: installed({ "@deno/linux-x64-glibc": "/x/@deno/linux-x64-glibc/package.json" }),
    files: ["/x/@deno/linux-x64-glibc/deno"],
  });
  assertEquals(await resolveDeno(h), "deno");
});

Deno.test("with no bundled binary, ~/.deno/bin is found without PATH", async () => {
  const h = fakeHost({
    env: (n) => n === "HOME" ? "/home/u" : undefined,
    files: ["/home/u/.deno/bin/deno"],
  });
  assertEquals(await resolveDeno(h), "/home/u/.deno/bin/deno");
});

Deno.test("$DENO_INSTALL/bin comes before ~/.deno/bin", async () => {
  const h = fakeHost({
    env: (n) => ({ HOME: "/home/u", DENO_INSTALL: "/opt/deno" })[n],
    files: ["/opt/deno/bin/deno", "/home/u/.deno/bin/deno"],
  });
  assertEquals(await resolveDeno(h), "/opt/deno/bin/deno");
});

Deno.test("nothing found falls back to bare `deno` on PATH", async () => {
  assertEquals(
    await resolveDeno(fakeHost({ env: (n) => n === "HOME" ? "/home/u" : undefined })),
    "deno",
  );
});

Deno.test("package.json pins every bundled platform package at one Deno version", async () => {
  const pkg = JSON.parse(
    await Deno.readTextFile(new URL("../package.json", import.meta.url)),
  ) as { optionalDependencies?: Record<string, string> };
  const expected = Object.fromEntries(
    BUNDLED_DENO_PACKAGES.map((name) => [name, DENO_PACKAGE_VERSION]),
  );
  assertEquals(pkg.optionalDependencies, expected);
});
