// `src/vendor/` holds generated JavaScript (see scripts/vendor-app-assemble.mjs) that `tsc`
// does not emit: it resolves `./vendor/app-assemble.js` to the hand-written `.d.ts` beside it.
// Copy the vendored files into `dist/src/vendor/` so the compiled `app-toolchain.js` finds them.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

const from = new URL("../src/vendor/", import.meta.url);
const to = new URL("../dist/src/vendor/", import.meta.url);
mkdirSync(to, { recursive: true });
for (const name of readdirSync(from)) {
  if (name.endsWith(".js") || name.endsWith(".d.ts")) {
    copyFileSync(new URL(name, from), new URL(name, to));
  }
}
