// Run: node --test scripts/content-cache.test.mjs   (proves word files are read once, however often the helpers are called)
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(path.join(repo, "site")); // content.ts finds ../content from the site folder
const c = await import(new URL("../site/src/lib/content.ts", import.meta.url).href);

test("each word file is read once, however many times the helpers are called", () => {
  const first = c.allWords().length;
  assert.ok(first > 0);
  const readsAfterFirst = c.wordFileReads;
  for (let i = 0; i < 200; i++) {
    c.allWords();
    for (const d of c.domains) for (const s of d.subtopics) c.wordsOf(d.id, s.id);
  }
  c.findWord("web-development", "backend", "cache");
  assert.equal(c.wordFileReads, readsAfterFirst);
});
test("text(): hi and en come from the word, a language without translation falls back to English", () => {
  const w = c.findWord("web-development", "backend", "api");
  assert.equal(c.text(w, "usage", "hi"), w.usage.hi);
  assert.equal(c.text(w, "usage", "en"), w.usage.en);
  assert.equal(c.text(w, "usage", "gu"), w.usage.en);
  assert.deepEqual(c.flow(w, "gu"), w.effect_flow.map((s) => s.en));
});
test("website words: every active language has a complete UI file", async () => {
  const { ui, tr } = await import(new URL("../site/src/lib/ui.ts", import.meta.url).href);
  for (const l of c.languages) assert.deepEqual(Object.keys(ui[l.code]).sort(), Object.keys(ui.en).sort(), l.code);
  assert.equal(tr("gu", "search"), ui.en.search); // unknown language -> English
});
test("helpers return the same published words as before", () => {
  const w = c.findWord("web-development", "backend", "api");
  assert.equal(w?.term, "API");
  assert.ok(c.allWords().every((x) => x.status === "published"));
  assert.deepEqual(c.wordsOf("nope", "nope"), []);
});
