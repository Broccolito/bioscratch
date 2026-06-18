// Headless sanity test for the frontmatter pipeline (no DOM):
//   1. import → doc → export round-trips each fixture's YAML block
//   2. parseFrontmatter classifies/parses the YAML (or falls back) without throwing
//
// Run: npx esbuild app/scripts/test-frontmatter.mts --bundle --platform=node \
//        --format=esm --outfile=/tmp/fmtest.mjs && node /tmp/fmtest.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { schema } from "../src/editor/schema";
import { markdownToDoc } from "../src/editor/serialization/markdownImport";
import { docToMarkdown } from "../src/editor/serialization/markdownExport";
import { parseFrontmatter } from "../src/lib/frontmatter";

const fixturesDir = join(process.cwd(), "../tests/fixtures/frontmatter");

let pass = 0;
let fail = 0;
const log = (ok: boolean, msg: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${msg}`);
  ok ? pass++ : fail++;
};

function extractYaml(md: string): string | null {
  const m = md.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\n/);
  return m ? m[1] : null;
}

for (const file of readdirSync(fixturesDir).sort()) {
  if (!file.endsWith(".md")) continue;
  console.log(`\n${file}`);
  const md = readFileSync(join(fixturesDir, file), "utf8");

  // 1. Import must produce a doc whose first child is a frontmatter node.
  let doc;
  try {
    doc = markdownToDoc(md, schema);
    const first = doc.firstChild;
    log(
      !!first && first.type.name === "frontmatter",
      `import: first node is frontmatter (got "${first?.type.name}")`
    );
  } catch (e) {
    log(false, `import threw: ${(e as Error).message}`);
    continue;
  }

  // 2. Round-trip: re-export, re-import, YAML content must be preserved.
  try {
    const out = docToMarkdown(doc);
    const redoc = markdownToDoc(out, schema);
    const a = doc.firstChild?.textContent?.trim();
    const b = redoc.firstChild?.textContent?.trim();
    log(a === b, `round-trip: YAML content stable`);
    if (a !== b) {
      console.log("    --- first ---\n" + a + "\n    --- second ---\n" + b);
    }
  } catch (e) {
    log(false, `round-trip threw: ${(e as Error).message}`);
  }

  // 3. parseFrontmatter never throws and yields entries (or empty for empty fm).
  const yaml = extractYaml(md) ?? "";
  try {
    const parsed = parseFrontmatter(yaml);
    log(
      Array.isArray(parsed.entries),
      `parse: ${parsed.entries.length} entries${parsed.malformed ? " (fallback)" : ""}`
    );
  } catch (e) {
    log(false, `parse threw: ${(e as Error).message}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
