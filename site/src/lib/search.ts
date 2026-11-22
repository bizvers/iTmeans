// Full-text search over names, pronunciations and meanings, for the Cloudflare version (scale step s3, layer 2).
// Reads the D1 database bound as SEARCH (filled by scripts/d1-sync.mjs). The static (GitHub Pages) build never calls
// this; its search page asks Pagefind in the browser.
import { env } from "cloudflare:workers";
import { ftsQuery } from "./search-key.mjs";

export interface Hit { t: string; p: string | null; mhi: string | null; men: string | null; d: string; s: string; g: string }

interface D1 { prepare(sql: string): { bind(...v: unknown[]): { all<T>(): Promise<{ results: T[] }> } } }

/** Best matches for what the reader typed (name counts most, then pronunciation, then meaning). null = too little typed. */
export async function searchWords(typed: string, limit = 30): Promise<Hit[] | null> {
  const match = ftsQuery(typed);
  if (!match) return null;
  const db = (env as unknown as { SEARCH?: D1 }).SEARCH;
  if (!db) throw new Error("D1 binding SEARCH is missing (wrangler.jsonc)");
  const { results } = await db
    .prepare(`SELECT w.t, w.p, w.mhi, w.men, w.d, w.s, w.g FROM search JOIN words w ON w.n = search.rowid
              WHERE search MATCH ?1 ORDER BY bm25(search, 10, 8, 3, 3) LIMIT ?2`)
    .bind(match, limit)
    .all<Hit>();
  return results;
}
