// Model work for articles: writing (the paused cycle) and the two checks every article needs before it is published.
// Rule (CLAUDE.md, same as for full words): two checkers of two DIFFERENT companies agree, and neither is the writer's company.
import fs from "node:fs";
import path from "node:path";
import { P, readJson } from "../cycle/lib.mjs";
import { verdict } from "./lib.mjs";

const prompt = (name, vars) => {
  let t = fs.readFileSync(path.join(P.prompts, name), "utf8");
  for (const [k, v] of Object.entries(vars)) t = t.replaceAll(`{{${k}}}`, String(v));
  return t;
};
export const LAW_LINE = "- Law: no section, article or rule numbers, and no legal advice to the reader.";

/** Text of an article with each placeholder shown as [term]. */
export const plainText = (a, terms) => a.body.hi.map((p) => p.replace(/\{(\d+)\}/g, (_, n) => `[${terms[+n] ?? "?"}]`)).join("\n\n");

/**
 * Two checks by two different companies (not writerCompany). Returns {ok, checked_by, problems}.
 * It goes through the pool, so a model that fails or is used up is replaced by the next one.
 */
export async function checkTwice(pool, a, words, { writerCompany = null, domainEn, subtopicEn, passScore = readJson(P.settings, {}).checker_pass_score ?? 85 }) {
  const text = prompt("article-check.md", {
    domain: domainEn, subtopic: subtopicEn, title_hi: a.title.hi, title_en: a.title.en,
    words: words.map((w) => `- ${w.term}: ${w.field_meaning?.hi ?? ""}`).join("\n"),
    text: plainText(a, words.map((w) => w.term)),
  });
  const used = writerCompany ? [writerCompany] : [], checked_by = [], problems = [];
  for (let i = 0; i < 2; i++) {
    const r = await pool.ask("checker", text, used); // throws "no model available" when no other company is left
    used.push(r.row.company);
    const v = verdict(r.text, passScore);
    checked_by.push(`${r.row.service}/${r.row.model}`);
    if (!v.pass) { problems.push(...v.problems.map((p) => `${r.row.company}: ${p}`)); if (!v.problems.length) problems.push(`${r.row.company}: score ${v.score}`); return { ok: false, checked_by, problems }; }
  }
  return { ok: true, checked_by, problems };
}

/** One article written by a free model (used only by the cycle, which is paused for now). */
export async function writeOne(pool, item, { exclude = [] } = {}) {
  const text = prompt("article-write.md", {
    domain: item.domain_en, subtopic: item.subtopic_en,
    candidates: item.candidates.map((c) => `- ${c.term}: ${c.meaning_hi}`).join("\n"),
    law: item.notice === "legal-not-advice" ? LAW_LINE : "",
  });
  const r = await pool.ask("writer", text, exclude);
  const s = r.text.indexOf("{"), e = r.text.lastIndexOf("}");
  const j = JSON.parse(r.text.slice(s, e + 1));
  return { reply: j, row: r.row };
}
