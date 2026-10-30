#!/usr/bin/env node
// Opt-in live round trip for the data-stores surface: node, cli and python, each against its own
// store, on a real w6w server. NOT run by CI. Needs both W6W_BASE_URL and W6W_TOKEN in the env
// (the token reaches the cli and python legs through env only and is never printed).
//
//   W6W_BASE_URL=<origin> W6W_TOKEN=<token> node scripts/live-roundtrip.mjs
//
// Needs node/dist and cli/dist built (npm run build in each). Exits 0 only if all three legs pass.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = (process.env.W6W_BASE_URL ?? "").trim();
const token = (process.env.W6W_TOKEN ?? "").trim();
if (!baseUrl || !token) {
  console.error("live-roundtrip: not configured: set W6W_BASE_URL and W6W_TOKEN");
  process.exit(2);
}

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const NODE_DIST = pathToFileURL(here("../node/dist/mod.js")).href;
const CLI_BIN = here("../cli/dist/bin/w6w.js");
const PY_SRC = here("../python/src");

const SCHEMA = { columns: [{ name: "title", type: "string", required: true }, { name: "n", type: "integer", required: false }] };
const CSV = "title,n\nbeta,2\ngamma,3\n";
const stamp = Date.now();
const storeName = (lane) => `live_rt_${lane}_${stamp}`; // ^[A-Za-z_][A-Za-z0-9_]{0,63}$

const redact = (text) => String(text ?? "").split(token).join("[token]");
const fail = (step, detail) => ({ ok: false, step, detail: redact(detail) });
const PASS = { ok: true };

class Step extends Error {
  constructor(step, detail) {
    super(detail);
    this.step = step;
  }
}
function expect(step, cond, detail = "unexpected result") {
  if (!cond) throw new Step(step, detail);
}

// ---- node leg ----------------------------------------------------------------------------------
async function nodeLeg() {
  let step = "import";
  let id = null;
  let client = null;
  try {
    const mod = await import(NODE_DIST);
    client = new mod.W6WClient({ baseUrl, token });
    step = "create";
    const store = await client.dataStores.create({ kind: "table", name: storeName("node"), schema: SCHEMA });
    id = store.id;
    expect(step, typeof id === "string" && id.length > 0, "no id");
    step = "set";
    const set = await client.dataStores.entries.set(id, "k1", { value: { title: "alpha", n: 1 } });
    step = "get";
    const got = await client.dataStores.entries.get(id, "k1");
    expect(step, got.value?.title === "alpha", "value differs");
    step = "list";
    const page = await client.dataStores.entries.list(id, {});
    expect(step, page.items.some((e) => e.key === "k1"), "k1 not listed");
    step = "delete";
    await client.dataStores.entries.delete(id, "k1");
    step = "csv-import";
    const imp = await client.dataStores.importCsv(id, CSV);
    expect(step, imp.imported === 2, `imported ${imp.imported}`);
    step = "csv-export";
    const text = await client.dataStores.exportCsv(id);
    expect(step, typeof text === "string" && text.includes("beta"), "export lacks beta");
    step = "stale-if-version";
    await client.dataStores.entries.set(id, "k2", { value: { title: "v1" } });
    let status = 0;
    try {
      await client.dataStores.entries.set(id, "k2", { value: { title: "v2" }, ifVersion: (set.version ?? 1) + 100 });
    } catch (err) {
      status = err?.status ?? 0;
    }
    expect(step, status === 409, `status ${status}`);
    return PASS;
  } catch (err) {
    return fail(err instanceof Step ? err.step : step, err instanceof Step ? err.message : err?.message ?? err);
  } finally {
    if (id && client) {
      try {
        await client.dataStores.archive(id);
      } catch {
        /* the verdict is already decided; a failed archive leaves a live_rt_ store to remove by hand */
      }
    }
  }
}

