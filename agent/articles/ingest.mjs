// Articles written on the owner's order (for now by Claude, decision of 23 Nov 2026).
// 1. `node agent/articles/ingest.mjs --plan [--date=YYYY-MM-DD]` prints the day's plan: per subject 2 topics + candidate words.
// 2. The writer saves drafts to content/articles-inbox/<date>.json: a list of
//      {"domain","subtopic","words":[3 terms or ids],"title":{"hi","en"},"body":{"hi":[paragraphs with {0} {1} {2}]},"written_by"}
// 3. `node agent/articles/ingest.mjs [--date=...]` checks each draft by code, then by two free models of two different
//    companies (keys from .env / GitHub secrets), and saves the ones that pass to content/articles/<date>/.
//    A draft that fails stays in the inbox with its problems written next to it. --no-ai skips the model check (tests only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { P, readJson, writeJson, today } from "../cycle/lib.mjs";
import { Pool } from "../cycle/providers.mjs";
import { A, istDate, planDay, articleCheck, newArticleId, saveArticle, publishedById, resolveWordIds, loadArticles } from "./lib.mjs";
import { checkTwice } from "./ai.mjs";

export async function ingestDay(date, { pool = null, ai = true, taxonomy = readJson(P.taxonomy) } = {}) {
  const f = path.join(A.inbox, `${date}.json`);
  const drafts = readJson(f, []);
  if (!drafts.length) return { published: [], failed: [] };
  const byId = publishedById();
  if (ai) pool ??= new Pool(readJson(P.models).models, { dryRun: true, balance: true }); // dryRun: no ledger lines (the ledger belongs to the hourly cycle)
  const published = [], failed = [], keep = [];
  for (const d of drafts) {
    const dom = taxonomy.domains.find((x) => x.id === d.domain), sub = dom?.subtopics.find((s) => s.id === d.subtopic);
    const a = { id: d.id ?? newArticleId(), date, domain: d.domain, subtopic: d.subtopic, title: d.title, body: d.body,
      words: resolveWordIds(d.words, d.domain, d.subtopic, byId), status: "published",
      written_by: d.written_by ?? "anthropic/claude (on order)", checked_by: [], created_at: today() };
    let problems = articleCheck(a, { byId, taxonomy, articles: loadArticles() });
    if (!problems.length && ai) {
      try {
        const c = await checkTwice(pool, a, a.words.map((id) => byId.get(id).w), { writerCompany: "Anthropic", domainEn: dom.en, subtopicEn: sub.en });
        if (c.ok) { a.checked_by = c.checked_by; a.checked_at = today(); } else problems = c.problems.length ? c.problems : ["checker said no"];
      } catch (e) { problems = [String(e.message).slice(0, 300)]; }
    }
    if (problems.length) { failed.push({ domain: d.domain, subtopic: d.subtopic, problems }); keep.push({ ...d, problems }); continue; }
    saveArticle(a);
    published.push(`${a.domain}/${a.subtopic}`);
  }
  if (keep.length) writeJson(f, keep); else fs.rmSync(f, { force: true });
  return { published, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  const date = arg("date") ?? istDate();
  if (process.argv.includes("--plan")) console.log(JSON.stringify(planDay(date), null, 2));
  else ingestDay(date, { ai: !process.argv.includes("--no-ai") }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e); process.exit(1); });
}
