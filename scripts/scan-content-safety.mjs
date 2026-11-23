// Safety scan of AI-written content (words, queue, articles). Run: node scripts/scan-content-safety.mjs
// The site escapes all text it prints, so this is a second lock: it stops build/PR on text that has no place in a dictionary.
//   FAIL  (exit 1): javascript:, vbscript:, data:text/html, "</script", on<event>= handlers
//   WARN  (listed, exit 0): <script / <iframe / <object tags and web links inside text fields
//     (words about web development may mention "<script>" legitimately, so these are only listed)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = ["content/words", "content/queue", "content/articles", "content/held"].map((d) => path.join(root, d));

const FAIL = [
  [/javascript\s*:/i, "javascript: link"],
  [/vbscript\s*:/i, "vbscript: link"],
  [/data\s*:\s*text\/html/i, "data:text/html"],
  [/<\s*\/\s*script/i, "closing </script"],
  [/<[a-z][^>]*\son[a-z]+\s*=/i, "tag with on...= handler"],
];
const WARN = [
  [/<\s*(script|iframe|object|embed|link|meta)\b/i, "html tag (script/iframe/object/embed/link/meta)"],
  [/https?:\/\/[^\s"']+/i, "web link in text"],
];
// fields that may legitimately hold links
const LINK_OK = { has: (k) => /(^|_)(source|sources|url|image|src)$/i.test(k) };

function* files(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.name.endsWith(".json") || e.name.endsWith(".jsonl")) yield p;
  }
}
function* strings(v, key = "") {
  if (typeof v === "string") yield [key, v];
  else if (Array.isArray(v)) for (const x of v) yield* strings(x, key);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* strings(x, k);
}

let scanned = 0;
const fails = [];
const warns = new Map();
for (const dir of dirs) {
  for (const f of files(dir)) {
    scanned++;
    let data;
    try {
      const raw = fs.readFileSync(f, "utf8");
      data = f.endsWith(".jsonl") ? raw.split("\n").filter(Boolean).map((l) => JSON.parse(l)) : JSON.parse(raw);
    } catch { continue; } // broken JSON is validate-content.mjs's job
    for (const [key, text] of strings(data)) {
      const rel = path.relative(root, f);
      for (const [re, name] of FAIL) if (re.test(text)) fails.push(`${rel} [${key}] ${name}: ${text.slice(0, 80)}`);
      for (const [re, name] of WARN) {
        if (name.startsWith("web link") && LINK_OK.has(key)) continue;
        if (re.test(text)) warns.set(name, [...(warns.get(name) ?? []), `${rel} [${key}]`]);
      }
    }
  }
}

console.log(`safety scan: ${scanned} files`);
for (const [name, list] of warns) console.log(`  warning: ${name}: ${list.length} places (e.g. ${list.slice(0, 2).join("; ")})`);
if (fails.length) {
  console.error(`\nSAFETY SCAN FAILED: ${fails.length} problem(s)`);
  for (const f of fails.slice(0, 30)) console.error("  " + f);
  process.exit(1);
}
console.log("safety scan: ok (no blocked patterns)");
