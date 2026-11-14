// Gives a permanent id to any word, queue entry or held record that lacks one (e.g. a word added by hand in the CMS).
// Run: node scripts/assign-ids.mjs     (also: npm run assign-ids  inside site/). Safe to run any time; existing ids are never changed.
import { assignMissingIds } from "../agent/cycle/lib.mjs";

const n = assignMissingIds();
console.log(n ? `Added ${n} permanent id(s).` : "Nothing to do: every record already has an id.");
