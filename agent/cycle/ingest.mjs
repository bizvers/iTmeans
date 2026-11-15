// Words written by Claude (in a Claude Code session) instead of a free writer model.
// They go through the SAME checks 1-5 as every other word; the two checker models are from other companies than Anthropic.
// Draft file: a JSON array of {id | term, level, pronunciation_hi, term_hi, literal_meaning, field_meaning, effect, effect_flow,
//   usage, example, caution, related:[terms]}.  `id` is the queue entry's id (or give `term`). Optional `source_term`: the exact\n//   Wikipedia/MDN article title when it differs from the term (e.g. "Dodging and burning").
// Contributor packets (docs/contribute/): {"format":"itmeans-draft-1","ai_company":"OpenAI","ai_model":"...","contributor":"...",
//   "domain":"<id>","subtopic":"<id>","words":[ ...same fields as above, each may also name its own domain/subtopic... ]}.
//   The checkers are then from companies other than ai_company. A term not yet in the queue is added to it (when domain/subtopic are known).
// Run: node --env-file=.env agent/cycle/ingest.mjs <drafts.json> [--hold] [--ignore-cap]
//      node --env-file=.env agent/cycle/ingest.mjs --inbox      every file in content/drafts/ (used by the hourly cycle)
//   without --hold a rejected word stays in the queue (so it can be fixed and sent again); with --hold it goes to the held list.
//   --ignore-cap: contributed words do not count against the daily cap (the checkers' free limits still stop the run).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO, readJson, writeJson, slugify, ledgerRead, takenIds, newId, today } from "./lib.mjs";
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

// Common ways people name the AI company -> the company name used in config/models.json (so the checkers exclude it).
const COMPANY = { openai: "OpenAI", chatgpt: "OpenAI", gpt: "OpenAI", google: "Google", gemini: "Google", anthropic: "Anthropic", claude: "Anthropic",
  nvidia: "NVIDIA", meta: "Meta", llama: "Meta", deepseek: "DeepSeek", mistral: "Mistral", alibaba: "Alibaba", qwen: "Alibaba", xai: "xAI", grok: "xAI", microsoft: "Microsoft", copilot: "Microsoft" };
export const companyOf = (x) => { if (typeof x !== "string" || !x.trim()) return null; const k = x.trim().toLowerCase(); return COMPANY[k] ?? COMPANY[k.split(/[\s/-]/)[0]] ?? x.trim().slice(0, 40); };

/** A plain array = words Claude wrote in a Claude Code session. A contributor packet names its AI company and default domain/subtopic. */
export function readPacket(input) {
  if (Array.isArray(input)) return { writer: CLAUDE_ROW, words: input };
  if (input?.format !== "itmeans-draft-1" || !Array.isArray(input.words)) throw new Error('not an iTmeans draft: needs "format": "itmeans-draft-1" and a "words" list');
  const company = companyOf(input.ai_company);
  if (!company) throw new Error('the draft must say which AI company wrote it ("ai_company")');
  const writer = { service: "contributor", model: String(input.ai_model ?? "unknown").slice(0, 60), company };
  return { writer, words: input.words.map((w) => ({ domain: input.domain, subtopic: input.subtopic, ...w })) };
}

/** A term that is not queued yet but names a known domain/subtopic is added to that queue (unless it is already published or held). */
function queueNew(taxonomy, f) {
  const d = taxonomy.domains.find((x) => x.id === f.domain), s = d?.subtopics.find((x) => x.id === f.subtopic);
  const term = typeof f.term === "string" ? f.term.trim() : "";
  if (!s || !/^[A-Za-z0-9]/.test(term) || term.length > 80) return null;
  if (fs.existsSync(path.join(P.words, d.id, s.id, `${slugify(term)}.json`)) || fs.existsSync(path.join(P.held, `${d.id}__${slugify(term)}.json`))) return null;
  const qf = path.join(P.queue, `${d.id}__${s.id}.json`);
  const entry = { id: newId(takenIds()), term, both: false };
  writeJson(qf, [...readJson(qf, []), entry]);
  return { domain: d, sub: s, term, id: entry.id };
}

