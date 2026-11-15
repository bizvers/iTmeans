// Fills content/queue/<domain>__<subtopic>.json. Two models from different companies each list terms;
// terms both name come first (priority), the rest follow. Run: node --env-file=.env agent/cycle/fill-queue.mjs [--n=12] [--below=3]
//   --below=K  only subtopics with fewer than K words still to write (a new subject from the admin page has 0). Used by the hourly cycle.
//              In that mode it also respects CYCLE_ENABLED and "stop all", like the cycle itself.
import fs from "node:fs";
import path from "node:path";
import { P, REPO, readJson, writeJson, slugify, takenIds, newId } from "./lib.mjs";
import { Pool, extractJson } from "./providers.mjs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const n = Number(arg("n") ?? 12);
const below = arg("below") === undefined ? Infinity : Number(arg("below"));
const taxonomy = readJson(P.taxonomy);

if (below !== Infinity) {
  if (process.env.CYCLE_ENABLED !== "true") { console.log("fill-queue: CYCLE_ENABLED is not true; nothing done"); process.exit(0); }
  if (readJson(P.settings).stop_all) { console.log("fill-queue: stop all is on; nothing done"); process.exit(0); }
}

if (below !== Infinity && readJson(P.settings).entry_stage === "short") { console.log("fill-queue: entry stage is short; the cycle lists words letter by letter itself"); process.exit(0); }

const exists = (d, s, term) => fs.existsSync(path.join(P.words, d, s, `${slugify(term)}.json`)) || fs.existsSync(path.join(P.held, `${d}__${slugify(term)}.json`));
const queueFile = (d, s) => path.join(P.queue, `${d.id}__${s.id}.json`);
const left = (d, s) => readJson(queueFile(d, s), []).filter((q) => !exists(d.id, s.id, q.term)).length;

const todo = taxonomy.domains.filter((x) => x.active).flatMap((d) => d.subtopics.map((s) => ({ d, s }))).filter(({ d, s }) => left(d, s) < below);
if (!todo.length) { console.log("fill-queue: every word list has enough words"); process.exit(0); }

const taken = takenIds(); // every id already used anywhere, so new ids never repeat
const pool = new Pool(readJson(P.models).models);
const tpl = fs.readFileSync(path.join(REPO, "agent/prompts/list.md"), "utf8");

for (const { d, s } of todo) {
  const prompt = tpl.replace("{{n}}", n).replace("{{domain}}", d.en).replace("{{subtopic}}", s.en);
  const lists = [], used = [];
  for (const ex of [[], null]) {
    try {
      const r = await pool.ask("list", prompt, ex ?? used);
      used.push(r.row.company); lists.push(extractJson(r.text).terms.filter((t) => typeof t === "string" && /^[A-Za-z]/.test(t)).map((t) => t.trim()));
    } catch (e) { console.error(`${d.id}/${s.id}: ${e.message}`); }
  }
  if (!lists.length) continue;
  const norm = (t) => t.toLowerCase();
  const both = lists.length > 1 ? lists[0].filter((t) => lists[1].some((x) => norm(x) === norm(t))) : [];
  const all = [...new Set(lists.flat().map(norm))].map((k) => lists.flat().find((t) => norm(t) === k));
  const qf = queueFile(d, s);
  const old = readJson(qf, []);
  const have = new Set(old.map((q) => norm(q.term)));
  const add = all.filter((t) => !have.has(norm(t)) && !exists(d.id, s.id, t)).map((t) => ({ id: newId(taken), term: t, both: both.some((b) => norm(b) === norm(t)) }));
  writeJson(qf, [...old, ...add]);
  console.log(`${d.id}/${s.id}: +${add.length} (${add.filter((a) => a.both).length} named by both)`);
}
