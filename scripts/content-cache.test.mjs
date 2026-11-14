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
test("helpers return the same published words as before", () => {
  const w = c.findWord("web-development", "backend", "api");
  assert.equal(w?.term, "API");
  assert.ok(c.allWords().every((x) => x.status === "published"));
  assert.deepEqual(c.wordsOf("nope", "nope"), []);
});
