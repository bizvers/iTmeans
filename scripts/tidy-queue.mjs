// Tidies the word queues before the content check, so one doubled queue entry no longer stops a whole run (17 Nov 2026: a run
// worked 8 minutes, then "duplicate term" in a queue file failed the check and nothing was saved).
// Removes, per queue file: an entry whose term is already in that file (same slug), and an entry whose id is already published.
// When two entries share a term, the one a published word points to in "related" is kept.
// Run:  node scripts/tidy-queue.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { P, readJson, writeJson, slugify, loadWords } from "../agent/cycle/lib.mjs";

// A term that is a section/article number can never pass the content check (a run of 26 such words paused the cycle, 20 Nov 2026).
const SECTION_TERM = /(धारा|section|sec\.|article|अनुच्छेद)\s*[0-9०-९]/i;

// A runaway list term (a phrase that repeats itself, hundreds of characters long) can never pass the checks and only clogs the queue.
const MAX_TERM_LENGTH = 90;

/** Pure part: the tidied list. `published`: ids of published words; `referenced`: ids named in some word's "related". */
export function tidyEntries(entries, published, referenced) {
  const list = Array.isArray(entries) ? entries.filter((e) => e?.term && !SECTION_TERM.test(e.term) && e.term.length <= MAX_TERM_LENGTH && !published.has(e.id)) : [];
  const keep = new Map(); // slug -> entry
  for (const e of list) {
    const s = slugify(e.term);
    const had = keep.get(s);
    if (!had || (!referenced.has(had.id) && referenced.has(e.id))) keep.set(s, e);
  }
  const chosen = new Set(keep.values());
  // a second entry that is ALSO referenced stays, so no "related" link breaks (the content check then names it)
  return list.filter((e) => chosen.has(e) || referenced.has(e.id));
}

export function tidyQueues() {
  if (!fs.existsSync(P.queue)) return 0;
  const words = loadWords();
  const published = new Set(words.filter((x) => x.w.status === "published").map((x) => x.w.id));
  const referenced = new Set(words.flatMap((x) => x.w.related ?? []));
  let removed = 0;
  for (const f of fs.readdirSync(P.queue).filter((x) => x.endsWith(".json"))) {
    const file = path.join(P.queue, f);
    const now = readJson(file, null);
    if (!Array.isArray(now)) continue;
    const tidy = tidyEntries(now, published, referenced);
    if (tidy.length !== now.length) { writeJson(file, tidy); removed += now.length - tidy.length; }
  }
  return removed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`tidy-queue: ${tidyQueues()} doubled, section-number or already-published queue entries removed`);
}
