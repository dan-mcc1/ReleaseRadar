// Fails on the styling the design system replaced, so it doesn't creep back:
// hand-typed text sizes, raw palette colours, eyebrow labels, accent words in
// headings and text glyphs used as icons. Run with `npm run lint:design`.
//
// components/ui is exempt (it defines the system), as are the admin pages
// (internal tools with their own look). A line ending in `// design-ok`
// (or containing {/* design-ok */}) is skipped, for the rare justified case.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src/", import.meta.url));
const EXEMPT = [/components[\\/]ui[\\/]/, /pages[\\/]Admin/, /components[\\/]AdminLayout/];

const RULES = [
  {
    name: "arbitrary text size",
    test: /\btext-\[\d+(\.\d+)?(px|rem)\]/,
    hint: "use text-caption / text-label / text-body / text-title / text-heading / text-display",
  },
  {
    name: "raw palette colour",
    test: /\b(text|bg|border|ring|from|via|to|fill|stroke|outline|decoration|accent|divide|placeholder|shadow)-(amber|red|emerald|yellow|green|orange|teal|lime|rose|pink|sky|indigo|cyan|fuchsia|violet|purple|blue|slate|gray|zinc|stone)-\d{2,3}\b/,
    hint: "use primary / neutral / warning / error / success / highlight / info",
  },
  {
    name: "eyebrow label",
    test: /(font-mono[^"'`]*uppercase|uppercase[^"'`]*font-mono|uppercase[^"'`]*tracking-(\[0\.\d+em\]|wide|wider|widest))/,
    hint: "headings are sentence case: PageHeader description or SectionHeader",
  },
  {
    name: "accent word in a heading",
    test: /<em\b[^>]*(text-primary|fontStyle)/,
    hint: "headings are plain text",
  },
  {
    name: "glyph as icon",
    test: /(^|[^\w])(→|←|★|✓|✕|✔|✖|▶|►)/,
    hint: "use an icon from components/ui (ChevronRightIcon, StarIcon, CheckIcon, …) or plain words",
  },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(tsx|ts)$/.test(name)) yield path;
  }
}

let count = 0;
for (const path of files(ROOT)) {
  const rel = relative(ROOT, path);
  if (EXEMPT.some((re) => re.test(rel))) continue;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes("design-ok")) return;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    for (const rule of RULES) {
      if (rule.test.test(line)) {
        count++;
        console.log(`src${sep}${rel}:${i + 1}  ${rule.name}  (${rule.hint})`);
      }
    }
  });
}

if (count > 0) {
  console.log(`\n${count} design rule ${count === 1 ? "problem" : "problems"}.`);
  process.exit(1);
}
console.log("Design rules: clean.");
