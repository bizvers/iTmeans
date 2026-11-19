// Entry stage "short": one topic at a time, letters A..Z in turn, words per letter between min and max.
// Pure helpers + small file reads. The cycle owns content/settings/progress.json; the admin owns settings.json.
import fs from "node:fs";
import path from "node:path";
import { P, readJson, slugify, canon, usedKeys } from "./lib.mjs";

export const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
export const DEFAULTS = { min: 5, max: 20, review_every: 1000, popular_target: 100 };

/** min / max per letter and the topic's finishing line, for one topic: topic rule > subject rule (domain_rules) > defaults. */
export function rulesFor(settings, domainId, subId) {
  const d = { ...DEFAULTS, ...(settings.topic_defaults ?? {}) };
  const o = { ...(settings.domain_rules?.[domainId] ?? {}), ...(settings.topic_rules?.[`${domainId}/${subId}`] ?? {}) };
  const mode = o.mode === "popular" ? "popular" : "letters";
  const min = o.min ?? d.min, max = Math.max(o.max ?? d.max, min);
  const target = o.target ?? (mode === "popular" ? d.popular_target : LETTERS.length * max); // 26 x 20 = 520 by default
  return { min, max, mode, target };
}

export const topicKey = (d, s) => `${d.id ?? d}/${s.id ?? s}`;

/** The one topic being filled now: the admin's choice if set and not finished, else the first unfinished one of an active subject. */
export function currentTopic(taxonomy, settings, progress) {
  const open = (d, s) => !progress.done_topics.includes(topicKey(d, s));
  const domains = taxonomy.domains.filter((d) => d.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (settings.current_topic) {
    const [di, si] = settings.current_topic.split("/");
    const d = domains.find((x) => x.id === di), s = d?.subtopics.find((x) => x.id === si);
    if (d && s && open(d, s)) return { d, s };
  }
  for (const d of domains) for (const s of d.subtopics) if (open(d, s)) return { d, s };
  return null;
}

/** Published words of a topic by letter: {A: 3, B: 1 ...} plus total. Held words are not counted. */
export function topicCounts(domainId, subId) {
  const dir = path.join(P.words, domainId, subId);
  const by = Object.fromEntries(LETTERS.map((l) => [l, 0]));
  let total = 0;
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const w = readJson(path.join(dir, f), null);
    if (!w || w.status !== "published") continue;
    total++;
    if (by[w.letter] !== undefined) by[w.letter]++;
  }
  return { by, total };
}

/** Is the topic finished? target reached, or every letter is full / has no more words (exhausted). */
export function topicFinished(rules, counts, exhausted = []) {
  if (counts.total >= rules.target) return true;
  if (rules.mode === "popular") return exhausted.includes("*");
  return LETTERS.every((l) => counts.by[l] >= rules.max || exhausted.includes(l));
}

export const usedTerm = (d, term) => { // a word that already came (anywhere in this subject, published or held) never comes again
  const slug = slugify(term);
  const dd = path.join(P.words, d);
  if (fs.existsSync(dd)) for (const s of fs.readdirSync(dd)) if (fs.existsSync(path.join(dd, s, `${slug}.json`))) return true;
  if (fs.existsSync(path.join(P.held, `${d}__${slug}.json`))) return true;
  return usedKeys(d).has(canon(term)); // also a spelling variant / plural / short name of a word that already came
};

/**
 * Next words for the current topic: one word per letter in turn (the letter with the fewest words first, ties A..Z).
 * `fill(letter)` asks the models for more words of that letter when its queue is empty (async, may add to the queue file).
 * A letter that stays empty after a fill is marked exhausted: no forcing words after the minimum.
 * Returns {topic, picks, exhausted (changed list)}.
 */
export async function pickShort({ taxonomy, settings, progress, maxTotal, fill }) {
  const topic = currentTopic(taxonomy, settings, progress);
  if (!topic) return { topic: null, picks: [], exhausted: [] };
  const { d, s } = topic, key = topicKey(d, s);
  const rules = rulesFor(settings, d.id, s.id);
  const counts = topicCounts(d.id, s.id);
  const exhausted = new Set(progress.exhausted[key] ?? []);
  const qf = path.join(P.queue, `${d.id}__${s.id}.json`);
  const unused = () => readJson(qf, []).filter((q) => !usedTerm(d.id, q.term));
  const picks = [];
  const taken = new Set();
  const sizeLeft = rules.target - counts.total;
  const lanes = rules.mode === "popular" ? ["*"] : LETTERS;
  const want = Math.min(maxTotal, sizeLeft);
  const added = {}; // new terms a fill brought this run, per letter (null = no model answered)
  const closed = new Set(); // letters with nothing left THIS run (more may come next run)
  const firstLetter = (q) => q.term[0].toUpperCase();
  if (want > 0 && fill?.many && rules.mode !== "popular") { // one request for every letter whose list is empty
    const left = unused();
    const need = lanes.filter((l) => !exhausted.has(l) && counts.by[l] < rules.max && !left.some((q) => firstLetter(q) === l));
    if (need.length) { const r = await fill.many(need, rules); if (r) Object.assign(added, r); }
  }
  while (picks.length < want) {
    const open = lanes.filter((l) => !exhausted.has(l) && !closed.has(l) && (l === "*" || counts.by[l] + picks.filter((p) => p.letter === l).length < rules.max));
    if (!open.length) break;
    const have = (l) => (l === "*" ? counts.total : counts.by[l]) + picks.filter((p) => (l === "*" ? true : p.letter === l)).length;
    open.sort((a, b) => have(a) - have(b) || (a === "*" ? 0 : a.localeCompare(b)));
    const lane = open[0];
    const fits = (q) => !taken.has(slugify(q.term)) && (lane === "*" || firstLetter(q) === lane);
    const next = () => unused().filter(fits).sort((a, b) => (!!b.both - !!a.both) || a.term.localeCompare(b.term))[0];
    let q = next();
    if (!q && fill && !(lane in added)) { added[lane] = await fill(lane, rules); q = next(); } // at most one list request per letter per run
    if (!q) {
      // the models were asked and had no new word: no forcing. A "popular" topic is NOT closed on one empty list
      // (19 Nov 2026: BNS closed at 34 of 100 after one bad list); cycle.mjs closes it after 3 runs in a row without a word.
      if (added[lane] === 0 && lane !== "*") exhausted.add(lane);
      else closed.add(lane);                       // used up for this run, or no model answered: try again next run
      continue;
    }
    taken.add(slugify(q.term));
    picks.push({ domain: d, sub: s, term: q.term, id: q.id, letter: lane === "*" ? q.term[0].toUpperCase() : lane });
  }
  return { topic, picks, exhausted: [...exhausted], rules, counts, added };
}
