// Fills content/queue/<domain>__<subtopic>.json. Two models from different companies each list terms;
// terms both name come first (priority), the rest follow. Run: node --env-file=.env agent/cycle/fill-queue.mjs [--n=12]
import fs from "node:fs";
import path from "node:path";
import { P, REPO, readJson, writeJson, slugify } from "./lib.mjs";
import { Pool, extractJson } from "./providers.mjs";

const n = Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4) ?? 12);
const taxonomy = readJson(P.taxonomy);
const pool = new Pool(readJson(P.models).models);
const tpl = fs.readFileSync(path.join(REPO, "agent/prompts/list.md"), "utf8");
const exists = (d, s, term) => fs.existsSync(path.join(P.words, d, s, `${slugify(term)}.json`)) || fs.existsSync(path.join(P.held, `${d}__${slugify(term)}.json`));

for (const d of taxonomy.domains.filter((x) => x.active)) for (const s of d.subtopics) {
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
  const qf = path.join(P.queue, `${d.id}__${s.id}.json`);
  const old = readJson(qf, []);
  const have = new Set(old.map((q) => norm(q.term)));
  const add = all.filter((t) => !have.has(norm(t)) && !exists(d.id, s.id, t)).map((t) => ({ term: t, both: both.some((b) => norm(b) === norm(t)) }));
  writeJson(qf, [...old, ...add]);
  console.log(`${d.id}/${s.id}: +${add.length} (${add.filter((a) => a.both).length} named by both)`);
}