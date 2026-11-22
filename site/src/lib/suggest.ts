// Ranking for suggestions while typing (scale step s3). Pure functions, so they can be tested without Cloudflare.
import { searchKey } from "./search-key.mjs";

/** One entry of a suggest/<shard>.json file (see scripts/export-r2.mjs). */
export interface SuggestEntry { k: string[]; t: string; p?: string; m: { hi?: string; en?: string }; d: string; s: string; g: string }
export interface Suggestion { term: string; pron?: string; meaning: string; d: string; s: string; slug: string }

/** Best matches for what the reader typed: exact name first, then names that start with it, then a part of the name,
 *  then the Hindi pronunciation; shorter names first within each. At most `limit`, no word twice. */
export function rank(entries: readonly SuggestEntry[], typed: string, lang: string, limit = 8): Suggestion[] {
  const q = searchKey(typed);
  if (q.length < 2) return [];
  const scored: { e: SuggestEntry; score: number }[] = [];
  for (const e of entries) {
    const whole = searchKey(e.t);
    const pron = e.p ? searchKey(e.p) : "";
    let score = -1;
    if (whole === q || pron === q) score = 0;
    else if (whole.startsWith(q)) score = 1;
    else if (pron.startsWith(q)) score = 2;
    else if (e.k.some((k) => k.startsWith(q))) score = 3;
    if (score >= 0) scored.push({ e, score });
  }
  scored.sort((a, b) => a.score - b.score || a.e.t.length - b.e.t.length || a.e.t.localeCompare(b.e.t, "en"));
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const { e } of scored) {
    const id = `${e.d}/${e.s}/${e.g}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ term: e.t, pron: e.p, meaning: (lang === "hi" ? e.m.hi ?? e.m.en : e.m.en ?? e.m.hi) ?? "", d: e.d, s: e.s, slug: e.g });
    if (out.length >= limit) break;
  }
  return out;
}
