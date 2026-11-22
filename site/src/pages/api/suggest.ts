// Suggestions while typing, for the Cloudflare version: /api/suggest?q=cac&lang=hi -> up to 8 words as JSON.
// Reads one small shard from R2 (by the first two letters typed); the answer is cached by the CDN per query.
// In the static (GitHub Pages) build this file is made once at build time and returns an empty list; that site
// keeps using Pagefind.
import type { APIRoute } from "astro";
import { domains, languages, nameIn, onCloudflare } from "../../lib/content";
import { searchKey, shardOf } from "../../lib/search-key.mjs";
import { rank, type SuggestEntry } from "../../lib/suggest";
import { readKept } from "../../lib/r2";

const json = (data: unknown, cache: string) =>
  new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache } });

export const GET: APIRoute = async ({ url }) => {
  if (!onCloudflare) return json([], "no-store");
  const typed = (url.searchParams.get("q") ?? "").slice(0, 60);
  const lang = languages.some((l) => l.code === url.searchParams.get("lang")) ? url.searchParams.get("lang")! : "hi";
  const key = searchKey(typed);
  if (key.length < 2) return json([], "public, max-age=3600, s-maxage=86400");
  const entries = (await readKept<SuggestEntry[]>(`suggest/${shardOf(key)}.json`)) ?? [];
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const items = rank(entries, typed, lang).map((r) => {
    const d = domains.find((x) => x.id === r.d);
    const s = d?.subtopics.find((x) => x.id === r.s);
    return { term: r.term, pron: r.pron, meaning: r.meaning, where: d && s ? `${nameIn(d, lang)} › ${nameIn(s, lang)}` : "", url: `${base}/${lang}/${r.d}/${r.s}/${r.slug}/` };
  });
  // browsers keep it 5 minutes, the CDN an hour (new words arrive every few hours)
  return json(items, "public, max-age=300, s-maxage=3600");
};