export async function ingest(input, { hold = false, ignoreCap = false, pool, resolve = resolveSource } = {}) {
  const { writer, words: drafts } = readPacket(input);
  const taxonomy = readJson(P.taxonomy), settings = readJson(P.settings);
  const results = [];
  const published = ledgerRead().filter((e) => e.kind === "word" && e.outcome === "published");
  for (const f of drafts) {
    const ctx = { taxonomy, passScore: settings.checker_pass_score ?? 85, backPassScore: settings.backtranslation_pass_score ?? 70, resolveSource: (t, d) => resolve(f.source_term ?? t, d) };
    const item = findQueued(taxonomy, f) ?? queueNew(taxonomy, f);
    if (!item) { results.push({ term: f.term ?? f.id, status: "not in queue" }); continue; }
    const cap = settings.daily_caps?.find((c) => c.domain === item.domain.id)?.cap ?? 0;
    const used = published.filter((e) => e.domain === item.domain.id).length + results.filter((r) => r.status === "published" && r.domain === item.domain.id).length;
    if (!ignoreCap && used >= cap) { results.push({ term: item.term, status: "daily cap reached", domain: item.domain.id }); continue; }
    const word = { id: item.id, term: item.term, domain: item.domain.id, subtopic: item.sub.id, letter: item.term[0].toUpperCase(), slug: slugify(item.term),
      level: f.level, pronunciation_hi: f.pronunciation_hi, term_hi: f.term_hi ?? null, literal_meaning: f.literal_meaning, field_meaning: f.field_meaning,
      effect: f.effect, effect_flow: f.effect_flow, usage: f.usage, example: f.example, caution: f.caution, related: f.related ?? [], status: "published" };
    let res;
    try { res = await runChecks(pool, item, ctx, word, writer); }
    catch (e) { results.push({ term: item.term, status: "stopped", reason: e.message }); break; } // e.g. checker limits used up
    if (res.ok || hold) { commitResult(item, res, false); results.push({ term: item.term, domain: item.domain.id, status: res.ok ? "published" : "held", reasons: res.reasons }); }
    else results.push({ term: item.term, domain: item.domain.id, status: "rejected (left in queue)", reasons: res.reasons });
  }
  return results;
}

const INBOX = path.join(REPO, "content/drafts");
const print = (results) => {
  for (const r of results) console.log(`${r.status.padEnd(26)} ${r.term}${r.reasons?.length ? "  <- " + r.reasons.join(" | ").slice(0, 300) : r.reason ? "  <- " + r.reason : ""}`);
  console.log(JSON.stringify(results.reduce((a, r) => ((a[r.status.split(" ")[0]] = (a[r.status.split(" ")[0]] ?? 0) + 1), a), {})));
};

/** Inbox: every *.json in content/drafts/ is checked. Rejected words go to the held list (so they are not re-checked every hour).
 *  A finished file moves to content/drafts/done/ with a .result.json next to it; a file that cannot be read moves to content/drafts/failed/.
 *  If the checkers' limits run out midway, the file stays in the inbox and the next hour continues (finished words are skipped). */
export async function ingestInbox({ pool, resolve } = {}) {
  if (!fs.existsSync(INBOX)) return [];
  const out = [];
  for (const name of fs.readdirSync(INBOX).filter((x) => x.endsWith(".json")).sort()) {
    const file = path.join(INBOX, name), stamp = `${today()}-${name.replace(/\.json$/, "")}`;
    let results;
    try { results = await ingest(JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")), { hold: true, ignoreCap: true, pool, resolve }); }
    catch (e) {
      fs.mkdirSync(path.join(INBOX, "failed"), { recursive: true });
      fs.renameSync(file, path.join(INBOX, "failed", `${stamp}.json`));
      writeJson(path.join(INBOX, "failed", `${stamp}.result.json`), { error: e.message });
      out.push({ file: name, error: e.message }); continue;
    }
    out.push({ file: name, results });
    if (results.some((r) => r.status === "stopped")) break; // limits used up: try again next hour
    fs.mkdirSync(path.join(INBOX, "done"), { recursive: true });
    fs.renameSync(file, path.join(INBOX, "done", `${stamp}.json`));
    writeJson(path.join(INBOX, "done", `${stamp}.result.json`), results);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node --env-file=.env agent/cycle/ingest.mjs <drafts.json> [--hold] [--ignore-cap]  |  --inbox"); process.exit(2); }
  if (file === "--inbox") {
    if (process.env.CYCLE_ENABLED !== "true") { console.log("ingest: CYCLE_ENABLED is not true; inbox not read"); process.exit(0); }
    if (readJson(P.settings).stop_all) { console.log("ingest: stop all is on; inbox not read"); process.exit(0); }
    const files = await ingestInbox({ pool: new Pool(readJson(P.models).models) });
    if (!files.length) console.log("ingest: inbox is empty");
    for (const f of files) { console.log(`--- ${f.file}`); f.error ? console.log(`could not read: ${f.error}`) : print(f.results); }
  } else {
    const drafts = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    print(await ingest(drafts, { hold: process.argv.includes("--hold"), ignoreCap: process.argv.includes("--ignore-cap"), pool: new Pool(readJson(P.models).models) }));
  }
}
