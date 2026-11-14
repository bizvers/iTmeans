// One hourly cycle: pick words -> write -> 6 checks -> publish or hold. Plain fixed steps, no "thinking agent".
// Usage:  node agent/cycle/cycle.mjs            (real; needs CYCLE_ENABLED=true + keys in env)
//         ITMEANS_ROOT=<scratch copy> node agent/cycle/cycle.mjs --mock   (fake models, no keys)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO, readJson, writeJson, ledgerAppend, ledgerRead, slugify, today } from "./lib.mjs";
import { Pool, extractJson } from "./providers.mjs";
import { codeCheck, resolveSource, copyCheck, shouldPause } from "./checks.mjs";
import { MOCK_ROWS, mockModel, mockResolve } from "./mock.mjs";

const prompt = (name, vars) => {
  let t = fs.readFileSync(path.join(REPO, "agent/prompts", name), "utf8");
  for (const [k, v] of Object.entries(vars)) t = t.replaceAll(`{{${k}}}`, v);
  return t;
};
const Q = ["belongs_to_subtopic", "literal_ok", "field_ok", "effect_usage_ok", "hi_en_same", "level_ok"];
const wordCount = (d, s) => { const f = path.join(P.words, d, s); return fs.existsSync(f) ? fs.readdirSync(f).filter((x) => x.endsWith(".json")).length : 0; };

/** Pick the next words: per active domain up to its remaining daily cap, subtopic with fewest words first. */
export function pickWords(taxonomy, settings, maxTotal) {
  const done = ledgerRead().filter((e) => e.kind === "word" && e.outcome === "published");
  const picks = [];
  for (const d of taxonomy.domains.filter((x) => x.active)) {
    const cap = settings.daily_caps?.find((c) => c.domain === d.id)?.cap ?? 0;
    let left = cap - done.filter((e) => e.domain === d.id).length;
    const subs = d.subtopics.map((s) => ({ s, n: wordCount(d.id, s.id) })).sort((a, b) => a.n - b.n);
    for (const { s } of subs) {
      if (left <= 0 || picks.length >= maxTotal) break;
      const qf = path.join(P.queue, `${d.id}__${s.id}.json`);
      const queue = readJson(qf, []).filter((q) => !fs.existsSync(path.join(P.words, d.id, s.id, `${slugify(q.term)}.json`)) && !fs.existsSync(path.join(P.held, `${d.id}__${slugify(q.term)}.json`))); // skip published and held words
      queue.sort((a, b) => (!!b.both - !!a.both) || a.term.localeCompare(b.term));
      const take = queue.slice(0, Math.min(left, maxTotal - picks.length, 1)); // 1 per subtopic per pass = spreads across subtopics
      for (const q of take) { picks.push({ domain: d, sub: s, term: q.term }); left--; }
    }
  }
  return picks;
}

async function writeWord(pool, { domain, sub, term }, objections) {
  const slug = slugify(term);
  const { text, row } = await pool.ask("writer", prompt("write.md", {
    domain: domain.en, subtopic: sub.en, term, letter: term[0].toUpperCase(),
    objections: objections.length ? `A checker objected to your previous version. Fix these: ${objections.join("; ")}` : "",
  }));
  const f = extractJson(text);
  const word = { term, domain: domain.id, subtopic: sub.id, letter: term[0].toUpperCase(), slug, level: f.level, pronunciation_hi: f.pronunciation_hi,
    term_hi: f.term_hi ?? null, literal_meaning: f.literal_meaning, field_meaning: f.field_meaning, effect: f.effect, effect_flow: f.effect_flow,
    usage: f.usage, example: f.example, caution: f.caution, related: f.related, status: "published" };
  return { word, writer: row };
}

async function aiChecks(pool, domain, sub, word, writerRow, passScore) {
  const entry = JSON.stringify(word, null, 1);
  const vars = { domain: domain.en, subtopic: sub.en, term: word.term, entry };
  const c1 = await pool.ask("checker", prompt("check.md", vars), [writerRow.company]);
  const c2 = await pool.ask("checker", prompt("check.md", vars), [writerRow.company, c1.row.company]);
  const objections = [], verdicts = [];
  for (const c of [c1, c2]) {
    const r = extractJson(c.text);
    verdicts.push(`${c.row.service}/${c.row.model}`);
    const all = Q.every((q) => r[q] === true);
    if (!all || !(r.score >= passScore)) objections.push(...(r.objections?.length ? r.objections : [`${c.row.model}: failed a question or score ${r.score} < ${passScore}`]));
  }
  return { objections, checkers: verdicts, rows: [c1.row, c2.row] };
}

