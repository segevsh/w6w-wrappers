#!/usr/bin/env python3
"""One version, eleven places it is written down: VERSION and every manifest must agree.

The same check release.yml runs inline, minus the release-tag comparison. Run from the
repository root (scripts/verify.sh does). Exits 1, naming every manifest that disagrees.
"""
import json
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent
shared = (root / "VERSION").read_text().strip()


def from_json(path, *keys):
    data = json.loads((root / path).read_text())
    for key in keys:
        data = data[key]
    return data


def from_regex(path, pattern):
    text = (root / path).read_text()
    match = re.search(pattern, text, re.M)
    if not match:
        sys.exit(f"::error::no version literal matched in {path}")
    return match.group(1)


found = {
    "VERSION": shared,
    "node/package.json": from_json("node/package.json", "version"),
    "node/deno.json": from_json("node/deno.json", "version"),
    "node/src/version.ts": from_regex(
        "node/src/version.ts", r'VERSION:\s*string\s*=\s*"([^"]+)"'),
    "cli/package.json": from_json("cli/package.json", "version"),
    "cli/deno.json": from_json("cli/deno.json", "version"),
    "cli/mod.ts": from_regex(
        "cli/mod.ts", r'VERSION:\s*string\s*=\s*"([^"]+)"'),
    "python/pyproject.toml": from_regex(
        "python/pyproject.toml", r'^version\s*=\s*"([^"]+)"'),
    "python/src/w6w/_version.py": from_regex(
        "python/src/w6w/_version.py", r'__version__:\s*str\s*=\s*"([^"]+)"'),
    "react/package.json": from_json("react/package.json", "version"),
    "react/src/version.ts": from_regex(
        "react/src/version.ts", r'VERSION:\s*string\s*=\s*"([^"]+)"'),
}

# Echo everything BEFORE deciding: when this fails, the log should
# already answer "which one disagreed" without a re-run.
width = max(len(name) for name in found)
for name, value in found.items():
    print(f"  {name:<{width}}  {value}")

wrong = {n: v for n, v in found.items() if v != shared}
if wrong:
    for name, value in wrong.items():
        print(f"::error::{name} is {value}, but VERSION is {shared}")
    sys.exit(1)
print(f"\nall {len(found)} agree on {shared}")
