// Words written by Claude (in a Claude Code session) instead of a free writer model.
// They go through the SAME checks 1-5 as every other word; the two checker models are from other companies than Anthropic.
// Draft file: a JSON array of {id | term, level, pronunciation_hi, term_hi, literal_meaning, field_meaning, effect, effect_flow,
//   usage, example, caution, related:[terms]}.  `id` is the queue entry's id (or give `term`). Optional `source_term`: the exact\n//   Wikipedia/MDN article title when it differs from the term (e.g. "Dodging and burning").
// Run: node --env-file=.env agent/cycle/ingest.mjs <drafts.json> [--hold]
//   without --hold a rejected word stays in the queue (so it can be fixed and sent again); with --hold it goes to the held list.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, readJson, slugify, ledgerRead } from "./lib.mjs";
import { Pool } from "./providers.mjs";
import { resolveSource } from "./checks.mjs";
import { runChecks, commitResult } from "./cycle.mjs";

export const CLAUDE_ROW = { service: "claude-code", model: "sonnet-5.5", company: "Anthropic" };

export function findQueued(taxonomy, key) {
  for (const d of taxonomy.domains) for (const s of d.subtopics) {
    const q = readJson(path.join(P.queue, `${d.id}__${s.id}.json`), []).find((e) => (key.id ? e.id === key.id : e.term.toLowerCase() === key.term?.toLowerCase()));
    if (q) return { domain: d, sub: s, term: q.term, id: q.id };
  }
  return null;
}

export async function ingest(drafts, { hold = false, pool, resolve = resolveSource } = {}) {
  const taxonomy = readJson(P.taxonomy), settings = readJson(P.settings);
  const results = [];
  const published = ledgerRead().filter((e) => e.kind === "word" && e.outcome === "published");
  for (const f of drafts) {
    const ctx = { taxonomy, passScore: settings.checker_pass_score ?? 85, backPassScore: settings.backtranslation_pass_score ?? 70, resolveSource: (t, d) => resolve(f.source_term ?? t, d) };
    const item = findQueued(taxonomy, f);
    if (!item) { results.push({ term: f.term ?? f.id, status: "not in queue" }); continue; }
    const cap = settings.daily_caps?.find((c) => c.domain === item.domain.id)?.cap ?? 0;
    const used = published.filter((e) => e.domain === item.domain.id).length + results.filter((r) => r.status === "published" && r.domain === item.domain.id).length;
    if (used >= cap) { results.push({ term: item.term, status: "daily cap reached", domain: item.domain.id }); continue; }
    const word = { id: item.id, term: item.term, domain: item.domain.id, subtopic: item.sub.id, letter: item.term[0].toUpperCase(), slug: slugify(item.term),
      level: f.level, pronunciation_hi: f.pronunciation_hi, term_hi: f.term_hi ?? null, literal_meaning: f.literal_meaning, field_meaning: f.field_meaning,
      effect: f.effect, effect_flow: f.effect_flow, usage: f.usage, example: f.example, caution: f.caution, related: f.related ?? [], status: "published" };
    let res;
    try { res = await runChecks(pool, item, ctx, word, CLAUDE_ROW); }
    catch (e) { results.push({ term: item.term, status: "stopped", reason: e.message }); break; } // e.g. checker limits used up
    if (res.ok || hold) { commitResult(item, res, false); results.push({ term: item.term, domain: item.domain.id, status: res.ok ? "published" : "held", reasons: res.reasons }); }
    else results.push({ term: item.term, domain: item.domain.id, status: "rejected (left in queue)", reasons: res.reasons });
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node --env-file=.env agent/cycle/ingest.mjs <drafts.json> [--hold]"); process.exit(2); }
  const drafts = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const pool = new Pool(readJson(P.models).models);
  const results = await ingest(drafts, { hold: process.argv.includes("--hold"), pool });
  for (const r of results) console.log(`${r.status.padEnd(26)} ${r.term}${r.reasons?.length ? "  <- " + r.reasons.join(" | ").slice(0, 300) : r.reason ? "  <- " + r.reason : ""}`);
  console.log(JSON.stringify(results.reduce((a, r) => ((a[r.status.split(" ")[0]] = (a[r.status.split(" ")[0]] ?? 0) + 1), a), {})));
}
