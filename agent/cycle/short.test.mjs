// Run: node --test agent/cycle   (scratch copy of the repo; fake models)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itmeans-short-"));
for (const d of ["content/taxonomy", "content/settings", "agent/prompts"]) fs.cpSync(path.join(real, d), path.join(tmp, d), { recursive: true });
process.env.ITMEANS_ROOT = tmp;
const { runCycle } = await import("./cycle.mjs");
const { codeCheck, hasDetail } = await import("./checks.mjs");
const { rulesFor, currentTopic, topicFinished, topicCounts } = await import("./topic.mjs");
const { P, readJson, writeJson, ID_RE, loadWords, loadProgress } = await import("./lib.mjs");

const tax = () => readJson(P.taxonomy);
const base = readJson(P.settings);
const set = (extra = {}) => writeJson(P.settings, { ...base, stop_all: false, entry_stage: "short", no_daily_cap: false, daily_caps: base.daily_caps.map((c) => ({ ...c, cap: 500 })), ...extra });
writeJson(P.pause, { paused: false, reason: "", at: "" });
set();

test("rules: defaults 5..20, topic target 520; admin overrides per topic", () => {
  assert.deepEqual(rulesFor({}, "a", "b"), { min: 5, max: 20, mode: "letters", target: 520 });
  const s = { topic_defaults: { min: 3, max: 10 }, topic_rules: { "a/b": { mode: "popular" }, "a/c": { max: 8, min: 2 } } };
  assert.equal(rulesFor(s, "x", "y").target, 260);
  assert.equal(rulesFor(s, "a", "b").target, 100);
  assert.deepEqual([rulesFor(s, "a", "c").min, rulesFor(s, "a", "c").max], [2, 8]);
});

test("a short word is a full record with empty detail fields; a half-filled detail is rejected", () => {
  const t = tax();
  const w = { id: "w-aaaaaaaa", term: "Flexbox", letter: "F", slug: "flexbox", pronunciation_hi: "फ़्लेक्सबॉक्स", field_meaning: { hi: "लेआउट का तरीक़ा।" }, kind: { en: "term", hi: "शब्द" }, status: "published" };
  assert.deepEqual(codeCheck(w, { domain: "web-development", subtopic: "frontend", taxonomy: t }), []);
  assert.equal(hasDetail(w), false);
  assert.ok(codeCheck({ ...w, level: "basic" }, { domain: "web-development", subtopic: "frontend", taxonomy: t }).some((m) => /all-or-none/.test(m)));
  assert.ok(codeCheck({ ...w, kind: { en: "term" } }, { domain: "web-development", subtopic: "frontend", taxonomy: t }).length > 0);
});

test("one topic at a time, A..Z in turn, no forced words for X/Y/Z, topic done -> 5 suggestions and the next topic", async () => {
  let runs = 0;
  while (!loadProgress().done_topics.length && runs++ < 40) await runCycle({ mock: true, maxPerRun: 26 });
  const p = loadProgress();
  assert.deepEqual(p.done_topics, ["web-development/frontend"]);
  const words = loadWords().filter((x) => x.sub === "frontend");
  assert.equal(words.length, 23 * 7); // A..W have 7 fake words each; X, Y, Z have none and nothing was forced
  assert.ok(words.every((x) => ID_RE.test(x.w.id) && !hasDetail(x.w) && x.w.kind.en && x.w.checked_by.length === 0));
  assert.equal(loadWords().filter((x) => x.sub !== "frontend").length, 0, "only one topic was worked on");
  assert.ok(["X", "Y", "Z"].every((l) => p.exhausted["web-development/frontend"].includes(l)));
  const sug = readJson(P.suggestions);
  assert.equal(sug.length, 5);
  assert.equal(currentTopic(tax(), readJson(P.settings), p).s.id, "backend");
});

test("a word that came before never comes again (per subject)", async () => {
  const seen = loadWords().map((x) => x.w.slug);
  assert.equal(new Set(seen).size, seen.length);
});

test("every review_every words: three AIs check together; a doubtful word goes to held; writing waits", async () => {
  set({ topic_defaults: { review_every: 10 } });
  const f = path.join(P.words, "web-development/frontend/badword.json");
  writeJson(f, { id: "w-bbbbbbbb", term: "BadWord", domain: "web-development", subtopic: "frontend", letter: "B", slug: "badword", pronunciation_hi: "बैड", field_meaning: { hi: "नमूना।" }, kind: { en: "term", hi: "शब्द" }, status: "published", written_by: "x", checked_by: [], created_at: "2000-01-01", checked_at: null });
  const before = loadWords().length;
  await runCycle({ mock: true, maxPerRun: 0 }); // 0 new words: look at the review alone
  assert.equal(loadProgress().review_job, null, "the whole review finished in this run");
  assert.ok(fs.existsSync(path.join(P.held, "web-development__badword.json")));
  assert.ok(!fs.existsSync(f));
  assert.equal(loadWords().length, before - 1);
  const checked = loadWords().filter((x) => x.w.checked_by.length === 3);
  assert.equal(checked.length, 9);
  assert.ok(new Set(checked[0].w.checked_by.map((n) => n.split("/")[1])).size === 3);
});

