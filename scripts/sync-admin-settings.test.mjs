// Run: node --test scripts/sync-admin-settings.test.mjs   (scratch copy of content/; no network)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itmeans-sync-"));
fs.cpSync(path.join(real, "content"), path.join(tmp, "content"), { recursive: true });
process.env.ITMEANS_ROOT = tmp;
const { applySettings, fromFs, syncFromFirestore } = await import("./sync-admin-settings.mjs");
const { P, readJson, writeJson } = await import("../agent/cycle/lib.mjs");

test("Firestore typed values become plain JSON", () => {
  const v = { mapValue: { fields: { a: { integerValue: "15" }, b: { booleanValue: true }, c: { arrayValue: { values: [{ stringValue: "x" }] } }, d: { timestampValue: "2026-11-15T10:00:00Z" } } } };
  assert.deepEqual(fromFs(v), { a: 15, b: true, c: ["x"], d: Date.parse("2026-11-15T10:00:00Z") });
});

test("valid settings are applied; invalid ones and unknown names are ignored", () => {
  const before = readJson(P.settings);
  const changes = applySettings({
    stop_all: true, pause_if_held_percent: 60, checker_pass_score: 999, // 999 is out of range -> ignored
    daily_caps: [{ domain: "web-development", cap: 20 }, { domain: "no-such-domain", cap: 5 }, { domain: "video-editing", cap: -3 }],
    domains: { science: true, "no-such-domain": true }, languages: { hi: false, gu: true },
  });
  const s = readJson(P.settings), t = readJson(P.taxonomy);
  assert.equal(s.stop_all, true); assert.equal(s.pause_if_held_percent, 60); assert.equal(s.checker_pass_score, before.checker_pass_score);
  assert.equal(s.daily_caps.find((c) => c.domain === "web-development").cap, 20);
  assert.equal(s.daily_caps.find((c) => c.domain === "video-editing").cap, before.daily_caps.find((c) => c.domain === "video-editing").cap);
  assert.equal(t.domains.find((d) => d.id === "science").active, true);
  assert.equal(t.languages.find((l) => l.code === "hi").active, true, "Hindi can never be switched off");
  assert.equal(t.languages.find((l) => l.code === "gu").active, true);
  assert.ok(changes.length >= 5);
  assert.deepEqual(applySettings({ stop_all: true }), [], "applying the same thing again changes nothing");
});

test("new subjects and subtopics are added switched off; bad or duplicate ones are ignored; renames apply", () => {
  const changes = applySettings({
    add_domains: [{ id: "graphic-design", en: "Graphic Design", hi: "ग्राफ़िक डिज़ाइन" }, { id: "admin", en: "Admin", hi: "एडमिन" },
      { id: "Bad Id", en: "X", hi: "य" }, { id: "web-development", en: "Dup", hi: "दो" }, { id: "empty-names", en: " ", hi: "" }],
    add_subtopics: [{ domain: "graphic-design", id: "typography", en: "Typography", hi: "टाइपोग्राफ़ी" },
      { domain: "graphic-design", id: "typography", en: "Again", hi: "फिर" }, { domain: "no-such-domain", id: "x", en: "X", hi: "य" },
      { domain: "web-development", id: "security", en: "Security", hi: "सुरक्षा" }],
    rename: [{ domain: "web-development", en: "Web Development", hi: "वेब विकास" }, { domain: "web-development", subtopic: "frontend", en: "Frontend <b>", hi: "x" }],
    domains: { "graphic-design": true }, daily_caps: [{ domain: "graphic-design", cap: 10 }],
  });
  const t = readJson(P.taxonomy), s = readJson(P.settings);
  const g = t.domains.find((d) => d.id === "graphic-design");
  assert.equal(g.active, true, "added and switched on in the same save");
  assert.deepEqual(g.subtopics.map((x) => x.id), ["typography"]);
  assert.equal(g.subtopics[0].en, "Typography");
  assert.equal(s.daily_caps.find((c) => c.domain === "graphic-design").cap, 10);
  assert.ok(!t.domains.some((d) => ["admin", "Bad Id", "empty-names"].includes(d.id)), "reserved, malformed or unnamed ids are refused");
  assert.equal(t.domains.find((d) => d.id === "web-development").en, "Web Development", "an existing id is never added twice");
  assert.equal(t.domains.find((d) => d.id === "web-development").hi, "वेब विकास");
  assert.ok(t.domains.find((d) => d.id === "web-development").subtopics.some((x) => x.id === "security"));
  assert.equal(t.domains.find((d) => d.id === "web-development").subtopics.find((x) => x.id === "frontend").en, "Frontend", "names with < > are refused");
  assert.ok(changes.includes("new domain graphic-design") && changes.includes("new subtopic graphic-design/typography"));
  assert.deepEqual(applySettings({ add_domains: [{ id: "graphic-design", en: "Graphic Design", hi: "ग्राफ़िक डिज़ाइन" }] }), [], "adding again changes nothing");
});

