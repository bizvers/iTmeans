// The checks that need no AI (1 code check, 2 source check, 4 copy check) + helpers for the AI checks.
import fs from "node:fs";
import path from "node:path";
import { P, canon, usedKeys } from "./lib.mjs";

const BI = ["literal_meaning", "field_meaning", "effect", "usage", "example", "caution"];
const DEVA = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;
const DIGITS = /[0-9०-९]|%|प्रतिशत|percent/i; // digits, %, "प्रतिशत"
const SECTION = /(धारा|section|sec\.|article|अनुच्छेद)\s*[0-9०-९]/i; // धारा/Section N

// A word is ONE record that can be filled in two steps (entry stage "short", then "full").
// Stage short fills only: term, pronunciation_hi, field_meaning.hi, kind. The DETAIL fields below are then all absent.
// Full = all of them present. A mix is an error. Same file, same id, same address; nothing else changes.
export const DETAIL = ["level", "literal_meaning", "effect", "effect_flow", "usage", "example", "caution", "related"];
export const hasDetail = (w) => DETAIL.some((f) => w[f] != null);

/** Check 1: code check. Returns a list of problems ([] = pass). */
export function codeCheck(w, { domain, subtopic, taxonomy, isNew = true }) {
  const bad = [];
  const need = (c, msg) => { if (!c) bad.push(msg); };
  need(w.term && /^[A-Za-z]/.test(w.term), "term missing or not starting with a letter");
  need(w.letter === w.term?.[0]?.toUpperCase(), "letter does not match term");
  need(w.pronunciation_hi && DEVA.test(w.pronunciation_hi), "pronunciation_hi must be Devanagari");
  need(w.field_meaning?.hi?.trim() && DEVA.test(w.field_meaning.hi), "field_meaning.hi must be Devanagari");
  const first = w.field_meaning?.hi?.split(/[।.]/)[0] ?? "";
  need(first.length <= 60, "field_meaning.hi first sentence over 60 chars");
  if (w.kind != null) { // what sort of word: company / software / term ... (free text, small, shown under the meaning)
    need(w.kind?.en?.trim() && LATIN.test(w.kind.en) && w.kind.en.length <= 24, "kind.en must be a short English word");
    need(w.kind?.hi?.trim() && DEVA.test(w.kind.hi) && w.kind.hi.length <= 24, "kind.hi must be a short Devanagari word");
  }
  if (isNew) { // only Devanagari, Latin letters/digits/punctuation in Hindi text: a real run once put Korean letters into a Hindi meaning
    const FOREIGN = /[^ऀ-ॿ\u0000-ɏ -⁯₹]/u;
    for (const [k, v] of [["pronunciation_hi", w.pronunciation_hi], ["field_meaning.hi", w.field_meaning?.hi], ["kind.hi", w.kind?.hi]]) if (v) need(!FOREIGN.test(v), `${k} has letters of another script`);
  }
  const full = hasDetail(w);
  if (full) {
    need(DETAIL.every((f) => w[f] != null), `detail fields are all-or-none; missing: ${DETAIL.filter((f) => w[f] == null).join(", ")}`);
    need(["basic", "advanced"].includes(w.level), "level must be basic/advanced");
    for (const f of BI) {
      need(w[f]?.hi?.trim() && w[f]?.en?.trim(), `${f}: both hi and en required`);
      if (w[f]?.hi) need(DEVA.test(w[f].hi), `${f}.hi has no Devanagari`);
      if (w[f]?.en) need(LATIN.test(w[f].en), `${f}.en has no Latin text`);
    }
    need(Array.isArray(w.effect_flow) && w.effect_flow.length === 3 && w.effect_flow.every((s) => s.hi?.trim() && s.en?.trim()), "effect_flow needs exactly 3 steps in hi+en");
    need(!DIGITS.test(JSON.stringify([w.effect, w.effect_flow])), "effect has a number or percentage");
    need(Array.isArray(w.related) && w.related.length >= 2 && w.related.length <= 5, "related needs 2-5 items");
  }
  const d = taxonomy.domains.find((x) => x.id === domain);
  if (d?.notice === "legal-not-advice") need(!SECTION.test(JSON.stringify(w)), "law word contains a section number");
  if (isNew) {
    const exists = fs.existsSync(path.join(P.words, domain, subtopic, `${w.slug}.json`)) ||
      fs.existsSync(path.join(P.held, `${domain}__${w.slug}.json`));
    need(!exists, "word already exists in this subtopic (or held list)");
    need(exists || !usedKeys(domain).has(canon(w.term)), "same word already exists under another spelling / plural / short name");
  }
  return bad;
}

/**
 * Check 2: the CODE finds the source, not the AI. Trusted sites only; the term must appear on the page.
 * web-development: MDN first, then Wikipedia. Every other domain: Wikipedia. Returns {ok,url,text,reason}.
 */
