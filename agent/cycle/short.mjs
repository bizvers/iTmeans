// Entry stage "short": the extra steps around the normal cycle -- listing words per letter, writing short entries,
// the review of every 1000 words by three AIs together, and the 5 topic suggestions after a topic is finished.
// A short entry is the SAME word file as a full one with the detail fields still empty (see checks.mjs hasDetail).
import fs from "node:fs";
import path from "node:path";
import { P, REPO, readJson, writeJson, slugify, today, newId, takenIds, loadWords, ledgerAppend, canon, usedKeys } from "./lib.mjs";
import { extractJson, extractTerms } from "./providers.mjs";
import { usedTerm } from "./topic.mjs";

const prompt = (name, vars) => {
  let t = fs.readFileSync(path.join(REPO, "agent/prompts", name), "utf8");
  for (const [k, v] of Object.entries(vars)) t = t.replaceAll(`{{${k}}}`, String(v));
  return t;
};
const note = (e, dry) => (dry ? console.log("[dry]", JSON.stringify(e)) : ledgerAppend(e));

/**
 * Word lists: two models of different companies list popular terms; terms both name come first. New terms go to the queue file.
 * fill(letter)        one letter (or "*" = any letter, for a "popular words" topic)
 * fill.many(letters)  MANY letters in ONE request per model (a new topic needs 26 letters: 2 requests instead of 52)
 * Both return how many new terms were added (per letter for many).
 */
const POPULAR_PART = 40;
/** Terms this topic already has (published, held or queued), newest last, at most 300 names. */
function alreadyHave(domainId, subId) {
  const names = loadWords().filter((x) => x.domain === domainId && x.sub === subId).map((x) => x.w.term);
  if (fs.existsSync(P.held)) for (const f of fs.readdirSync(P.held).filter((x) => x.startsWith(`${domainId}__`) && x.endsWith(".json"))) {
    const h = readJson(path.join(P.held, f), null);
    if (h?.subtopic === subId && h.term) names.push(h.term);
  }
  for (const q of readJson(path.join(P.queue, `${domainId}__${subId}.json`), [])) names.push(q.term);
  return [...new Set(names)].slice(-300);
}

export function makeFill(pool, { d, s, dryRun = false }) {
  const norm = (t) => t.toLowerCase();
  const clean = (arr, letter) => (Array.isArray(arr) ? arr : []).filter((t) => typeof t === "string" && /^[A-Za-z]/.test(t.trim()) && (letter === "*" || t.trim()[0].toUpperCase() === letter)).map((t) => t.trim());
  async function askTwo(text) { // replies of up to two different companies
    const replies = [], used = [];
    for (let i = 0; i < 2; i++) {
      try { const r = await pool.ask("list", text, used); used.push(r.row.company); replies.push(extractTerms(r.text)); }
      catch (e) { if (!/^no model available/.test(e.message) && !/JSON/.test(e.message)) throw e; }
    }
    return replies;
  }
  function addToQueue(letter, lists) {
    if (!lists.length) return 0;
    const both = lists.length > 1 ? lists[0].filter((t) => lists[1].some((x) => norm(x) === norm(t))) : [];
    const all = [...new Map(lists.flat().map((t) => [norm(t), t])).values()];
    const qf = path.join(P.queue, `${d.id}__${s.id}.json`);
    const old = readJson(qf, []);
    const have = new Set(old.map((q) => canon(q.term))); // this topic's queue; published and held words of the whole subject are checked by usedTerm below
    const taken = takenIds();
    const add = all.filter((t) => { const k = canon(t); if (have.has(k) || usedTerm(d.id, t)) return false; have.add(k); return true; }).map((t) => ({ id: newId(taken), term: t, both: both.some((b) => norm(b) === norm(t)) }));
    if (add.length && !dryRun) writeJson(qf, [...old, ...add]);
    note({ kind: "list", domain: d.id, subtopic: s.id, letter, added: add.length }, dryRun);
    return add.length;
  }
  const fill = async (letter, rules) => {
    // a "popular" topic is asked in parts of POPULAR_PART (a 100-word list came back cut off), naming what it already has
    // so the next part brings NEW words instead of the same famous ones again
    const n = letter === "*" ? Math.min(POPULAR_PART, rules.target) : rules.max;
    const avoid = letter === "*" ? alreadyHave(d.id, s.id) : [];
    const avoidLine = avoid.length ? `Already in the dictionary, do NOT list these again: ${avoid.join("; ")}.` : "";
    const replies = await askTwo(prompt("list-letter.md", { n, domain: d.en, subtopic: s.en, letter: letter === "*" ? "(any letter)" : letter, avoid: avoidLine }));
    if (!replies.length) return null; // no model answered: unknown, NOT "no more words"
    return addToQueue(letter, replies.map((t) => clean(t, letter)));
  };
  fill.many = async (letters, rules) => { // in groups of 6 letters: a list of all 26 at once came back cut off
    const added = {};
    for (let i = 0; i < letters.length; i += 6) {
      const group = letters.slice(i, i + 6);
      const replies = await askTwo(prompt("list-letters.md", { n: rules.max, domain: d.en, subtopic: s.en, letters: group.join(", ") }));
      if (!replies.length) continue; // no model answered: these letters are left out (asked again one by one if needed)
      for (const l of group) added[l] = addToQueue(l, replies.filter((r) => r && typeof r === "object").map((r) => clean(r[l], l)));
    }
    return added;
  };
  return fill;
}

