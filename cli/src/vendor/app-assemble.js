// generated — do not edit. Run `npm run vendor:assemble` in cli/ to refresh.
// Vendored from w6w-core ddfe38f316947d6442683a459880af12e47d5f6b: packages/app-build/assemble.ts,
// bundled by cli/scripts/vendor-app-assemble.mjs with esbuild 0.28.2.
// ../../core/packages/runtime/src/errors.ts
var W6WError = class extends Error {
  constructor(code, phase, message, details) {
    super(message);
    this.code = code;
    this.phase = phase;
    this.details = details;
    this.name = "W6WError";
  }
  code;
  phase;
  details;
  toJSON() {
    return { code: this.code, phase: this.phase, message: this.message, details: this.details };
  }
};
var LoadError = class extends W6WError {
  constructor(code, message, details) {
    super(code, "load", message, details);
    this.name = "LoadError";
  }
};

// ../../core/packages/types/src/param.ts
function isFormResolvedOptions(o) {
  return !!o && !Array.isArray(o) && o.source === "resolveFields";
}

// ../../core/packages/types/src/output-shape.ts
var MAX_DEPTH = 8;
function typeOf(value) {
  if (value === null || value === void 0) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "unknown";
  }
}
function record(shape, path3, type) {
  const seen = Object.hasOwn(shape, path3) ? shape[path3] : void 0;
  if (seen === void 0 || seen === "null") shape[path3] = type;
  else if (type !== "null" && seen !== type) shape[path3] = "unknown";
}
function walk(shape, path3, value, depth) {
  const type = typeOf(value);
  record(shape, path3, type);
  if (depth >= MAX_DEPTH) return;
  if (type === "array") {
    for (const el of value) walk(shape, `${path3}.0`, el, depth + 1);
  } else if (type === "object") {
    for (const [k, v] of Object.entries(value)) {
      walk(shape, `${path3}.${k}`, v, depth + 1);
    }
  }
}
function observedShapeOfValue(value) {
  const shape = {};
  if (typeOf(value) !== "object") return shape;
  for (const [k, v] of Object.entries(value)) walk(shape, k, v, 1);
  return shape;
}
var parentOf = (path3) => {
  const i = path3.lastIndexOf(".");
  return i < 0 ? void 0 : path3.slice(0, i);
};
function compareOutputShape(declared, observed) {
  const decl = /* @__PURE__ */ new Map();
  for (const f of declared) {
    decl.set(f.key, f.type);
    if (f.type === "array" && f.items && f.items.length > 0) {
      decl.set(`${f.key}.0`, "object");
      for (const it of f.items) decl.set(`${f.key}.0.${it.key}`, it.type);
    }
  }
  for (const p of [...decl.keys()]) {
    for (let a = parentOf(p); a !== void 0; a = parentOf(a)) {
      if (!decl.has(a)) decl.set(a, "object");
    }
  }
  const hasChild = /* @__PURE__ */ new Set();
  for (const p of decl.keys()) {
    const par = parentOf(p);
    if (par !== void 0) hasChild.add(par);
  }
  const has = (o, k) => Object.hasOwn(o, k);
  const diff = { missing: [], extra: [], typeMismatch: [] };
  for (const [path3, type] of decl) {
    const par = parentOf(path3);
    if (!has(observed, path3)) {
      if (par === void 0 || has(observed, par) && observed[par] === "object") {
        diff.missing.push(path3);
      }
      continue;
    }
    const obs = observed[path3];
    if (obs !== "null" && obs !== "unknown" && type !== "file" && obs !== type) {
      diff.typeMismatch.push({ key: path3, declared: type, observed: obs });
    }
  }
  for (const path3 of Object.keys(observed)) {
    if (decl.has(path3)) continue;
    const par = parentOf(path3);
    if (par === void 0 || decl.has(par) && hasChild.has(par)) diff.extra.push(path3);
  }
  return diff;
}

// ../../core/packages/types/src/auth.ts
var AUTH_HOOK_KINDS = [
  "preflight",
  "exchange",
  "test",
  "afterConnect",
  "sign",
  "handshake",
  "refresh",
  "revoke"
];

// ../../core/packages/types/src/trigger.ts
var TRIGGER_HOOK_KINDS = [
  "onSubscribe",
  "onUnsubscribe",
  "handleIngest",
  "poll",
  "parseOutput"
];

// ../../core/packages/types/src/trigger-protocol.ts
var PROTOCOL_DELIVERY = "w6w-protocol";
var FORBIDDEN_HOOKS = ["onSubscribe", "onUnsubscribe", "poll"];
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "[::1]"]);
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function isProtocolTrigger(t) {
  return t.delivery === PROTOCOL_DELIVERY || t.type === "protocol";
}
function urlErrors(field, raw, allow) {
  const at = `protocol.${field}`;
  if (typeof raw !== "string" || raw.length === 0) return [`${at} is required and must be a URL`];
  let u;
  try {
    u = new URL(raw);
  } catch {
    return [`${at} is not a parseable absolute URL`];
  }
  const out = [];
  const host = u.hostname.toLowerCase();
  if (u.protocol === "http:") {
    if (!LOOPBACK_HOSTS.has(host)) {
      out.push(`${at} must use https (http is accepted only for a loopback host)`);
    }
  } else if (u.protocol !== "https:") {
    out.push(`${at} must use https`);
  }
  if (u.username !== "" || u.password !== "") out.push(`${at} must not carry userinfo`);
  if (u.search !== "" || raw.includes("?")) out.push(`${at} must not carry a query`);
  if (u.hash !== "" || raw.includes("#")) out.push(`${at} must not carry a fragment`);
  const bare = host.replace(/^\[|\]$/g, "");
  const listed = allow.some((a) => {
    const l = a.toLowerCase();
    return l === host || l === bare;
  });
  if (!listed) out.push(`${at} host "${host}" must appear literally in network.allow`);
  return out;
}
function protocolDeclarationErrors(manifest, triggers) {
  const out = [];
  const block = manifest.protocol;
  if (block !== void 0) {
    if (!isObj(block)) {
      out.push("protocol must be an object");
    } else {
      const allowRaw = isObj(manifest.network) ? manifest.network.allow : void 0;
      const allow = Array.isArray(allowRaw) ? allowRaw.filter((a) => typeof a === "string") : [];
      out.push(...urlErrors("baseUrl", block.baseUrl, allow));
      out.push(...urlErrors("jwksUrl", block.jwksUrl, allow));
      const v = block.versions;
      if (!Array.isArray(v) || v.length === 0 || !v.every((n) => Number.isInteger(n)) || !v.includes(1)) {
        out.push("protocol.versions must be a non-empty integer array containing 1");
      }
    }
  }
  for (const { trigger, hooks } of triggers) {
    if (!isProtocolTrigger(trigger)) continue;
    const who = `Trigger "${trigger.key}"`;
    if (block === void 0) {
      out.push(`${who} is delivered by the protocol but the app declares no \`protocol\` block`);
    }
    if (trigger.delivery !== PROTOCOL_DELIVERY) {
      out.push(`${who} must set \`delivery\` to "${PROTOCOL_DELIVERY}"`);
    }
    const p = trigger.protocol;
    const events = isObj(p) ? p.events : void 0;
    const eventsOk = Array.isArray(events) && events.length > 0 && events.every((e) => typeof e === "string" && e.length > 0);
    if (!eventsOk) {
      out.push(`${who} \`protocol.events\` must be a non-empty array of non-empty strings`);
    }
    const declared = new Set(hooks);
    for (const h of FORBIDDEN_HOOKS) {
      if (declared.has(h)) {
        out.push(
          `${who} declares \`${h}\`: the host is the registration client of a protocol trigger`
        );
      }
    }
    if (eventsOk && events.length > 1) {
      const sel = (trigger.params ?? []).find((q) => q.key === "eventType");
      const opts = sel?.options;
      const values = Array.isArray(opts) ? opts.map((o) => String(o.value)) : void 0;
      if (sel?.type !== "select" || values === void 0 || values.length === 0 || !values.every((x) => events.includes(x))) {
        out.push(
          `${who} lists several events, so it must declare an \`eventType\` select param whose options are a subset of \`protocol.events\``
        );
      }
    }
  }
  return out;
}

