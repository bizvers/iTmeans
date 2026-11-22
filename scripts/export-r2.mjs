// Writes the published words in the R2 layout that site/src/lib/r2.ts reads (scale version, docs/decisions.md 22 Nov 2026).
//   node scripts/export-r2.mjs [--out=site/.r2-export] [--domain=web-development] [--limit=500]
// Output (one file per R2 object, same path as the key):
//   meta.json                              { counts: { "<domain>/<subtopic>": n } }
//   index/<domain>/<subtopic>.json         [{ slug, term, letter }] A-Z
//   words/<domain>/<subtopic>/<slug>.json  { word (+ _tr translations), refs (its related words) }
// Only active domains, only status "published" (same rule as the website). --limit keeps the first N words per domain (A-Z).
import fs from "node:fs";
import path from "node:path";
import { P, readJson } from "../agent/cycle/lib.mjs";

const REPO = path.resolve(path.dirname(P.taxonomy), "..", "..");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = path.resolve(REPO, arg("out", "site/.r2-export"));
const ONLY = arg("domain", "");
const LIMIT = Number(arg("limit", "0")) || Infinity;

const taxonomy = readJson(P.taxonomy);
const domains = taxonomy.domains.filter((d) => d.active && (!ONLY || d.id === ONLY));
const C = path.join(REPO, "content");
const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f)) : []);

// every published word of the chosen domains
const words = [];
for (const d of domains) {
  const mine = [];
  for (const s of d.subtopics) for (const f of jsonFiles(path.join(C, "words", d.id, s.id))) {
    const w = readJson(f);
    if (w.status === "published") mine.push(w);
  }
  mine.sort((a, b) => a.term.localeCompare(b.term, "en"));
  words.push(...mine.slice(0, LIMIT));
}

// related ids -> name (+ address when it has a page): queued and held terms first, published words win (as in content.ts)
const refs = new Map();
for (const f of jsonFiles(path.join(C, "queue"))) for (const e of readJson(f)) if (e.id) refs.set(e.id, { id: e.id, term: e.term });
for (const f of jsonFiles(path.join(C, "held"))) { const h = readJson(f); if (h.id) refs.set(h.id, { id: h.id, term: h.term }); }
for (const w of words) refs.set(w.id, { id: w.id, term: w.term, domain: w.domain, subtopic: w.subtopic, slug: w.slug });

// translations other than hi/en live in content/translations/<lang>/<id>.json
const trDir = path.join(C, "translations");
const trLangs = fs.existsSync(trDir) ? fs.readdirSync(trDir).filter((l) => fs.statSync(path.join(trDir, l)).isDirectory()) : [];
const translationsOf = (id) => {
  const out = {};
  for (const l of trLangs) { const f = path.join(trDir, l, `${id}.json`); if (fs.existsSync(f)) out[l] = readJson(f); }
  return Object.keys(out).length ? out : undefined;
};

fs.rmSync(OUT, { recursive: true, force: true });
const put = (key, data) => {
  const f = path.join(OUT, ...key.split("/"));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data));
};

const bySub = new Map();
for (const w of words) {
  const k = `${w.domain}/${w.subtopic}`;
  if (!bySub.has(k)) bySub.set(k, []);
  bySub.get(k).push(w);
}
const counts = {};
for (const [k, list] of bySub) {
  list.sort((a, b) => a.term.localeCompare(b.term, "en"));
  counts[k] = list.length;
  put(`index/${k}.json`, list.map((w) => ({ slug: w.slug, term: w.term, letter: w.letter })));
  for (const w of list) {
    const related = {};
    for (const id of w.related ?? []) if (refs.has(id)) related[id] = refs.get(id);
    const tr = translationsOf(w.id);
    put(`words/${k}/${w.slug}.json`, { word: tr ? { ...w, _tr: tr } : w, refs: related });
  }
}
put("meta.json", { counts });
console.log(`export-r2: ${words.length} words, ${bySub.size} topics -> ${path.relative(REPO, OUT)}`);
