// One hourly cycle: pick words -> write -> 6 checks -> publish or hold. Plain fixed steps, no "thinking agent".
// Usage:  node agent/cycle/cycle.mjs            (real; needs CYCLE_ENABLED=true + keys in env)
//         ITMEANS_ROOT=<scratch copy> node agent/cycle/cycle.mjs --mock   (fake models, no keys)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO, readJson, writeJson, ledgerAppend, ledgerRead, slugify, today, assignMissingIds, resolveRelated, removeFromQueue, loadWords, loadHeld } from "./lib.mjs";
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
  const doneIds = new Set([...loadWords().map((x) => x.w.id), ...loadHeld().map((x) => x.h.id)]); // already published or held
  for (const d of taxonomy.domains.filter((x) => x.active)) {
    const cap = settings.daily_caps?.find((c) => c.domain === d.id)?.cap ?? 0;
    let left = cap - done.filter((e) => e.domain === d.id).length;
    const subs = d.subtopics.map((s) => ({ s, n: wordCount(d.id, s.id) })).sort((a, b) => a.n - b.n);
    for (const { s } of subs) {
      if (left <= 0 || picks.length >= maxTotal) break;
      const qf = path.join(P.queue, `${d.id}__${s.id}.json`);
      const queue = readJson(qf, []).filter((q) => !doneIds.has(q.id) && !fs.existsSync(path.join(P.words, d.id, s.id, `${slugify(q.term)}.json`)) && !fs.existsSync(path.join(P.held, `${d.id}__${slugify(q.term)}.json`))); // skip published and held words
      queue.sort((a, b) => (!!b.both - !!a.both) || a.term.localeCompare(b.term));
      const take = queue.slice(0, Math.min(left, maxTotal - picks.length, 1)); // 1 per subtopic per pass = spreads across subtopics
      for (const q of take) { picks.push({ domain: d, sub: s, term: q.term, id: q.id }); left--; }
    }
  }
  return picks;
}