// ../../core/packages/types/src/digest.ts
var SHA256_HEX = /^[0-9a-f]{64}$/;
function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}
function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value;
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === void 0) continue;
    out[key] = canonicalize(v);
  }
  return out;
}
async function sha256HexBytes(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sha256Hex(text) {
  return sha256HexBytes(new TextEncoder().encode(text));
}
function assertExec(exec) {
  if (exec !== void 0 && !(typeof exec === "string" && SHA256_HEX.test(exec))) {
    throw new TypeError("digest input `exec` must be 64 lowercase hex characters");
  }
}
async function digestDescription(input) {
  assertExec(input.exec);
  const manifest = { ...input.manifest };
  delete manifest.assetsRoot;
  const triggers = input.triggers && input.triggers.length > 0 ? input.triggers : void 0;
  const health = input.health && input.health.length > 0 ? input.health : void 0;
  const interfaces = input.interfaces && input.interfaces.length > 0 ? input.interfaces : void 0;
  return await sha256Hex(canonicalJson({
    manifest,
    actions: input.actions,
    auth: input.auth,
    triggers,
    health,
    interfaces,
    exec: input.exec
  }));
}
async function digestDescriptionVersioned(input) {
  const digest = await digestDescription(input);
  return { digest, digestVersion: input.exec !== void 0 ? 2 : 1 };
}

// ../../core/packages/types/src/artifact.ts
var SHA256_HEX2 = /^[0-9a-f]{64}$/;
var TOP_KEYS = /* @__PURE__ */ new Set([
  "artifactVersion",
  "id",
  "version",
  "manifest",
  "actions",
  "auth",
  "healthChecks",
  "triggers",
  "interfaces",
  "exec",
  "map",
  "sourceDigest",
  "buildInfo"
]);
function isObj2(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function nonEmpty(v) {
  return typeof v === "string" && v.length > 0;
}
function checkKeys(o, path3, keys, errors) {
  for (const k of Object.keys(o)) {
    if (!keys.includes(k)) errors.push(`${path3}.${k}: unknown key`);
  }
  for (const k of keys) {
    if (!(k in o)) errors.push(`${path3}.${k}: missing`);
  }
}
function checkBlob(v, path3, extra, errors) {
  if (!isObj2(v)) {
    errors.push(`${path3}: must be an object`);
    return;
  }
  checkKeys(v, path3, ["sha256", "bytes", ...extra], errors);
  if (typeof v.sha256 !== "string" || !SHA256_HEX2.test(v.sha256)) {
    errors.push(`${path3}.sha256: must be 64 lowercase hex characters`);
  }
  if (typeof v.bytes !== "number" || !Number.isSafeInteger(v.bytes) || v.bytes < 0) {
    errors.push(`${path3}.bytes: must be a non-negative safe integer`);
  }
}
function checkHooks(v, path3, allowed, errors) {
  if (!Array.isArray(v) || !v.every((h) => typeof h === "string" && allowed.includes(h))) {
    errors.push(`${path3}: must be an array of known hook kinds`);
  }
}
function parseAppArtifactManifest(value) {
  const errors = [];
  if (!isObj2(value)) return { ok: false, errors: ["artifact: must be an object"] };
  const v = value;
  for (const k of Object.keys(v)) {
    if (!TOP_KEYS.has(k)) errors.push(`${k}: unknown key`);
  }
  if (v.artifactVersion !== 1) errors.push("artifactVersion: must be 1");
  if (!nonEmpty(v.id)) errors.push("id: must be a non-empty string");
  if (!nonEmpty(v.version)) errors.push("version: must be a non-empty string");
  if (!isObj2(v.manifest)) {
    errors.push("manifest: must be an object");
  } else {
    if ("assetsRoot" in v.manifest) errors.push("manifest.assetsRoot: must not be present");
    if (nonEmpty(v.id) && v.manifest.id !== v.id) errors.push("id: must equal manifest.id");
    if (nonEmpty(v.version) && v.manifest.version !== v.version) {
      errors.push("version: must equal manifest.version");
    }
  }
  if (!Array.isArray(v.actions)) {
    errors.push("actions: must be an array");
  } else {
    v.actions.forEach((a, i) => {
      if (!isObj2(a) || !nonEmpty(a.key)) {
        errors.push(`actions[${i}].key: must be a non-empty string`);
      }
    });
  }
  if (!Array.isArray(v.auth)) {
    errors.push("auth: must be an array");
  } else {
    v.auth.forEach((a, i) => {
      if (!isObj2(a)) return void errors.push(`auth[${i}]: must be an object`);
      checkKeys(a, `auth[${i}]`, ["auth", "hooks"], errors);
      if (!isObj2(a.auth)) errors.push(`auth[${i}].auth: must be an object`);
      checkHooks(a.hooks, `auth[${i}].hooks`, AUTH_HOOK_KINDS, errors);
    });
  }
  if (!Array.isArray(v.triggers)) {
    errors.push("triggers: must be an array");
  } else {
    v.triggers.forEach((t, i) => {
      if (!isObj2(t)) return void errors.push(`triggers[${i}]: must be an object`);
      checkKeys(t, `triggers[${i}]`, ["trigger", "hooks"], errors);
      if (!isObj2(t.trigger) || !nonEmpty(t.trigger.key)) {
        errors.push(`triggers[${i}].trigger.key: must be a non-empty string`);
      }
      checkHooks(t.hooks, `triggers[${i}].hooks`, TRIGGER_HOOK_KINDS, errors);
    });
  }
  if (!Array.isArray(v.healthChecks)) {
    errors.push("healthChecks: must be an array");
  } else {
    v.healthChecks.forEach((h, i) => {
      if (!isObj2(h)) return void errors.push(`healthChecks[${i}]: must be an object`);
      checkKeys(h, `healthChecks[${i}]`, ["check", "hasHook"], errors);
      if (!isObj2(h.check) || !nonEmpty(h.check.key)) {
        errors.push(`healthChecks[${i}].check.key: must be a non-empty string`);
      }
      if (typeof h.hasHook !== "boolean") {
        errors.push(`healthChecks[${i}].hasHook: must be a boolean`);
      }
    });
  }
  if (!Array.isArray(v.interfaces)) errors.push("interfaces: must be an array");
  checkBlob(v.exec, "exec", ["format"], errors);
  if (isObj2(v.exec) && v.exec.format !== "esm") errors.push('exec.format: must be "esm"');
  if ("map" in v && v.map !== void 0) checkBlob(v.map, "map", [], errors);
  if (typeof v.sourceDigest !== "string" || !SHA256_HEX2.test(v.sourceDigest)) {
    errors.push("sourceDigest: must be 64 lowercase hex characters");
  }
  if (!isObj2(v.buildInfo)) {
    errors.push("buildInfo: must be an object");
  } else {
    const b = v.buildInfo;
    const hasNode = "nodeVersion" in b;
    if (hasNode && "denoVersion" in b) {
      errors.push("buildInfo: exactly one of denoVersion, nodeVersion must be present");
    }
    const runtimeKey = hasNode && !("denoVersion" in b) ? "nodeVersion" : "denoVersion";
    checkKeys(b, "buildInfo", ["builder", runtimeKey, "minify", "sourcemap"], errors);
    if (!nonEmpty(b.builder)) errors.push("buildInfo.builder: must be a non-empty string");
    if (runtimeKey in b && !nonEmpty(b[runtimeKey])) {
      errors.push(`buildInfo.${runtimeKey}: must be a non-empty string`);
    }
    if (typeof b.minify !== "boolean") errors.push("buildInfo.minify: must be a boolean");
    if (typeof b.sourcemap !== "boolean") {
      errors.push("buildInfo.sourcemap: must be a boolean");
    } else if (b.sourcemap !== (v.map !== void 0)) {
      errors.push("buildInfo.sourcemap: must be true iff map is present");
    }
  }
  return errors.length === 0 ? { ok: true, value: v } : { ok: false, errors };
}
async function verifySha256(bytes, expected) {
  try {
    if (typeof expected !== "string" || !SHA256_HEX2.test(expected)) return false;
    return await sha256HexBytes(bytes) === expected;
  } catch {
    return false;
  }
}
async function sourceDigestOf(files) {
  const seen = /* @__PURE__ */ new Set();
  for (const f of files) {
    const p = f.path;
    if (typeof p !== "string" || p.length === 0) throw new TypeError("source path is empty");
    if (p.startsWith("/")) throw new TypeError(`source path is absolute: ${p}`);
    if (p.includes("\\")) throw new TypeError(`source path contains a backslash: ${p}`);
    for (const seg of p.split("/")) {
      if (seg === "" || seg === "." || seg === "..") {
        throw new TypeError(`source path has an invalid segment: ${p}`);
      }
    }
    if (seen.has(p)) throw new TypeError(`duplicate source path: ${p}`);
    seen.add(p);
  }
  const enc = new TextEncoder();
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const parts = [];
  for (const f of sorted) {
    parts.push(enc.encode(f.path), new Uint8Array([0]));
    parts.push(enc.encode(String(f.bytes.length)), new Uint8Array([0]), f.bytes);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return await sha256HexBytes(all);
}

// ../../core/packages/runtime/src/node.ts
var FS = "node:fs/promises";
var PATH = "node:path";
var fs = await import(FS);
var path = await import(PATH);

// ../../core/packages/runtime/src/loader.ts
var { isAbsolute, resolve } = path;
function unscopedName(name) {
  if (!name) return void 0;
  const slash = name.lastIndexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}
function normalizeAuthor(author) {
  if (!author) return void 0;
  if (typeof author !== "string") return author;
  const m = author.match(/^([^<(]+?)\s*(?:<([^>]+)>)?\s*(?:\(([^)]+)\))?$/);
  if (!m) return { name: author };
  return { name: m[1], ...m[2] && { email: m[2] }, ...m[3] && { url: m[3] } };
}
function firstUrl(field) {
  if (!field) return void 0;
  return typeof field === "string" ? field : field.url;
}
function manifestFromPackageJson(pkg) {
  const w = pkg.w6w ?? {};
  const require2 = (value, field) => {
    if (value === void 0 || value === null) {
      throw new LoadError("invalid_manifest", `App is missing required field \`${field}\`.`);
    }
    return value;
  };
  return {
    manifestVersion: w.manifestVersion ?? "1",
    id: require2(w.id, "w6w.id"),
    name: w.name ?? require2(unscopedName(pkg.name), "name"),
    displayName: require2(w.displayName, "w6w.displayName"),
    version: w.version ?? require2(pkg.version, "version"),
    description: w.description ?? pkg.description ?? "",
    categories: require2(w.categories ?? pkg.categories, "categories"),
    appearance: require2(w.appearance, "w6w.appearance"),
    author: require2(w.author ?? normalizeAuthor(pkg.author), "author"),
    license: w.license ?? require2(pkg.license, "license"),
    keywords: w.keywords ?? pkg.keywords,
    homepage: w.homepage ?? pkg.homepage,
    repository: w.repository ?? firstUrl(pkg.repository),
    bugs: w.bugs ?? firstUrl(pkg.bugs),
    classification: w.classification,
    longDescription: w.longDescription,
    screenshots: w.screenshots,
    publisher: w.publisher,
    documentation: w.documentation,
    support: w.support,
    privacyPolicy: w.privacyPolicy,
    termsOfService: w.termsOfService,
    defaultLocale: w.defaultLocale,
    localizations: w.localizations,
    engines: w.engines,
    network: w.network,
    // Declarative-only (DC-5): publish-time review visibility, never read by
    // `runtime.ts` to gate anything — the real check is per-Connection, not
    // per-App. Surfaced the same way `network` is, straight off the raw
    // `w6w` block, with no derived/computed counterpart the way
    // `network.allow` gets `netAllowlist` below.
    capabilities: w.capabilities,
    // Absent stays absent: never emit `modelProvider: undefined`/null/{}.
    ...w.modelProvider !== void 0 ? { modelProvider: w.modelProvider } : {},
    // Same for the trigger-protocol block: a block not projected here is dropped silently.
    ...w.protocol !== void 0 ? { protocol: w.protocol } : {}
  };
}
function resolveRef(baseDir, ref) {
  return isAbsolute(ref) ? ref : resolve(baseDir, ref);
}
function computeAllowlist(manifest, auths) {
  const hosts = new Set(manifest.network?.allow ?? []);
  for (const { auth } of auths) {
    const urls = [
      auth.oauth2?.authorizationUrl,
      auth.oauth2?.tokenUrl,
      auth.oauth2?.refreshUrl,
      auth.oauth2?.revokeUrl
    ];
    for (const u of urls) {
      if (!u) continue;
      try {
        hosts.add(new URL(u).hostname);
      } catch {
      }
    }
  }
  return [...hosts];
}
function derivedAuthChecks(auths) {
  return auths.filter((a) => a.hooks.has("test")).map(({ auth }) => ({
    key: `auth:${auth.key}`,
    title: `${auth.displayName} credential`,
    description: `Derived from the \`${auth.key}\` auth method's \`test\` hook.`,
    kind: "credential",
    scope: "connection",
    credential: "signed",
    covers: [`auth:${auth.key}`],
    severity: "fatal"
  }));
}
function healthAllowlist(appAllowlist, check) {
  const posture = check.credential ?? (check.kind === "service" ? "none" : "signed");
  if (posture === "signed") return appAllowlist;
  const extra = [...check.network?.allow ?? []];
  if (check.feed?.url) {
    try {
      extra.push(new URL(check.feed.url).hostname);
    } catch {
    }
  }
  return [.../* @__PURE__ */ new Set([...appAllowlist, ...extra])];
}
function resolveAppEntry(root, pkg) {
  return resolveRef(root, pkg.w6w?.entry ?? pkg.main ?? "./index.ts");
}
function assembleLoadedApp(described, manifest, code, label) {
  const actions = /* @__PURE__ */ new Map();
  for (const definition of described.actions) {
    if (!definition?.key) {
      throw new LoadError("invalid_action", `An action in ${label} is missing a \`key\`.`);
    }
    actions.set(definition.key, { definition });
  }
  const auths = described.auth.map(({ auth, hooks }) => ({
    auth,
    hooks: new Set(hooks)
  }));
  const triggers = /* @__PURE__ */ new Map();
  for (const { trigger: given, hooks } of described.triggers) {
    if (!given?.key) {
      throw new LoadError("invalid_trigger", `A trigger in ${label} is missing a \`key\`.`);
    }
    const trigger = { ...given };
    const declared = new Set(hooks);
    if (declared.has("onSubscribe") && !declared.has("onUnsubscribe")) {
      throw new LoadError(
        "invalid_trigger",
        `Trigger "${trigger.key}" in ${label} declares \`onSubscribe\` without \`onUnsubscribe\`: whatever is registered must be destroyable.`
      );
    }
    if (declared.has("poll") && declared.has("onSubscribe")) {
      throw new LoadError(
        "invalid_trigger",
        `Trigger "${trigger.key}" in ${label} declares both \`poll\` and \`onSubscribe\`: a trigger is a webhook or a poll, not both.`
      );
    }
    trigger.type = isProtocolTrigger(given) ? "protocol" : declared.has("poll") ? "poll" : "webhook";
    triggers.set(trigger.key, { trigger, hooks: declared });
  }
  const protocolErrors = protocolDeclarationErrors(manifest, [...triggers.values()]);
  if (protocolErrors.length > 0) {
    throw new LoadError("invalid_trigger", `${label}: ${protocolErrors[0]}`);
  }
  const netAllowlist = computeAllowlist(manifest, auths);
  const healthChecks = /* @__PURE__ */ new Map();
  for (const { check, hasHook } of described.healthChecks) {
    if (!check?.key) {
      throw new LoadError(
        "invalid_health_check",
        `A health check in ${label} is missing a \`key\`.`
      );
    }
    if (healthChecks.has(check.key)) {
      throw new LoadError(
        "invalid_health_check",
        `Duplicate health check key "${check.key}" in ${label}.`
      );
    }
    healthChecks.set(check.key, {
      check,
      hasHook,
      netAllowlist: healthAllowlist(netAllowlist, check)
    });
  }
  for (const check of derivedAuthChecks(auths)) {
    if (!healthChecks.has(check.key)) {
      healthChecks.set(check.key, { check, hasHook: true, netAllowlist });
    }
  }
  return {
    code,
    ...code.kind === "dir" ? { dir: code.dir, entryPath: code.entryPath } : {},
    manifest,
    actions,
    auths,
    triggers,
    healthChecks,
    interfaces: described.interfaces,
    netAllowlist
  };
}
async function loadedAppFromArtifact(manifest, code) {
  const sha256 = manifest.exec.sha256;
  if (!await verifySha256(new TextEncoder().encode(code), sha256)) {
    throw new LoadError(
      "exec_sha_mismatch",
      `Exec code does not match the manifest's sha256 (${sha256}).`,
      { sha256 }
    );
  }
  const clone = structuredClone(manifest);
  const described = {
    actions: clone.actions,
    auth: clone.auth,
    triggers: clone.triggers,
    healthChecks: clone.healthChecks,
    interfaces: clone.interfaces
  };
  return assembleLoadedApp(
    described,
    clone.manifest,
    { kind: "exec", sha256, code },
    `sha256:${sha256}`
  );
}

// ../../core/packages/runtime/src/shared.ts
var { lstat, readFile, realpath } = fs;
var { dirname, isAbsolute: isAbsolute2, relative, resolve: resolve2 } = path;
function isInside(root, child) {
  const rel = relative(root, child);
  return rel === "" || !isAbsolute2(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\");
}
async function resolveSharedRoots(appDir) {
  appDir = await realpath(appDir);
  const pkg = JSON.parse(await readFile(resolve2(appDir, "package.json"), "utf8"));
  const includes = pkg.w6w?.build?.include;
  if (includes === void 0) return [];
  const fail = (message) => {
    throw new LoadError("shared_path_invalid", message, { appDir });
  };
  if (!Array.isArray(includes) || !includes.every((p) => typeof p === "string")) {
    return fail("w6w.build.include must be an array of relative directory paths");
  }
  const parent = dirname(appDir);
  const roots = [];
  for (const ref of includes) {
    if (!ref || isAbsolute2(ref) || ref.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)) {
      fail(`shared directory must be relative: ${ref}`);
    }
    const path3 = resolve2(appDir, ref);
    if (path3 === parent || !isInside(parent, path3) || isInside(appDir, path3)) {
      fail(`shared directory must be inside a sibling directory: ${ref}`);
    }
    let current = parent;
    for (const part of relative(parent, path3).split(/[\\/]/)) {
      current = resolve2(current, part);
      let st;
      try {
        st = await lstat(current);
      } catch {
        return fail(`shared directory does not exist: ${ref}`);
      }
      if (!st.isDirectory() || st.isSymbolicLink()) {
        fail(`shared directory must not be a symlink: ${ref}`);
      }
    }
    if (relative(parent, path3).split(/[\\/]/).includes("tests")) {
      fail(`shared directory is test code: ${ref}`);
    }
    if (roots.some((root) => isInside(root, path3) || isInside(path3, root))) {
      fail(`duplicate or overlapping shared directories: ${ref}`);
    }
    roots.push(path3);
  }
  return roots.sort();
}

// ../../core/packages/runtime/src/description.ts
function describe(app) {
  return {
    app: app.manifest,
    actions: [...app.actions.values()].map((a) => {
      const appPorts = app.manifest.ports;
      const actionPorts = a.definition.ports;
      if (appPorts === void 0 && actionPorts === void 0) return a.definition;
      return { ...a.definition, ports: { ...appPorts, ...actionPorts } };
    }),
    auth: app.auths.map((a) => a.auth),
    triggers: [...app.triggers.values()].map((t) => t.trigger),
    health: [...app.healthChecks.values()].map((h) => h.check),
    interfaces: app.interfaces
  };
}

// ../../core/packages/runtime/src/sandbox/describe.ts
function projectDescription(app, authHookKinds, triggerHookKinds) {
  const actions = (app.actions ?? []).map(
    (a) => JSON.parse(JSON.stringify({
      ...a,
      execute: void 0,
      // Explicit: a hand-written non-function `resolveFields` must not survive,
      // and an action without the hook keeps the key absent (digests stable).
      resolveFields: typeof a.resolveFields === "function" ? true : void 0
    }))
  );
  const auth = (app.auth ?? []).map((a) => {
    const present = authHookKinds.filter((k) => typeof a[k] === "function");
    const config = { ...a };
    for (const k of authHookKinds) delete config[k];
    return { auth: JSON.parse(JSON.stringify(config)), hooks: present };
  });
  const triggers = (app.triggers ?? []).map((t) => {
    const present = triggerHookKinds.filter((k) => typeof t[k] === "function");
    const config = { ...t };
    for (const k of triggerHookKinds) delete config[k];
    return { trigger: JSON.parse(JSON.stringify(config)), hooks: present };
  });
  const declared = (app.healthChecks ?? []).map((h) => {
    const config = { ...h };
    delete config.check;
    return {
      check: JSON.parse(JSON.stringify(config)),
      hasHook: typeof h.check === "function"
    };
  });
  const tagged = (app.actions ?? []).filter((a) => a.healthCheck).map((a) => ({
    check: JSON.parse(JSON.stringify({
      kind: "dependency",
      ...a.healthCheck,
      key: a.healthCheck.key ?? a.key,
      title: a.healthCheck.title ?? a.title
    })),
    hasHook: typeof a.execute === "function"
  }));
  return {
    actions,
    auth,
    triggers,
    healthChecks: [...declared, ...tagged],
    interfaces: JSON.parse(JSON.stringify(app.interfaces ?? []))
  };
}

// ../../core/packages/runtime/src/sandbox/node-describe.ts
var WORKER_THREADS = "node:worker_threads";
function workerSource() {
  return [
    `import { parentPort, workerData } from "node:worker_threads";`,
    `const project = ${projectDescription.toString()};`,
    `try {`,
    `  const mod = await import(workerData.url);`,
    `  const app = mod.default ?? mod.app;`,
    `  if (!app || typeof app !== "object") {`,
    `    throw new Error("Entry module must default-export an AppDefinition object.");`,
    `  }`,
    `  parentPort.postMessage({ ok: true, value: project(app, workerData.auth, workerData.trigger) });`,
    `} catch (err) {`,
    `  parentPort.postMessage({ ok: false, name: err?.name ?? "Error",`,
    `    message: String(err?.message ?? err) });`,
    `}`
  ].join("\n");
}
async function describeExecNode(entryUrl, timeoutMs, memoryLimitMb) {
  const { Worker } = await import(WORKER_THREADS);
  const worker = new Worker(
    new URL(`data:text/javascript,${encodeURIComponent(workerSource())}`),
    {
      workerData: { url: entryUrl, auth: [...AUTH_HOOK_KINDS], trigger: [...TRIGGER_HOOK_KINDS] },
      resourceLimits: { maxOldGenerationSizeMb: memoryLimitMb },
      stdout: false,
      stderr: false
    }
  );
  return await new Promise((resolve6, reject) => {
    let settled = false;
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => settle(
        () => reject(new W6WError("hook_timeout", "execute", `Worker timed out after ${timeoutMs}ms.`))
      ),
      timeoutMs
    );
    worker.on("message", (m) => {
      settle(
        () => m.ok ? resolve6(m.value) : reject(new W6WError("hook_failed", "execute", m.message ?? "describe failed", m))
      );
    });
    worker.on("error", (e) => {
      settle(
        () => reject(new W6WError("hook_crashed", "execute", e?.message || "Worker crashed."))
      );
    });
    worker.on("exit", (code) => {
      settle(
        () => reject(new W6WError("hook_crashed", "execute", `Worker exited (${code}) without a result.`))
      );
    });
  });
}

// ../../core/packages/app-build/src/errors.ts
var BuildError = class extends Error {
  /** Stable, machine-readable refusal class (see the list in `mod.ts`). */
  code;
  /** The app directory the refusal concerns, as given by the caller. */
  appDir;
  constructor(code, message, appDir) {
    super(`[${code}] ${message}`);
    this.name = "BuildError";
    this.code = code;
    this.appDir = appDir;
  }
};
function isInside2(root, child) {
  const r = root.endsWith("/") ? root : root + "/";
  return child === root || child.startsWith(r);
}
function isTestPath(relPosix) {
  const segs = relPosix.split("/");
  if (segs.slice(0, -1).includes("tests") || segs[segs.length - 1] === "tests") return true;
  const base = segs[segs.length - 1];
  return base.endsWith(".test.ts") || base.endsWith("_test.ts");
}

// ../../core/packages/validator/src/validate.ts
var CATEGORIES = [
  "ai",
  "analytics",
  "calendar",
  "cms",
  "communication",
  "commerce",
  "crm",
  "databases",
  "data-warehousing",
  "developer-tools",
  "devops",
  "documents",
  "email",
  "finance",
  "forms",
  "hr",
  "iot",
  "legal",
  "marketing",
  "monitoring",
  "productivity",
  "project-management",
  "search",
  "security",
  "social-media",
  "spreadsheets",
  "storage",
  "support",
  "version-control",
  "video",
  "other"
];
var CATEGORY_SET = new Set(CATEGORIES);
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function checkFormResolvedFields(action, path3 = "action") {
  const errors = [];
  const warnings = [];
  if (!isObject(action)) return { errors, warnings };
  const hook = action.resolveFields === true;
  let optedIn = false;
  const flatten = (params, at, out) => {
    if (!Array.isArray(params)) return out;
    params.forEach((p, i) => {
      if (!isObject(p)) return;
      const here = `${at}[${i}]`;
      if (p.type === "section") flatten(p.children, `${here}.children`, out);
      else out.push({ p, path: here });
    });
    return out;
  };
  const walk3 = (params, at) => {
    const scope = flatten(params, at, []);
    const keys = new Set(scope.map((e) => e.p.key));
    for (const { p, path: here } of scope) {
      const options = p.options;
      if (isFormResolvedOptions(options)) {
        optedIn = true;
        if (!hook) {
          errors.push({
            path: `${here}.options.source`,
            message: 'is "resolveFields" but the action does not declare `resolveFields: true`'
          });
        }
      }
      const refreshOn = isObject(options) ? options.refreshOn : void 0;
      if (Array.isArray(refreshOn)) {
        refreshOn.forEach((k, i) => {
          const at2 = `${here}.options.refreshOn[${i}]`;
          if (k === p.key) {
            errors.push({ path: at2, message: "must not name the field itself" });
          } else if (typeof k !== "string" || !keys.has(k)) {
            errors.push({
              path: at2,
              message: `names no other param in the same form scope: ${JSON.stringify(k)}`
            });
          }
        });
      }
      if (p.type === "group") walk3(p.children, `${here}.children`);
    }
  };
  walk3(action.params, `${path3}.params`);
  if (hook && !optedIn) {
    warnings.push({
      path: `${path3}.resolveFields`,
      message: 'is true but no param has options.source "resolveFields"'
    });
  }
  return { errors, warnings };
}

// ../../core/packages/app-build/src/node.ts
var FS2 = "node:fs/promises";
var PATH2 = "node:path";
var OS = "node:os";
var fs2 = await import(FS2);
var path2 = await import(PATH2);
var os = await import(OS);

// ../../core/packages/app-build/src/assets.ts
var { lstat: lstat2, readFile: readFile2, realpath: realpath2 } = fs2;
var { extname, resolve: resolve3 } = path2;
var REMOTE_OR_DATA = /^(https?|data):/i;
var MIME = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon"
};
function base64(bytes) {
  let s = "";
  const CHUNK = 32768;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
var Inliner = class {
  constructor(realAppDir, appDir, limits, sharedRoots) {
    this.realAppDir = realAppDir;
    this.appDir = appDir;
    this.limits = limits;
    this.sharedRoots = sharedRoots;
  }
  realAppDir;
  appDir;
  limits;
  sharedRoots;
  total = 0;
  fail(code, msg) {
    throw new BuildError(code, msg, this.appDir);
  }
  async ref(ref, where) {
    if (REMOTE_OR_DATA.test(ref)) return ref;
    if (ref === "" || ref.startsWith("/") || ref.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)) {
      this.fail("asset_path", `${where}: asset ref must be a relative path inside the app: ${ref}`);
    }
    const ext = extname(ref).slice(1).toLowerCase();
    const mime = MIME[ext];
    if (!mime) this.fail("asset_extension", `${where}: unsupported asset type ".${ext}": ${ref}`);
    const path3 = resolve3(this.realAppDir, ref);
    const roots = [this.realAppDir, ...this.sharedRoots];
    const root = roots.find((dir) => isInside2(dir, path3));
    if (!root || root === this.realAppDir && ref.split("/").includes("..")) {
      this.fail("asset_path", `${where}: asset ref escapes the app: ${ref}`);
    }
    let st;
    try {
      st = await lstat2(path3);
    } catch {
      this.fail("asset_missing", `${where}: asset not found: ${ref}`);
    }
    if (st.isSymbolicLink()) this.fail("asset_symlink", `${where}: asset is a symlink: ${ref}`);
    if (!st.isFile()) this.fail("asset_not_file", `${where}: asset is not a regular file: ${ref}`);
    const real = await realpath2(path3);
    if (!root || !isInside2(root, real)) {
      this.fail("asset_path", `${where}: asset resolves outside the app: ${ref}`);
    }
    if (st.size > this.limits.maxAssetBytes) {
      this.fail(
        "asset_too_large",
        `${where}: asset ${ref} is ${st.size} bytes (cap ${this.limits.maxAssetBytes})`
      );
    }
    const bytes = new Uint8Array(await readFile2(real));
    if (bytes.length > this.limits.maxAssetBytes) {
      this.fail("asset_too_large", `${where}: asset ${ref} exceeds ${this.limits.maxAssetBytes}`);
    }
    this.total += bytes.length;
    if (this.total > this.limits.maxAppAssetBytes) {
      this.fail(
        "asset_total_too_large",
        `inlined assets exceed ${this.limits.maxAppAssetBytes} bytes at ${where}`
      );
    }
    return `data:${mime};base64,${base64(bytes)}`;
  }
  async image(img, where) {
    if (!img || typeof img !== "object") return img;
    const out = { ...img };
    if (typeof out.svg === "string") out.svg = await this.ref(out.svg, `${where}.svg`);
    if (typeof out.url === "string") out.url = await this.ref(out.url, `${where}.url`);
    if (out.sizes && typeof out.sizes === "object") {
      const sizes = {};
      for (const [k, v] of Object.entries(out.sizes)) {
        sizes[k] = typeof v === "string" ? await this.ref(v, `${where}.sizes.${k}`) : v;
      }
      out.sizes = sizes;
    }
    return out;
  }
};
async function inlineAssets(manifest, realAppDir, appDir, limits, sharedRoots = []) {
  const inl = new Inliner(realAppDir, appDir, limits, sharedRoots);
  const out = structuredClone(manifest);
  delete out.assetsRoot;
  const ap = out.appearance;
  if (ap) {
    if (ap.icon) ap.icon = await inl.image(ap.icon, "appearance.icon");
    if (ap.darkMode?.icon) {
      ap.darkMode.icon = await inl.image(ap.darkMode.icon, "appearance.darkMode.icon");
    }
  }
  if (Array.isArray(out.screenshots)) {
    for (let i = 0; i < out.screenshots.length; i++) {
      out.screenshots[i] = await inl.image(out.screenshots[i], `screenshots[${i}]`);
    }
  }
  return out;
}

// ../../core/packages/app-build/src/shared.ts
async function resolveSharedRoots2(appDir) {
  try {
    return await resolveSharedRoots(appDir);
  } catch (error) {
    if (error instanceof LoadError) throw new BuildError(error.code, error.message, appDir);
    throw error;
  }
}

// ../../core/packages/app-build/src/source-digest.ts
var { readdir, readFile: readFile3, realpath: realpath3 } = fs2;
var { join } = path2;
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "tests"]);
var SKIP_ANY = /* @__PURE__ */ new Set(["node_modules"]);
async function walk2(dir, rel, out, appDir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (SKIP_ANY.has(entry.name)) continue;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      throw new BuildError("source_symlink", `symlink in app source tree: ${relPath}`, appDir);
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk2(full, relPath, out, appDir);
    } else if (entry.isFile()) {
      if (isTestPath(relPath)) continue;
      out.push({ path: relPath, bytes: new Uint8Array(await readFile3(full)) });
    } else {
      throw new BuildError("source_special_file", `not a regular file: ${relPath}`, appDir);
    }
  }
}
async function computeSourceDigest(appDir) {
  let real;
  try {
    real = await realpath3(appDir);
  } catch (e) {
    throw new BuildError(
      "app_dir_invalid",
      `cannot resolve app dir: ${e.message}`,
      appDir
    );
  }
  const files = [];
  const sharedRoots = await resolveSharedRoots2(real);
  await walk2(real, sharedRoots.length ? "app" : "", files, appDir);
  for (const [i, root] of sharedRoots.entries()) {
    await walk2(root, `shared/${i}`, files, appDir);
  }
  return await sourceDigestOf(files);
}

