// Run: node --test agent/cycle   (uses a scratch copy of the repo; never touches real content)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itmeans-"));
for (const d of ["content/taxonomy", "content/settings", "agent/prompts"]) fs.cpSync(path.join(real, d), path.join(tmp, d), { recursive: true });
process.env.ITMEANS_ROOT = tmp;
const { runCycle } = await import("./cycle.mjs");
const { ingest } = await import("./ingest.mjs");
const { Pool } = await import("./providers.mjs");
const { MOCK_ROWS, mockModel, mockResolve } = await import("./mock.mjs");
const { codeCheck, copyCheck, shouldPause, resolveSource } = await import("./checks.mjs");
const { P, readJson, writeJson, ID_RE, resolveRelated } = await import("./lib.mjs");

writeJson(P.settings, { ...readJson(P.settings), stop_all: false, entry_stage: "full", no_daily_cap: false }); // real settings may be paused; tests start from "on" (the short stage has its own tests: short.test.mjs)
const queue =(d, s, terms) => writeJson(path.join(P.queue, `${d}__${s}.json`), terms.map((term) => ({ term })));

test("publishes good words, holds the bad one, no pause under 50%", async () => {
  queue("web-development", "backend", ["Widget"]);
  queue("web-development", "frontend", ["Bad Thing"]);
  queue("web-development", "database", ["Gadget"]);
  const r = await runCycle({ mock: true });
  assert.deepEqual([r.published, r.held, r.paused], [2, 1, false]);
  const w = readJson(path.join(P.words, "web-development/backend/widget.json"));
  assert.equal(w.status, "published");
  assert.equal(w.written_by, "mock/writer-1");
  assert.equal(w.checked_by.length, 2);
  assert.ok(fs.existsSync(path.join(P.held, "web-development__bad-thing.json")));
  // permanent ids: the queue entry's id becomes the word's id; related terms became ids; the queue entry is gone
  assert.match(w.id, ID_RE);
  const q = readJson(path.join(P.queue, "web-development__backend.json"));
  assert.ok(!q.some((e) => e.id === w.id), "published word left the queue");
  assert.equal(w.related.length, 2);
  for (const r of w.related) { assert.match(r, ID_RE); assert.ok(q.some((e) => e.id === r), "related term reserved in queue"); }
  assert.match(readJson(path.join(P.held, "web-development__bad-thing.json")).id, ID_RE);
});

test("resolveRelated reuses existing words and queued terms instead of duplicating them", () => {
  const w = readJson(path.join(P.words, "web-development/backend/widget.json"));
  const ids = resolveRelated(["Widget", "alpha", "Brand New Term"], { domain: "web-development", sub: "backend", selfId: "w-zzzzzzzz" });
  assert.equal(ids[0], w.id);                       // an existing published word is reused
  assert.equal(ids[1], w.related[0]);               // "alpha" was already reserved in the queue
  assert.equal(new Set(ids).size, 3);               // the third is a brand-new reserved id
  assert.deepEqual(resolveRelated(["Widget"], { domain: "web-development", sub: "backend", selfId: w.id }), []); // never itself
});

test("stop_all makes the cycle do nothing", async () => {
  const s = readJson(P.settings); writeJson(P.settings, { ...s, stop_all: true });
  assert.equal((await runCycle({ mock: true })).kind, "skip");
  writeJson(P.settings, { ...s, stop_all: false });
});

test("daily cap stops new words", async () => {
  const s = readJson(P.settings);
  writeJson(P.settings, { ...s, daily_caps: s.daily_caps.map((c) => ({ ...c, cap: 0 })) });
  queue("web-development", "backend", ["Another"]);
  assert.equal((await runCycle({ mock: true })).kind, "skip");
  writeJson(P.settings, s);
});

