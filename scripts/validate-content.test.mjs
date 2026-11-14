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