/** Check 5: Hindi field_meaning -> English by a model -> compare with the original English. */
async function backTranslation(pool, word, passScore) {
  const t = await pool.ask("checker", prompt("backtranslate.md", { hi: word.field_meaning.hi }));
  const back = extractJson(t.text).en;
  const c = await pool.ask("checker", prompt("compare.md", { en: word.field_meaning.en, back }));
  const r = extractJson(c.text);
  return r.same === true && r.score >= passScore ? [] : [`back-translation mismatch (score ${r.score})`];
}

async function processWord(pool, item, ctx) {
  let objections = [], reasons = [];
  for (let attempt = 1; attempt <= 2; attempt++) { // one fix attempt after objections
    const { word, writer } = await writeWord(pool, item, objections);
    reasons = codeCheck(word, { domain: item.domain.id, subtopic: item.sub.id, taxonomy: ctx.taxonomy });
    let sourceText = "", sourceUrl = null;
    if (!reasons.length) {
      const s = await ctx.resolveSource(word.term, item.domain.id);
      if (!s.ok) reasons.push(s.reason); else { sourceText = s.text; sourceUrl = s.url; }
      if (!reasons.length) reasons.push(...copyCheck(word, sourceText));
    }
    if (!reasons.length) {
      const ai = await aiChecks(pool, item.domain, item.sub, word, writer, ctx.passScore);
      reasons.push(...ai.objections);
      if (!reasons.length) reasons.push(...await backTranslation(pool, word, ctx.passScore));
      if (!reasons.length) {
        Object.assign(word, { source_url: sourceUrl, written_by: `${writer.service}/${writer.model}`, checked_by: ai.checkers, created_at: today(), checked_at: today() });
        return { ok: true, word };
      }
    }
    objections = reasons;
  }
  return { ok: false, reasons, held: { status: "held", term: item.term, domain: item.domain.id, subtopic: item.sub.id, slug: slugify(item.term), hold_reason: reasons[0], objections: reasons, created_at: today() } };
}

export async function runCycle({ mock = false, dryRun = false, maxPerRun = 5, fetchImpl = fetch } = {}) {
  if (!mock && process.env.CYCLE_ENABLED !== "true") return ledgerNote({ kind: "skip", reason: "CYCLE_ENABLED is not true" }, dryRun);
  const settings = readJson(P.settings), taxonomy = readJson(P.taxonomy);
  if (settings.stop_all) return ledgerNote({ kind: "skip", reason: "stop_all is on" }, dryRun);
  const rows = mock ? MOCK_ROWS : readJson(P.models).models;
  const pool = new Pool(rows, { mock: mockModel, dryRun });
  const picks = pickWords(taxonomy, settings, maxPerRun);
  if (!picks.length) return ledgerNote({ kind: "skip", reason: "nothing to do (queue empty or daily cap reached)" }, dryRun);
  const ctx = { taxonomy, passScore: settings.checker_pass_score ?? 85, resolveSource: mock ? mockResolve : (t, d) => resolveSource(t, d, fetchImpl) };
  let published = 0, held = 0;
  for (const item of picks) {
    let res;
    try { res = await processWord(pool, item, ctx); }
    catch (e) { ledgerNote({ kind: "error", term: item.term, message: e.message }, dryRun); break; } // e.g. every model out of limit: stop this hour
    if (res.ok) {
      if (!dryRun) writeJson(path.join(P.words, item.domain.id, item.sub.id, `${res.word.slug}.json`), res.word);
      published++;
    } else {
      if (!dryRun) writeJson(path.join(P.held, `${item.domain.id}__${res.held.slug}.json`), res.held);
      held++;
    }
    ledgerNote({ kind: "word", outcome: res.ok ? "published" : "held", domain: item.domain.id, subtopic: item.sub.id, term: item.term, reason: res.ok ? null : res.reasons[0] }, dryRun);
  }
  const paused = shouldPause(published + held, held, settings.pause_if_held_percent ?? 50);
  if (paused) { // check 6: pause rule -- flips the same "stop all" switch the admin page shows
    if (!dryRun) writeJson(P.settings, { ...settings, stop_all: true });
    ledgerNote({ kind: "paused", reason: `${held} of ${published + held} words held this hour`, domain: null }, dryRun);
  }
  return { published, held, paused };
}

function ledgerNote(e, dryRun) { if (!dryRun) ledgerAppend(e); else console.log("[dry]", JSON.stringify(e)); return e; }

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2), mock = args.includes("--mock");
  if (mock && !process.env.ITMEANS_ROOT) { console.error("--mock writes fake words. Set ITMEANS_ROOT to a scratch copy of the repo first."); process.exit(2); }
  const r = await runCycle({ mock, dryRun: args.includes("--dry"), maxPerRun: Number(args.find((a) => a.startsWith("--max="))?.slice(6) ?? 5) });
  console.log(JSON.stringify(r));
}
