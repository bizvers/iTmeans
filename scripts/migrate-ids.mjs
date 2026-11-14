// One-time migration (improvement step 3): gives every word, queue entry and held record a permanent id,
// and turns each word's "related" slug list into a list of ids.
//   node scripts/migrate-ids.mjs           -> DRY RUN on a scratch copy of content/; prints what would change, touches nothing
//   node scripts/migrate-ids.mjs --write   -> really changes content/ (do this once, then commit)
// Safe to run again: records that already have an id are left alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(here), "..");

if (!process.argv.includes("--write")) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itmeans-migrate-"));
  fs.cpSync(path.join(repo, "content"), path.join(tmp, "content"), { recursive: true });
  fs.cpSync(path.join(repo, "agent"), path.join(tmp, "agent"), { recursive: true });
  console.log("DRY RUN on a scratch copy; real content is not touched.\n");
  const out = execFileSync(process.execPath, [here, "--write"], { env: { ...process.env, ITMEANS_ROOT: tmp }, encoding: "utf8" });
  console.log(out);
  console.log(`Scratch copy kept for inspection: ${tmp}\nIf it looks right, run again with --write.`);
  process.exit(0);
}

const { P, loadWords, loadQueues, loadHeld, takenIds, newId, writeJson, slugify, resolveRelated, ID_RE } = await import("../agent/cycle/lib.mjs");

// Nicer English names for the old "related" slugs that were never real words (the slug alone loses capitals).
const TERMS = {
  cdn: "CDN", nginx: "Nginx", "rest-api": "REST API", endpoint: "Endpoint", "http-methods": "HTTP methods", authorization: "Authorization",
  jwt: "JWT", oauth: "OAuth", layout: "Layout", "responsive-design": "Responsive design", sass: "Sass", ecmascript: "ECMAScript",
  typescript: "TypeScript", "media-queries": "Media queries", viewport: "Viewport", "fluid-grid": "Fluid grid", breakpoints: "Breakpoints",
  "mobile-first": "Mobile-first", migration: "Migration", "database-design": "Database design", transition: "Transition",
  "color-wheel": "Color wheel", volume: "Volume", compression: "Compression", "dynamic-range": "Dynamic range",
};

const taken = takenIds();
const log = { wordIds: 0, heldIds: 0, queueIds: 0, queueDropped: [], relatedConverted: 0, newQueued: [] };

// A. ids for words and held records
const words = loadWords();
for (const x of words) if (!x.w.id) { x.w = { id: newId(taken), ...x.w }; writeJson(x.file, x.w); log.wordIds++; }
const held = loadHeld();
for (const x of held) if (!x.h.id) { x.h = { id: newId(taken), ...x.h }; writeJson(x.file, x.h); log.heldIds++; }

// B. queue: drop entries that are already published or held (they keep their own id), give the rest an id
for (const q of loadQueues()) {
  const kept = [];
  for (const e of q.entries) {
    const s = slugify(e.term);
    const pub = words.find((x) => x.domain === q.domain && x.sub === q.sub && x.w.slug === s);
    const hld = held.find((x) => x.h.domain === q.domain && x.h.slug === s);
    if (pub || hld) { log.queueDropped.push(`${q.domain}/${q.sub}: "${e.term}" (${pub ? "already published" : "held"})`); continue; }
    if (e.id) { kept.push(e); continue; }
    kept.push({ id: newId(taken), ...e }); log.queueIds++;
  }
  writeJson(q.file, kept);
}

// C. related: slugs -> ids (new queue entries are reserved for terms that exist nowhere yet)
const queueBefore = new Set(loadQueues().flatMap((q) => q.entries.map((e) => e.id)));
for (const x of loadWords()) {
  const w = x.w;
  if (!Array.isArray(w.related) || w.related.every((r) => ID_RE.test(r))) continue;
  const items = w.related.map((r) => TERMS[r] ?? r);
  const ids = resolveRelated(items, { domain: x.domain, sub: x.sub, selfId: w.id });
  writeJson(x.file, { ...w, related: ids });
  log.relatedConverted++;
}
for (const q of loadQueues()) for (const e of q.entries) if (!queueBefore.has(e.id)) log.newQueued.push(`${q.domain}/${q.sub}: ${e.term}`);

console.log(`Word ids added:        ${log.wordIds}`);
console.log(`Held ids added:        ${log.heldIds}`);
console.log(`Queue ids added:       ${log.queueIds}`);
console.log(`Queue entries removed: ${log.queueDropped.length}\n  ${log.queueDropped.join("\n  ")}`);
console.log(`Words with related converted to ids: ${log.relatedConverted}`);
console.log(`New queue entries from "related":    ${log.newQueued.length}\n  ${log.newQueued.join("\n  ")}`);
