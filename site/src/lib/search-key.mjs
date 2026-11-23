// Search keys, shared by the exporter (scripts/export-r2.mjs) and the Worker (src/pages/api/suggest.ts), so both
// cut words the same way. A key is lower-case Latin letters/digits, or Indian-script letters (Devanagari, Bengali;
// scale step s5), with spaces, dots, hyphens and accents removed: "Ajax (programming)" -> "ajaxprogramming", "ए-पी-आई" -> "एपीआई".

const LATIN = /[a-z0-9]/;
const INDIC = /[ऀ-ॿঀ-৿]/; // Devanagari U+0900-097F, Bengali U+0980-09FF

/** One search key from any text (what a reader types, or a word's name). */
export function searchKey(text) {
  const s = String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().normalize("NFC");
  let out = "";
  for (const ch of s) if (LATIN.test(ch) || INDIC.test(ch)) out += ch;
  return out.replace(/[়़]/g, ""); // nukta (क़ = क, য় = য): readers often type without it
}

/** All keys a word can be found by: whole name, each part of a multi-word name, Hindi pronunciation (whole + parts),
 *  and the pronunciation in other languages (translations: { bn: { pronunciation } }). */
export function wordKeys(w, translations) {
  const keys = new Set();
  const add = (t) => { const k = searchKey(t); if (k.length >= 2) keys.add(k); };
  const prons = Object.values(translations ?? {}).map((t) => t?.pronunciation).filter(Boolean);
  for (const name of [w.term, w.term_hi, w.pronunciation_hi, ...prons]) {
    if (!name) continue;
    add(name);
    for (const part of String(name).split(/[\s\-/()।.,]+/)) add(part);
  }
  return [...keys];
}

/** Which shard a key lives in: its first two characters (shards stay small even at a million words). */
export const shardOf = (key) => [...key].slice(0, 2).map((c) => c.codePointAt(0).toString(16)).join("-");

// Full-text search (scale step s3, layer 2: D1 FTS5). Text is cleaned the same way before it is stored and before it
// is searched: lower-case, no accents, no nukta, and everything except Latin letters/digits and Devanagari / Bengali
// letters and vowel signs becomes a space (so "।", commas and brackets split words).
const WORDCH = /[a-z0-9ऀ-ॣ०-ॿঀ-৿]/;

/** Text ready for the full-text index: words separated by single spaces. */
export function ftsText(text) {
  const s = String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().normalize("NFC").replace(/[়़]/g, "");
  let out = "";
  for (const ch of s) out += WORDCH.test(ch) ? ch : " ";
  return out.replace(/\s+/g, " ").trim();
}

/** What the reader typed, as an FTS5 query: every word must be there, each as the start of a word
 *  ("रंग बद" finds "रंगों को बदलना"). null when there is too little to search. */
export function ftsQuery(typed) {
  const words = ftsText(String(typed ?? "").slice(0, 80)).split(" ").filter(Boolean).slice(0, 6);
  if (words.join("").length < 2) return null;
  return words.map((w) => `"${w}"*`).join(" ");
}
