// Reads ../content at build time. Only active languages/domains are exposed.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..", "content");

export type L2 = { hi: string; en: string; [k: string]: string };
export interface Language { code: string; en: string; native: string; script: string; font: string; active: boolean }
export interface Subtopic { id: string; en: string; hi: string; [k: string]: string }
export interface Domain { id: string; en: string; hi: string; order: number; active: boolean; notice?: string; subtopics: Subtopic[] }
export interface Word {
  term: string; domain: string; subtopic: string; letter: string; slug: string;
  level: "basic" | "advanced"; pronunciation_hi: string; term_hi: string | null;
  literal_meaning: L2; field_meaning: L2; effect: L2; effect_flow: L2[];
  usage: L2; example: L2; caution: L2; related: string[];
  status: string; written_by: string | null; checked_by: string[];
  created_at: string; checked_at: string | null;
}

const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, "taxonomy", "taxonomy.json"), "utf8"));

export const languages: Language[] = (taxonomy.languages as Language[]).filter((l) => l.active);
export const domains: Domain[] = (taxonomy.domains as Domain[])
  .filter((d) => d.active)
  .sort((a, b) => a.order - b.order);

export function allWords(): Word[] {
  const out: Word[] = [];
  for (const d of domains) for (const s of d.subtopics) {
    const dir = path.join(ROOT, "words", d.id, s.id);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const w = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Word;
      if (w.status === "published") out.push(w);
    }
  }
  return out.sort((a, b) => a.term.localeCompare(b.term, "en"));
}

export const wordsOf = (domain: string, subtopic: string) =>
  allWords().filter((w) => w.domain === domain && w.subtopic === subtopic);

export const findWord = (domain: string, subtopic: string, slug: string) =>
  wordsOf(domain, subtopic).find((w) => w.slug === slug);

/** Name in a language, falling back to English. */
export const nameIn = (o: { en: string; hi: string }, lang: string) =>
  (o as Record<string, string>)[lang] ?? o.en;

/** Language-dependent text from a {hi,en} field, falling back to English. */
export const t2 = (o: L2 | undefined, lang: string) => (o ? o[lang] ?? o.en : "");
