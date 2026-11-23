// Ranking for suggestions while typing (scale step s3). Pure functions, so they can be tested without Cloudflare.
import { searchKey } from "./search-key.mjs";

/** One entry of a suggest/<shard>.json file (see scripts/export-r2.mjs). */
// m: first sentence of the meaning per language; pp: pronunciation in other languages' scripts (bn ...), when translated
export interface SuggestEntry { k: string[]; t: string; p?: string; pp?: Record<string, string>; m: { hi?: string; en?: string; [lang: string]: string | undefined }; d: string; s: string; g: string }
export interface Suggestion { term: string; pron?: string; meaning: string; d: string; s: string; slug: string }

/** Best matches for what the reader typed: exact name first, then names that start with it, then a part of the name,
 *  then the Hindi pronunciation; shorter names first within each. At most `limit`, no word twice. */
export function rank(entries: readonly SuggestEntry[], typed: string, lang: string, limit = 8): Suggestion[] {
  const q = searchKey(typed);
  if (q.length < 2) return [];
  const scored: { e: SuggestEntry; score: number }[] = [];
  for (const e of entries) {
    const whole = searchKey(e.t);
    const prons = [e.p, ...Object.values(e.pp ?? {})].filter(Boolean).map((p) => searchKey(p!));
    let score = -1;
    if (whole === q || prons.includes(q)) score = 0;
    else if (whole.startsWith(q)) score = 1;
    else if (prons.some((p) => p.startsWith(q))) score = 2;
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
    // the page's language first; English pages then Hindi; every other page then Hindi (short words have Hindi meanings)
    const meaning = e.m[lang] ?? (lang === "en" ? e.m.en ?? e.m.hi : e.m.hi ?? e.m.en) ?? "";
    out.push({ term: e.t, pron: e.pp?.[lang] ?? e.p, meaning, d: e.d, s: e.s, slug: e.g });
    if (out.length >= limit) break;
  }
  return out;
}