// ../../core/packages/app-build/deno.json
var deno_default = {
  name: "@w6w/app-build",
  version: "0.2.0",
  license: "MIT",
  exports: {
    ".": "./mod.ts",
    "./cli": "./cli.ts",
    "./assemble": "./assemble.ts"
  },
  imports: {
    "@w6w/types": "../types/mod.ts",
    "@w6w/runtime": "../runtime/mod.ts",
    "@w6w/runtime/assemble": "../runtime/assemble.ts",
    "@w6w/validator": "../validator/mod.ts"
  },
  tasks: {
    build: "deno run -A --unstable-worker-options cli.ts",
    parity: "deno run -A --unstable-worker-options scripts/parity.ts"
  }
};

// ../../core/packages/app-build/src/package.ts
var { mkdir, readFile: readFile4, realpath: realpath4, rm, writeFile } = fs2;
var { join: join2, resolve: resolve4 } = path2;
var MAX_ASSET_BYTES = 262144;
var MAX_APP_ASSET_BYTES = 1048576;
var BUILDER = `@w6w/app-build@${deno_default.version}`;
function itemsOnNonArray(fields, prefix = "") {
  const bad = [];
  for (const f of fields) {
    if (f === null || typeof f !== "object") continue;
    const at = `${prefix}${f.key}`;
    if (f.items !== void 0 && f.type !== "array") bad.push(at);
    if (Array.isArray(f.items)) bad.push(...itemsOnNonArray(f.items, `${at}[].`));
  }
  return bad;
}
function outputWarnings(kind, entry, warnings, counts) {
  const at = `${kind}[${entry.key}]`;
  if (!Object.hasOwn(entry, "output") || entry.output === void 0) {
    warnings.push(`${at}: declares no output`);
    if (kind === "actions") counts.actionsWithoutOutput++;
    else counts.triggersWithoutOutput++;
    return;
  }
  if (!Array.isArray(entry.output)) return;
  const fields = entry.output;
  for (const k of itemsOnNonArray(fields)) {
    warnings.push(`${at}: output field "${k}" declares items but its type is not "array"`);
    counts.itemsOnNonArray++;
  }
  if (entry.sample === void 0) return;
  const diff = compareOutputShape(fields, observedShapeOfValue(entry.sample));
  const missing = diff.missing.filter((m) => !diff.missing.some((o) => o.startsWith(`${m}.`)));
  const parts = [];
  if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
  if (diff.typeMismatch.length > 0) {
    parts.push(
      "type mismatch " + diff.typeMismatch.map((t) => `${t.key} (declared ${t.declared}, sample ${t.observed})`).join(", ")
    );
  }
  if (parts.length > 0) {
    warnings.push(`${at}: sample does not match output: ${parts.join("; ")}`);
    counts.sampleMismatches++;
  }
}
var ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
var VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;
async function readAppIdentity(appDir) {
  const fail = (code, msg) => {
    throw new BuildError(code, msg, appDir);
  };
  let realAppDir;
  try {
    realAppDir = await realpath4(appDir);
  } catch (e) {
    return fail("app_dir_invalid", `cannot resolve app dir: ${e.message}`);
  }
  let pkg;
  try {
    pkg = JSON.parse(await readFile4(join2(realAppDir, "package.json"), "utf8"));
  } catch (e) {
    return fail("invalid_package", `cannot read package.json: ${e.message}`);
  }
  if (pkg === null || typeof pkg !== "object") {
    fail("invalid_package", "package.json is not an object");
  }
  if (pkg.w6w?.manifest !== void 0) {
    fail("manifest_file_forbidden", "`w6w.manifest` (a standalone manifest file) is not buildable");
  }
  let manifest;
  try {
    manifest = manifestFromPackageJson(pkg);
  } catch (e) {
    if (e instanceof LoadError) return fail("invalid_manifest", e.message);
    throw e;
  }
  const { id, version } = manifest;
  if (typeof id !== "string" || !ID_RE.test(id)) fail("invalid_id", `invalid app id: ${id}`);
  if (typeof version !== "string" || !VERSION_RE.test(version) || version.includes("..")) {
    fail("invalid_version", `invalid app version: ${version}`);
  }
  return { realAppDir, pkg, manifest, id, version };
}
async function packageBuiltApp(input) {
  const { appDir, identity, js, map, buildInfo } = input;
  const { realAppDir, manifest, id, version } = identity;
  const fail = (code2, msg) => {
    throw new BuildError(code2, msg, appDir);
  };
  const code = new TextDecoder("utf-8", { fatal: true }).decode(js);
  let described;
  try {
    described = await input.describeCode(code);
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (/unstable-worker-options|worker.*permission/i.test(msg)) {
      return fail("worker_options_required", `run with --unstable-worker-options: ${msg}`);
    }
    return fail("describe_failed", `describing the bundle failed: ${msg}`);
  }
  const warnings = [...input.warnings ?? []];
  const counts = {
    actionsWithoutOutput: 0,
    triggersWithoutOutput: 0,
    sampleMismatches: 0,
    itemsOnNonArray: 0
  };
  const wiringErrors = [];
  for (const a of described.actions) {
    const at = `actions[${a.key}]`;
    const found = checkFormResolvedFields(a, at);
    for (const e of found.errors) wiringErrors.push(`${e.path}: ${e.message}`);
    for (const w of found.warnings) warnings.push(`${w.path}: ${w.message}`);
    outputWarnings("actions", a, warnings, counts);
  }
  for (const t of described.triggers) {
    outputWarnings("triggers", t.trigger, warnings, counts);
  }
  if (wiringErrors.length > 0) {
    return fail("fields_hook_invalid", wiringErrors.join("; "));
  }
  const inlined = await inlineAssets(manifest, realAppDir, appDir, {
    maxAssetBytes: input.maxAssetBytes ?? MAX_ASSET_BYTES,
    maxAppAssetBytes: input.maxAppAssetBytes ?? MAX_APP_ASSET_BYTES
  }, input.sharedRoots);
  const sourceDigest = await computeSourceDigest(realAppDir);
  const execSha256 = await sha256HexBytes(js);
  const artifact = {
    artifactVersion: 1,
    id,
    version,
    manifest: inlined,
    actions: described.actions,
    auth: described.auth,
    healthChecks: described.healthChecks,
    triggers: described.triggers,
    interfaces: described.interfaces,
    exec: { sha256: execSha256, bytes: js.length, format: "esm" },
    sourceDigest,
    buildInfo
  };
  let mapBytes;
  if (map !== void 0) {
    mapBytes = new TextEncoder().encode(map);
    artifact.map = { sha256: await sha256HexBytes(mapBytes), bytes: mapBytes.length };
  }
  let loaded;
  try {
    loaded = await loadedAppFromArtifact(artifact, code);
  } catch (e) {
    if (e instanceof LoadError) return fail("load_failed", e.message);
    throw e;
  }
  const d = describe(loaded);
  const { digest, digestVersion } = await digestDescriptionVersioned({
    manifest: d.app,
    actions: d.actions,
    auth: d.auth,
    triggers: d.triggers,
    health: d.health.filter((h) => !h.key.startsWith("auth:")),
    interfaces: d.interfaces,
    exec: execSha256
  });
  const manifestText = JSON.stringify(artifact, null, 2) + "\n";
  const parsed = parseAppArtifactManifest(JSON.parse(manifestText));
  if (!parsed.ok) {
    fail("artifact_invalid", `manifest.json does not parse: ${parsed.errors.join("; ")}`);
  }
  const outDir = join2(resolve4(input.outRoot), id, version);
  try {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    await writeFile(join2(outDir, "app.js"), js);
    if (mapBytes) await writeFile(join2(outDir, "app.js.map"), mapBytes);
    await writeFile(join2(outDir, "manifest.json"), manifestText);
  } catch (e) {
    return fail("write_failed", `cannot write ${outDir}: ${e.message}`);
  }
  const result = {
    id,
    version,
    execSha256,
    digest,
    digestVersion,
    sourceDigest,
    outDir
  };
  if (warnings.length > 0) result.warnings = warnings;
  if (Object.values(counts).some((n) => n > 0)) result.outputWarnings = counts;
  return result;
}
async function readBackManifest(outDir, parse) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile4(join2(outDir, "manifest.json"), "utf8"));
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_manifest",
          message: `cannot read back the built manifest: ${e.message}`
        }
      ]
    };
  }
  const parsed = parse(manifest);
  if (!parsed.ok) {
    return { ok: false, errors: [{ code: "invalid_manifest", message: parsed.errors.join("; ") }] };
  }
  return { ok: true, id: parsed.value.id, version: parsed.value.version };
}

