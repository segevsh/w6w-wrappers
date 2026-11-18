#!/usr/bin/env bash
# The ONE list of checks for w6w-wrappers: the lockstep version gate plus every lane (node, python,
# cli, react). CI (.github/workflows/ci.yml) runs exactly this file, and so does the pre-push hook
# (w6w-io/w6w .githooks/pre-push). Add a check HERE, never only to ci.yml. Publishing is not a
# check: it lives in release.yml alone.
#
# Needs node 24 + npm, python 3 with the `build` module (`pip install build`), and — for the cli
# lane only, until it moves off Deno like node/ did — deno 2.x.
# Self-contained: no sibling checkout — the lanes link each other inside this repo (../node).
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$*"; }

step "lockstep: VERSION and every manifest agree"
python3 scripts/check-lockstep.py

# The SDK goes first: cli and react both link it (cli via deno.json, react via npm), so it is
# installed, checked and built before either.
step "node: npm ci";          (cd node && npm ci)
step "node: typecheck";       (cd node && npm run typecheck)
step "node: lint";            (cd node && npm run lint)
step "node: format:check";    (cd node && npm run format:check)
# build before test: examples/embed-host imports "@w6w/sdk/server", which resolves to dist/.
step "node: build";           (cd node && npm run build)
step "node: test";            (cd node && npm test)
step "node: npm pack --dry-run"; (cd node && npm pack --dry-run)

step "python: unittest (includes the conformance suite)"
(cd python && PYTHONPATH=src python3 -m unittest discover -s tests -t .)
step "python: build sdist + wheel"
if ! python3 -c 'import build' 2>/dev/null; then
  echo "verify: python3 has no 'build' module. Devcontainer: sudo apt-get install -y python3-build python3-venv (the image ships both from w6w-io/w6w#.devcontainer); elsewhere: python3 -m pip install build" >&2
  exit 1
fi
(cd python && python3 -m build --outdir dist)

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