test("a subject without subtopics cannot be switched on", () => {
  const changes = applySettings({ add_domains: [{ id: "music", en: "Music", hi: "संगीत" }], domains: { music: true } });
  assert.equal(readJson(P.taxonomy).domains.find((d) => d.id === "music").active, false);
  assert.ok(changes.some((c) => /music not switched on/.test(c)));
});

test("resume clears a pause only when it is newer than the pause", () => {
  writeJson(P.pause, { paused: true, reason: "too many held", at: "2026-11-15T10:00:00.000Z" });
  assert.deepEqual(applySettings({ unpause: Date.parse("2026-11-15T09:00:00Z") }), []);
  assert.equal(readJson(P.pause).paused, true);
  assert.deepEqual(applySettings({ unpause: Date.parse("2026-11-15T11:00:00Z") }), ["pause cleared by admin"]);
  assert.equal(readJson(P.pause).paused, false);
});

test("a missing document or an unreachable Firestore changes nothing and never throws", async () => {
  const a = await syncFromFirestore({ fetchImpl: async () => ({ status: 404, ok: false }) });
  assert.equal(a.ok, true); assert.match(a.note, /no admin settings/);
  const b = await syncFromFirestore({ fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(b.ok, false); assert.match(b.note, /not reachable/);
  const c = await syncFromFirestore({ fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ fields: { stop_all: { booleanValue: false } } }) }) });
  assert.equal(c.ok, true);
});

test("topic rules from the admin: limits are checked, unknown topics ignored, one topic can be 'popular 100'", () => {
  const changes = applySettings({
    topic_defaults: { min: 3, max: 12, review_every: 5, popular_target: 7000 }, // review_every < 10 and popular_target > 5000 are ignored
    topic_rules: { "web-development/backend": { mode: "popular", target: 100, min: 99 }, "no/such": { max: 3 }, "video-editing/audio": { min: 9, max: 4 } },
    current_topic: "video-editing/cutting",
  });
  const s = readJson(P.settings);
  assert.equal(s.topic_defaults.min, 3); assert.equal(s.topic_defaults.max, 12); assert.equal(s.topic_defaults.review_every, 1000);
  assert.equal(s.topic_rules["web-development/backend"].mode, "popular");
  assert.equal(s.topic_rules["web-development/backend"].target, 100);
  assert.deepEqual(Object.keys(s.topic_rules).sort(), ["video-editing/audio", "web-development/backend"]);
  assert.deepEqual([s.topic_rules["video-editing/audio"].min, s.topic_rules["video-editing/audio"].max], [4, 4], "min can never be above max");
  assert.equal(s.current_topic, "video-editing/cutting");
  assert.ok(changes.length >= 3);
  applySettings({ current_topic: "" });
  assert.equal(readJson(P.settings).current_topic, undefined, "empty = automatic again");
});

test("no_daily_cap switch from the admin page", () => {
  applySettings({ no_daily_cap: false });
  assert.deepEqual(applySettings({ no_daily_cap: true }).filter((c) => c.startsWith("no_daily_cap")), ["no_daily_cap=true"]);
  assert.equal(readJson(P.settings).no_daily_cap, true);
  assert.deepEqual(applySettings({ no_daily_cap: true }), []);
});

test("topic rules saved by the admin page as a list are applied like the map form", () => {
  applySettings({ topic_rules: [{ key: "video-editing/color", mode: "popular", target: 100 }, { key: "no/such", max: 3 }, { nokey: true }] });
  const s = readJson(P.settings);
  assert.deepEqual(Object.keys(s.topic_rules), ["video-editing/color"]);
  assert.equal(s.topic_rules["video-editing/color"].target, 100);
});