// Polite requests to the source sites: a short gap between calls, and on "429 too many requests" wait and ask again.
// A real run with 200 words got HTTP 429 from Wikipedia for 75 of them.
const GAP_MS = 300;
let lastCall = 0;
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
async function polite(fetchImpl, url, opts) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const r = await fetchImpl(url, opts);
    if (r.status !== 429 || attempt === 2) return r;
    const after = Number(r.headers?.get?.("retry-after"));
    await sleep(Math.min(30, after > 0 ? after : 5 * (attempt + 1)) * 1000);
  }
}

// Wikipedia answers up to 20 titles in ONE request (intro text only). One request for 20 words instead of 20 requests
// is what avoids the "429 too many requests" that held back most words. A page not found here is really missing;
// a page whose intro does not name the term is looked up again the old way (full text).
const WIKI_H = { headers: { "User-Agent": "iTmeans-checker/1.0 (+https://github.com/bizvers/iTmeans)" } };
const wikiCache = new Map(); // term -> { missing: true } | { title, extract }
export function clearWikiCache() { wikiCache.clear(); }
export async function warmWikipedia(terms, fetchImpl0 = fetch) {
  const fetchImpl = (url, opts) => polite(fetchImpl0, url, opts);
  const plain = (t) => t.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const all = [...new Set(terms.flatMap((t) => [t, plain(t)]).filter((t) => t && !t.includes("|") && !wikiCache.has(t)))];
  for (let i = 0; i < all.length; i += 20) {
    const group = all.slice(i, i + 20);
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&exlimit=max&redirects=1&format=json&titles=${group.map(encodeURIComponent).join("%7C")}`;
      const r = await fetchImpl(url, WIKI_H);
      if (!r.ok) continue; // busy: these terms are looked up one by one later
      const q = (await r.json()).query ?? {};
      const norm = new Map((q.normalized ?? []).map((x) => [x.from, x.to]));
      const redir = new Map((q.redirects ?? []).map((x) => [x.from, x.to]));
      const byTitle = new Map(Object.values(q.pages ?? {}).map((p) => [p.title, p]));
      for (const t of group) {
        const n = norm.get(t) ?? t, page = byTitle.get(redir.get(n) ?? n);
        if (!page) continue;
        wikiCache.set(t, page.missing !== undefined ? { missing: true } : { title: page.title, extract: page.extract ?? "" });
      }
    } catch { /* nothing cached: the old one-by-one lookup is used */ }
  }
}

// subjects whose words are web/programming words: MDN is asked first (it was only web-development, so HTML words of
// "programming-languages" such as Textarea or KeyboardEvent were held for "no source")
export const MDN_DOMAINS = new Set(["web-development", "programming-languages"]);

/**
 * Wikipedia search with the topic as hint, for a term whose own title is a "may refer to" page or missing:
 * "Browser" + "web development" -> "Web browser". The found page must still name the term.
 */
// 17 Nov 2026: the hint used to be "<topic> <subject>" in ONE search ("Aerospike Database Web Development"); Wikipedia's search
// wants every word on the page, so it found nothing and 40 of 40 held words were held wrongly. Now: the topic only, then the
// exact phrase alone. A page whose title does not repeat the term counts too ("Hot backup" is explained on "Backup"),
// as long as the page text names the term. Titles that repeat the term are tried first. At most 4 pages are read per term.
async function wikiSearch(term, hint, fetchImpl, has) {
  const must = hint?.must ? hint.must.toLowerCase().replace(/[^a-z0-9]+/g, "") : ""; // "Grant (SQL)": the page must say "SQL"
  if (hint?.list) hint = hint.list;
  const hints = (Array.isArray(hint) ? hint : [hint]).filter(Boolean);
  const queries = [...new Set([hints.length ? `${term} ${hints[0]}` : null, `"${term}"`].filter(Boolean))];
  const core = term.toLowerCase();
  // a found page must also be about the topic ("Grant" -> "Cary Grant" has no "database"): a word of the topic/subject on the page
  const GENERIC = new Set(["development", "editing", "design", "basics", "general", "other", "advanced"]);
  const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const ctx = [...new Set(hints.flatMap((h) => String(h).toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 4 && !GENERIC.has(w)).map((w) => w.replace(/(ies|es|s)$/, "")))];
  const times = (s, w) => s.split(w).length - 1;
  // at least twice (one passing mention, e.g. "Internet Movie Database" on an actor's page, is not enough)
  const onTopic = (text) => { const t = flat(text); return (!must || t.includes(must)) && (!ctx.length || ctx.some((w) => times(t, w) >= 2)); };
  const seen = new Set();
  let read = 0, status = null;
  for (const q of queries) {
    const r = await fetchImpl(`https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=5&format=json&srsearch=${encodeURIComponent(q)}`, WIKI_H);
    if (!r.ok) { status = r.status; continue; }
    const hits = ((await r.json()).query?.search ?? []).filter((h) => !/disambiguation/i.test(h.title) && !seen.has(h.title));
    hits.sort((a, b) => Number(b.title.toLowerCase().includes(core)) - Number(a.title.toLowerCase().includes(core)));
    for (const h of hits.slice(0, 3)) {
      if (read >= 4) break;
      seen.add(h.title); read++;
      const pr = await fetchImpl(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(h.title)}`, WIKI_H);
      if (!pr.ok) { status = pr.status; continue; }
      const page = Object.values((await pr.json()).query?.pages ?? {})[0];
      if (!page?.extract || /may refer to/i.test(page.extract.slice(0, 300)) || !has(page.extract) || !onTopic(page.extract)) continue;
      return { ok: true, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, text: page.extract };
    }
  }
  throw new Error(status ? `Wikipedia search HTTP ${status}` : "no matching Wikipedia page in search");
}

