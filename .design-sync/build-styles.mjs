// design-sync style build (cfg.buildCmd). Compiles the repo's Tailwind v4
// stylesheet (app/globals.css, which @imports tailwindcss + shadcn/tailwind.css
// + tw-animate-css and defines the @theme tokens) into a STATIC stylesheet the
// design-sync bundle can ship as cfg.cssEntry. Tailwind v4 auto-scans the repo
// for utility classes, so every class the bundled components use is emitted.
//
// Two post-processing steps make the output self-contained for a preview that
// has no Next runtime:
//   1. Bind --font-sans / --font-heading / --font-devanagari, which next/font
//      injects on <html> at runtime in the real app but are undefined here.
//   2. Pull DM Sans + Bricolage Grotesque from Google Fonts via a remote
//      @import (Tailwind flags this [FONT_REMOTE] = informational; the families
//      load at render time). See .design-sync/NOTES.md "Re-sync risks".
//
// Run from the repo root: `node .design-sync/build-styles.mjs`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_ENTRY = [
  ".ds-sync/node_modules/@tailwindcss/cli/dist/index.mjs",
  "node_modules/@tailwindcss/cli/dist/index.mjs",
].find((p) => existsSync(p));

if (!CLI_ENTRY) {
  console.error(
    "[build-styles] @tailwindcss/cli not found. Install it into the staged converter deps:\n" +
      "  (cd .ds-sync && npm i @tailwindcss/cli@4.3.0)",
  );
  process.exit(1);
}

const INPUT = "app/globals.css";
const OUT = ".design-sync/compiled-styles.css";

const tmp = join(mkdtempSync(join(tmpdir(), "ds-tw-")), "tw.css");
console.error(`[build-styles] compiling ${INPUT} via ${CLI_ENTRY} ...`);
execFileSync(process.execPath, [CLI_ENTRY, "-i", INPUT, "-o", tmp], {
  stdio: ["ignore", "inherit", "inherit"],
});

const compiled = readFileSync(tmp, "utf8");

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap');\n";

const FONT_BINDINGS = `
/* design-sync: bind the next/font CSS variables (set on <html> at runtime in
   the app) so type renders in DM Sans / Bricolage Grotesque, not a fallback. */
:root {
  --font-sans: 'DM Sans', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-heading: 'Bricolage Grotesque', 'DM Sans', ui-sans-serif, sans-serif;
  --font-devanagari: 'Noto Sans Devanagari', 'DM Sans', sans-serif;
}
`;

// @import must precede all other rules; the :root binding goes last.
writeFileSync(OUT, FONT_IMPORT + compiled + "\n" + FONT_BINDINGS);
console.error(
  `[build-styles] wrote ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB)`,
);
