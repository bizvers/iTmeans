// The daily article cycle with FREE models. Built, but PAUSED (settings.articles.paused = true, owner's decision 23 Nov 2026):
// for now Claude writes the articles on the owner's order (ingest.mjs). When the owner hands the work over, set
// "articles": {"paused": false} in content/settings/settings.json; the hourly workflow then makes the day's articles once a day.
// Run: node agent/articles/cycle.mjs [--date=YYYY-MM-DD] [--dry]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { P, readJson, ledgerAppend, today } from "../cycle/lib.mjs";
import { Pool } from "../cycle/providers.mjs";
import { rules, istDate, planDay, articleCheck, newArticleId, saveArticle, publishedById, resolveWordIds, loadArticles } from "./lib.mjs";
import { writeOne, checkTwice } from "./ai.mjs";

export async function runArticles({ date = istDate(), dry = false, pool = null, settings = readJson(P.settings, {}) } = {}) {
  const note = (e) => (dry ? console.log("[dry]", JSON.stringify(e)) : ledgerAppend({ kind: "article", ...e }));
  const r = rules(settings);
  // paused: nothing in the ledger (it would add a line every hour), only the run log says so
  if (r.paused) { console.log("articles are paused (settings.articles.paused): Claude writes them on order for now"); return { paused: true, made: 0 }; }
  if (settings.stop_all) { note({ outcome: "skip", reason: "stop_all is on" }); return { made: 0 }; }
  const todo = planDay(date).filter((p) => !p.done);
  if (!todo.length) return { made: 0 };
  pool ??= new Pool(readJson(P.models).models, { dryRun: dry, balance: true });
  const byId = publishedById();
  let made = 0;
  for (const item of todo) {
    try {
      const { reply, row } = await writeOne(pool, item);
      const words = resolveWordIds(reply.terms, item.domain, item.subtopic, byId);
      const a = { id: newArticleId(), date, domain: item.domain, subtopic: item.subtopic,
        title: { hi: String(reply.title_hi ?? "").trim(), en: String(reply.title_en ?? "").trim() },
        body: { hi: (reply.paragraphs ?? []).map((p) => String(p).trim()) }, words,
        status: "published", written_by: `${row.service}/${row.model}`, checked_by: [], created_at: today() };
      const bad = articleCheck(a, { byId, settings, articles: loadArticles() });
      if (bad.length) { note({ outcome: "held", domain: a.domain, subtopic: a.subtopic, reason: bad[0] }); continue; }
      const c = await checkTwice(pool, a, words.map((id) => byId.get(id).w), { writerCompany: row.company, domainEn: item.domain_en, subtopicEn: item.subtopic_en });
      if (!c.ok) { note({ outcome: "held", domain: a.domain, subtopic: a.subtopic, reason: c.problems[0] ?? "checker said no" }); continue; }
      a.checked_by = c.checked_by; a.checked_at = today();
      if (!dry) saveArticle(a);
      note({ outcome: "published", domain: a.domain, subtopic: a.subtopic, id: a.id });
      made++;
    } catch (e) {
      note({ outcome: /^no model available/.test(e.message) ? "limits" : "error", domain: item.domain, subtopic: item.subtopic, reason: String(e.message).slice(0, 160) });
      if (/^no model available/.test(e.message)) break;
    }
  }
  return { made };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  runArticles({ date: arg("date") ?? istDate(), dry: process.argv.includes("--dry") })
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => { console.error(e); process.exit(1); });
}
