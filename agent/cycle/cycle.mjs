// One hourly cycle: pick words -> write -> 6 checks -> publish or hold. Plain fixed steps, no "thinking agent".
// Usage:  node agent/cycle/cycle.mjs            (real; needs CYCLE_ENABLED=true + keys in env)
//         ITMEANS_ROOT=<scratch copy> node agent/cycle/cycle.mjs --mock   (fake models, no keys)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO, readJson, writeJson, ledgerAppend, ledgerRead, slugify, today, assignMissingIds, resolveRelated, removeFromQueue, loadWords, loadHeld, loadProgress, saveProgress } from "./lib.mjs";
import { Pool, extractJson } from "./providers.mjs";
import { codeCheck, resolveSource, copyCheck, shouldPause } from "./checks.mjs";
import { pickShort, topicFinished, topicCounts, topicKey, rulesFor } from "./topic.mjs";
import { makeFill, writeShortBatch, reviewJob, reviewStep, suggestTopics } from "./short.mjs";
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
    let left = settings.no_daily_cap ? Infinity : cap - done.filter((e) => e.domain === d.id).length;
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
    if (res.word.related != null) res.word.related = resolveRelated(res.word.related, { domain: item.domain.id, sub: item.sub.id, selfId: item.id, write: !dryRun }); // a short word has no related yet
    if (!dryRun) { writeJson(path.join(P.words, item.domain.id, item.sub.id, `${res.word.slug}.json`), res.word); removeFromQueue(item.domain.id, item.sub.id, item.id); }
  } else {
    const held = res.held ?? heldRecord(item, res.reasons);
    if (!dryRun) { writeJson(path.join(P.held, `${item.domain.id}__${held.slug}.json`), held); removeFromQueue(item.domain.id, item.sub.id, item.id); }
  }
  ledgerNote({ kind: "word", outcome: res.ok ? "published" : "held", domain: item.domain.id, subtopic: item.sub.id, term: item.term, reason: res.ok ? null : res.reasons[0] }, dryRun);
}
const isLimits = (e) => e.message.startsWith("no model available");

/** A short word that failed a check stays in the queue for one more try, then goes to the held list. */
function failShort(item, reasons, dryRun) {
  const qf = path.join(P.queue, `${item.domain.id}__${item.sub.id}.json`);
  const q = readJson(qf, []), e = q.find((x) => x.id === item.id);
  const tries = (e?.tries ?? 0) + 1;
  if (tries >= 2) { commitResult(item, { ok: false, reasons }, dryRun); return true; }
  if (e && !dryRun) writeJson(qf, q.map((x) => (x.id === item.id ? { ...x, tries } : x)));
  ledgerNote({ kind: "word", outcome: "retry", domain: item.domain.id, subtopic: item.sub.id, term: item.term, reason: reasons[0] }, dryRun);
  return false;
}

/**
 * Entry stage "short" (settings.entry_stage): one topic at a time, one word per letter in turn, short entries only.
 * Per word: code check, trusted source, copy check. The AI check is done in bulk: every 1000 words of a subject
 * three AIs review them together, and writing waits until that review is finished.
 */