/**
 * The picked words are shared out, one by one in turn, between up to THREE different AIs (different companies, the least-used first);
 * each AI writes its share in one request. Returns [{item, word, writer} | {item, error}] for the shares that were written.
 * A share whose reply is bad is tried once more by another company; if it still fails it is skipped (its words stay in the
 * queue, not counted as a failed try). Only when every share failed is the error thrown.
 */
const CHUNK = 15; // most words one AI writes in one request: 40 was tried for real and the free models' replies came back cut off
export async function writeShortBatch(pool, picks) {
  const { domain, sub } = picks[0];
  const companies = [...new Set(pool.available("writer").map((r) => r.company))];
  // at least one share per AI (all of them write), and more shares when there are hundreds of words
  const n = Math.max(Math.min(companies.length || 1, picks.length), Math.ceil(picks.length / CHUNK));
  const shares = Array.from({ length: n }, () => []);
  picks.forEach((p, i) => shares[i % n].push(p));
  // Every company works AT THE SAME TIME in its own lane and takes the next share as soon as it is free (user's wish, 17 Nov 2026):
  // a fast AI writes many shares, a slow one fewer, and a slow one no longer holds the others up.
  const jobs = shares.map((share) => ({ share, tried: [] }));
  const out = [];
  let lastError = null, written = 0;
  const lane = async (company) => {
    const others = companies.filter((c) => c !== company);
    for (;;) {
      const job = jobs.find((j) => !j.tried.includes(company));
      if (!job) return;
      jobs.splice(jobs.indexOf(job), 1);
      job.tried.push(company);
      const text0 = prompt("write-short.md", { domain: domain.en, subtopic: sub.en, terms: job.share.map((p) => `"${p.term}"`).join(", ") });
      let r;
      try { r = await pool.ask("writer", text0, others); }
      catch (e) { lastError = e; jobs.push(job); return; } // this company is out (limit used up / not answering): another lane takes the share
      let got;
      try { got = new Map((extractJson(r.text).entries ?? []).map((e) => [String(e.term).toLowerCase(), e])); }
      catch (e) { lastError = e; if (job.tried.length < 2) jobs.push(job); continue; } // a bad (cut-off) reply: once more, by another company
      written++;
      collect(job.share, got, r.row);
    }
  };
  const collect = (share, got, row) => {
    for (const item of share) {
      const e = got.get(item.term.toLowerCase());
      if (!e) { out.push({ item, error: "model gave no entry for this term" }); continue; }
      const word = { id: item.id, term: item.term, domain: item.domain.id, subtopic: item.sub.id, letter: item.term[0].toUpperCase(), slug: slugify(item.term),
        pronunciation_hi: e.pronunciation_hi, field_meaning: { hi: e.meaning_hi }, kind: { en: String(e.kind_en ?? "").toLowerCase().trim(), hi: String(e.kind_hi ?? "").trim() }, status: "published" };
      out.push({ item, word, writer: row });
    }
  };
  await Promise.all(companies.map(lane));
  if (!written && lastError) throw lastError; // nothing at all was written; unwritten shares stay in the queue for the next run
  return out;
}

// ---------------------------------------------------------------- review: every `review_every` words of a subject, three AIs together
const BATCH = 50; // words per review request: 1000 words = 20 requests per AI, so one day's free limit is enough
const unchecked = (domain) => loadWords().filter((x) => x.domain === domain && x.w.status === "published" && !(x.w.checked_by ?? []).length)
  .sort((a, b) => (a.w.created_at ?? "").localeCompare(b.w.created_at ?? "") || a.w.term.localeCompare(b.w.term));

/** Is a review running, or due (>= review_every unchecked words in a subject)? Returns the job (and saves it into progress) or null. */
export function reviewJob(progress, settings, domains) {
  if (progress.review_job) return progress.review_job;
  const every = settings.topic_defaults?.review_every ?? 1000;
  for (const d of domains) {
    const list = unchecked(d.id);
    if (list.length >= every) return (progress.review_job = { domain: d.id, ids: list.slice(0, every).map((x) => x.w.id), next: 0, started: today() });
  }
  return null;
}