// ---- cli leg -----------------------------------------------------------------------------------
function cliLeg() {
  const dir = mkdtempSync(join(tmpdir(), "live-rt-cli-"));
  const env = { ...process.env, W6W_BASE_URL: baseUrl, W6W_TOKEN: token, HOME: dir, XDG_CONFIG_HOME: join(dir, "cfg") };
  const run = (args) => {
    const r = spawnSync(process.execPath, [CLI_BIN, ...args, "--json"], { env, encoding: "utf8", timeout: 60_000 });
    return { code: r.status ?? 1, out: r.stdout ?? "", err: `${r.stderr ?? ""}${r.error ? ` ${r.error.message}` : ""}` };
  };
  let step = "create";
  let id = null;
  try {
    const must = (name, args) => {
      step = name;
      const r = run(args);
      if (r.code !== 0) throw new Step(name, `exit ${r.code}: ${r.err}`);
      return r.out;
    };
    const created = JSON.parse(must("create", ["data-stores", "create", storeName("cli"), "--kind", "table", "--schema", JSON.stringify(SCHEMA)]));
    id = created.id;
    expect("create", typeof id === "string" && id.length > 0, "no id");
    must("set", ["data-stores", "entry-set", id, "k1", "--value", JSON.stringify({ title: "alpha", n: 1 })]);
    const got = JSON.parse(must("get", ["data-stores", "entry-get", id, "k1"]));
    expect("get", got.value?.title === "alpha", "value differs");
    const page = JSON.parse(must("list", ["data-stores", "entry-list", id]));
    expect("list", (page.items ?? []).some((e) => e.key === "k1"), "k1 not listed");
    must("delete", ["data-stores", "entry-delete", id, "k1"]);
    const csvPath = join(dir, "rows.csv");
    writeFileSync(csvPath, CSV);
    const imp = JSON.parse(must("csv-import", ["data-stores", "import", id, "--file", csvPath]));
    expect("csv-import", imp.imported === 2, `imported ${imp.imported}`);
    const exp = must("csv-export", ["data-stores", "export", id]);
    expect("csv-export", exp.includes("beta"), "export lacks beta");
    must("stale-if-version", ["data-stores", "entry-set", id, "k2", "--value", JSON.stringify({ title: "v1" })]);
    step = "stale-if-version";
    const stale = run(["data-stores", "entry-set", id, "k2", "--value", JSON.stringify({ title: "v2" }), "--if-version", "999"]);
    expect(step, stale.code !== 0 && /409|version_conflict/.test(`${stale.out}${stale.err}`), `exit ${stale.code}: ${stale.err}`);
    return PASS;
  } catch (err) {
    return fail(err instanceof Step ? err.step : step, err instanceof Step ? err.message : err?.message ?? err);
  } finally {
    if (id) run(["data-stores", "archive", id]);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- python leg --------------------------------------------------------------------------------
const PY_PROGRAM = `
import os, sys
import w6w
c = w6w.Client(base_url=os.environ["W6W_BASE_URL"], token=os.environ["W6W_TOKEN"])
name = os.environ["LIVE_RT_STORE"]
schema = {"columns": [{"name": "title", "type": "string", "required": True}, {"name": "n", "type": "integer", "required": False}]}
csv = "title,n\\nbeta,2\\ngamma,3\\n"
step = "create"
sid = None
def need(ok, what):
    if not ok:
        print("FAIL " + step + ": " + what)
        sys.exit(1)
try:
    store = c.data_stores.create("table", name, schema=schema)
    sid = store["id"] if isinstance(store, dict) else store.id
    get = lambda o, k: o[k] if isinstance(o, dict) else getattr(o, k)
    step = "set"
    first = c.data_stores.entries.set(sid, "k1", {"title": "alpha", "n": 1})
    step = "get"
    got = c.data_stores.entries.get(sid, "k1")
    need(get(got, "value")["title"] == "alpha", "value differs")
    step = "list"
    page = c.data_stores.entries.list(sid)
    items = get(page, "items")
    need(any(get(e, "key") == "k1" for e in items), "k1 not listed")
    step = "delete"
    c.data_stores.entries.delete(sid, "k1")
    step = "csv-import"
    imp = c.data_stores.import_csv(sid, csv)
    need(get(imp, "imported") == 2, "imported " + str(get(imp, "imported")))
    step = "csv-export"
    text = c.data_stores.export_csv(sid)
    need(isinstance(text, str) and "beta" in text, "export lacks beta")
    step = "stale-if-version"
    c.data_stores.entries.set(sid, "k2", {"title": "v1"})
    status = 0
    try:
        c.data_stores.entries.set(sid, "k2", {"title": "v2"}, if_version=999)
    except w6w.ApiError as e:
        status = e.status
    need(status == 409, "status " + str(status))
    print("PASS")
except SystemExit:
    raise
except Exception as e:
    print("FAIL " + step + ": " + type(e).__name__ + " " + str(e))
    sys.exit(1)
finally:
    if sid is not None:
        try:
            c.data_stores.archive(sid)
        except Exception:
            pass
`;

function pythonLeg() {
  const env = {
    ...process.env,
    W6W_BASE_URL: baseUrl,
    W6W_TOKEN: token,
    LIVE_RT_STORE: storeName("python"),
    PYTHONPATH: PY_SRC,
  };
  const r = spawnSync("python3", ["-c", PY_PROGRAM], { env, encoding: "utf8", timeout: 90_000 });
  if (r.error) return fail("spawn", r.error.message);
  const line = (r.stdout ?? "").trim().split("\n").pop() ?? "";
  if (r.status === 0 && line === "PASS") return PASS;
  const m = /^FAIL ([\w-]+): (.*)$/.exec(line);
  return fail(m ? m[1] : "run", m ? m[2] : `${r.stderr ?? ""}`.trim().split("\n").pop());
}

// ---- main --------------------------------------------------------------------------------------
const results = [];
for (const [lane, leg] of [["node", nodeLeg], ["cli", cliLeg], ["python", pythonLeg]]) {
  let res;
  try {
    res = await leg();
  } catch (err) {
    res = fail("run", err?.message ?? err);
  }
  results.push(res);
  console.log(res.ok ? `${lane}: PASS` : `${lane}: FAIL ${res.step}`);
  if (!res.ok && res.detail) console.error(`  ${lane}: ${String(res.detail).slice(0, 300)}`);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
