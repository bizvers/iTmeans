// "Today's words" articles (stage 5): every day, per subject, short articles about 3 related words of ONE topic.
// Each subject gets `per_subject` articles (2) from that many DIFFERENT topics; a topic comes back only after `topic_gap_days`.
// Files: content/articles/<YYYY-MM-DD>/<domain>--<subtopic>.json. The site shows them on /<lang>/today/.
// Who writes: for now Claude, on the owner's order (ingest.mjs); the free-model cycle (cycle.mjs) is built but paused
// (settings.articles.paused) until the owner hands the work over (decision of 23 Nov 2026, docs/decisions.md).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { P, REPO, readJson, writeJson, loadWords } from "../cycle/lib.mjs";
import { SECTION } from "../cycle/checks.mjs";

export const A = {
  dir: path.join(REPO, "content/articles"),
  inbox: path.join(REPO, "content/articles-inbox"),
};
export const DEFAULTS = { paused: true, per_subject: 2, words_per_article: 3, topic_gap_days: 14, candidates: 12 };
export const rules = (settings = readJson(P.settings, {})) => ({ ...DEFAULTS, ...(settings.articles ?? {}) });

/** Today's date in India (the readers' day), YYYY-MM-DD. */
export const istDate = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const fileOf = (date, domain, sub) => path.join(A.dir, date, `${domain}--${sub}.json`);

/** Every saved article, oldest day first. */
export function loadArticles() {
  if (!fs.existsSync(A.dir)) return [];
  const out = [];
  for (const day of fs.readdirSync(A.dir).filter((x) => DATE_RE.test(x)).sort()) {
    for (const f of fs.readdirSync(path.join(A.dir, day)).filter((x) => x.endsWith(".json")).sort()) out.push(readJson(path.join(A.dir, day, f)));
  }
  return out;
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const hash = (s) => parseInt(crypto.createHash("sha1").update(s).digest("hex").slice(0, 8), 16);

/**
 * The day's plan: for each active subject, `per_subject` different topics that have enough published words,
 * least recently used first (a topic used within topic_gap_days is left out while others are available),
 * then a stable shuffle by date so the order changes from day to day. Each item carries candidate words to write about.
 */
export function planDay(date, { taxonomy = readJson(P.taxonomy), settings = readJson(P.settings, {}), words = loadWords(), articles = loadArticles() } = {}) {
  const r = rules(settings);
  const lastUsed = new Map();
  for (const a of articles) if (a.date < date) { const k = `${a.domain}/${a.subtopic}`; if (!lastUsed.has(k) || lastUsed.get(k) < a.date) lastUsed.set(k, a.date); }
  const doneToday = new Set(articles.filter((a) => a.date === date).map((a) => `${a.domain}/${a.subtopic}`));
  const pub = new Map();
  for (const x of words) if (x.w.status === "published") { const k = `${x.domain}/${x.sub}`; (pub.get(k) ?? pub.set(k, []).get(k)).push(x.w); }
  const plan = [];
  for (const d of taxonomy.domains.filter((x) => x.active).sort((a, b) => a.order - b.order)) {
    const subs = d.subtopics.map((s) => ({ s, k: `${d.id}/${s.id}`, words: pub.get(`${d.id}/${s.id}`) ?? [] })).filter((x) => x.words.length >= r.words_per_article);
    const gapOk = (x) => !lastUsed.has(x.k) || daysBetween(lastUsed.get(x.k), date) >= r.topic_gap_days;
    const order = (a, b) => (lastUsed.get(a.k) ?? "").localeCompare(lastUsed.get(b.k) ?? "") || hash(date + a.k) - hash(date + b.k);
    const fresh = subs.filter(gapOk).sort(order), stale = subs.filter((x) => !gapOk(x)).sort(order);
    for (const x of [...fresh, ...stale].slice(0, r.per_subject)) {
      const cands = [...x.words].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || hash(date + a.id) - hash(date + b.id)).slice(0, r.candidates);
      plan.push({ date, domain: d.id, domain_en: d.en, subtopic: x.s.id, subtopic_en: x.s.en, notice: d.notice ?? null, done: doneToday.has(x.k),
        candidates: cands.map((w) => ({ id: w.id, term: w.term, meaning_hi: w.field_meaning?.hi ?? "" })) });
    }
  }
  return plan;
}

