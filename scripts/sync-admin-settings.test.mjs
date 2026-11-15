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