async function writeWord(pool, { domain, sub, term, id }, objections) {
  const slug = slugify(term);
  const { text, row } = await pool.ask("writer", prompt("write.md", {
    domain: domain.en, subtopic: sub.en, term, letter: term[0].toUpperCase(),
    objections: objections.length ? `A checker objected to your previous version. Fix these: ${objections.join("; ")}` : "",
  }));
  const f = extractJson(text);
  const word = { id, term, domain: domain.id, subtopic: sub.id, letter: term[0].toUpperCase(), slug, level: f.level, pronunciation_hi: f.pronunciation_hi,
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
async function backTranslation(pool, word, passScore, exclude = []) {
  const t = await pool.ask("checker", prompt("backtranslate.md", { hi: word.field_meaning.hi }), exclude);
  const back = extractJson(t.text).en;
  const c = await pool.ask("checker", prompt("compare.md", { en: word.field_meaning.en, back }), exclude);
  const r = extractJson(c.text);
  return r.same === true && r.score >= passScore ? [] : [`back-translation mismatch (score ${r.score})`];
}

/** Checks 1-5 on a finished word (written by a model, or by Claude through ingest.mjs). Returns {ok, reasons, word}. */
export async function runChecks(pool, item, ctx, word, writer) {
  const reasons = codeCheck(word, { domain: item.domain.id, subtopic: item.sub.id, taxonomy: ctx.taxonomy });
  if (reasons.length) return { ok: false, reasons };
  const s = await ctx.resolveSource(word.term, item.domain.id);
  if (!s.ok) return { ok: false, reasons: [s.reason] };
  const copied = copyCheck(word, s.text);
  if (copied.length) return { ok: false, reasons: copied };
  const ai = await aiChecks(pool, item.domain, item.sub, word, writer, ctx.passScore);
  if (ai.objections.length) return { ok: false, reasons: ai.objections };
  const bt = await backTranslation(pool, word, ctx.backPassScore, [ai.rows[0].company]); // a different checker than the first, to spread the free limits
  if (bt.length) return { ok: false, reasons: bt };
  Object.assign(word, { source_url: s.url, written_by: `${writer.service}/${writer.model}`, checked_by: ai.checkers, created_at: today(), checked_at: today() });
  return { ok: true, word };
}

export const heldRecord = (item, reasons) => ({ id: item.id, status: "held", term: item.term, domain: item.domain.id, subtopic: item.sub.id, slug: slugify(item.term), hold_reason: reasons[0], objections: reasons, created_at: today() });

async function processWord(pool, item, ctx) {
  let objections = [], res;
  for (let attempt = 1; attempt <= 2; attempt++) { // one fix attempt after objections
    const { word, writer } = await writeWord(pool, item, objections);
    res = await runChecks(pool, item, ctx, word, writer);
    if (res.ok) return res;
    objections = res.reasons;
  }
  return { ...res, held: heldRecord(item, res.reasons) };
}

/** Saves the outcome of one word: published file or held record, queue entry removed, ledger line. */
export function commitResult(item, res, dryRun) {
  if (res.ok) {
    // the writer names related TERMS; code turns them into permanent ids (new terms are reserved in the queue)
    res.word.related = resolveRelated(res.word.related, { domain: item.domain.id, sub: item.sub.id, selfId: item.id, write: !dryRun });
    if (!dryRun) { writeJson(path.join(P.words, item.domain.id, item.sub.id, `${res.word.slug}.json`), res.word); removeFromQueue(item.domain.id, item.sub.id, item.id); }
  } else {
    const held = res.held ?? heldRecord(item, res.reasons);
    if (!dryRun) { writeJson(path.join(P.held, `${item.domain.id}__${held.slug}.json`), held); removeFromQueue(item.domain.id, item.sub.id, item.id); }
  }
  ledgerNote({ kind: "word", outcome: res.ok ? "published" : "held", domain: item.domain.id, subtopic: item.sub.id, term: item.term, reason: res.ok ? null : res.reasons[0] }, dryRun);
}
export async function runCycle({ mock = false, dryRun = false, maxPerRun = 5, fetchImpl = fetch } = {}) {
  if (!mock && process.env.CYCLE_ENABLED !== "true") return ledgerNote({ kind: "skip", reason: "CYCLE_ENABLED is not true" }, dryRun);
  const settings = readJson(P.settings), taxonomy = readJson(P.taxonomy);
  if (settings.stop_all) return ledgerNote({ kind: "skip", reason: "stop_all is on" }, dryRun);
  const pause = readJson(P.pause, { paused: false });
  if (pause.paused) return ledgerNote({ kind: "skip", reason: `paused: ${pause.reason ?? ""}` }, dryRun);
  if (!dryRun) assignMissingIds(); // anything added by hand/CMS without an id gets one before picking
  const rows = mock ? MOCK_ROWS : readJson(P.models).models;
  const pool = new Pool(rows, { mock: mockModel, dryRun });
  const picks = pickWords(taxonomy, settings, maxPerRun);
  if (!picks.length) return ledgerNote({ kind: "skip", reason: "nothing to do (queue empty or daily cap reached)" }, dryRun);
  const ctx = { taxonomy, passScore: settings.checker_pass_score ?? 85, backPassScore: settings.backtranslation_pass_score ?? 70, resolveSource: mock ? mockResolve : (t, d) => resolveSource(t, d, fetchImpl) };
  let published = 0, held = 0, errors = 0;
  for (const item of picks) {
    let res;
    try { res = await processWord(pool, item, ctx); }
    catch (e) {
      // every model out of free limit is normal at the end of a day: not a failure. Anything else is an error (the CI run fails -> email).
      const limits = e.message.startsWith("no model available");
      ledgerNote({ kind: limits ? "limits" : "error", term: item.term, message: e.message }, dryRun);
      if (!limits) errors++;
      break;
    }
    commitResult(item, res, dryRun);
    if (res.ok) published++; else held++;
  }
  const paused = shouldPause(published + held, held, settings.pause_if_held_percent ?? 50);
  if (paused) { // check 6: pause rule. Own file, so the bot never edits settings.json (which belongs to the admin page)
    if (!dryRun) writeJson(P.pause, { paused: true, reason: `${held} of ${published + held} words held`, at: new Date().toISOString() });
    ledgerNote({ kind: "paused", reason: `${held} of ${published + held} words held this hour`, domain: null }, dryRun);
  }
  return { published, held, paused, errors };
}

function ledgerNote(e, dryRun) { if (!dryRun) ledgerAppend(e); else console.log("[dry]", JSON.stringify(e)); return e; }

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2), mock = args.includes("--mock");
  if (mock && !process.env.ITMEANS_ROOT) { console.error("--mock writes fake words. Set ITMEANS_ROOT to a scratch copy of the repo first."); process.exit(2); }
  const r = await runCycle({ mock, dryRun: args.includes("--dry"), maxPerRun: Number(args.find((a) => a.startsWith("--max="))?.slice(6) ?? 5) });
  console.log(JSON.stringify(r));
  if (r.paused || r.errors > 0) process.exitCode = 1; // makes the GitHub Actions run fail, so the owner gets an email
}
