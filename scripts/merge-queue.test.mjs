// Run: node --test scripts/merge-queue.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { missingEntries } from "./merge-queue.mjs";

test("entries only the old branch had come back; known ids, terms and used words do not", () => {
  const now = [{ id: "w-aaaaaaaa", term: "Alpha" }];
  const old = [
    { id: "w-aaaaaaaa", term: "Alpha" },            // same id: already there
    { id: "w-bbbbbbbb", term: "Beta" },             // lost in the merge: comes back
    { id: "w-cccccccc", term: "alpha" },            // same term as a queued word: not twice
    { id: "w-dddddddd", term: "Delta" },            // already published: not queued again
    { id: "w-eeeeeeee", term: "Beta" },             // same term as the one just added: not twice
  ];
  const add = missingEntries(now, old, new Set(["w-aaaaaaaa"]), new Set(["delta"]));
  assert.deepEqual(add.map((e) => e.id), ["w-bbbbbbbb"]);
});
