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
  edit((w) => { delete w.usage.en; w.level = "x"; w.domain = "nope"; w.related = [w.slug, w.slug]; });
  const { errors } = validateContent();
  restore();
  for (const needle of ["usage: both hi and en required", "level must be", "does not match folder", "points to the word itself", "duplicates"]) {
    assert.ok(errors.some((e) => e.includes(needle)), `expected an error containing: ${needle}`);
  }
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
