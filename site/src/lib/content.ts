// Reads ../content at build time. Only active languages/domains are exposed.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..", "content");

export type L2 = { hi: string; en: string; [k: string]: string };
export interface Language { code: string; en: string; native: string; script: string; font: string; active: boolean }
export interface Subtopic { id: string; en: string; hi: string; [k: string]: string }
export interface Group { id: string; en: string; hi: string; [k: string]: string } // a heading over topics in the sidebar (Law: LLB subject; its topics are acts)
export interface Domain { id: string; en: string; hi: string; order: number; active: boolean; notice?: string; groups?: Group[]; subtopics: Subtopic[] }
export interface Word {
  id: string; // permanent id (w-xxxxxxxx); never changes. "related" holds ids too.
  term: string; domain: string; subtopic: string; letter: string; slug: string;
  pronunciation_hi: string; term_hi?: string | null;
  field_meaning: L2; // a short word (entry stage "short") has only field_meaning.hi, pronunciation_hi and kind
  kind?: L2; // company / software / term ...: shown small, in a colour, under the meaning
  // the detail fields are all present (full word) or all absent (short word, filled in later in the same file)
  level?: "basic" | "advanced"; literal_meaning?: L2; effect?: L2; effect_flow?: L2[];
  usage?: L2; example?: L2; caution?: L2; related?: string[];
  status: string; written_by: string | null; checked_by: string[];
  created_at: string; checked_at: string | null;
}
export const isFull = (w: Word) => w.level != null && w.effect != null && w.related != null;

const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, "taxonomy", "taxonomy.json"), "utf8"));

export const languages: Language[] = (taxonomy.languages as Language[]).filter((l) => l.active);
export const domains: Domain[] = (taxonomy.domains as Domain[])
  .filter((d) => d.active)
  .sort((a, b) => a.order - b.order);

/** How many word files were read from disk (used by tests to prove each file is read once per build). */
export let wordFileReads = 0;

/** What a "related" id points to: a published word (has a page) or a queued/held term (no page yet). */
export interface Ref { id: string; term: string; domain?: string; subtopic?: string; slug?: string }

interface Loaded { all: readonly Word[]; bySub: Map<string, Word[]>; refs: Map<string, Ref> }
let cache: Loaded | null = null;
let cacheAt = 0;

const readList = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8").replace(/^﻿/, ""))) : []);

function load(): Loaded {
  const out: Word[] = [];
  for (const d of domains) for (const s of d.subtopics) {
    const dir = path.join(ROOT, "words", d.id, s.id);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const w = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8").replace(/^﻿/, "")) as Word;
      wordFileReads++;
      if (w.status === "published") out.push(w);
    }
  }
  out.sort((a, b) => a.term.localeCompare(b.term, "en"));
  const bySub = new Map<string, Word[]>();
  for (const w of out) {
    const k = `${w.domain}/${w.subtopic}`;
    if (!bySub.has(k)) bySub.set(k, []);
    bySub.get(k)!.push(w);
  }
  // id -> term for related links: queued and held terms first, then published words (which win)
  const refs = new Map<string, Ref>();
  for (const q of readList(path.join(ROOT, "queue"))) for (const e of q as { id?: string; term: string }[]) if (e.id) refs.set(e.id, { id: e.id, term: e.term });
  for (const h of readList(path.join(ROOT, "held")) as { id?: string; term: string }[]) if (h.id) refs.set(h.id, { id: h.id, term: h.term });
  for (const w of out) refs.set(w.id, { id: w.id, term: w.term, domain: w.domain, subtopic: w.subtopic, slug: w.slug });
  return { all: Object.freeze(out), bySub, refs };
}

/** Reads content once per build and reuses it. In `astro dev` it re-reads (at most once a second) so edits show up. */
function loaded(): Loaded {
  if (import.meta.env?.DEV) {
    if (!cache || Date.now() - cacheAt > 1000) { cache = load(); cacheAt = Date.now(); }
    return cache;
  }
  return (cache ??= load());
}

/** Looks up a permanent id (from a word's "related" list). */
export const refOf = (id: string): Ref | undefined => loaded().refs.get(id);

export const allWords = (): readonly Word[] => loaded().all;

export const wordsOf = (domain: string, subtopic: string): readonly Word[] =>
  loaded().bySub.get(`${domain}/${subtopic}`) ?? [];

export const findWord = (domain: string, subtopic: string, slug: string) =>
  wordsOf(domain, subtopic).find((w) => w.slug === slug);

// ---------------------------------------------------------------- translated text of a word
// Hindi and English live inside the word file ({hi, en} per field). Every OTHER language lives in
// content/translations/<lang>/<word id>.json (plain strings, same field names) so a new language never touches word files.
// Missing translation -> English is shown.
export type TextField = "literal_meaning" | "field_meaning" | "effect" | "usage" | "example" | "caution";
interface Translation { effect_flow?: string[]; [k: string]: string | string[] | undefined }
const translationCache = new Map<string, Translation | null>();
function translation(id: string, lang: string): Translation | null {
  const key = `${lang}/${id}`;
  if (!import.meta.env?.DEV && translationCache.has(key)) return translationCache.get(key)!;
  const f = path.join(ROOT, "translations", lang, `${id}.json`);
  const t = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")) as Translation) : null;
  translationCache.set(key, t);
  return t;
}

/** One text field of a word in a language (word file first, then translations/, else English). */
export function text(w: Word, field: TextField, lang: string): string {
  return w[field]?.[lang] ?? (translation(w.id, lang)?.[field] as string | undefined) ?? w[field]?.en ?? w[field]?.hi ?? "";
}
/** The three "effect at a glance" steps in a language. */
export const flow = (w: Word, lang: string): string[] =>
  (w.effect_flow ?? []).map((s, i) => s[lang] ?? translation(w.id, lang)?.effect_flow?.[i] ?? s.en);

/** Name in a language, falling back to English. */
export const nameIn = (o: { en: string; hi: string }, lang: string) =>
  (o as Record<string, string>)[lang] ?? o.en;

/** Language-dependent text from a {hi,en} field, falling back to English. */
export const t2 = (o: L2 | undefined, lang: string) => (o ? o[lang] ?? o.en : "");