async function runShort({ settings, taxonomy, pool, maxPerRun, dryRun, ctxBase }) {
  const progress = loadProgress();
  const out = { published: 0, held: 0, paused: false, errors: 0 };
  const save = () => { if (!dryRun) saveProgress(progress); };
  const fail = (e, term) => { const limits = isLimits(e); ledgerNote({ kind: limits ? "limits" : "error", term, message: e.message }, dryRun); if (!limits) out.errors++; save(); return out; };

  const active = taxonomy.domains.filter((d) => d.active);
  if (reviewJob(progress, settings, active)) { // 1. a review (due or running) comes before any new word; 20 steps x 50 words = a whole 1000-word review in one run
    try { const r = await reviewStep(pool, progress, taxonomy, { dryRun, steps: 20 }); out.held += r.held; ledgerNote({ kind: "review-step", done: r.done, checked: r.checked, held: r.held }, dryRun); }
    catch (e) { return fail(e, "review"); }
    save();
    if (progress.review_job) return out; // not finished (a free limit ran out): writing keeps waiting
  } // finished: go on and write in the same run

  let topic, picks, exhausted, rules;
  const room = (d) => settings.no_daily_cap ? Infinity : (settings.daily_caps?.find((c) => c.domain === d.id)?.cap ?? 0) - ledgerRead().filter((e) => e.kind === "word" && e.outcome === "published" && e.domain === d.id).length;
  try {
    const first = pickShort({ taxonomy, settings, progress, maxTotal: 0 });
    topic = (await first).topic;
    if (!topic) { ledgerNote({ kind: "skip", reason: "no open topic: waiting for the admin to approve a new topic" }, dryRun); return out; }
    const left = room(topic.d);
    if (left <= 0) { ledgerNote({ kind: "skip", reason: `daily cap reached for ${topic.d.id}` }, dryRun); return out; }
    ({ picks, exhausted, rules } = await pickShort({ taxonomy, settings, progress, maxTotal: Math.min(maxPerRun, left), fill: makeFill(pool, { d: topic.d, s: topic.s, dryRun }) }));
  } catch (e) { return fail(e, "pick"); }
  const key = topicKey(topic.d, topic.s);
  progress.exhausted[key] = exhausted;

  if (picks.length) {
    let results;
    try { results = await writeShortBatch(pool, picks); } catch (e) { return fail(e, picks[0].term); }
    for (const r of results) {
      let reasons = r.error ? [r.error] : [];
      if (!reasons.length) {
        reasons = codeCheck(r.word, { domain: r.item.domain.id, subtopic: r.item.sub.id, taxonomy });
        if (!r.word.kind.en) reasons.push("kind missing");
      }
      if (!reasons.length) {
        try {
          const s = await ctxBase.resolveSource(r.word.term, r.item.domain.id);
          if (!s.ok) reasons = [s.reason];
          else { reasons = copyCheck(r.word, s.text); r.word.source_url = s.url; }
        } catch (e) { return fail(e, r.item.term); }
      }
      if (reasons.length) {
        // no trusted source (and not a network hiccup): the answer will be the same next hour, so hold it now instead of trying again,
        // and do not count it for the pause rule: it is the source filter working, not an AI writing badly
        if (reasons.length === 1 && /^no trusted source/.test(reasons[0]) && /HTTP (5\d\d|429)|abort|timeout|fetch failed/i.test(reasons[0])) {
          // the source site was busy (e.g. Wikipedia "429 too many requests"): not the word's fault; it stays in the queue, no try counted
          ledgerNote({ kind: "word", outcome: "retry", domain: r.item.domain.id, subtopic: r.item.sub.id, term: r.item.term, reason: reasons[0] }, dryRun);
          continue;
        }
        if (reasons.length === 1 && /^no trusted source/.test(reasons[0])) {
          commitResult(r.item, { ok: false, reasons }, dryRun); out.held++; out.noSource = (out.noSource ?? 0) + 1; continue;
        }
        if (failShort(r.item, reasons, dryRun)) { out.held++; out.badHeld = (out.badHeld ?? 0) + 1; }
        continue;
      }
      Object.assign(r.word, { written_by: `${r.writer.service}/${r.writer.model}`, checked_by: [], created_at: today(), checked_at: null });
      commitResult(r.item, { ok: true, word: r.word }, dryRun);
      out.published++;
    }
  }

  // 2. is the topic finished? (target reached, or every letter full or without more words)
  const counts = topicCounts(topic.d.id, topic.s.id);
  progress.total_published = loadWords().filter((x) => x.w.status === "published").length;
  if (topicFinished(rules, counts, exhausted)) {
    progress.done_topics.push(key);
    (progress.suggest_pending ??= []).push(key);
    ledgerNote({ kind: "topic-done", domain: topic.d.id, subtopic: topic.s.id, words: counts.total }, dryRun);
  }
  for (const k of [...(progress.suggest_pending ?? [])]) { // 3. five new topic names for the admin (retried next hour if the models are busy)
    const [di, si] = k.split("/"), d = taxonomy.domains.find((x) => x.id === di), s = d?.subtopics.find((x) => x.id === si);
    try { if (d && s) await suggestTopics(pool, taxonomy, { d, s }, { dryRun }); progress.suggest_pending = progress.suggest_pending.filter((x) => x !== k); }
    catch (e) { ledgerNote({ kind: "suggest-failed", topic: k, message: e.message }, dryRun); }
  }
  save();
  // pause rule: only words held for a bad entry count (a real run paused itself on 63 words that merely had no source page)
  const bad = out.badHeld ?? 0;
  out.paused = shouldPause(out.published + bad, bad, settings.pause_if_held_percent ?? 50);
  if (out.paused) {
    if (!dryRun) writeJson(P.pause, { paused: true, reason: `${bad} of ${out.published + bad} words held for a bad entry`, at: new Date().toISOString() });
    ledgerNote({ kind: "paused", reason: `${bad} of ${out.published + bad} words held for a bad entry this hour`, domain: null }, dryRun);
  }
  return out;
}

const timedFetch = (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(30000) }); // a source site that hangs must not block the run
export async function runCycle({ mock = false, dryRun = false, maxPerRun = 5, fetchImpl = timedFetch } = {}) {
  if (!mock && process.env.CYCLE_ENABLED !== "true") return ledgerNote({ kind: "skip", reason: "CYCLE_ENABLED is not true" }, dryRun);
  const settings = readJson(P.settings), taxonomy = readJson(P.taxonomy);
  if (settings.stop_all) return ledgerNote({ kind: "skip", reason: "stop_all is on" }, dryRun);
  const pause = readJson(P.pause, { paused: false });
  if (pause.paused) return ledgerNote({ kind: "skip", reason: `paused: ${pause.reason ?? ""}` }, dryRun);
  if (!dryRun) assignMissingIds(); // anything added by hand/CMS without an id gets one before picking
  const rows = mock ? MOCK_ROWS : readJson(P.models).models;
  const pool = new Pool(rows, { mock: mockModel, dryRun, balance: settings.entry_stage === "short" });
  const ctx = { taxonomy, passScore: settings.checker_pass_score ?? 85, backPassScore: settings.backtranslation_pass_score ?? 70, resolveSource: mock ? mockResolve : (t, d) => resolveSource(t, d, fetchImpl) };
  if (settings.entry_stage === "short") return runShort({ settings, taxonomy, pool, maxPerRun, dryRun, ctxBase: ctx });
  const picks = pickWords(taxonomy, settings, maxPerRun);
  if (!picks.length) return ledgerNote({ kind: "skip", reason: "nothing to do (queue empty or daily cap reached)" }, dryRun);
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
