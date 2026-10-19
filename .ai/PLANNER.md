# PLANNER.md — read this first when planning work in `w6w-wrappers`

> **verified: 2026-10-19** (26-10-18-01-fixes integration tip) — This guide records checked source locations, not a
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
| release order, version bumps, or CI gates                   | `docs/release.md`, `.github/workflows/ci.yml` | **verified: 2026-10-14** — `docs/release.md:124-158`; `.github/workflows/ci.yml` `on:` block |
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

   **verified: 2026-10-14** — React ALSO has runtime adapter conformance now
   (`react/src/__tests__/adapter-conformance.test.ts`): it reads the required/optional `W6WApi`
   member names from the installed `@w6w/ui` (pinned to the published `0.1.0` in
   `react/package.json` devDependencies: `"@w6w/ui": "0.1.0"`) and checks each is a function, forwards its arguments,
   and preserves server error bodies. Bump that version when the UI provider contract changes. The validating
   `toFlowWorkflow`/`fromFlowWorkflow` converter lives in `react/src/flow-workflow.ts` (no runtime
   `@w6w/ui` import). An embedding fixture + source-scan test (no `client.console`,
   `client.request`, handwritten lifecycle URLs, `as unknown as` workflow casts) lives under
   `react/src/__tests__/fixtures/` with its own `react/tsconfig.embed-fixture.json`.

   **verified: 2026-10-14** — contract `0.7.0` has **58** operations; `node/tests/conformance_test.ts`
   pins the count, so a contract op change must update that literal in the same commit.
   A plain `workflows.run` / `functions.run` executes the **stored** row as last saved; a publish is
   only a precondition (server `run-workflow.ts` / `bll/invoke-function.ts` gate on
   `currentPublishedVersion === null`). Only `runVersion(id, n)` executes a published snapshot —
   proven against a real server by `server/e2e/embed_sdk_e2e_test.ts`.

   **verified: 2026-10-14** — the account-scoped session minter is server-only and lives beside
   `exchangeToken`: Node `createEmbedSessionClient` (`node/src/server/mod.ts`, `./server` subpath,
   deliberately NOT in the root/console barrels) and Python `EmbedSessionClient`
   (`python/src/w6w/server.py`). Both require a non-blank `accountRef` (no silent default-account
   fallback; raw `exchangeToken` keeps its optional `account`). Python's blank check MUST use the
   ECMAScript `trim()` set (`JS_WS` in `server.py`), not `str.strip()` — `str.strip()` keeps
   U+FEFF, the server trims it, and a BOM-only ref silently lands on the default account.
   The tested host recipe is `node/examples/embed-host/{handler.ts,route.ts}`, exercised by
   `node/tests/embed_host_example_test.ts` (examples are outside `deno task check`'s inputs; the
   test file is what type-checks them). The exchange route (`POST /auth/exchange`) is NOT in
   `endpoints.json`, so the CLI lane has no command for it by design (`docs/parity.md`
   `## Server-only helpers`).

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

7. **Duplicate requests on load are shared, not avoided by callers.** `@w6w/react` shares one
   in-flight read per client and key (`react/src/single-flight.ts` `subscribe`, a WeakMap per client
   with refcounted abort), so StrictMode's double mount and two components reading the same list
   make one request. An aborted shared fetch must not surface as an error to the survivor. The
   SDK shares concurrent token-supplier calls per resolved config (`node/src/config.ts`
   `requireToken`/`inflightTokens`), so a host's non-memoized async `token` runs once per burst,
   not once per request. Connection reads carry `app?: ConnectionAppMeta | null`
   (`node/src/types.ts`, `python/src/w6w/types.py`), so render the icon from the row, never
   from a second catalog fetch. **verified: 2026-10-13** — wrappers@eb381a7 (0.9.7,
   `26-10-13-02-fixes`): `react` `npm test` 65 pass, pinned in `react/src/__tests__/provider.test.ts`.

