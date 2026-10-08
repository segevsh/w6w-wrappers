# `docs/`

This folder follows the house `docs/` convention. `manifest.json` is the publish
allow-list — a file in this folder that isn't listed there is not public. See
[CONTRIBUTING.md](https://github.com/w6w-io/docs/blob/main/CONTRIBUTING.md) for
the full write-up.

Two kinds of document live here:

- **`clients/`** — the user guides for every client, published to
  [docs.w6w.io/clients](https://docs.w6w.io/clients/overview/). Every page in it
  is listed in `manifest.json` (section `clients`) and follows the page template
  in `w6w-io/docs` (`templates/page.md`). Keep internals out of these pages.
- **Everything else** (`cli.md`, `endpoints.md`, `implementation.md`,
  `parity.md`, `release.md`, `sdk-surface.md`) — implementer docs for people
  changing the wrappers. They are deliberately **not** in `manifest.json` and
  stay unpublished.