export const MIN_AGREE = 2; // a word is kept when at least this many of the checking AIs (different companies) find no fault (user's decision, 16 Nov 2026)

/** Asks EVERY available company (up to five) about one batch. At least MIN_AGREE must answer; otherwise nothing is applied and the same batch is retried. */
async function askAll(pool, text) {
  const comps = [...new Set([...pool.available("checker"), ...pool.available("writer")].map((r) => r.company))];
  // all companies are asked at the same time; one that is slow, out of its limit or unreadable simply does not count
  const replies = await Promise.all(comps.map(async (c) => {
    const others = comps.filter((x) => x !== c);
    try {
      const r = await pool.ask("checker", text, others).catch(() => pool.ask("writer", text, others));
      return { row: r.row, bad: extractJson(r.text).bad ?? [] };
    } catch { return null; }
  }));
  const answers = replies.filter(Boolean);
  if (answers.length < MIN_AGREE) throw new Error(`review: only ${answers.length} AI(s) answered, ${MIN_AGREE} needed; the same batch is retried next run`);
  return answers;
}

/** Works on the running review; returns {done, checked, held}. Words any AI doubts go to the held list (off the site). */
export async function reviewStep(pool, progress, taxonomy, { steps = 4, dryRun = false } = {}) {
  const job = progress.review_job;
  const d = taxonomy.domains.find((x) => x.id === job.domain);
  let checked = 0, held = 0;
  for (let k = 0; k < steps && job.next < job.ids.length; k++) {
    const ids = job.ids.slice(job.next, job.next + BATCH);
    const items = ids.map((id) => loadWords().find((x) => x.w.id === id)).filter(Boolean);
    if (items.length) {
      const entries = items.map((x) => `- ${x.w.term} | ${x.w.pronunciation_hi} | ${x.w.field_meaning.hi} | kind: ${x.w.kind?.en ?? ""} | topic: ${x.sub}`).join("\n");
      const answers = await askAll(pool, prompt("review.md", { domain: d.en, entries }));
      const objections = new Map();
      for (const a of answers) for (const b of a.bad) {
        const key = String(b.term ?? "").toLowerCase();
        objections.set(key, [...(objections.get(key) ?? []), { company: a.row.company, text: `${a.row.company}: ${b.reason ?? "doubtful"}` }]);
      }
      for (const x of items) {
        const obj = objections.get(x.w.term.toLowerCase()) ?? [];
        const agreed = answers.filter((a) => !obj.some((o) => o.company === a.row.company));
        const why = agreed.length >= MIN_AGREE ? null : obj.map((o) => o.text);        if (why) {
          held++;
          if (!dryRun) {
            writeJson(path.join(P.held, `${x.domain}__${x.w.slug}.json`), { id: x.w.id, status: "held", term: x.w.term, domain: x.domain, subtopic: x.sub, slug: x.w.slug, hold_reason: `review: ${why[0]}`, objections: why, created_at: today() });
            fs.unlinkSync(x.file);
          }
        } else {
          checked++;
          const by = agreed.map((a) => `${a.row.service}/${a.row.model}`); // only the AIs that found no fault; objections stay in the ledger/review note
          if (!dryRun) writeJson(x.file, { ...x.w, checked_by: by, checked_at: today(), ...(obj.length ? { review_objections: obj.map((o) => o.text) } : {}) });
        }
      }
    }
    job.next += ids.length;
    note({ kind: "review", domain: job.domain, upto: job.next, of: job.ids.length, held }, dryRun);
  }
  const done = job.next >= job.ids.length;
  if (done) progress.review_job = null;
  return { done, checked, held };
}

// ---------------------------------------------------------------- 5 new topic names after a topic is finished
export async function suggestTopics(pool, taxonomy, { d, s }, { dryRun = false } = {}) {
  const existing = d.subtopics.map((x) => x.en).join(", ");
  const r = await pool.ask("list", prompt("suggest.md", { finished: s.en, domain: d.en, existing }));
  const have = new Set(taxonomy.domains.flatMap((x) => x.subtopics.map((y) => `${x.id}/${y.id}`)));
  const list = readJson(P.suggestions, []);
  const add = [];
  for (const t of extractJson(r.text).topics ?? []) {
    const en = String(t.en ?? "").trim(), hi = String(t.hi ?? "").trim(), id = slugify(en).slice(0, 40);
    if (!en || !hi || !id || have.has(`${d.id}/${id}`) || list.some((x) => x.domain === d.id && x.id === id) || add.some((x) => x.id === id)) continue;
    add.push({ domain: d.id, id, en, hi, after: `${d.id}/${s.id}`, at: today() });
    if (add.length === 5) break;
  }
  if (add.length && !dryRun) writeJson(P.suggestions, [...list, ...add]);
  note({ kind: "suggest", domain: d.id, topics: add.map((x) => x.id) }, dryRun);
  return add.length;
}