8. **`ci.yml` is the PR/main gate; it never publishes.**

   **verified: 2026-10-14** — `.github/workflows/ci.yml` runs on `pull_request` and `push` to main (`on:` block) with
   `permissions: contents: read` and no publish step. Jobs: `lockstep`, `python`, `node`, `cli`,
   `react`. The `lockstep` job's `python3 - <<'PY'` heredoc compares **11** version literals against
   `VERSION` (the `found = {` dict: node/cli/react `package.json`, node/cli `deno.json`,
   `node/src/version.ts`, `cli/mod.ts`, `python/pyproject.toml`, `python/src/w6w/_version.py`,
   `react/src/version.ts`). In the `cli` job `npm install && npm run build` must run before
   `deno task check` (comment: "its types come from cli/node_modules (@types/node)").

9. **CLI: flags a handler ignores are hidden explicitly, not exempted by accident.**

   **verified: 2026-10-14** — `cli/scripts/gen-help.ts` exports `HIDDEN_PARAMS` (`workflows.run.variables`,
   `workflows.run.trigger`, `workflows.runVersion.variables`, `workflows.runVersion.trigger`);
   `renderCommandHelp` skips them and `cli/tests/help_test.ts` exempts exactly that set
   (`if (HIDDEN_PARAMS.has(`). Add a flag to the set only when the handler never reads it, then run
   `cd cli && deno task gen:help` and commit `cli/src/help.generated.ts`.

