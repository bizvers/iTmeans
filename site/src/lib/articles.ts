// "Today's words" articles (content/articles/<date>/<domain>--<subtopic>.json), read at build time.
// Every page that shows them is made at build time (also in the Cloudflare build), so reading files here is fine.
import fs from "node:fs";
import path from "node:path";
import { domains, allWords, type Word, type L2 } from "./content";

const DIR = path.resolve(process.cwd(), "..", "content", "articles");
export interface Article {
  id: string; date: string; domain: string; subtopic: string;
  title: L2; body: { hi: string[]; [k: string]: string[] }; words: string[];
  status: string; written_by: string; checked_by: string[]; created_at: string;
}
/** An article with its words looked up and its address. key = "<domain>--<subtopic>" (the file name). */
export interface Story extends Article { key: string; ws: Word[] }

let cache: Story[] | null = null;
export function allStories(): Story[] {
  if (cache) return cache;
  const byId = new Map(allWords().map((w) => [w.id, w]));
  const active = new Set(domains.map((d) => d.id));
  const out: Story[] = [];
  if (fs.existsSync(DIR)) for (const day of fs.readdirSync(DIR).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().reverse()) {
    for (const f of fs.readdirSync(path.join(DIR, day)).filter((x) => x.endsWith(".json")).sort()) {
      const a = JSON.parse(fs.readFileSync(path.join(DIR, day, f), "utf8").replace(/^﻿/, "")) as Article;
      const ws = a.words.map((id) => byId.get(id)).filter((w): w is Word => !!w);
      // only whole stories: published, subject switched on, every word still published
      if (a.status !== "published" || !active.has(a.domain) || ws.length !== a.words.length) continue;
      out.push({ ...a, key: f.replace(/\.json$/, ""), ws });
    }
  }
  // subject order as on the site, then topic
  const order = new Map(domains.map((d, i) => [d.id, i]));
  out.sort((a, b) => b.date.localeCompare(a.date) || (order.get(a.domain)! - order.get(b.domain)!) || a.subtopic.localeCompare(b.subtopic));
  return (cache = out);
}
/** Days that have stories, newest first. */
export const storyDays = () => [...new Set(allStories().map((s) => s.date))];
export const storiesOn = (date: string) => allStories().filter((s) => s.date === date);

/** Subject colour key used by the CSS (.s-law, .s-ai ...). */
export const subjectClass = (domain: string) => `s-${domain.replace(/-.*/, "")}`;

/** "23 नवंबर 2026" / "23 November 2026" (+ weekday). */
export function dayName(date: string, lang: string, weekday = false) {
  const loc = lang === "hi" ? "hi-IN" : lang === "en" ? "en-IN" : lang;
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric", ...(weekday ? { weekday: "long" } : {}), timeZone: "UTC" });
}
