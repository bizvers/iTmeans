// Writes the published words in the R2 layout that site/src/lib/r2.ts reads (scale version, docs/decisions.md 22 Nov 2026).
//   node scripts/export-r2.mjs [--out=site/.r2-export] [--domain=web-development] [--limit=500]
// Output (one file per R2 object, same path as the key):
//   meta.json                                  { counts: { "<domain>/<subtopic>": n } }
//   index/<domain>/<subtopic>.json             [{ slug, term, letter }] A-Z
//   bundles/<domain>/<subtopic>/<LETTER>.json  { "<slug>": { word (+ _tr translations), refs (its related words) } }
//   manifest.json                              { "<key>": "<sha1 of the file>" } - lets the uploader send only what changed
// One bundle per topic and letter (at most ~20 words in the short stage), so a new word changes one bundle, one index
// and meta - and a million words stay a few thousand objects. Only active domains, only status "published" (as on the
// website). --limit keeps the first N words per domain (A-Z), for trials.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { P, readJson } from "../agent/cycle/lib.mjs";
import { wordKeys, shardOf } from "../site/src/lib/search-key.mjs";

const REPO = path.resolve(path.dirname(P.taxonomy), "..", "..");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = path.resolve(REPO, arg("out", "site/.r2-export"));
const ONLY = arg("domain", "");
const LIMIT = Number(arg("limit", "0")) || Infinity;

const taxonomy = readJson(P.taxonomy);
const active = taxonomy.domains.filter((d) => d.active);
const C = path.join(REPO, "content");
const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f)) : []);

// every published word of the active domains (refs need all of them, even when only some are exported)
const all = [];
for (const d of active) for (const s of d.subtopics) for (const f of jsonFiles(path.join(C, "words", d.id, s.id))) {
  const w = readJson(f);
  if (w.status === "published") all.push(w);
}
const byTerm = (a, b) => a.term.localeCompare(b.term, "en");
const words = [];
for (const d of active) {
  if (ONLY && d.id !== ONLY) continue;
  words.push(...all.filter((w) => w.domain === d.id).sort(byTerm).slice(0, LIMIT));
}

// related ids -> name (+ address when it has a page): queued and held terms first, published words win (as in content.ts)
const refs = new Map();
for (const f of jsonFiles(path.join(C, "queue"))) for (const e of readJson(f)) if (e.id) refs.set(e.id, { id: e.id, term: e.term });
for (const f of jsonFiles(path.join(C, "held"))) { const h = readJson(f); if (h.id) refs.set(h.id, { id: h.id, term: h.term }); }
for (const w of all) refs.set(w.id, { id: w.id, term: w.term, domain: w.domain, subtopic: w.subtopic, slug: w.slug });

// translations other than hi/en live in content/translations/<lang>/<id>.json
const trDir = path.join(C, "translations");
const trLangs = fs.existsSync(trDir) ? fs.readdirSync(trDir).filter((l) => fs.statSync(path.join(trDir, l)).isDirectory()) : [];
const translationsOf = (id) => {
  const out = {};
  for (const l of trLangs) { const f = path.join(trDir, l, `${id}.json`); if (fs.existsSync(f)) out[l] = readJson(f); }
  return Object.keys(out).length ? out : undefined;
};

fs.rmSync(OUT, { recursive: true, force: true });
const manifest = {};
const put = (key, data) => {
  const body = JSON.stringify(data);
  const f = path.join(OUT, ...key.split("/"));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  manifest[key] = crypto.createHash("sha1").update(body).digest("hex");
};

const bySub = new Map();
for (const w of words) {
  const k = `${w.domain}/${w.subtopic}`;
  if (!bySub.has(k)) bySub.set(k, []);
  bySub.get(k).push(w);
}
const counts = {};
let bundles = 0;
for (const [k, list] of bySub) {
  list.sort(byTerm);
  counts[k] = list.length;
  put(`index/${k}.json`, list.map((w) => ({ slug: w.slug, term: w.term, letter: w.letter })));
  const byLetter = new Map();
  for (const w of list) {
    const related = {};
    for (const id of w.related ?? []) if (refs.has(id)) related[id] = refs.get(id);
    const tr = translationsOf(w.id);
    if (!byLetter.has(w.letter)) byLetter.set(w.letter, {});
    byLetter.get(w.letter)[w.slug] = { word: tr ? { ...w, _tr: tr } : w, refs: related };
  }
  for (const [L, b] of byLetter) { put(`bundles/${k}/${L}.json`, b); bundles++; }
}
put("meta.json", { counts });

// suggestions while typing (scale step s3): suggest/<shard>.json, one shard per first two letters of a search key.
// Each entry: k = its keys, t = name, p = Hindi pronunciation, m = first sentence of the meaning (hi / en), d/s/g = address.
const firstSentence = (s) => (s ? String(s).split(/[।.]/)[0].trim().slice(0, 90) : undefined);
const shards = new Map();
for (const w of words) {
  const tr = translationsOf(w.id);
  const keys = wordKeys(w, tr);
  const entry = { k: keys, t: w.term, p: w.pronunciation_hi, m: { hi: firstSentence(w.field_meaning?.hi), en: firstSentence(w.field_meaning?.en) }, d: w.domain, s: w.subtopic, g: w.slug };
  // other languages (scale step s5): their meaning and pronunciation, only when the word is translated (others stay as before)
  for (const [l, t] of Object.entries(tr ?? {})) {
    if (t.field_meaning) entry.m[l] = firstSentence(t.field_meaning);
    if (t.pronunciation) (entry.pp ??= {})[l] = t.pronunciation;
  }
  for (const sh of new Set(keys.map(shardOf))) {
    if (!shards.has(sh)) shards.set(sh, []);
    shards.get(sh).push(entry);
  }
}
for (const [sh, list] of shards) put(`suggest/${sh}.json`, list);
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest));
console.log(`export-r2: ${words.length} words, ${bySub.size} topics, ${bundles} bundles, ${shards.size} suggestion shards -> ${path.relative(REPO, OUT)}`);
