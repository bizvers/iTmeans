// Entry stage "short": the extra steps around the normal cycle -- listing words per letter, writing short entries,
// the review of every 1000 words by three AIs together, and the 5 topic suggestions after a topic is finished.
// A short entry is the SAME word file as a full one with the detail fields still empty (see checks.mjs hasDetail).
import fs from "node:fs";
import path from "node:path";
import { P, REPO, readJson, writeJson, slugify, today, newId, takenIds, loadWords, ledgerAppend } from "./lib.mjs";
import { extractJson } from "./providers.mjs";
import { usedTerm } from "./topic.mjs";

const prompt = (name, vars) => {
  let t = fs.readFileSync(path.join(REPO, "agent/prompts", name), "utf8");
  for (const [k, v] of Object.entries(vars)) t = t.replaceAll(`{{${k}}}`, String(v));
  return t;
};
const note = (e, dry) => (dry ? console.log("[dry]", JSON.stringify(e)) : ledgerAppend(e));

/** Two models of different companies list popular terms of one letter; terms both name come first. New terms go to the queue file. */
export function makeFill(pool, { d, s, dryRun = false }) {
  return async (letter, rules) => {
    const n = letter === "*" ? rules.target : rules.max;
    const text = prompt("list-letter.md", { n, domain: d.en, subtopic: s.en, letter: letter === "*" ? "(any letter)" : letter });
    const lists = [], used = [];
    for (let i = 0; i < 2; i++) {
      try {
        const r = await pool.ask("list", text, used);
        used.push(r.row.company);
        lists.push(extractJson(r.text).terms.filter((t) => typeof t === "string" && /^[A-Za-z]/.test(t.trim()) && (letter === "*" || t.trim()[0].toUpperCase() === letter)).map((t) => t.trim()));
      } catch (e) { if (!/^no model available/.test(e.message) && !/no JSON|JSON/.test(e.message)) throw e; }
    }
    if (!lists.length) return 0;
    const norm = (t) => t.toLowerCase();
    const both = lists.length > 1 ? lists[0].filter((t) => lists[1].some((x) => norm(x) === norm(t))) : [];
    const all = [...new Map(lists.flat().map((t) => [norm(t), t])).values()];
    const qf = path.join(P.queue, `${d.id}__${s.id}.json`);
    const old = readJson(qf, []);
    const have = new Set(old.map((q) => norm(q.term)));
    const taken = takenIds();
    const add = all.filter((t) => !have.has(norm(t)) && !usedTerm(d.id, t)).map((t) => ({ id: newId(taken), term: t, both: both.some((b) => norm(b) === norm(t)) }));
    if (add.length && !dryRun) writeJson(qf, [...old, ...add]);
    note({ kind: "list", domain: d.id, subtopic: s.id, letter, added: add.length }, dryRun);
    return add.length;
  };
}

/** One model call writes the short entries of all picked words. Returns [{item, word} | {item, error}]. */
export async function writeShortBatch(pool, picks) {
  const { domain, sub } = picks[0];
  const { text, row } = await pool.ask("writer", prompt("write-short.md", { domain: domain.en, subtopic: sub.en, terms: picks.map((p) => `"${p.term}"`).join(", ") }));
  const got = new Map((extractJson(text).entries ?? []).map((e) => [String(e.term).toLowerCase(), e]));
  return picks.map((item) => {
    const e = got.get(item.term.toLowerCase());
    if (!e) return { item, error: "model gave no entry for this term" };
    const word = { id: item.id, term: item.term, domain: item.domain.id, subtopic: item.sub.id, letter: item.term[0].toUpperCase(), slug: slugify(item.term),
      pronunciation_hi: e.pronunciation_hi, field_meaning: { hi: e.meaning_hi }, kind: { en: String(e.kind_en ?? "").toLowerCase().trim(), hi: String(e.kind_hi ?? "").trim() }, status: "published" };
    return { item, word, writer: row };
  });
}

// ---------------------------------------------------------------- review: every `review_every` words of a subject, three AIs together
const BATCH = 25;
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

/** Asks THREE different companies about one batch. All three must answer; otherwise nothing is applied and the same batch is retried. */
async function askThree(pool, text) {
  const used = [], answers = [];
  for (let i = 0; i < 3; i++) {
    let r;
    try { r = await pool.ask("checker", text, used); } catch { r = await pool.ask("writer", text, used); } // the third company may be one that is a writer
    used.push(r.row.company);
    answers.push({ row: r.row, bad: extractJson(r.text).bad ?? [] });
  }
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
      const answers = await askThree(pool, prompt("review.md", { domain: d.en, entries }));
      const objections = new Map();
      for (const a of answers) for (const b of a.bad) {
        const key = String(b.term ?? "").toLowerCase();
        objections.set(key, [...(objections.get(key) ?? []), `${a.row.company}: ${b.reason ?? "doubtful"}`]);
      }
      const names = answers.map((a) => `${a.row.service}/${a.row.model}`);
      for (const x of items) {
        const why = objections.get(x.w.term.toLowerCase());
        if (why) {
          held++;
          if (!dryRun) {
            writeJson(path.join(P.held, `${x.domain}__${x.w.slug}.json`), { id: x.w.id, status: "held", term: x.w.term, domain: x.domain, subtopic: x.sub, slug: x.w.slug, hold_reason: `review: ${why[0]}`, objections: why, created_at: today() });
            fs.unlinkSync(x.file);
          }
        } else {
          checked++;
          if (!dryRun) writeJson(x.file, { ...x.w, checked_by: names, checked_at: today() });
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
