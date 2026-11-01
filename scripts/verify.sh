#!/usr/bin/env bash
# The ONE list of checks for w6w-wrappers: the lockstep version gate plus every lane (node, python,
# cli, react). CI (.github/workflows/ci.yml) runs exactly this file, and so does the pre-push hook
# (w6w-io/w6w .githooks/pre-push). Add a check HERE, never only to ci.yml. Publishing is not a
# check: it lives in release.yml alone.
#
# Needs deno 2.x, node 24 + npm, and python 3 with the `build` module (`pip install build`).
# Self-contained: no sibling checkout — the lanes link each other inside this repo (../node).
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$*"; }

step "lockstep: VERSION and every manifest agree"
python3 scripts/check-lockstep.py

# Deno lane first, and `deno publish --dry-run` before ANY npm or python step: Deno's clean-tree
# check covers the whole repository, and npm installs can touch sibling lockfiles.
step "node: deno check";      (cd node && deno task check)
step "node: deno lint";       (cd node && deno task lint)
step "node: deno fmt --check"; (cd node && deno task fmt:check)
step "node: deno test";       (cd node && deno task test)
step "node: JSR dry run";     (cd node && deno publish --dry-run)

step "python: unittest (includes the conformance suite)"
(cd python && PYTHONPATH=src python3 -m unittest discover -s tests -t .)
step "python: build sdist + wheel"
if ! python3 -c 'import build' 2>/dev/null; then
  echo "verify: python3 has no 'build' module — install it (python3 -m pip install build)" >&2
  exit 1
fi
(cd python && python3 -m build --outdir dist)

# The SDK build comes before cli and react: both link it (cli via deno.json, react via npm).
step "node: npm ci + build"; (cd node && npm ci && npm run build)
step "node: npm pack --dry-run"; (cd node && npm pack --dry-run)

# Install before `deno check`: its types come from cli/node_modules (@types/node).
step "cli: npm install + build"; (cd cli && npm install && npm run build)
step "cli: deno check";       (cd cli && deno task check)
step "cli: deno lint";        (cd cli && deno task lint)
step "cli: deno fmt --check"; (cd cli && deno task fmt:check)
step "cli: deno test";        (cd cli && deno task test)
step "cli: npm pack --dry-run"; (cd cli && npm pack --dry-run)

# The sibling goes in FIRST: react's @w6w/sdk range tracks VERSION, so on a release commit a bare
# `npm install` dies with ETARGET (see release.yml).
step "react: install against the sibling SDK"
(cd react && npm install --no-save ../node && npm install)
step "react: typecheck"; (cd react && npm run typecheck)
step "react: lint";      (cd react && npm run lint)
step "react: test";      (cd react && npm test)
step "react: build";     (cd react && npm run build)
step "react: npm pack --dry-run"; (cd react && npm pack --dry-run)

printf '\nverify: ok\n'