test("no_daily_cap: the per-subject daily cap is ignored (model free limits still apply in Pool)", async () => {
  const zero = base.daily_caps.map((c) => ({ ...c, cap: 0 }));
  const sub = { current_topic: "video-editing/cutting", topic_defaults: { review_every: 100000 } }; // a fresh subject: the fake words of web-development are used up
  set({ ...sub, no_daily_cap: true, daily_caps: zero });
  const r = await runCycle({ mock: true, maxPerRun: 3 });
  assert.equal(r.published, 3, "words were written although every cap is 0");
  set({ ...sub, daily_caps: zero });
  assert.equal((await runCycle({ mock: true, maxPerRun: 3 })).published, 0, "cap 0 still stops when the switch is off");
});
test("three AIs write: the words are shared between three different companies, least-used first", async () => {
  const { Pool } = await import("./providers.mjs");
  const { mockModel } = await import("./mock.mjs");
  const { writeShortBatch } = await import("./short.mjs");
  const rows = ["A", "B", "C"].map((c) => ({ service: "mock", model: `m-${c}`, company: `Co${c}`, role: ["writer", "checker", "list"], daily_limit: 100 }));
  const pool = new Pool(rows, { mock: mockModel, dryRun: true, balance: true });
  const d = { id: "web-development", en: "Web Development" }, s = { id: "frontend", en: "Frontend" };
  const picks = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"].map((term, i) => ({ domain: d, sub: s, term, id: `w-aaaaaaa${i}` }));
  const out = await writeShortBatch(pool, picks);
  assert.equal(out.length, 7);
  assert.equal(new Set(out.map((r) => r.writer.company)).size, 3, "all three companies wrote");
  assert.deepEqual(out.map((r) => r.item.term).sort(), picks.map((p) => p.term).sort());
});

test("hundreds of words in one run: shared out in requests of at most 15 words, all AIs take turns", async () => {
  const { Pool } = await import("./providers.mjs");
  const { mockModel } = await import("./mock.mjs");
  const { writeShortBatch } = await import("./short.mjs");
  const rows = ["A", "B", "C"].map((c) => ({ service: "mock", model: `m-${c}`, company: `Co${c}`, role: ["writer"], daily_limit: 1000 }));
  const pool = new Pool(rows, { mock: mockModel, dryRun: true, balance: true });
  const d = { id: "web-development", en: "Web Development" }, s = { id: "frontend", en: "Frontend" };
  const picks = Array.from({ length: 200 }, (_, i) => ({ domain: d, sub: s, term: `Word${i}`, id: `w-x${String(i).padStart(7, "0")}` }));
  const out = await writeShortBatch(pool, picks);
  assert.equal(out.length, 200);
  assert.equal(new Set(out.map((r) => r.writer.company)).size, 3);
  const mine = Object.entries(pool.used).filter(([k]) => k.startsWith("mock/m-")).map(([, n]) => n);
  assert.equal(mine.reduce((a, b) => a + b, 0), Math.ceil(200 / 15), "requests of at most 15 words");
  assert.ok(Math.max(...mine) - Math.min(...mine) <= 1, `the AIs take equal turns ${JSON.stringify(mine)}`);
});

test("a Hindi meaning with letters of another script (e.g. Korean) is rejected for new words", () => {
  const t = tax();
  const w = { id: "w-aaaaaaaa", term: "WebAssembly", letter: "W", slug: "webassembly", pronunciation_hi: "वेबअसेंबली", field_meaning: { hi: "브라우저 में बाइनरी कोड चलाने का फॉर्मेट।" }, kind: { en: "format", hi: "फॉर्मेट" }, status: "published" };
  assert.ok(codeCheck(w, { domain: "web-development", subtopic: "frontend", taxonomy: t }).some((m) => /another script/.test(m)));
  assert.deepEqual(codeCheck({ ...w, field_meaning: { hi: "browser में binary code चलाने का format।" } }, { domain: "web-development", subtopic: "frontend", taxonomy: t }), []);
});

test("words without a source page are held at once and do NOT trigger the pause rule", async () => {
  set({ current_topic: "photo-editing/layers", topic_defaults: { review_every: 100000 } });
  writeJson(P.pause, { paused: false, reason: "", at: "" });
  globalThis.__mockNoSource = /(alpha|beta|gamma|delta|zeta|eta)$/i; // 6 of the 7 fake words of every letter have no source
  try {
    const r = await runCycle({ mock: true, maxPerRun: 60 });
    assert.ok(r.noSource > r.published, `most words had no source: ${JSON.stringify(r)}`);
    assert.equal(r.paused, false, "no pause for missing sources");
    assert.equal(readJson(P.pause).paused, false);
    const held = fs.readdirSync(P.held).map((f) => readJson(path.join(P.held, f))).filter((h) => h.subtopic === "layers");
    assert.ok(held.length >= r.noSource && held.every((h) => /no trusted source/.test(h.hold_reason)), "held at once, with the reason");
  } finally { delete globalThis.__mockNoSource; }
});