// ../../core/packages/app-build/src/self-contained.ts
var REGEX_AFTER_WORD = /* @__PURE__ */ new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await"
]);
var isIdStart = (c) => /[A-Za-z_$\u0080-￿]/.test(c);
var isIdPart = (c) => /[A-Za-z0-9_$\u0080-￿\\]/.test(c);
function tokens(src) {
  const out = [];
  const braces = [];
  let i = 0;
  const n = src.length;
  const regexAllowed = () => {
    const last = out[out.length - 1];
    if (last === void 0) return true;
    if (last.t === "str") return false;
    if (last.t === "word") return REGEX_AFTER_WORD.has(last.v) && !last.dotBefore;
    return !(last.v === ")" || last.v === "]" || last.v === "}");
  };
  const template = () => {
    while (i < n) {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        out.push({ t: "str" });
        return;
      }
      if (c === "$" && src[i + 1] === "{") {
        i += 2;
        braces.push(true);
        out.push({ t: "punct", v: "${" });
        return;
      }
      i++;
    }
  };
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "	" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      out.push({ t: "str" });
      continue;
    }
    if (c === "`") {
      i++;
      template();
      continue;
    }
    if (c === "/" && regexAllowed()) {
      i++;
      let inClass = false;
      while (i < n) {
        const r = src[i];
        if (r === "\\") {
          i += 2;
          continue;
        }
        if (r === "\n") break;
        if (inClass) {
          if (r === "]") inClass = false;
        } else if (r === "[") inClass = true;
        else if (r === "/") break;
        i++;
      }
      i++;
      while (i < n && isIdPart(src[i])) i++;
      out.push({ t: "str" });
      continue;
    }
    if (isIdStart(c)) {
      const start = i;
      while (i < n && isIdPart(src[i])) i++;
      const prev = out[out.length - 1];
      out.push({
        t: "word",
        v: src.slice(start, i),
        dotBefore: prev?.t === "punct" && (prev.v === "." || prev.v === "?.")
      });
      continue;
    }
    if (c >= "0" && c <= "9") {
      while (i < n && /[0-9A-Za-z_.]/.test(src[i])) i++;
      out.push({ t: "word", v: "0", dotBefore: false });
      continue;
    }
    if (c === "{") {
      braces.push(false);
      out.push({ t: "punct", v: "{" });
      i++;
      continue;
    }
    if (c === "}") {
      i++;
      if (braces.pop() === true) {
        template();
        continue;
      }
      out.push({ t: "punct", v: "}" });
      continue;
    }
    if (c === "?" && src[i + 1] === ".") {
      out.push({ t: "punct", v: "?." });
      i += 2;
      continue;
    }
    if (c === "." && src[i + 1] === "." && src[i + 2] === ".") {
      out.push({ t: "punct", v: "..." });
      i += 3;
      continue;
    }
    out.push({ t: "punct", v: c });
    i++;
  }
  return out;
}
function startsWithImport(toks, k) {
  for (let j = k - 1; j >= 0; j--) {
    const t = toks[j];
    if (t.t === "punct" && t.v === ";") return false;
    if (t.t === "word" && !t.dotBefore && (t.v === "import" || t.v === "export")) {
      return t.v === "import";
    }
  }
  return false;
}
function moduleImports(src) {
  const toks = tokens(src);
  const found = /* @__PURE__ */ new Set();
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    if (tok.t !== "word" || tok.dotBefore) continue;
    const next = toks[k + 1];
    if (tok.v === "import") {
      if (next?.t === "punct" && (next.v === "." || next.v === ":")) continue;
      found.add(next?.t === "punct" && next.v === "(" ? "dynamic import()" : "static import");
      continue;
    }
    if (tok.v === "from" && next?.t === "str") {
      const prev = toks[k - 1];
      if (prev !== void 0 && (prev.t === "punct" && (prev.v === "}" || prev.v === "*") || prev.t === "word") && !startsWithImport(toks, k)) {
        found.add("export \u2026 from");
      }
    }
  }
  return [...found];
}

