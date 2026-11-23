// Run: node --test agent/articles   (scratch copy of the repo; fake words and fake models)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itmeans-articles-"));
for (const d of ["content/taxonomy", "content/settings", "agent/prompts"]) fs.cpSync(path.join(real, d), path.join(tmp, d), { recursive: true });
process.env.ITMEANS_ROOT = tmp;
const { P, readJson, writeJson } = await import("../cycle/lib.mjs");
const L = await import("./lib.mjs");
const { ingestDay } = await import("./ingest.mjs");
const { runArticles } = await import("./cycle.mjs");
const { Pool } = await import("../cycle/providers.mjs");

// fake published words: 3 topics of web-development (4 words each) and 1 Law topic
const tax = readJson(P.taxonomy);
const web = tax.domains.find((d) => d.id === "web-development"), law = tax.domains.find((d) => d.id === "law");
const topics = [[web, web.subtopics[0].id], [web, web.subtopics[1].id], [web, web.subtopics[2].id], [law, law.subtopics[0].id]];
let n = 0;
const ids = {};
for (const [d, s] of topics) for (const t of ["Alpha", "Beta", "Gamma", "Delta"]) {
  const id = `w-${String(++n).padStart(8, "0")}`;
  (ids[`${d.id}/${s}`] ??= []).push(id);
  writeJson(path.join(P.words, d.id, s, `${t.toLowerCase()}.json`), { id, term: `${t} ${s}`, domain: d.id, subtopic: s, letter: t[0], slug: t.toLowerCase(),
    pronunciation_hi: "अल्फ़ा", field_meaning: { hi: "एक नमूना अर्थ।" }, kind: { en: "term", hi: "शब्द" }, status: "published", written_by: "x", checked_by: [], created_at: "2026-11-20", checked_at: null });
}
const settings = (extra = {}) => writeJson(P.settings, { ...readJson(P.settings), articles: { paused: true, per_subject: 2, words_per_article: 3, topic_gap_days: 14, ...extra } });
settings();
const para = (i) => `यह एक नमूना अनुच्छेद है जिसमें {${i}} का सरल अर्थ रोज़ की एक घटना से समझाया गया है, ताकि पढ़ने वाला आसानी से याद रख सके।`;
const draft = (key, extra = {}) => { const [domain, subtopic] = key.split("/"); return { domain, subtopic, words: ids[key].slice(0, 3),
  title: { hi: "एक रोचक नमूना शीर्षक", en: "An interesting sample title" }, body: { hi: [para(0), para(1), para(2)] }, ...extra }; };

test("plan: per subject 2 DIFFERENT topics with enough words; a topic used recently waits for topic_gap_days", () => {
  const plan = L.planDay("2026-11-23");
  const w = plan.filter((p) => p.domain === "web-development");
  assert.equal(w.length, 2);
  assert.notEqual(w[0].subtopic, w[1].subtopic);
  assert.ok(w.every((p) => p.candidates.length === 4));
  assert.equal(plan.filter((p) => p.domain === "law").length, 1, "Law has only one topic with words");
  const used = w.map((p) => ({ date: "2026-11-22", domain: p.domain, subtopic: p.subtopic }));
  const next = L.planDay("2026-11-23", { articles: used }).filter((p) => p.domain === "web-development");
  assert.ok(next.some((p) => !used.some((u) => u.subtopic === p.subtopic)), "the unused topic comes first");
});

test("code check: 3 words of that topic, all used, titles in both languages, no section numbers in Law", () => {
  const byId = L.publishedById();
  const k = Object.keys(ids)[0];
  const ok = { id: "a-00000001", date: "2026-11-23", ...draft(k) };
  assert.deepEqual(L.articleCheck(ok, { byId, articles: [] }), []);
  assert.ok(L.articleCheck({ ...ok, body: { hi: [para(0), para(1), para(1)] } }, { byId, articles: [] }).some((m) => /\{2\} is never used/.test(m)));
  assert.ok(L.articleCheck({ ...ok, words: [...ids[k].slice(0, 2), ids[Object.keys(ids)[1]][0]] }, { byId, articles: [] }).some((m) => /not a published word/.test(m)));
  assert.ok(L.articleCheck({ ...ok, title: { hi: "एक रोचक नमूना शीर्षक", en: "एक रोचक" } }, { byId, articles: [] }).some((m) => /title.en/.test(m)));
  const lk = Object.keys(ids).find((x) => x.startsWith("law/"));
  const lawA = { id: "a-00000002", date: "2026-11-23", ...draft(lk, { body: { hi: [para(0), para(1), para(2) + " धारा 302 देखें।"] } }) };
  assert.ok(L.articleCheck(lawA, { byId, articles: [] }).some((m) => /section/.test(m)));
  const two = Object.keys(ids).filter((x) => x.startsWith("web-development/")).slice(0, 2).map((x, i) => ({ id: `a-0000001${i}`, date: "2026-11-23", domain: "web-development", subtopic: x.split("/")[1] }));
  assert.ok(L.articleCheck({ ...ok, id: "a-9", subtopic: Object.keys(ids)[2].split("/")[1], words: ids[Object.keys(ids)[2]].slice(0, 3) }, { byId, articles: two }).some((m) => /already has 2 articles/.test(m)));
});

