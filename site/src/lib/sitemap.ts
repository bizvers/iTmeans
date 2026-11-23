// Every address of the site, for Google (sitemaps). Made at build time from the word files, in both builds.
// One sitemap file holds at most 50,000 addresses; we cut at 45,000 per language, so 10 languages x 100,000 words
// is about 25 files, all listed in /sitemap-index.xml.
import { languages, domains, wordsOf } from "./content";
import { allStories, storyDays } from "./articles";

export const PER_FILE = 45000;
const site = (import.meta.env.SITE ?? "https://itmeans.org").replace(/\/$/, "");
const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export const abs = (rest: string) => `${site}${base}/${rest}`;

interface Entry { rest: string; lastmod?: string } // rest = address after /<lang>/

/** The same list for every language (only the /<lang>/ part differs). */
function entries(): Entry[] {
  const out: Entry[] = [{ rest: "" }];
  // today's words: the newest day, every earlier day and every story (each stays at its address for good)
  const days = storyDays();
  if (days.length) out.push({ rest: "today/", lastmod: days[0] });
  for (const day of days) out.push({ rest: `today/${day}/`, lastmod: day });
  for (const s of allStories()) out.push({ rest: `today/${s.date}/${s.key}/`, lastmod: s.date });
  for (const d of domains) {
    out.push({ rest: `${d.id}/` });
    for (const s of d.subtopics) {
      const words = wordsOf(d.id, s.id);
      if (!words.length) continue;
      out.push({ rest: `${d.id}/${s.id}/` });
      for (const w of words) out.push({ rest: `${d.id}/${s.id}/${w.slug}/`, lastmod: w.checked_at ?? w.created_at });
    }
  }
  return out;
}

/** File names without ".xml", e.g. "hi-1", "en-1", "hi-2". */
export function files(): string[] {
  const n = Math.max(1, Math.ceil(entries().length / PER_FILE));
  return languages.flatMap((l) => Array.from({ length: n }, (_, i) => `${l.code}-${i + 1}`));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** One sitemap file: its addresses, each with links to the same page in the other languages. */
export function fileXml(name: string): string | null {
  const m = /^([a-z]{2,3})-(\d+)$/.exec(name);
  const lang = m && languages.find((l) => l.code === m[1]);
  if (!m || !lang) return null;
  const part = entries().slice((Number(m[2]) - 1) * PER_FILE, Number(m[2]) * PER_FILE);
  const urls = part.map((e) => {
    const alts = languages.map((l) => `<xhtml:link rel="alternate" hreflang="${l.code}" href="${esc(abs(`${l.code}/${e.rest}`))}"/>`).join("");
    return `<url><loc>${esc(abs(`${lang.code}/${e.rest}`))}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}${alts}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

export function indexXml(): string {
  const items = files().map((f) => `<sitemap><loc>${esc(abs(`sitemaps/${f}.xml`))}</loc></sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</sitemapindex>\n`;
}

export const xml = (body: string) => new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
