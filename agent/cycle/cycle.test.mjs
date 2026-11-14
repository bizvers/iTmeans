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
const { codeCheck, copyCheck, shouldPause } = await import("./checks.mjs");
const { P, readJson, writeJson } = await import("./lib.mjs");

const queue = (d, s, terms) => writeJson(path.join(P.queue, `${d}__${s}.json`), terms.map((term) => ({ term })));

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

test("pause rule flips stop_all when over half are held", async () => {
  queue("video-editing", "cutting", ["Bad One"]);
  queue("video-editing", "color", ["Bad Two"]);
  queue("video-editing", "audio", ["Fine Word"]);
  const r = await runCycle({ mock: true });
  assert.equal(r.paused, true);
  assert.equal(readJson(P.settings).stop_all, true);
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
  assert.equal(shouldPause(4, 3, 50), true); assert.equal(shouldPause(1, 1, 50), false); assert.equal(shouldPause(4, 2, 50), false);
});
