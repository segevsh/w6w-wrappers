# PLANNER.md — read this first when planning work in `w6w-wrappers`

> **verified: 2026-10-13** (wrappers@e637745) — This guide records checked source locations, not a
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
| a `console.*` (`@w6w/sdk/console`) type or route            | `node/docs/console.md`, then trap 6 below    | **verified: 2026-10-13** — `node/src/console/mod.ts` header |

## Things that bite people who skip this

1. **React must test the sibling SDK build, in this order.**

   **verified: 2026-10-06** — Build `node/` first with
   `npm install && npm run build`, then in `react/` run
   `npm install --no-save ../node && npm install` before `npm test`. The release
   workflow specifies that order at `.github/workflows/release.yml:146-161`; the
   network installs were not re-run here.

   **verified: 2026-10-12** — `react/package-lock.json` is committed (as are
   `node/`'s and `cli/`'s). In `react/` and `cli/` it records `@w6w/sdk` as a
   link to `../node`, so a clean `npm ci` or `npm install` there needs no
   registry copy of the SDK; `cli`'s build then needs `node/dist`, so build
   `node/` first. The release workflow uses `npm ci` for `node/` and keeps
   `npm install` for the `cli`/`react` lanes (`docs/release.md`, npm jobs).

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

   **verified: 2026-10-07** — Also move `react/package.json`'s `@w6w/sdk` range to exactly `^` + `VERSION`:
   `react/src/__tests__/version.test.ts` requires it, and the `0.9.1` bump (`fce330b`) missed it, leaving the
   react suite at 43/1 until `0.9.2` (`26-10-06-09-self-host-bundle-hygiene`) fixed it (44/0). Also
   regenerate and commit the three lockfiles: after writing the manifests run `npm install` in `node/`, then `cli/`,
   then `react/` (`npm ci` passes on a stale lock, so the `package-lock.json` assertion in each lane's version
   test is the guard).

   **verified: 2026-10-13** — Each lane's `README.md` (`node`, `cli`, `python`, `react`) also states
   the version (`**Version:** \`0.9.5\``, or `Version: 0.9.5` in react). No version test reads a
   README, so update them by hand: the 0.9.4 (`b129865`) and 0.9.5 (`e637745`) bumps changed all four. `grep -ln README`
   over the four version tests → no match.

5. **An operation's `status` is what lanes render; `serverImplemented` is read by nothing.**

   **verified: 2026-10-07** — `cli/scripts/gen-help.ts` renders `status: "planned"` into
   `cli/src/help.generated.ts`, which `cli/tests/help_test.ts` byte-checks; so flipping an op to `required`
   means `cd cli && deno task gen:help` and committing the output. `serverImplemented` has no reader in any
   lane. The six `team.*` operations are `required`/`serverImplemented: true` as of `VERSION` 0.9.2.

6. **`console.*` is outside the contract, and React hand-copies some of its types.**

   **verified: 2026-10-13** — `@w6w/sdk/console` is kept out of `endpoints.json`'s
   `operations[]` and out of the root barrel (`node/src/console/mod.ts` header;
   `grep -c '"console' endpoints.json` → 0). A console field therefore needs no
   conformance change in cli/python, but it still ships under a lockstep `VERSION`
   bump (steps-metadata went to 0.9.4, `b129865`). It also needs a matching row in
   `node/docs/console.md`. The trap is that `react/src/adapter.ts` declares its own
   copy of the `invokeAction` return type and the `recordStepTestRun` body. The step
   `meta` added to `node/src/console/apps.ts` (`StepMeta`, `invokeAction`'s
   `meta?`) and `node/src/console/step-tests.ts` (`lastRunMeta`, run `meta`,
   `recordRun` body) is missing from both copies. React users get the field at
   runtime but not in the types (open followup F-6 of `26-10-12-00-steps-metadata`).
   When you add a console field, grep `react/src/adapter.ts` for the method too.

   **verified: 2026-10-13** — `console.tenantOAuthApps` has four methods: `list`, `put`, `remove`
   and `listCandidates` (`node/src/console/tenant-oauth-apps.ts`, `GET /tenant/oauth-apps/candidates`,
   keyset page `{ apps, nextCursor? }`, `nextCursor` absent on the last page). `listCandidates` is
   console-only: no `endpoints.json` row, so cli/python gained nothing but the `VERSION` bump to
   0.9.5 (`e637745`); its doc section is in `node/docs/console.md` (`## console.tenantOAuthApps.*`).

   **verified: 2026-10-13** — `26-10-13-01-oauth-client-setup` (wrappers@dac1698, `VERSION` 0.9.6
   @ `fdeb467`): the SDK never takes or builds a callback URL. `TenantOAuthApp`/`GlobalOAuthApp` put
   inputs have no `redirectUri`; the list response's top-level `callbackUrl` is gone and each entry
   (and config row) carries the server-derived `callbackUrl` instead; `OAuth2ClientSetup` (the app's
   `oauth2.setup` guidance) is exported from the `console` barrel (`node/src/console/apps.ts`,
   `tenant-oauth-apps.ts`, `node/docs/console.md`).

## Gate baselines

- **verified: 2026-10-06** — The release test job runs Python's unittest command
  and `deno task
  test` in node and cli
  (`.github/workflows/release.yml:123-135`). Those suites include the contract
  conformance and version guards (`docs/release.md:150-158`).
- **verified: 2026-10-13** — node `deno task test` → `ok | 514 passed | 0 failed`
  at the T3.1.1 merge of `26-10-12-00-steps-metadata` (`84f4b1e`; its eval G2).
  The later 0.9.4 bump touches only version strings and lockfiles.
- **verified: 2026-10-13** — node `deno task test` → `ok | 519 passed | 0 failed` at
  wrappers@e637745 (0.9.5, `listCandidates` added); `deno task check`, `lint` (83 files) and
  `fmt:check` (88 files) exit 0.
- **verified: 2026-10-13** — node `deno task test` → `ok | 522 passed | 0 failed` at the
  T3.1.1 merge of `26-10-13-01-oauth-client-setup` (`dac1698`, its G1).
- **verified: 2026-10-06** — React's CI setup builds the sibling SDK, installs
  it locally, then runs `npm test` (`.github/workflows/release.yml:146-161`).
  Use the Node 22 invocation above when reproducing it in this lane.

## Maintenance

- **verified: 2026-10-06** — Re-check every cited command and `file:line` after
  changing the corresponding source; this guide is intentionally subordinate to
  code.
- **verified: 2026-10-13** — Keep the routing table and the traps in sync
  with the release workflow, `docs/parity.md`, `docs/implementation.md`, and
  `docs/release.md` named above.
