# PLANNER.md — read this first when planning work in `w6w-wrappers`

> **verified: 2026-10-06** — This guide records checked source locations, not a
> replacement for them. When this guide and the code disagree, **code wins**;
> correct this guide in the same change.

## Where work happens

- **verified: 2026-10-06** — `node/`, `cli/`, and `python/` are contract lanes;
  they implement `endpoints.json` directly. `react/` is a derived lane that
  composes node's client instead. See `docs/parity.md:33-59`.
- **verified: 2026-10-06** — `endpoints.json` and `VERSION` are shared at the
  repository root and are resolved as sibling files by the lanes' tests. See
  `docs/parity.md:72-80`.
- **verified: 2026-10-06** — `docs/manifest.json` is the public-doc allow-list;
  consult the relevant file below before changing a published document. See
  `docs/README.md:1-6`.

## Which doc to read

| Your task touches…                                          | Read                                         | Evidence                                                    |
| ----------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| endpoint coverage, lane parity, or a derived-lane exception | `docs/parity.md`, especially **Conformance** | **verified: 2026-10-06** — `docs/parity.md:31-59`           |
| how a contract name is resolved by a client or CLI runner   | `docs/implementation.md` §10                 | **verified: 2026-10-06** — `docs/implementation.md:892-945` |
| release order, version bumps, or CI gates                   | `docs/release.md`                            | **verified: 2026-10-06** — `docs/release.md:124-158`        |
| public docs or publication eligibility                      | `docs/README.md` and `docs/manifest.json`    | **verified: 2026-10-06** — `docs/README.md:1-6`             |

## Four things that bite people who skip this

1. **React must test the sibling SDK build, in this order.**

   **verified: 2026-10-06** — Build `node/` first with
   `npm install && npm run build`, then in `react/` run
   `npm install --no-save ../node && npm install` before `npm test`. The release
   workflow specifies that order at `.github/workflows/release.yml:146-161`; the
   network installs were not re-run here.

   **verified: 2026-10-06** — Do not use `npm ci` in `react/`:
   `package-lock.json` is ignored (`react/.gitignore:7-10`) and was absent in
   this lane (`test ! -f react/package-lock.json` → success, run 2026-10-06).
   The release guidance also says the npm jobs use `npm install`, not `npm ci`
   (`docs/release.md:194-202`).

2. **React's Node 22 test invocation needs the strip-types flag.**

   **verified: 2026-10-06** — This lane reported `node --version` → `v22.16.0`;
   invoke its test command as
   `NODE_OPTIONS=--experimental-strip-types npm test`. The package's `test`
   script passes a `*.test.ts` glob to Node (`react/package.json:36-40`), so
   keep the flag at invocation time rather than assuming the script supplies it.
   The suite was not re-run here.

3. **Conformance belongs to each contract lane, but React has a different
   guard.**

   **verified: 2026-10-06** — Run node's `node/tests/conformance_test.ts`
   through `deno task test`, python's `python/tests/test_surface.py` through
   `PYTHONPATH=src python3 -m unittest discover -s tests -t .`, and cli through
   `deno task test`. CI names those exact lane commands at
   `.github/workflows/release.yml:123-135`, while `docs/release.md:150-158`
   identifies the embedded runners.

   **verified: 2026-10-06** — React is exempt from `endpoints.json` conformance
   because it is a derived lane (`docs/parity.md:48-59`), but its own
   `ui-conformance.test.ts` runs the type-only `ui-conformance.check.ts` through
   TypeScript (`react/src/__tests__/ui-conformance.test.ts:1-23`).

4. **`VERSION` moves as a lockstep release fact.**

   **verified: 2026-10-06** — Update node and cli `package.json` + `deno.json`,
   then Python's `pyproject.toml` + `src/w6w/_version.py`, with the React
   manifest/source copy in the same release change; `docs/release.md:128-148`
   lists the guarded files. The workflow compares those values against `VERSION`
   at `.github/workflows/release.yml:48-105`, and the local guards include
   `node/tests/version_test.ts:1-71`, `cli/tests/help_test.ts:299-317`,
   `python/tests/test_version.py:1-102`, and
   `react/src/__tests__/version.test.ts:22-49`.

## Gate baselines

- **verified: 2026-10-06** — The release test job runs Python's unittest command
  and `deno task
  test` in node and cli
  (`.github/workflows/release.yml:123-135`). Those suites include the contract
  conformance and version guards (`docs/release.md:150-158`).
- **verified: 2026-10-06** — React's CI setup builds the sibling SDK, installs
  it locally, then runs `npm test` (`.github/workflows/release.yml:146-161`).
  Use the Node 22 invocation above when reproducing it in this lane.

## Maintenance

- **verified: 2026-10-06** — Re-check every cited command and `file:line` after
  changing the corresponding source; this guide is intentionally subordinate to
  code.
- **verified: 2026-10-06** — Keep the routing table and the four traps in sync
  with the release workflow, `docs/parity.md`, `docs/implementation.md`, and
  `docs/release.md` named above.
