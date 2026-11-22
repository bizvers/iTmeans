// Word data for the Cloudflare build: read from the R2 bucket bound as WORDS (written by scripts/export-r2.mjs).
// Layout in the bucket:
//   meta.json                                  { counts: { "<domain>/<subtopic>": n } }        (sidebar word counts)
//   index/<domain>/<subtopic>.json             [{ slug, term, letter }] in A-Z order          (chapters, previous/next)
//   bundles/<domain>/<subtopic>/<LETTER>.json  { "<slug>": { word, refs } }  (one topic-letter; word carries its
//                                              translations as _tr; refs = its related words)
// All three are kept in the Worker's memory for a few minutes; the CDN keeps the finished page much longer.
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
  if (keep) {
    if (memo.size > 400) memo.clear(); // a Worker has little memory; start over rather than grow without end
    memo.set(key, { at: Date.now(), value });
  }
  return value;
}

export interface WordPage { doc: WordDoc; index: IndexEntry[]; meta: Meta }

/** Everything one word page needs, or null when the word does not exist. */
export async function wordPage(domain: string, subtopic: string, slug: string): Promise<WordPage | null> {
  if (!/^[a-z0-9-]+$/.test(domain + subtopic + slug)) return null; // never build a key from odd input
  const [index, meta] = await Promise.all([
    read<IndexEntry[]>(`index/${domain}/${subtopic}.json`, true),
    read<Meta>("meta.json", true),
  ]);
  const entry = index?.find((e) => e.slug === slug);
  if (!entry || !meta || !/^[A-Z]$/.test(entry.letter)) return null;
  const bundle = await read<Record<string, WordDoc>>(`bundles/${domain}/${subtopic}/${entry.letter}.json`, true);
  const doc = bundle?.[slug];
  if (!doc) return null;
  return { doc, index, meta };
}
