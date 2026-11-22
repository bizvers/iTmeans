// Run: node --test scripts/suggest.test.mjs   (search keys and ranking for /api/suggest, scale step s3)
import test from "node:test";
import assert from "node:assert/strict";
const k = await import(new URL("../site/src/lib/search-key.mjs", import.meta.url).href);
const { rank } = await import(new URL("../site/src/lib/suggest.ts", import.meta.url).href);

test("search keys: case, spaces, accents, hyphens and nukta do not matter", () => {
  assert.equal(k.searchKey("Ajax (programming)"), "ajaxprogramming");
  assert.equal(k.searchKey("ए-पी-आई"), "एपीआई");
  assert.equal(k.searchKey("Café"), "cafe");
  assert.equal(k.searchKey("क़ानून"), k.searchKey("कानून"));
  assert.equal(k.shardOf("cache"), "63-61");
});

test("word keys: whole name, parts and Hindi pronunciation", () => {
  const keys = k.wordKeys({ term: "Machine learning", pronunciation_hi: "मशीन लर्निंग" });
  for (const want of ["machinelearning", "machine", "learning", "मशीनलर्निंग", "लर्निंग"]) assert.ok(keys.includes(want), want);
});

test("full-text: text and queries are cleaned the same way", () => {
  assert.equal(k.ftsText("रंग मॉडल में नीला‑हरा रंग।"), "रंग मॉडल में नीला हरा रंग");
  assert.equal(k.ftsText("Café (Colour), API"), "cafe colour api");
  assert.equal(k.ftsText("क़ानून"), "कानून");
  assert.equal(k.ftsQuery("रंग बद"), '"रंग"* "बद"*');
  assert.equal(k.ftsQuery(`a"b OR c`), '"a"* "b"* "or"* "c"*'); // quotes and FTS words cannot change the query
  assert.equal(k.ftsQuery("x"), null);
  assert.equal(k.ftsQuery("  ।। "), null);
});

const e = (t, p, extra = {}) => ({ k: k.wordKeys({ term: t, pronunciation_hi: p }), t, p, m: { hi: `${t} का अर्थ`, en: `${t} meaning` }, d: "web-development", s: "backend", g: t.toLowerCase().replace(/\W+/g, "-"), ...extra });
const entries = [e("Cache server", "कैश सर्वर"), e("Cache", "कैश"), e("Caching", "कैशिंग"), e("Web cache", "वेब कैश"), e("Kafka", "काफ़्का")];

test("rank: exact name first, then names starting with it, then parts; Hindi works too", () => {
  assert.deepEqual(rank(entries, "cache", "hi").map((r) => r.term), ["Cache", "Cache server", "Web cache"]);
  assert.deepEqual(rank(entries, "cach", "en").map((r) => r.term), ["Cache", "Caching", "Cache server", "Web cache"]);
  assert.equal(rank(entries, "कैश", "hi")[0].term, "Cache");
  assert.equal(rank(entries, "cache", "hi")[0].meaning, "Cache का अर्थ");
  assert.equal(rank(entries, "cache", "en")[0].meaning, "Cache meaning");
  assert.deepEqual(rank(entries, "c", "hi"), []); // one letter is too little
  assert.deepEqual(rank(entries, "zzz", "hi"), []);
});
