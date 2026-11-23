// Content gate: checks every file under content/ and exits 1 on any ERROR (so the build stops).
// WARNINGs are printed but do not stop the build. No dependencies; independent of Astro.
// Run: node scripts/validate-content.mjs     (also runs automatically before `npm run build` in site/)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { P, readJson, slugify, ID_RE } from "../agent/cycle/lib.mjs";
import { codeCheck, hasDetail } from "../agent/cycle/checks.mjs";

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
      if (s.group !== undefined && !(d.groups ?? []).some((g) => g.id === s.group)) err("taxonomy", `subtopic "${d.id}/${s.id}" has group "${s.group}" that is not in the domain's groups`);
    }
    for (const g of d.groups ?? []) if (!g.id || !g.en || !g.hi) err("taxonomy", `group in domain "${d.id}" needs id, en and hi`);
  }

  // ---------- words
  const published = new Set(); // ids of published words
  const owner = new Map(); // id -> where it lives; an id may belong to exactly ONE record
  const claimId = (id, where, what) => {
    if (!id) return err(where, `${what} has no permanent id (run: npm run assign-ids)`);
    if (!ID_RE.test(id)) return err(where, `${what} id "${id}" is not in the form w-xxxxxxxx`);
    if (owner.has(id)) return err(where, `id ${id} is already used by ${owner.get(id)}`);
    owner.set(id, where);
  };
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
    claimId(w.id, where, "word");
    if (Array.isArray(w.related)) {
      if (new Set(w.related).size !== w.related.length) err(where, "related has duplicates");
      if (w.related.includes(w.id)) err(where, "related points to the word itself");
      for (const r of w.related) if (!ID_RE.test(r)) err(where, `related "${r}" is not a permanent id (w-xxxxxxxx)`);
    }
    if (w.status === "published") {
      published.add(w.id);
      // a short word (detail fields still empty) is checked later, in the review of every 1000 words; only a full word is expected to carry two checkers now
      if (!w._note && (!w.written_by || (hasDetail(w) && (w.checked_by ?? []).length < 2))) warn(where, "published without written_by / two checked_by");
    }
  }

  // ---------- queue
  let queuedCount = 0;
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
      queuedCount++;
      if (published.has(e.id)) warn(where, `"${e.term}" is already published (remove it from the queue)`);
      else claimId(e.id, where, `queue entry "${e.term}"`);
    }
  }

  // ---------- held
  let heldCount = 0;
  for (const f of listJson(P.held)) {
    const file = path.join(P.held, f);
    const where = rel(file);
    const h = load(file);
    if (!h) continue;
    if (!subKey.has(`${h.domain}/${h.subtopic}`)) err(where, "domain/subtopic is not in taxonomy.json");
    if (!h.term) err(where, "term missing");
    if (!h.hold_reason) err(where, "hold_reason missing");
    if (h.status && h.status !== "held") err(where, `status should be "held", not "${h.status}"`);
    heldCount++;
    claimId(h.id, where, "held record");
  }

  // ---------- "related" must point at a real id (a word, a queued term or a held word): a broken reference is an ERROR
  for (const { w, file } of all) {
    if (!Array.isArray(w.related)) continue;
    for (const r of w.related) if (ID_RE.test(r) && !owner.has(r)) err(rel(file), `related "${r}" does not exist anywhere (broken reference)`);
  }

  // ---------- website words per language (content/ui/<lang>.json): every active language needs every key of en.json
  const activeLangs = (taxonomy.languages ?? []).filter((l) => l.active).map((l) => l.code);
  const uiFile = (code) => path.join(P.ui, `${code}.json`);
  const uiEn = fs.existsSync(uiFile("en")) ? load(uiFile("en")) : (err("content/ui/en.json", "missing (English is the base for every language)"), {});
  for (const code of activeLangs) {
    if (code === "en") continue;
    if (!fs.existsSync(uiFile(code))) { err(`content/ui/${code}.json`, `missing, but language "${code}" is active`); continue; }
    const u = load(uiFile(code)) ?? {};
    const missing = Object.keys(uiEn ?? {}).filter((k) => !String(u[k] ?? "").trim());
    if (missing.length) err(`content/ui/${code}.json`, `missing text for: ${missing.join(", ")}`);
    const extra = Object.keys(u).filter((k) => !(k in (uiEn ?? {})));
    if (extra.length) warn(`content/ui/${code}.json`, `keys not in en.json: ${extra.join(", ")}`);
  }

  // ---------- translations: hi and en live inside the word file; every other language in content/translations/<lang>/<word id>.json
  const CORE = ["hi", "en"], FIELDS = ["literal_meaning", "field_meaning", "effect", "usage", "example", "caution"];
  const translated = new Map(); // lang -> Set of word ids
  if (fs.existsSync(P.translations)) {
    for (const lang of fs.readdirSync(P.translations).filter((x) => fs.statSync(path.join(P.translations, x)).isDirectory())) {
      const where0 = `content/translations/${lang}`;
      if (CORE.includes(lang)) { err(where0, `"${lang}" text lives inside the word file, not here`); continue; }
      if (!langCodes.has(lang)) { err(where0, `"${lang}" is not a language in taxonomy.json`); continue; }
      const ids = new Set();
      for (const f of listJson(path.join(P.translations, lang))) {
        const file = path.join(P.translations, lang, f), where = `${where0}/${f}`;
        const id = f.replace(/\.json$/, "");
        if (!published.has(id)) err(where, `"${id}" is not the id of a published word`);
        const t = load(file);
        if (!t) continue;
        ids.add(id);
        // like a word: short = pronunciation (in that language's script) + field_meaning; the detail fields all or none
        // (scale step s5, 23 Nov 2026; a missing detail field shows English on the page)
        for (const k of ["pronunciation", "field_meaning"]) if (!String(t[k] ?? "").trim()) err(where, `${k} is missing`);
        const DETAIL = FIELDS.filter((k) => k !== "field_meaning");
        const some = DETAIL.some((k) => t[k] !== undefined) || t.effect_flow !== undefined;
        if (some) {
          for (const k of DETAIL) if (!String(t[k] ?? "").trim()) err(where, `${k} is missing (detail fields are all or none)`);
          if (!Array.isArray(t.effect_flow) || t.effect_flow.length !== 3 || t.effect_flow.some((x) => !String(x ?? "").trim())) err(where, "effect_flow needs exactly 3 steps");
        }
      }
      translated.set(lang, ids);
    }
  }
  for (const code of activeLangs.filter((c) => !CORE.includes(c))) {
    const have = translated.get(code)?.size ?? 0;
    if (have < published.size) warn(`language "${code}"`, `${published.size - have} of ${published.size} published words have no translation yet (English is shown)`);
  }

  // ---------- settings
  const settings = fs.existsSync(P.settings) ? load(P.settings) : null;
  for (const c of settings?.daily_caps ?? []) {
    if (!domainIds.has(c.domain)) err("content/settings/settings.json", `daily_caps domain "${c.domain}" is not in taxonomy.json`);
    if (!Number.isInteger(c.cap) || c.cap < 0) err("content/settings/settings.json", `cap for "${c.domain}" must be a whole number >= 0`);
  }

  const whole = (x) => Number.isInteger(x) && x >= 0;
  if (settings && !["short", "full", undefined].includes(settings.entry_stage)) err("content/settings/settings.json", `entry_stage must be "short" or "full"`);
  const checkRule = (where, r) => {
    for (const k of ["min", "max", "target", "review_every", "popular_target"]) if (r?.[k] !== undefined && !whole(r[k])) err(where, `${k} must be a whole number >= 0`);
    if (r?.min !== undefined && r?.max !== undefined && r.min > r.max) err(where, "min is more than max");
  };
  checkRule("content/settings/settings.json topic_defaults", settings?.topic_defaults);
  for (const [k, r] of Object.entries(settings?.topic_rules ?? {})) {
    if (!subKey.has(k)) err("content/settings/settings.json", `topic_rules "${k}" is not a domain/subtopic in taxonomy.json`);
    checkRule(`content/settings/settings.json topic_rules ${k}`, r);
  }
  for (const [k, r] of Object.entries(settings?.domain_rules ?? {})) {
    if (!domainIds.has(k)) err("content/settings/settings.json", `domain_rules "${k}" is not a domain in taxonomy.json`);
    if (r?.mode !== undefined && !["letters", "popular"].includes(r.mode)) err("content/settings/settings.json", `domain_rules ${k}: mode must be "letters" or "popular"`);
    checkRule(`content/settings/settings.json domain_rules ${k}`, r);
  }
  if (settings?.current_topic && !subKey.has(settings.current_topic)) err("content/settings/settings.json", `current_topic "${settings.current_topic}" is not a domain/subtopic in taxonomy.json`);

  // ---------- ledger (one JSON object per line)
  if (fs.existsSync(P.ledger)) {
    for (const f of fs.readdirSync(P.ledger).filter((x) => x.endsWith(".jsonl"))) {
      fs.readFileSync(path.join(P.ledger, f), "utf8").split("\n").filter(Boolean).forEach((line, i) => {
        try { JSON.parse(line); } catch { err(`content/ledger/${f}`, `line ${i + 1} is not valid JSON`); }
      });
    }
  }

  return { errors, warnings, counts: { words: wordFiles, queued: queuedCount, held: heldCount } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, warnings, counts } = validateContent();
  for (const w of warnings) console.warn(`WARNING  ${w}`);
  for (const e of errors) console.error(`ERROR    ${e}`);
  console.log(`\nContent check: ${counts.words ?? 0} words, ${counts.queued ?? 0} queued, ${counts.held ?? 0} held; ${errors.length} error(s), ${warnings.length} warning(s).`);
  if (errors.length) { console.error("Build stopped: fix the errors above."); process.exit(1); }
}
