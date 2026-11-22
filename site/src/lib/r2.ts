// Word data for the Cloudflare build: read from the R2 bucket bound as WORDS (written by scripts/export-r2.mjs).
// Layout in the bucket:
//   meta.json                              { counts: { "<domain>/<subtopic>": n } }            (sidebar word counts)
//   index/<domain>/<subtopic>.json         [{ slug, term, letter }] in A-Z order              (chapters, previous/next)
//   words/<domain>/<subtopic>/<slug>.json  { word, refs }  (word carries its translations as _tr; refs = its related words)
// meta and the topic lists are kept in the Worker's memory for a few minutes, so a page usually costs one R2 read.
import { env } from "cloudflare:workers";
import type { Word, Ref, Translation } from "./content";

export interface IndexEntry { slug: string; term: string; letter: string }
export interface WordDoc { word: Word & { _tr?: Record<string, Translation> }; refs: Record<string, Ref> }
export interface Meta { counts: Record<string, number> }

interface Bucket { get(key: string): Promise<{ json<T>(): Promise<T> } | null> }
const bucket = () => (env as unknown as { WORDS?: Bucket }).WORDS;

const KEEP_MS = 5 * 60 * 1000;
const memo = new Map<string, { at: number; value: unknown }>();
async function read<T>(key: string, keep = false): Promise<T | null> {
  const hit = memo.get(key);
  if (keep && hit && Date.now() - hit.at < KEEP_MS) return hit.value as T;
  const b = bucket();
  if (!b) throw new Error("R2 binding WORDS is missing (wrangler.jsonc)");
  const obj = await b.get(key);
  const value = obj ? await obj.json<T>() : null;
  if (keep) memo.set(key, { at: Date.now(), value });
  return value;
}

export interface WordPage { doc: WordDoc; index: IndexEntry[]; meta: Meta }

/** Everything one word page needs, or null when the word does not exist. */
export async function wordPage(domain: string, subtopic: string, slug: string): Promise<WordPage | null> {
  if (!/^[a-z0-9-]+$/.test(domain + subtopic + slug)) return null; // never build a key from odd input
  const [doc, index, meta] = await Promise.all([
    read<WordDoc>(`words/${domain}/${subtopic}/${slug}.json`),
    read<IndexEntry[]>(`index/${domain}/${subtopic}.json`, true),
    read<Meta>("meta.json", true),
  ]);
  if (!doc || !index || !meta) return null;
  return { doc, index, meta };
}
