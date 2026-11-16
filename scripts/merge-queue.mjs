// The hourly workflow brings main into ai-words with "git merge -X theirs", so on a clash main's queue file wins and queue entries that
// only ai-words had are lost -- including ids that published words point to in "related" (the content check then stops the cycle).
// This puts them back: every queue entry of the old ai-words tip whose id and term exist nowhere now (queue, published, held).
// Run (after the merge):  node scripts/merge-queue.mjs <ai-words tip before the merge>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { P, REPO, readJson, writeJson, slugify, loadWords, loadHeld, loadQueues } from "../agent/cycle/lib.mjs";

/** Pure part: entries of `old` that are missing from `now`. `knownIds`: every id in use; `usedSlugs`: terms already published or held. */
export function missingEntries(now, old, knownIds, usedSlugs) {
  const have = new Set(now.map((e) => slugify(e.term)));
  const add = [];
  for (const e of old) {
    const s = slugify(e.term ?? "");
    if (!e?.id || !s || knownIds.has(e.id) || have.has(s) || usedSlugs.has(s)) continue;
    have.add(s); knownIds.add(e.id); add.push(e);
  }
  return add;
}

export function mergeQueues(ref) {
  const git = (...a) => execFileSync("git", ["-c", `safe.directory=${REPO.replaceAll("\\", "/")}`, ...a], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const rel = path.relative(REPO, P.queue).replaceAll("\\", "/");
  let files = [];
  try { files = git("ls-tree", "--name-only", ref, `${rel}/`).split("\n").filter((f) => f.endsWith(".json")); } catch { return 0; }
  const knownIds = new Set([...loadWords().map((x) => x.w.id), ...loadHeld().map((x) => x.h.id), ...loadQueues().flatMap((q) => q.entries.map((e) => e.id))].filter(Boolean));
  const used = (domain) => new Set([...loadWords().filter((x) => x.domain === domain).map((x) => x.w.slug), ...loadHeld().filter((x) => x.h.domain === domain).map((x) => x.h.slug)]);
  let total = 0;
  for (const f of files) {
    const name = path.basename(f, ".json"), [domain] = name.split("__");
    let old; try { old = JSON.parse(git("show", `${ref}:${f}`).replace(/^﻿/, "")); } catch { continue; }
    const file = path.join(P.queue, `${name}.json`), now = readJson(file, []);
    const add = missingEntries(now, old, knownIds, used(domain));
    if (add.length) { writeJson(file, [...now, ...add]); total += add.length; }
  }
  return total;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ref = process.argv[2];
  if (!ref) { console.error("usage: node scripts/merge-queue.mjs <ref>"); process.exit(2); }
  console.log(`merge-queue: ${mergeQueues(ref)} queue entries put back`);
}