test("pause rule writes pause.json when over half are held, and the next run is skipped", async () => {
  fs.rmSync(P.queue, { recursive: true, force: true }); // leftovers from earlier tests would dilute the held share
  queue("video-editing", "cutting", ["Bad One"]);
  queue("video-editing", "color", ["Bad Two"]);
  queue("video-editing", "audio", ["Fine Word"]);
  queue("photo-editing", "retouching", ["Bad Three"]);
  queue("photo-editing", "color", ["Bad Four"]);
  queue("photo-editing", "layers", ["Fine Two"]);
  const r = await runCycle({ mock: true });
  assert.equal(r.paused, true);
  assert.equal(readJson(P.pause).paused, true);
  assert.equal(r.errors, 0);
  assert.match((await runCycle({ mock: true })).reason, /paused/);
  assert.equal(readJson(P.settings).stop_all, false); // settings.json stays untouched by the bot
});

test("code check catches numbers in effect, law section numbers, missing hindi", () => {
  const tax = readJson(P.taxonomy);
  const base = readJson(path.join(real, "content/words/web-development/backend/cache.json"));
  base.field_meaning.hi = "पास में रखा डेटा, ताकि दोबारा तुरंत मिले।"; // the hand-written sample is over the 60-char rule
  assert.deepEqual(codeCheck(base, { domain: "web-development", subtopic: "frontend", taxonomy: tax }), []);
  const bad = structuredClone(base); bad.effect.en = "Faster by 40%"; bad.literal_meaning.hi = "only english";
  const msgs = codeCheck(bad, { domain: "web-development", subtopic: "frontend", taxonomy: tax }).join("|");
  assert.match(msgs, /number or percentage/); assert.match(msgs, /literal_meaning.hi has no Devanagari/);
  const law = structuredClone(base); law.usage.en = "See Section 138 of the Act";
  tax.domains.find((d) => d.id === "web-development").notice = "legal-not-advice";
  assert.match(codeCheck(law, { domain: "web-development", subtopic: "frontend", taxonomy: tax }).join("|"), /section number/);
});

test("copy check finds 8 copied words; pause rule math", () => {
  const w = readJson(path.join(real, "content/words/web-development/backend/cache.json"));
  const src = "intro " + w.field_meaning.en + " outro";
  assert.equal(copyCheck(w, src).length, 1);
  assert.equal(copyCheck(w, "totally different text").length, 0);
  assert.equal(shouldPause(5, 3, 50), true); assert.equal(shouldPause(4, 4, 50), false); assert.equal(shouldPause(6, 3, 50), false);
});

test("source is found by code from trusted sites (MDN first for web, else Wikipedia)", async () => {
  const j = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => "<p>Middleware sits between layers.</p>" });
  const f = async (url) => url.includes("mozilla.org/api") ? j({ documents: [{ title: "Middleware", mdn_url: "/en-US/docs/Glossary/Middleware" }] })
    : url.includes("mozilla.org") ? j({}) : j({ query: { pages: { 1: { title: "Contrast (vision)", extract: "Contrast is the difference in luminance." } } } });
  const a = await resolveSource("Middleware", "web-development", f);
  assert.equal(a.ok, true); assert.match(a.url, /developer\.mozilla\.org/);
  const b = await resolveSource("Contrast", "photo-editing", f);
  assert.equal(b.ok, true); assert.match(b.url, /wikipedia\.org/);
  const none = await resolveSource("Zzzz", "photo-editing", async () => j({ query: { pages: { "-1": { missing: "" } } } }));
  assert.equal(none.ok, false); assert.match(none.reason, /no trusted source/);
});
test("ingest: Claude-written drafts go through the same checks; rejected ones stay in the queue", async () => {
  fs.rmSync(P.queue, { recursive: true, force: true });
  queue("photo-editing", "color", ["Hue Shift", "Bad Tone"]);
  const q = readJson(path.join(P.queue, "photo-editing__color.json"));
  q.forEach((e, i) => (e.id = `w-testaaa${i + 2}`)); writeJson(path.join(P.queue, "photo-editing__color.json"), q);
  const base = { level: "basic", pronunciation_hi: "नमूना", literal_meaning: { hi: "एक अर्थ।", en: "A meaning." }, field_meaning: { hi: "यह एक नमूना है।", en: "This is a sample made for testing." },
    effect: { hi: "जाँच आसान होती है।", en: "Testing becomes easier." }, effect_flow: [{ hi: "एक", en: "One" }, { hi: "दो", en: "Two" }, { hi: "तीन", en: "Three" }],
    usage: { hi: "परीक्षण में।", en: "In testing." }, example: { hi: "उदाहरण।", en: "Example." }, caution: { hi: "सावधान।", en: "Careful." }, related: ["Alpha", "Beta"] };
  const pool = new Pool(MOCK_ROWS, { mock: mockModel });
  const r = await ingest([{ term: "Hue Shift", ...base }, { term: "Bad Tone", ...base }], { pool, resolve: mockResolve });
  assert.deepEqual(r.map((x) => x.status), ["published", "rejected (left in queue)"]);
  const w = readJson(path.join(P.words, "photo-editing/color/hue-shift.json"));
  assert.equal(w.written_by, "claude-code/sonnet-5.5");
  assert.ok(readJson(path.join(P.queue, "photo-editing__color.json")).some((e) => e.term === "Bad Tone")); // still queued
});