// ../../core/packages/app-build/assemble.ts
var { mkdtemp, readFile: readFile5, realpath: realpath5, rm: rm2 } = fs2;
var { tmpdir } = os;
var { dirname: dirname2, isAbsolute: isAbsolute3, join: join3, relative: relative2, resolve: resolve5 } = path2;
var DESCRIBE_TIMEOUT_MS = 3e4;
var DESCRIBE_MEMORY_MB = 1024;
var SOURCE_MAPPING_URL = /(?:^|\r?\n)[ \t]*\/\/[#@][ \t]*sourceMappingURL=([^\s'"]+)[ \t]*\s*$/;
var posix = (p) => p.split("\\").join("/");
function runtimeVersion() {
  const g = globalThis;
  const deno = g.Deno?.version?.deno;
  if (deno) return { denoVersion: deno };
  return { nodeVersion: g.process?.versions?.node ?? "unknown" };
}
async function readSourceMap(mapPath, realAppDir, appDir) {
  let map;
  try {
    map = JSON.parse(await readFile5(mapPath, "utf8"));
  } catch (e) {
    throw new BuildError(
      "sourcemap_invalid",
      `cannot read source map ${posix(relative2(realAppDir, mapPath))}: ${e.message}`,
      appDir
    );
  }
  if (map === null || typeof map !== "object" || Array.isArray(map)) {
    throw new BuildError("sourcemap_invalid", "source map is not a JSON object", appDir);
  }
  if (!Array.isArray(map.sources) || !map.sources.every((s) => typeof s === "string")) {
    throw new BuildError("sourcemap_invalid", "source map has no string `sources`", appDir);
  }
  const root = typeof map.sourceRoot === "string" ? map.sourceRoot : "";
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(root)) {
    return JSON.stringify(map);
  }
  const base = resolve5(dirname2(mapPath), root);
  map.sources = map.sources.map(
    (s) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(s) && !/^[A-Za-z]:[\\/]/.test(s) ? s : posix(relative2(realAppDir, isAbsolute3(s) ? s : resolve5(base, s)))
  );
  delete map.sourceRoot;
  return JSON.stringify(map);
}
async function localFile(root, path3) {
  if (!isInside2(root, path3)) return null;
  try {
    const real = await realpath5(path3);
    return isInside2(root, real) ? real : null;
  } catch {
    return null;
  }
}
async function assembleApp(appDir, outRoot, opts = {}) {
  const fail = (code2, msg) => {
    throw new BuildError(code2, msg, appDir);
  };
  const identity = await readAppIdentity(appDir);
  const { realAppDir, pkg } = identity;
  const declared = pkg.w6w?.entry ?? pkg.main ?? "./index.ts";
  const entryAbs = resolveAppEntry(realAppDir, pkg);
  if (!/\.m?js$/i.test(entryAbs)) {
    fail(
      "entry_not_js",
      `entry ${declared} is not JavaScript: build your app first (TypeScript \u2192 one ESM .js file) and point \`w6w.entry\` at the built file, e.g. \`dist/app.js\``
    );
  }
  if (!isInside2(realAppDir, entryAbs)) {
    fail("entry_outside_app", `entry escapes the app: ${entryAbs}`);
  }
  let entryReal;
  try {
    entryReal = await realpath5(entryAbs);
  } catch {
    return fail("entry_missing", `entry module not found: ${declared} (did you build the app?)`);
  }
  if (!isInside2(realAppDir, entryReal)) fail("entry_outside_app", `entry resolves outside the app`);
  const sharedRoots = await resolveSharedRoots2(realAppDir);
  let code;
  try {
    code = new TextDecoder("utf-8", { fatal: true }).decode(await readFile5(entryReal));
  } catch (e) {
    return fail("entry_not_utf8", `cannot read ${declared} as UTF-8: ${e.message}`);
  }
  const imports = moduleImports(code);
  if (imports.length > 0) {
    fail(
      "bundle_not_self_contained",
      `${declared} is not one self-contained module (found: ${imports.join(", ")}); bundle every dependency into it`
    );
  }
  const warnings = [];
  let mapPath = null;
  const comment = SOURCE_MAPPING_URL.exec(code);
  if (comment !== null && !comment[1].startsWith("data:")) {
    const ref = comment[1];
    code = code.slice(0, comment.index) + (/^\r?\n/.exec(comment[0])?.[0] ?? "");
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref) && !isAbsolute3(ref)) {
      let decoded = ref;
      try {
        decoded = decodeURIComponent(ref);
      } catch {
      }
      mapPath = await localFile(realAppDir, resolve5(dirname2(entryReal), decoded));
    }
    if (mapPath === null) {
      warnings.push(`${declared}: sourceMappingURL ${ref} names no source map in the app; removed`);
    }
  }
  const map = mapPath === null ? void 0 : await readSourceMap(mapPath, realAppDir, appDir);
  const buildInfo = {
    builder: BUILDER,
    ...runtimeVersion(),
    minify: false,
    sourcemap: map !== void 0
  };
  return await packageBuiltApp({
    appDir,
    identity,
    sharedRoots,
    js: new TextEncoder().encode(code),
    map,
    buildInfo,
    describeCode: (c) => describeExecNode(dataUrl(c), DESCRIBE_TIMEOUT_MS, DESCRIBE_MEMORY_MB),
    outRoot,
    maxAssetBytes: opts.maxAssetBytes,
    maxAppAssetBytes: opts.maxAppAssetBytes,
    warnings
  });
}
function dataUrl(code) {
  const bytes = new TextEncoder().encode(code);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return `data:text/javascript;base64,${btoa(bin)}`;
}
async function validateAssembled(appDir, opts = {}) {
  const outRoot = await mkdtemp(join3(tmpdir(), "w6w-app-validate-"));
  try {
    let outDir;
    try {
      outDir = (await assembleApp(appDir, outRoot, opts)).outDir;
    } catch (e) {
      if (!(e instanceof BuildError)) throw e;
      return { ok: false, errors: [{ code: e.code, message: e.message }] };
    }
    return await readBackManifest(outDir, parseAppArtifactManifest);
  } finally {
    await rm2(outRoot, { recursive: true, force: true }).catch(() => {
    });
  }
}
export {
  BuildError,
  MAX_APP_ASSET_BYTES,
  MAX_ASSET_BYTES,
  assembleApp,
  validateAssembled
};
