// Model calls. Keys come ONLY from environment variables named in the model row ("secret").
// Endpoints below follow each service's documented chat API shape; verify them (and the free limits) when
// first using a real key -- see docs/decisions.md.
import { ledgerRead, ledgerAppend } from "./lib.mjs";

const OPENAI_LIKE = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  "github-models": "https://models.github.ai/inference/chat/completions",
};

// one polite retry after a rate-limit (429) answer
const f = async (...a) => {
  let r = await fetch(...a);
  if (r.status === 429) { await new Promise((s) => setTimeout(s, 20000)); r = await fetch(...a); }
  return r;
};

export async function callModel(row, prompt, { mock } = {}) {
  if (row.service === "mock") return mock(row, prompt);
  const key = process.env[row.secret];
  if (!key) throw new Error(`secret ${row.secret} is not set`);
  if (OPENAI_LIKE[row.service]) {
    const r = await f(OPENAI_LIKE[row.service], {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: row.model, messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
    });
    if (!r.ok) throw new Error(`${row.service} HTTP ${r.status}`);
    return (await r.json()).choices?.[0]?.message?.content ?? "";
  }
  if (row.service === "google-ai-studio") {
    const r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${row.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
    });
    if (!r.ok) throw new Error(`google-ai-studio HTTP ${r.status}`);
    return (await r.json()).candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  }
  if (row.service === "cohere") {
    const r = await f("https://api.cohere.com/v2/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: row.model, messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
    });
    if (!r.ok) throw new Error(`cohere HTTP ${r.status}`);
    return (await r.json()).message?.content?.[0]?.text ?? "";
  }
  throw new Error(`unknown service ${row.service}`);
}

/** First JSON object found in a model reply (models often wrap it in prose or ``` fences). */
export function extractJson(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("no JSON in model reply");
  return JSON.parse(text.slice(s, e + 1));
}

/**
 * Model pool: picks a row for a role, skipping excluded companies and rows whose daily call limit
 * is used up (counted from today's ledger). Records every call in the ledger (service/model only).
 */
export class Pool {
  // balance: the least-used row (by share of its daily limit) goes first, so every AI gets its turn. Off = list order (old behaviour).
  constructor(rows, { mock, dryRun = false, balance = false } = {}) {
    this.rows = rows; this.mock = mock; this.dryRun = dryRun; this.balance = balance;
    this.used = {};
    for (const e of ledgerRead()) if (e.kind === "call") this.used[`${e.service}/${e.model}`] = (this.used[`${e.service}/${e.model}`] ?? 0) + 1;
  }
  available(role, excludeCompanies = []) {
    const load = (r) => (r.daily_limit ? (this.used[`${r.service}/${r.model}`] ?? 0) / r.daily_limit : 0);
    const rows = this.balance ? [...this.rows].sort((a, b) => load(a) - load(b)) : this.rows;
    return rows.filter((r) => r.role.includes(role) && !excludeCompanies.includes(r.company) &&
      (r.daily_limit == null || (this.used[`${r.service}/${r.model}`] ?? 0) < r.daily_limit) &&
      (r.service === "mock" || process.env[r.secret]));
  }
  /** Calls the first available row; on error falls through to the next one. Returns {text,row}. */
  async ask(role, prompt, excludeCompanies = []) {
    const tried = [];
    for (const row of this.available(role, excludeCompanies)) {
      const k = `${row.service}/${row.model}`;
      this.used[k] = (this.used[k] ?? 0) + 1;
      if (!this.dryRun) ledgerAppend({ kind: "call", service: row.service, model: row.model, role });
      try { return { text: await callModel(row, prompt, { mock: this.mock }), row }; }
      catch (e) { tried.push(`${k}: ${e.message}`); }
    }
    throw new Error(`no model available for ${role} (excluded: ${excludeCompanies.join(",") || "none"}) ${tried.join("; ")}`);
  }
}