10. **Python: tests inject a transport; redirects differ by client.**

   **verified: 2026-10-14** — `docs/implementation.md` §9 "Tests and coverage" requires a mocked, injected transport (an
   injected opener/`urlopen` seam), so tests open no sockets. `exchange_token` and
   `EmbedSessionClient` default to `no_redirect_transport` (`python/src/w6w/server.py`, `transport if
   transport is not None else no_redirect_transport`; defined in `python/src/w6w/_http.py`), so a 3xx
   surfaces as `ApiError`; the Bearer `Client` uses `default_transport` and still follows redirects.
   `apps.by_ids("x")` raises `ConfigError` (`python/src/w6w/apps.py`: "`ids` must be a list of ids, not
   a single string").

11. **React session store: attach/detach is reversible, and a re-suspending Suspense detaches it.**

   **verified: 2026-10-14** — `react/src/session.ts` (`SessionStore`), the `W6WProvider` `getSession` prop and the
   `useW6WSession` hook. The provider attaches in a layout effect (`W6WProvider.tsx`,
   `store?.attach()` / `return () => store?.detach()`); `detach()` defers disposal with
   `queueMicrotask`, and a re-`attach()` in the same task cancels it. That keeps StrictMode (and React 19
   `<Activity>`, which re-runs effects) safe. Trap: a Suspense boundary that re-suspends *around* the
   provider runs the layout cleanup, detaching the store; reads then throw "w6w session store was
   disposed" until the content re-shows. Fake-clock tests use `node:test`
   `mock.timers.enable({ apis: ["setTimeout", "Date"], ... })`
   (`react/src/__tests__/session.test.ts`); its header says never `await new Promise(r =>
   setTimeout(r, 0))` under the fake clock (it hangs) — flush with `settle()` / `tick()`.

12. **`console.apps` pages one server snapshot; `list()` restarts, `listPage()` never does.**

   **verified: 2026-10-17** — `GET /apps` is served from a pinned list snapshot (server
   `docs/reference/pagination.md`). `node/src/console/apps.ts`:
   - `AppsPage` carries optional `snapshot`, `total`, `offset`, `limit` and `expiresAt`.
   - `ListAppsOptions` takes `snapshot?`/`offset?`, and `listPage` forwards both in wire order after
     `cursor`.
   - `list()` follows each `nextCursor` verbatim, because the cursor already encodes the snapshot.
     It never sends `snapshot`/`offset`, which the server refuses beside a `cursor`
     (`400 invalid_cursor`). On an `ApiError` with `code` `snapshot_expired` (410) or
     `unknown_snapshot` (404), `list()` discards the partial walk and restarts ONCE (`isSnapshotGone`).
     A second such error is rethrown, and the cap is still 20 pages per attempt.
   - `listPage()` never restarts. Its caller drops what it holds and calls again without `snapshot`.

   **`QueryParams` drops only `undefined`** (`node/src/http.ts`, the `QueryParams` docblock), so
   `offset: 0` IS sent, and so is a form's `""`. The server treats an empty
   `maturity=`/`visibility=` as absent on open but as a mismatch beside a token that stored one.
   Don't "clean up" an empty string in the SDK without checking the server's `canonicalize`.

   The react adapter mirrors this by hand. `react/src/adapter.ts` `ListAppsPageOptions` /
   `AppsPageResult` (copies of ui `src/provider.tsx`) gained the same fields, and `listAppsPage`
   rebuilds the options and the result field by field, so a new page field must be added in both
   places (trap 6). Docs: `node/docs/console.md` (`list()` / `listPage(options?)` rows and the
   "`snapshot?` / `offset?` read a position in one server snapshot" paragraph). `docs/endpoints.md`
   and `docs/sdk-surface.md` do not describe `console.apps` paging. Tests:
   `node/tests/console/apps_test.ts` (`console.apps.list restarts once on …`,
   `console.apps.listPage forwards snapshot/offset …`), `react/src/__tests__/adapter.test.ts`
   (`listAppsPage forwards snapshot/offset and returns the snapshot page fields`, `listApps restarts
   once …`) and `adapter-conformance.test.ts` (`listAppsPage forwards snapshot and offset …`).
   Console-only, so the change needed no `endpoints.json` row, only the lockstep bump to 0.9.14.

13. **Every lane defaults to `https://api.w6w.io`; the value lives once in `endpoints.json`.**

   **verified: 2026-10-19** — `endpoints.json` top-level `defaultBaseUrl` (beside `basePath`) is the
   source; each lane carries its own constant and a test pins it equal: node
   `DEFAULT_BASE_URL` in `node/src/config.ts` (exported from `node/mod.ts`; pinned by
   `node/tests/conformance_test.ts` "DEFAULT_BASE_URL equals endpoints.json defaultBaseUrl"), python
   `DEFAULT_BASE_URL` in `python/src/w6w/_config.py` (in `__all__`), react's OWN constant (never
   imported from the SDK, pinned by `react/src/__tests__/default-base-url.test.ts`). Library
   precedence: argument > `W6W_BASE_URL` (blank = absent) > default; an EXPLICIT blank base URL still
   raises `ConfigError` ("No w6w base URL is configured"). The secret-bearing helpers
   (`exchangeToken`/`exchange_token`, `createEmbedSessionClient`/`EmbedSessionClient`) are
   argument-or-default and **never read `W6W_BASE_URL`** (`node/src/server/mod.ts` `baseUrl ??
   DEFAULT_BASE_URL`, `python/src/w6w/server.py` `_base_or_default`) — don't route them through
   env-reading `resolveConfig(undefined)`. React must apply its default BEFORE `new W6WClient`, or an
   omitted prop reaches the SDK's env read during SSR. Adding `defaultBaseUrl` did NOT bump
   `contractVersion` (wire-only, `docs/parity.md`). Docs for those helpers carry a self-host warning:
   omit the base URL and the tenant client credentials go to `https://api.w6w.io`.

