// Run: node --test scripts   (works on a scratch copy; never touches real content)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itmeans-validate-"));
fs.cpSync(path.join(real, "content"), path.join(tmp, "content"), { recursive: true });
process.env.ITMEANS_ROOT = tmp;
const { validateContent } = await import("./validate-content.mjs");

const wordFile = path.join(tmp, "content/words/web-development/backend/application-programming-interface.json");
const original = fs.readFileSync(wordFile, "utf8");
const edit = (fn) => { const w = JSON.parse(original.replace(/^﻿/, "")); fn(w); fs.writeFileSync(wordFile, JSON.stringify(w)); };
const restore = () => fs.writeFileSync(wordFile, original);

test("real content passes with zero errors", () => {
  assert.equal(validateContent().errors.length, 0);
});
test("missing translation, bad level, unknown domain, self-reference are all errors", () => {
  edit((w) => { delete w.usage.en; w.level = "x"; w.domain = "nope"; w.related = [w.id, w.id]; });
  const { errors } = validateContent();
  restore();
  for (const needle of ["usage: both hi and en required", "level must be", "does not match folder", "points to the word itself", "duplicates"]) {
    assert.ok(errors.some((e) => e.includes(needle)), `expected an error containing: ${needle}`);
  }
});
test("missing id, duplicate id and a broken related reference are errors", () => {
  const other = path.join(tmp, "content/words/web-development/backend/authentication.json");
  const otherOriginal = fs.readFileSync(other, "utf8");
  edit((w) => { delete w.id; });
  assert.ok(validateContent().errors.some((e) => e.includes("no permanent id")));
  edit((w) => { w.id = JSON.parse(otherOriginal.replace(/^﻿/, "")).id; });
  assert.ok(validateContent().errors.some((e) => e.includes("already used by")));
  edit((w) => { w.related = ["w-aaaaaaaa", ...w.related.slice(1)]; });
  assert.ok(validateContent().errors.some((e) => e.includes("broken reference")));
  edit((w) => { w.related = ["cache", "api"]; }); // old-style slugs are no longer accepted
  assert.ok(validateContent().errors.some((e) => e.includes("not a permanent id")));
  restore();
});
test("languages: UI words must be complete; translations must belong to a real word and be complete", () => {
  const taxFile = path.join(tmp, "content/taxonomy/taxonomy.json");
  const taxOriginal = fs.readFileSync(taxFile, "utf8");
  const wordId = JSON.parse(original.replace(/^﻿/, "")).id;
  const put = (rel, data) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(data)); return f; };
  try {
    // Gujarati turned on with no UI file -> error
    const tax = JSON.parse(taxOriginal.replace(/^﻿/, "")); tax.languages.find((l) => l.code === "gu").active = true;
    fs.writeFileSync(taxFile, JSON.stringify(tax));
    assert.ok(validateContent().errors.some((e) => e.includes("content/ui/gu.json") && e.includes("missing")));
    // UI file with one key missing -> error naming the key; complete file -> no UI error, but a "no translation yet" warning
    const en = JSON.parse(fs.readFileSync(path.join(tmp, "content/ui/en.json"), "utf8"));
    const partial = { ...en }; delete partial.search;
    put("content/ui/gu.json", partial);
    assert.ok(validateContent().errors.some((e) => e.includes("missing text for: search")));
    put("content/ui/gu.json", en);
    const ok = validateContent();
    assert.ok(!ok.errors.some((e) => e.includes("content/ui")));
    assert.ok(ok.warnings.some((w) => w.includes('language "gu"') && w.includes("no translation yet")));
    // translations
    const full = { literal_meaning: "a", field_meaning: "b", effect: "c", usage: "d", example: "e", caution: "f", effect_flow: ["1", "2", "3"] };
    put(`content/translations/gu/${wordId}.json`, full);
    assert.equal(validateContent().errors.length, 0);
    put("content/translations/gu/w-aaaaaaaa.json", full);
    assert.ok(validateContent().errors.some((e) => e.includes("not the id of a published word")));
    fs.rmSync(path.join(tmp, "content/translations/gu/w-aaaaaaaa.json"));
    put(`content/translations/gu/${wordId}.json`, { ...full, usage: "", effect_flow: ["1"] });
    const bad = validateContent().errors.join("|");
    assert.match(bad, /usage is missing/); assert.match(bad, /effect_flow needs exactly 3/);
    put("content/translations/hi/x.json", full);
    assert.ok(validateContent().errors.some((e) => e.includes("lives inside the word file")));
    put("content/translations/zz/x.json", full);
    assert.ok(validateContent().errors.some((e) => e.includes("not a language in taxonomy.json")));
  } finally {
    fs.writeFileSync(taxFile, taxOriginal);
    for (const p of ["content/ui/gu.json", "content/translations"]) fs.rmSync(path.join(tmp, p), { recursive: true, force: true });
  }
  assert.equal(validateContent().errors.length, 0);
});
test("a slug that does not match its file name is an error", () => {
  edit((w) => { w.slug = "something-else"; });
  const { errors } = validateContent();
  restore();
  assert.ok(errors.some((e) => e.includes("does not match file name")));
});
test("invalid JSON is an error", () => {
  fs.writeFileSync(wordFile, "{ not json");
  const { errors } = validateContent();
  restore();
  assert.ok(errors.some((e) => e.includes("invalid JSON")));
});