async function resolveOne(term, domainId, fetchImpl0, hint) {
  const fetchImpl = (url, opts) => polite(fetchImpl0, url, opts);
  const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ");
  const core = term.replace(/\s*\([^)]*\)\s*/g, " ").trim(); // the page need not repeat our qualifier: "Equalization (audio)" -> "Equalization"
  const has = (text) => text.toLowerCase().includes((core || term).toLowerCase());
  const H = { headers: { "User-Agent": "iTmeans-checker/1.0 (+https://github.com/bizvers/iTmeans)" } }; // Wikimedia asks bots to say who they are
  const tries = [];
  if (MDN_DOMAINS.has(domainId)) tries.push(async () => {
    const r = await fetchImpl(`https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(term)}&locale=en-US&size=3`, H);
    if (!r.ok) throw new Error(`MDN search HTTP ${r.status}`);
    for (const d of (await r.json()).documents ?? []) {
      if (!d.title?.toLowerCase().includes(term.toLowerCase())) continue;
      const url = `https://developer.mozilla.org${d.mdn_url}`;
      const pr = await fetchImpl(url, H);
      if (pr.ok) { const text = strip(await pr.text()); if (has(text)) return { ok: true, url, text }; }
    }
    throw new Error("no MDN page for this term");
  });
  tries.push(async () => {
    const hit = wikiCache.get(term);
    if (hit?.missing) throw new Error("no Wikipedia page for this term");
    if (hit?.extract && !/may refer to|disambiguation/i.test(hit.extract.slice(0, 300)) && has(hit.extract))
      return { ok: true, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`, text: hit.extract };
    const api =`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(term)}`;
    const r = await fetchImpl(api, H);
    if (!r.ok) throw new Error(`Wikipedia HTTP ${r.status}`);
    const page = Object.values((await r.json()).query?.pages ?? {})[0];
    if (!page || page.missing !== undefined || !page.extract) throw new Error("no Wikipedia page for this term");
    if (/may refer to|disambiguation/i.test(page.extract.slice(0, 300))) throw new Error("Wikipedia page is a disambiguation page");
    if (!has(page.extract)) throw new Error("term not found in the Wikipedia page");
    return { ok: true, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, text: page.extract };
  });
  if (hint) tries.push(() => wikiSearch(core || term, hint, fetchImpl, has)); // last: search with the topic, e.g. "Browser" -> "Web browser"
  const why = [];
  for (const t of tries) { try { return await t(); } catch (e) { why.push(e.message); } }
  return { ok: false, reason: `no trusted source: ${why.join("; ")}` };
}
/** Tries the term as written, then without a trailing qualifier: "Backend (web development)" -> "Backend". */
export async function resolveSource(term, domainId, fetchImpl = fetch, hint = null) {
  const plain = term.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const variants = [...new Set([term, plain].filter(Boolean))];
  const qual = (term.match(/\(([^)]*)\)/)?.[1] ?? "").trim();
  const searchHint = hint && qual ? { list: Array.isArray(hint) ? hint : [hint], must: qual } : hint;
  const why = [];
  for (const [i, v] of variants.entries()) {
    const r = await resolveOne(v, domainId, fetchImpl, i === variants.length - 1 ? searchHint : null); // the search only once, on the last variant
    if (r.ok) return r;
    why.push(r.reason);
  }
  return { ok: false, reason: why.join(" | ") };
}
/** Check 4: no run of `n` consecutive words copied verbatim from the source (copyright). */
export function copyCheck(w, sourceText, n = 8) {
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const src = norm(sourceText), srcJoined = " " + src.join(" ") + " ";
  for (const f of [...BI.map((k) => w[k]), ...(w.effect_flow ?? [])]) {
    const words = norm(f?.en ?? "");
    for (let i = 0; i + n <= words.length; i++)
      if (srcJoined.includes(" " + words.slice(i, i + n).join(" ") + " ")) return [`copied ${n}+ words from source: "${words.slice(i, i + n).join(" ")}"`];
  }
  return [];
}

/** Check 6: pause rule. */
export function shouldPause(processed, held, percent) {
  return processed >= 5 && held / processed * 100 > percent;
}
