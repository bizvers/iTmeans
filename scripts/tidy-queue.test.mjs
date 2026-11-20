import test from "node:test";
import assert from "node:assert/strict";
import { tidyEntries } from "./tidy-queue.mjs";

test("a doubled term is removed, an already-published id is removed", () => {
  const q = [{ id: "w-1", term: "Key-value store" }, { id: "w-2", term: "Key-Value Store" }, { id: "w-3", term: "Index" }];
  const out = tidyEntries(q, new Set(["w-3"]), new Set());
  assert.deepEqual(out.map((e) => e.id), ["w-1"]);
});

test("of two same terms, the one a word points to in related is kept", () => {
  const q = [{ id: "w-1", term: "Shard" }, { id: "w-2", term: "shard" }];
  assert.deepEqual(tidyEntries(q, new Set(), new Set(["w-2"])).map((e) => e.id), ["w-2"]);
});

test("nothing doubled: list unchanged", () => {
  const q = [{ id: "w-1", term: "A" }, { id: "w-2", term: "B" }];
  assert.deepEqual(tidyEntries(q, new Set(), new Set()), q);
});

test("section-number terms are dropped", () => {
  const q = [{ id: "w-1", term: "Section 304B" }, { id: "w-2", term: "Summons" }, { id: "w-3", term: "Section 113B of the Indian Evidence Act" }];
  assert.deepEqual(tidyEntries(q, new Set(), new Set()).map((e) => e.id), ["w-2"]);
});