test("on order: drafts in the inbox are checked and saved; a bad draft stays with its problems", async () => {
  const k = Object.keys(ids)[0];
  writeJson(path.join(L.A.inbox, "2026-11-23.json"), [draft(k, { words: ["Alpha " + k.split("/")[1], "Beta " + k.split("/")[1], "Gamma " + k.split("/")[1]] }), draft(Object.keys(ids)[1], { body: { hi: ["छोटा"] } })]);
  const r = await ingestDay("2026-11-23", { ai: false });
  assert.deepEqual(r.published, [k]);
  assert.equal(r.failed.length, 1);
  const saved = readJson(L.fileOf("2026-11-23", ...k.split("/")));
  assert.deepEqual(saved.words, ids[k].slice(0, 3), "terms were turned into word ids");
  assert.match(saved.id, /^a-[0-9a-f]{8}$/);
  assert.ok(readJson(path.join(L.A.inbox, "2026-11-23.json"))[0].problems.length);
});

test("on order: two checkers of two different companies, never the writer's company", async () => {
  const rows = ["A", "B", "C"].map((c) => ({ service: "mock", model: `m-${c}`, company: `Co${c}`, role: ["writer", "checker"], daily_limit: 99 }));
  const asked = [];
  const pool = new Pool(rows, { dryRun: true, mock: (row) => { asked.push(row.company); return '{"pass": true, "score": 92, "problems": []}'; } });
  const k = Object.keys(ids)[2];
  writeJson(path.join(L.A.inbox, "2026-11-24.json"), [draft(k)]);
  const r = await ingestDay("2026-11-24", { pool });
  assert.deepEqual(r.published, [k]);
  assert.equal(new Set(asked).size, 2);
  assert.equal(readJson(L.fileOf("2026-11-24", ...k.split("/"))).checked_by.length, 2);
  const no = new Pool(rows, { dryRun: true, mock: () => '{"pass": false, "score": 40, "problems": ["wrong meaning"]}' });
  writeJson(path.join(L.A.inbox, "2026-11-25.json"), [draft(k)]);
  const r2 = await ingestDay("2026-11-25", { pool: no });
  assert.equal(r2.published.length, 0);
  assert.match(r2.failed[0].problems[0], /wrong meaning/);
});

test("the free-model cycle is paused by default and writes nothing; switched on, it writes and checks", async () => {
  const before = L.loadArticles().length;
  const r = await runArticles({ date: "2026-12-01", dry: true });
  assert.equal(r.paused, true);
  assert.equal(L.loadArticles().length, before);
  settings({ paused: false });
  const rows = ["A", "B", "C"].map((c) => ({ service: "mock", model: `m-${c}`, company: `Co${c}`, role: ["writer", "checker"], daily_limit: 99 }));
  const pool = new Pool(rows, { dryRun: true, mock: (row, prompt) => {
    if (prompt.includes("Answer with JSON only: {\"pass\"")) return '{"pass": true, "score": 95, "problems": []}';
    const terms = [...prompt.matchAll(/^- (.+?): /gm)].map((m) => m[1]).slice(0, 3);
    return JSON.stringify({ terms, title_hi: "एक रोचक नमूना शीर्षक", title_en: "An interesting sample title", paragraphs: [para(0), para(1), para(2)] });
  } });
  const r2 = await runArticles({ date: "2026-12-02", pool, settings: readJson(P.settings) });
  assert.ok(r2.made >= 3, JSON.stringify(r2));
  const day = L.loadArticles().filter((a) => a.date === "2026-12-02");
  assert.ok(day.every((a) => a.checked_by.length === 2 && a.written_by.startsWith("mock/")));
  settings();
});
