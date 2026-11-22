// Search keys, shared by the exporter (scripts/export-r2.mjs) and the Worker (src/pages/api/suggest.ts), so both
// cut words the same way. A key is lower-case Latin letters/digits, or Devanagari letters, with spaces, dots,
// hyphens and accents removed: "Ajax (programming)" -> "ajaxprogramming", "ए-पी-आई" -> "एपीआई".

const LATIN = /[a-z0-9]/;
const DEVANAGARI = /[ऀ-ॿ]/;

/** One search key from any text (what a reader types, or a word's name). */
export function searchKey(text) {
  const s = String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().normalize("NFC");
  let out = "";
  for (const ch of s) if (LATIN.test(ch) || DEVANAGARI.test(ch)) out += ch;
  return out.replace(/[़]/g, ""); // nukta (क़ = क): readers often type without it
}

/** All keys a word can be found by: whole name, each part of a multi-word name, Hindi pronunciation (whole + parts). */
export function wordKeys(w) {
  const keys = new Set();
  const add = (t) => { const k = searchKey(t); if (k.length >= 2) keys.add(k); };
  for (const name of [w.term, w.term_hi, w.pronunciation_hi]) {
    if (!name) continue;
    add(name);
    for (const part of String(name).split(/[\s\-/()।.,]+/)) add(part);
  }
  return [...keys];
}

/** Which shard a key lives in: its first two characters (shards stay small even at a million words). */
export const shardOf = (key) => [...key].slice(0, 2).map((c) => c.codePointAt(0).toString(16)).join("-");