const sample = { level: "basic", pronunciation_hi: "नमूना", literal_meaning: { hi: "एक अर्थ।", en: "A meaning." }, field_meaning: { hi: "यह एक नमूना है।", en: "This is a sample made for testing." },
  effect: { hi: "जाँच आसान होती है।", en: "Testing becomes easier." }, effect_flow: [{ hi: "एक", en: "One" }, { hi: "दो", en: "Two" }, { hi: "तीन", en: "Three" }],
  usage: { hi: "परीक्षण में।", en: "In testing." }, example: { hi: "उदाहरण।", en: "Example." }, caution: { hi: "सावधान।", en: "Careful." }, related: ["Alpha", "Beta"] };

test("contributor packet: new terms are queued, checkers exclude the contributor's AI company", async () => {
  const { readPacket, companyOf } = await import("./ingest.mjs");
  assert.equal(companyOf("ChatGPT"), "OpenAI"); assert.equal(companyOf("Gemini 3"), "Google"); assert.equal(companyOf(""), null);
  assert.throws(() => readPacket({ words: [] }), /itmeans-draft-1/);
  assert.throws(() => readPacket({ format: "itmeans-draft-1", words: [] }), /ai_company/);
  const pool = new Pool(MOCK_ROWS, { mock: mockModel });
  const r = await ingest({ format: "itmeans-draft-1", ai_company: "ChatGPT", ai_model: "gpt-x", domain: "photo-editing", subtopic: "color",
    words: [{ term: "Tone Curve", ...sample }, { term: "Nowhere", domain: "no-such", ...sample }] }, { pool, resolve: mockResolve, ignoreCap: true });
  assert.deepEqual(r.map((x) => x.status), ["published", "not in queue"]);
  const w = readJson(path.join(P.words, "photo-editing/color/tone-curve.json"));
  assert.equal(w.written_by, "contributor/gpt-x");
  assert.ok(!w.checked_by.some((c) => /openai/i.test(JSON.stringify(c))), "no OpenAI checker for an OpenAI-written word");
});

test("inbox: finished files move to done/ with a result; unreadable ones to failed/", async () => {
  const { ingestInbox } = await import("./ingest.mjs");
  const inbox = path.join(P.queue, "..", "drafts");
  writeJson(path.join(inbox, "a.json"), { format: "itmeans-draft-1", ai_company: "Gemini", domain: "photo-editing", subtopic: "color", words: [{ term: "Split Toning", ...sample }] });
  writeJson(path.join(inbox, "b.json"), { hello: "world" });
  const out = await ingestInbox({ pool: new Pool(MOCK_ROWS, { mock: mockModel }), resolve: mockResolve });
  assert.equal(out.length, 2);
  assert.deepEqual(fs.readdirSync(inbox).filter((x) => x.endsWith(".json")), []);
  assert.equal(fs.readdirSync(path.join(inbox, "done")).filter((x) => x.endsWith(".result.json")).length, 1);
  assert.match(readJson(path.join(inbox, "failed", fs.readdirSync(path.join(inbox, "failed")).find((x) => x.endsWith(".result.json")))).error, /itmeans-draft-1/);
  assert.ok(fs.existsSync(path.join(P.words, "photo-editing/color/split-toning.json")));
});