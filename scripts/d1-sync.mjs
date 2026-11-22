// Fills the D1 search database (itmeans-search) with the published words, for full-text search over names and
// meanings (scale step s3, layer 2; read by site/src/pages/api/search.ts).
//   node scripts/d1-sync.mjs --local     the copy `wrangler dev` uses (site/.wrangler)
//   node scripts/d1-sync.mjs --remote    the real database (needs `wrangler login` or CLOUDFLARE_API_TOKEN)
//   add --all to empty it and load everything again, --dry to only write the SQL and say what would change
// Only what changed is sent: each row keeps a hash of its contents, and the script compares with the database first
// (the free plan allows 100,000 rows written a day, so a full reload of a big dictionary must stay rare).
// Tables:
//   words   n (row number), id, h (hash), d/s/g (address), t (name), p (pronunciation), mhi/men (meaning, for display)
//   search  FTS5 index, rowid = words.n: kt (name, Hindi name), kp (pronunciation), khi / ken (meaning)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { P, readJson } from "../agent/cycle/lib.mjs";
import { ftsText } from "../site/src/lib/search-key.mjs";

const REPO = path.resolve(path.dirname(P.taxonomy), "..", "..");
const SITE = path.join(REPO, "site");
const WRANGLER = path.join(SITE, "node_modules", "wrangler", "bin", "wrangler.js");
const DB = "itmeans-search";
const has = (f) => process.argv.includes(`--${f}`);
const where = has("remote") ? "--remote" : has("local") ? "--local" : null;
if (!where) { console.error("d1-sync: say --local or --remote"); process.exit(2); }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS words (n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, h TEXT NOT NULL,
  d TEXT NOT NULL, s TEXT NOT NULL, g TEXT NOT NULL, t TEXT NOT NULL, p TEXT, mhi TEXT, men TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(kt, kp, khi, ken, tokenize = "unicode61 categories 'L* N* Co M*'");`;

function wrangler(args) {
  const r = spawnSync(process.execPath, [WRANGLER, "d1", "execute", DB, where, ...args], { cwd: SITE, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`wrangler failed (${r.status}):\n${(r.stderr || r.stdout || "").slice(-2000)}`);
  return r.stdout;
}
const runSql = (sql) => {
  const f = path.join(os.tmpdir(), `itm-d1-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(f, sql);
  try { return wrangler(["--file", f, "--yes"]); } finally { fs.rmSync(f, { force: true }); }
};
const query = (sql) => {
  const out = wrangler(["--command", sql, "--json"]);
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
};

// every published word of the active domains (as on the website)
const taxonomy = readJson(P.taxonomy);
const C = path.join(REPO, "content");
const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f)) : []);
const rows = new Map();
for (const d of taxonomy.domains.filter((x) => x.active)) for (const s of d.subtopics) for (const f of jsonFiles(path.join(C, "words", d.id, s.id))) {
  const w = readJson(f);
  if (w.status !== "published") continue;
  const m = w.field_meaning ?? {};
  const row = {
    id: w.id, d: w.domain, s: w.subtopic, g: w.slug, t: w.term, p: w.pronunciation_hi ?? null,
    mhi: m.hi ? String(m.hi).slice(0, 300) : null, men: m.en ? String(m.en).slice(0, 300) : null,
    kt: ftsText([w.term, w.term_hi].filter(Boolean).join(" ")), kp: ftsText(w.pronunciation_hi),
    khi: ftsText([m.hi, w.kind?.hi].filter(Boolean).join(" ")), ken: ftsText([m.en, w.kind?.en].filter(Boolean).join(" ")),
  };
  row.h = crypto.createHash("sha1").update(JSON.stringify(row)).digest("hex").slice(0, 16);
  rows.set(w.id, row);
}

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const sql = [];
if (has("all")) sql.push("DROP TABLE IF EXISTS search;", "DROP TABLE IF EXISTS words;");
if (!has("dry")) runSql(sql.splice(0).join("\n") + SCHEMA);

const have = new Map();
if (!has("dry") || !has("all")) {
  try { for (const r of query("SELECT id, h FROM words")) have.set(r.id, r.h); } catch (e) { if (!has("dry")) throw e; }
}
let added = 0, changed = 0, removed = 0;
const drop = (id) => sql.push(`DELETE FROM search WHERE rowid IN (SELECT n FROM words WHERE id = ${q(id)});`, `DELETE FROM words WHERE id = ${q(id)};`);
for (const [id, h] of have) if (!rows.has(id)) { drop(id); removed++; }
for (const r of rows.values()) {
  const old = have.get(r.id);
  if (old === r.h) continue;
  if (old) { drop(r.id); changed++; } else added++;
  sql.push(
    `INSERT INTO words (id, h, d, s, g, t, p, mhi, men) VALUES (${[r.id, r.h, r.d, r.s, r.g, r.t, r.p, r.mhi, r.men].map(q).join(", ")});`,
    `INSERT INTO search (rowid, kt, kp, khi, ken) VALUES (last_insert_rowid(), ${[r.kt, r.kp, r.khi, r.ken].map(q).join(", ")});`,
  );
}
console.log(`d1-sync ${where}: ${rows.size} words; ${added} new, ${changed} changed, ${removed} removed`);
if (has("dry")) {
  const f = path.join(os.tmpdir(), "itm-d1-dry.sql");
  fs.writeFileSync(f, sql.join("\n"));
  console.log(`  SQL written to ${f}`);
} else if (sql.length) {
  // one file per few thousand statements, so a single failure does not undo everything
  const STEP = 4000;
  for (let i = 0; i < sql.length; i += STEP) {
    runSql(sql.slice(i, i + STEP).join("\n"));
    console.log(`  ${Math.min(i + STEP, sql.length)}/${sql.length} statements`);
  }
}