14. **The CLI has a stored per-user token, bound to the URL it was saved for; `auth` is CLI-only.**

   **verified: 2026-10-19** — `w6w auth login|logout|status` (`cli/src/commands/auth.ts`) is
   declared in `endpoints.json`'s `cli.commands[]` (not an API operation), which
   `cli/scripts/gen-help.ts` builds through the same path as an operation — regenerate with
   `deno task gen:help` (`tests/help_test.ts` byte-compares `src/help.generated.ts`). The store:
   `cli/src/config-store.ts` (`configPath`: `%APPDATA%\w6w\config.json` on Windows, else an
   ABSOLUTE `$XDG_CONFIG_HOME/w6w/config.json`, else `~/.config/w6w/config.json`; `parseConfig` /
   `serializeConfig`, `{version:1, baseUrl, hosts:{<url>:{token}}}`), real I/O behind the injected
   `ConfigStore` seam in `cli/src/store-fs.ts` (Deno and the npm build; dir 0700, file 0600,
   tmp+rename). CLI precedence: flag > env > stored current `baseUrl` > default for the URL;
   `--token` > `W6W_TOKEN` > `hosts[<resolved URL>].token` — a stored token is sent ONLY to the URL
   it was saved under (env/flag tokens are not host-bound). A malformed/unreadable store is a usage
   error naming the path, never repaired. Tests never touch the real `~/.config`: inject
   `XDG_CONFIG_HOME`/a fake store (`cli/tests/config_store_test.ts`, `cmd_auth_test.ts`); the
   end-to-end probe (both runtimes, local capture server) lives in the 26-10-18-01-fixes project
   record (`artifacts/probes/cli-auth-probe.sh`). The SDK, python and react never read this store.

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
- **verified: 2026-10-13** — at wrappers@eb381a7 (0.9.7, 26-10-13-02-fixes closeout, fresh
  detached checkout): node `deno task test` → `ok | 528 passed | 0 failed`; cli 127 passed / 0
  failed; react `npm test` 65 pass / 0 fail; python unittest `Ran 284 tests … OK`.
- **verified: 2026-10-14** — at the 26-10-14-03-embed-sdk-coverage integration tip (0.9.11,
  contract 0.7.0): node `deno task test` → `ok | 562 passed | 0 failed`; cli 161 passed / 0 failed;
  react `NODE_OPTIONS=--experimental-strip-types npm test` 144 pass / 0 fail; python unittest
  `Ran 332 tests … OK`.
- **verified: 2026-10-14** — at the 26-10-14-02-embed-sessions integration tip (0.9.12): node
  `deno task test` → `ok | 618 passed | 0 failed`; cli 161 passed / 0 failed; python unittest
  `Ran 349 tests … OK`. `deno task --cwd cli check` fails with `npm:@types/node` missing in a tree
  with no `node_modules` (also on main) — run `npm ci` in `cli/` first.
- **verified: 2026-10-14** — at the 26-10-14-05-embed-client-kit tip (wrappers@96c5524, `VERSION` 0.9.13): python
  unittest 359 tests OK; cli `deno task test` 163 passed; react
  `NODE_OPTIONS=--experimental-strip-types npm test` 164 pass. Local Node is 22.16, so react needs
  `--experimental-strip-types`; CI uses Node 24 (`ci.yml` `node-version: "24"`).
- **verified: 2026-10-17** — at the 26-10-16-00-pinned-pagination integration tip (wrappers@ce7f88f,
  `VERSION` 0.9.14): node `deno task test` → `ok | 626 passed | 0 failed`; react
  `NODE_OPTIONS=--experimental-strip-types npm test` → `# tests 167 · # pass 167 · # fail 0`.
- **verified: 2026-10-17** — at `main` @ `1df07aa` (`VERSION` 0.9.15, contract 0.8.0;
  26-10-16-01-embed-composable-surfaces closeout, fresh detached checkout): node `deno task test` →
  `ok | 640 passed | 0 failed`; cli 166 passed (`npm ci` in `cli/` first, or `deno task check` fails
  on `@types/node`); python `PYTHONPATH=src python3 -m unittest discover -s tests -t .` → `Ran 366 tests
  … OK` (without `-t .`, `test_functions_precondition` fails to import: relative import); react
  `NODE_OPTIONS=--experimental-strip-types npm test` → 171 pass. 0.9.14 (pinned-pagination) was never
  published; its change ships in 0.9.15. React's `test` script is capped
  (`--max-old-space-size=2048 --test-concurrency=4 --test-timeout=120000`) and `src/test-jsx-loader.mjs`
  loads two assert guards (`test-assert-guard.mjs` inner, `test-guards.mjs` outer), because a failing
  assert on a rendered DOM node exhausted host memory (26-10-16-01 BLK-1).
- **verified: 2026-10-19** — at the 26-10-18-01-fixes integration tip (`VERSION` 0.9.16, contract
  0.8.0 + `defaultBaseUrl`): node `deno task test` → `ok | 646 passed | 0 failed`; cli 192 passed;
  python unittest 375 OK; react 176 pass (same invocations as above).
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
