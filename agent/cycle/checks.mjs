// The checks that need no AI (1 code check, 2 source check, 4 copy check) + helpers for the AI checks.
import fs from "node:fs";
import path from "node:path";
import { P } from "./lib.mjs";

const BI = ["literal_meaning", "field_meaning", "effect", "usage", "example", "caution"];
const DEVA = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;
const DIGITS = /[0-9०-९]|%|प्रतिशत|percent/i; // digits, %, "प्रतिशत"
const SECTION = /(धारा|section|sec\.|article|अनुच्छेद)\s*[0-9०-९]/i; // धारा/Section N

/** Check 1: code check. Returns a list of problems ([] = pass). */
export function codeCheck(w, { domain, subtopic, taxonomy, isNew = true }) {
  const bad = [];
  const need = (c, msg) => { if (!c) bad.push(msg); };
  need(w.term && /^[A-Za-z]/.test(w.term), "term missing or not starting with a letter");
  need(w.letter === w.term?.[0]?.toUpperCase(), "letter does not match term");
  need(["basic", "advanced"].includes(w.level), "level must be basic/advanced");
  need(w.pronunciation_hi && DEVA.test(w.pronunciation_hi), "pronunciation_hi must be Devanagari");
  for (const f of BI) {
    need(w[f]?.hi?.trim() && w[f]?.en?.trim(), `${f}: both hi and en required`);
    if (w[f]?.hi) need(DEVA.test(w[f].hi), `${f}.hi has no Devanagari`);
    if (w[f]?.en) need(LATIN.test(w[f].en), `${f}.en has no Latin text`);
  }
  need(Array.isArray(w.effect_flow) && w.effect_flow.length === 3 && w.effect_flow.every((s) => s.hi?.trim() && s.en?.trim()), "effect_flow needs exactly 3 steps in hi+en");
  const first = w.field_meaning?.hi?.split(/[।.]/)[0] ?? "";
  need(first.length <= 60, "field_meaning.hi first sentence over 60 chars");
  need(!DIGITS.test(JSON.stringify([w.effect, w.effect_flow])), "effect has a number or percentage");
  const d = taxonomy.domains.find((x) => x.id === domain);
  if (d?.notice === "legal-not-advice") need(!SECTION.test(JSON.stringify(w)), "law word contains a section number");
  need(Array.isArray(w.related) && w.related.length >= 2 && w.related.length <= 5, "related needs 2-5 slugs");
  if (isNew) {
    const exists = fs.existsSync(path.join(P.words, domain, subtopic, `${w.slug}.json`)) ||
      fs.existsSync(path.join(P.held, `${domain}__${w.slug}.json`));
    need(!exists, "word already exists in this subtopic (or held list)");
  }
  return bad;
}

/** Check 2: the source link opens and the term is on that page. Returns {ok, text, reason}. */
export async function sourceCheck(url, term, fetchImpl = fetch) {
  if (!/^https:\/\//.test(url ?? "")) return { ok: false, reason: "source_url missing or not https" };
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": "iTmeans-checker" } });
    if (!r.ok) return { ok: false, reason: `source HTTP ${r.status}` };
    const text = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ");
    return text.toLowerCase().includes(term.toLowerCase())
      ? { ok: true, text } : { ok: false, reason: "term not found on the source page" };
  } catch (e) { return { ok: false, reason: `source fetch failed: ${e.message}` }; }
}

/** Check 4: no run of `n` consecutive words copied verbatim from the source (copyright). */
export function copyCheck(w, sourceText, n = 8) {
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const src = norm(sourceText), srcJoined = " " + src.join(" ") + " ";
  for (const f of [...BI.map((k) => w[k]), ...w.effect_flow]) {
    const words = norm(f.en ?? "");
    for (let i = 0; i + n <= words.length; i++)
      if (srcJoined.includes(" " + words.slice(i, i + n).join(" ") + " ")) return [`copied ${n}+ words from source: "${words.slice(i, i + n).join(" ")}"`];
  }
  return [];
}

/** Check 6: pause rule. */
export function shouldPause(processed, held, percent) {
  return processed >= 2 && held / processed * 100 > percent;
}
