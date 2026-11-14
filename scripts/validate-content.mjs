// Content gate: checks every file under content/ and exits 1 on any ERROR (so the build stops).
// WARNINGs are printed but do not stop the build. No dependencies; independent of Astro.
// Run: node scripts/validate-content.mjs     (also runs automatically before `npm run build` in site/)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { P, readJson, slugify } from "../agent/cycle/lib.mjs";
import { codeCheck } from "../agent/cycle/checks.mjs";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUS = ["published", "held"];

const listJson = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : []);
const rel = (f) => path.relative(path.resolve(P.words, "..", ".."), f).replaceAll("\\", "/");

export function validateContent() {
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
  const load = (f) => {
    try { return readJson(f); } catch (e) { err(rel(f), `invalid JSON (${e.message})`); return null; }
  };

  // ---------- taxonomy
  const taxonomy = load(P.taxonomy);
  if (!taxonomy) return { errors, warnings, counts: {} };
  const langCodes = new Set();
  for (const l of taxonomy.languages ?? []) {
    if (!l.code) { err("taxonomy", "a language has no code"); continue; }
    if (langCodes.has(l.code)) err("taxonomy", `duplicate language code "${l.code}"`);
    langCodes.add(l.code);
  }
  for (const need of ["hi", "en"]) {
    if (!(taxonomy.languages ?? []).some((l) => l.code === need && l.active)) err("taxonomy", `language "${need}" must exist and be active`);
  }
  const domainIds = new Set();
  const subKey = new Set(); // "domain/subtopic"
  for (const d of taxonomy.domains ?? []) {
    if (domainIds.has(d.id)) err("taxonomy", `duplicate domain id "${d.id}"`);
    domainIds.add(d.id);
    if (!d.en || !d.hi) err("taxonomy", `domain "${d.id}" needs en and hi names`);
    const seen = new Set();
    for (const s of d.subtopics ?? []) {
      if (seen.has(s.id)) err("taxonomy", `duplicate subtopic id "${s.id}" in domain "${d.id}"`);
      seen.add(s.id);
      subKey.add(`${d.id}/${s.id}`);
      if (!s.en || !s.hi) err("taxonomy", `subtopic "${d.id}/${s.id}" needs en and hi names`);
    }
  }

  // ---------- words
  const published = new Map(); // slug -> ["domain/subtopic", ...]
  const slugsAnywhere = new Set();
  const all = []; // {w, file, where}
  let wordFiles = 0;
  if (fs.existsSync(P.words)) {
    for (const d of fs.readdirSync(P.words)) {
      const dd = path.join(P.words, d);
      if (!fs.statSync(dd).isDirectory()) continue;
      for (const s of fs.readdirSync(dd)) {
        const sd = path.join(dd, s);
        if (!fs.statSync(sd).isDirectory()) continue;
        if (!subKey.has(`${d}/${s}`)) err(`content/words/${d}/${s}`, "folder is not a domain/subtopic in taxonomy.json");
        for (const f of listJson(sd)) {
          wordFiles++;
          const file = path.join(sd, f);
          const w = load(file);
          if (w) all.push({ w, file, d, s, f });
        }
      }
    }
  }
  for (const { w, file, d, s, f } of all) {
    const where = rel(file);
    if (w.domain !== d) err(where, `domain "${w.domain}" does not match folder "${d}"`);
    if (w.subtopic !== s) err(where, `subtopic "${w.subtopic}" does not match folder "${s}"`);
    if (!w.slug || !SLUG.test(w.slug)) err(where, `slug "${w.slug}" is missing or not lowercase-with-hyphens`);
    else if (`${w.slug}.json` !== f) err(where, `slug "${w.slug}" does not match file name`);
    if (!STATUS.includes(w.status)) err(where, `status must be one of ${STATUS.join("/")}`);
    // Hand-written stage-1 samples carry a "_note"; their rule breaks are only warnings. Cycle-written words must pass.
    for (const p of codeCheck(w, { domain: d, subtopic: s, taxonomy, isNew: false })) (w._note ? warn : err)(where, `${p}${w._note ? " (hand-written sample)" : ""}`);
    if (Array.isArray(w.related)) {
      if (new Set(w.related).size !== w.related.length) err(where, "related has duplicates");
      if (w.related.includes(w.slug)) err(where, "related points to the word itself");
      for (const r of w.related) if (!SLUG.test(r)) err(where, `related "${r}" is not a valid slug`);
    }
    if (w.status === "published") {
      const list = published.get(w.slug) ?? [];
      list.push(`${d}/${s}`);
      published.set(w.slug, list);
      if (!w._note && (!w.written_by || (w.checked_by ?? []).length < 2)) warn(where, "published without written_by / two checked_by");
    }
    slugsAnywhere.add(w.slug);
  }
  for (const [slug, where] of published) {
    if (where.length > 1) warn(`slug "${slug}"`, `used in ${where.join(" and ")} (ambiguous until permanent IDs, step 3)`);
  }

  // ---------- queue (also used to resolve "related" words that are not published yet)
  const queuedSlugs = new Set();
  for (const f of listJson(P.queue)) {
    const file = path.join(P.queue, f);
    const where = rel(file);
    const key = f.replace(/\.json$/, "").split("__");
    if (key.length !== 2 || !subKey.has(key.join("/"))) err(where, "file name must be <domain>__<subtopic> from taxonomy.json");
    const q = load(file);
    if (!q) continue;
    if (!Array.isArray(q)) { err(where, "must be a list"); continue; }
    const seen = new Set();
    for (const e of q) {
      if (!e?.term || typeof e.term !== "string") { err(where, "an entry has no term"); continue; }
      const sl = slugify(e.term);
      if (seen.has(sl)) err(where, `duplicate term "${e.term}"`);
      seen.add(sl);
      queuedSlugs.add(sl);
      if (published.has(sl) && published.get(sl).includes(key.join("/"))) warn(where, `"${e.term}" is already published`);
    }
  }

  // ---------- held
  const heldSlugs = new Set();
  for (const f of listJson(P.held)) {
    const file = path.join(P.held, f);
    const where = rel(file);
    const h = load(file);
    if (!h) continue;
    if (!subKey.has(`${h.domain}/${h.subtopic}`)) err(where, "domain/subtopic is not in taxonomy.json");
    if (!h.term) err(where, "term missing");
    if (!h.hold_reason) err(where, "hold_reason missing");
    if (h.status && h.status !== "held") err(where, `status should be "held", not "${h.status}"`);
    if (h.slug) heldSlugs.add(h.slug);
  }

  // ---------- "related" words that exist nowhere. data-model.md allows these (the site shows a plain tag and the
  // word should join the queue), so this is a WARNING for now; step 3 (permanent IDs) will make it an error.
  const dangling = new Map(); // slug -> count
  for (const { w } of all) {
    if (w.status !== "published" || !Array.isArray(w.related)) continue;
    for (const r of w.related) {
      if (!published.has(r) && !queuedSlugs.has(r) && !heldSlugs.has(r)) dangling.set(r, (dangling.get(r) ?? 0) + 1);
    }
  }
  if (dangling.size) warn("related", `${dangling.size} related slug(s) are in no word, queue or held list: ${[...dangling.keys()].join(", ")}`);

  // ---------- settings
  const settings = fs.existsSync(P.settings) ? load(P.settings) : null;
  for (const c of settings?.daily_caps ?? []) {
    if (!domainIds.has(c.domain)) err("content/settings/settings.json", `daily_caps domain "${c.domain}" is not in taxonomy.json`);
    if (!Number.isInteger(c.cap) || c.cap < 0) err("content/settings/settings.json", `cap for "${c.domain}" must be a whole number >= 0`);
  }

  // ---------- ledger (one JSON object per line)
  if (fs.existsSync(P.ledger)) {
    for (const f of fs.readdirSync(P.ledger).filter((x) => x.endsWith(".jsonl"))) {
      fs.readFileSync(path.join(P.ledger, f), "utf8").split("\n").filter(Boolean).forEach((line, i) => {
        try { JSON.parse(line); } catch { err(`content/ledger/${f}`, `line ${i + 1} is not valid JSON`); }
      });
    }
  }

  return { errors, warnings, counts: { words: wordFiles, queued: queuedSlugs.size, held: heldSlugs.size } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, warnings, counts } = validateContent();
  for (const w of warnings) console.warn(`WARNING  ${w}`);
  for (const e of errors) console.error(`ERROR    ${e}`);
  console.log(`\nContent check: ${counts.words ?? 0} words, ${counts.queued ?? 0} queued, ${counts.held ?? 0} held; ${errors.length} error(s), ${warnings.length} warning(s).`);
  if (errors.length) { console.error("Build stopped: fix the errors above."); process.exit(1); }
}