const DEVA = /[ऀ-ॿ]/, FOREIGN = /[^ऀ-ॿ\u0000-ɏ -⁯₹]/u, PH = /\{(\d+)\}/g;
/**
 * Code check of one article (before any AI check). Returns a list of problems ([] = fine).
 * byId: Map of word id -> {domain, sub, w} for published words.
 */
export function articleCheck(a, { byId, taxonomy = readJson(P.taxonomy), settings = readJson(P.settings, {}), articles = loadArticles() }) {
  const r = rules(settings), out = [], need = (ok, msg) => { if (!ok) out.push(msg); };
  need(DATE_RE.test(a.date ?? ""), "date must be YYYY-MM-DD");
  const d = taxonomy.domains.find((x) => x.id === a.domain && x.active);
  need(!!d, `unknown or inactive subject ${a.domain}`);
  need(!!d?.subtopics.some((s) => s.id === a.subtopic), `unknown topic ${a.domain}/${a.subtopic}`);
  const ids = Array.isArray(a.words) ? a.words : [];
  need(ids.length === r.words_per_article && new Set(ids).size === ids.length, `needs exactly ${r.words_per_article} different words`);
  for (const id of ids) { const x = byId.get(id); need(!!x && x.domain === a.domain && x.sub === a.subtopic, `word ${id} is not a published word of ${a.domain}/${a.subtopic}`); }
  const th = a.title?.hi ?? "", te = a.title?.en ?? "";
  need(th.length >= 8 && th.length <= 90 && DEVA.test(th), "title.hi: 8-90 characters, in Hindi");
  need(te.length >= 8 && te.length <= 90 && !DEVA.test(te), "title.en: 8-90 characters, in English");
  const body = Array.isArray(a.body?.hi) ? a.body.hi : [];
  need(body.length >= 3 && body.length <= 5, "body.hi: 3-5 paragraphs");
  const total = body.join("").length;
  need(total >= 300 && total <= 1600, `body.hi: 300-1600 characters (has ${total})`);
  for (const [i, p] of body.entries()) need(typeof p === "string" && p.length >= 40 && p.length <= 420, `paragraph ${i + 1}: 40-420 characters`);
  const used = new Set([...body.join(" ").matchAll(PH)].map((m) => +m[1]));
  for (let i = 0; i < ids.length; i++) need(used.has(i), `word {${i}} is never used in the text`);
  for (const n of used) need(n < ids.length, `{${n}} does not name a word`);
  const all = [th, te, ...body].join(" ");
  need(!FOREIGN.test(all), "letters of another script");
  if (d?.notice === "legal-not-advice") need(!SECTION.test(all), "Law: no section, article or rule numbers");
  const same = articles.filter((x) => x.date === a.date && x.id !== a.id);
  need(!same.some((x) => x.domain === a.domain && x.subtopic === a.subtopic), "this topic already has an article that day");
  need(same.filter((x) => x.domain === a.domain).length < r.per_subject, `this subject already has ${r.per_subject} articles that day`);
  return out;
}

export function newArticleId(articles = loadArticles()) {
  const taken = new Set(articles.map((a) => a.id));
  for (;;) { const id = `a-${crypto.randomBytes(4).toString("hex")}`; if (!taken.has(id)) return id; }
}
export const saveArticle = (a) => writeJson(fileOf(a.date, a.domain, a.subtopic), a);
export const publishedById = (words = loadWords()) => new Map(words.filter((x) => x.w.status === "published").map((x) => [x.w.id, x]));

/** Turns a model/draft reply's word list (terms or ids) into word ids of that topic; unknown terms stay as they are (the check then fails). */
export function resolveWordIds(list, domain, sub, byId) {
  const inTopic = [...byId.values()].filter((x) => x.domain === domain && x.sub === sub);
  return (list ?? []).map((t) => (byId.has(t) ? t : inTopic.find((x) => x.w.term.toLowerCase() === String(t).toLowerCase())?.w.id ?? String(t)));
}

/** The checker's verdict from its reply: pass only with "pass": true and a score at or above the pass score. */
export function verdict(reply, passScore) {
  const s = reply.indexOf("{"), e = reply.lastIndexOf("}");
  if (s < 0 || e <= s) return { pass: false, score: 0, problems: ["checker reply had no JSON"] };
  try {
    const j = JSON.parse(reply.slice(s, e + 1));
    const score = Number(j.score) || 0;
    return { pass: j.pass === true && score >= passScore, score, problems: Array.isArray(j.problems) ? j.problems.map(String).slice(0, 6) : [] };
  } catch { return { pass: false, score: 0, problems: ["checker reply was not valid JSON"] }; }
}
