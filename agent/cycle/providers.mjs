// Model calls. Keys come ONLY from environment variables named in the model row ("secret").
// Endpoints below follow each service's documented chat API shape; verify them (and the free limits) when
// first using a real key -- see docs/decisions.md.
import { ledgerRead, ledgerAppend } from "./lib.mjs";

const OPENAI_LIKE = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  "github-models": "https://models.github.ai/inference/chat/completions",
  // ready for when the user makes these free accounts and adds the key (GitHub secret + .env); then only a row in config/models.json is needed
  cerebras: "https://api.cerebras.ai/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  sambanova: "https://api.sambanova.ai/v1/chat/completions",
  "nvidia-nim": "https://integrate.api.nvidia.com/v1/chat/completions",
  // Cloudflare Workers AI (free: 10,000 "neurons" a day for the whole account, shared by all its models). The account id only names the account.
  "cloudflare-workers-ai": `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID ?? "e5ed2325b409cf04ad1e2e7a8a9f6bfe"}/ai/v1/chat/completions`,
};

// a model that does not answer within this time is given up (the pool then tries the next model); without it one stuck request blocks the whole run
// (90 s: a real run spent 14 minutes on 12 calls to slow free models and wrote nothing)
export const CALL_TIMEOUT_MS = 90000;
// one polite retry after a rate-limit (429) answer
const f = async (url, opts, ms = CALL_TIMEOUT_MS) => {
  const go = () => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  let r = await go();
  if (r.status === 429) { await new Promise((s) => setTimeout(s, 20000)); r = await go(); }
  return r;
};

export async function callModel(row, prompt, { mock } = {}) {
  if (row.service === "mock") return mock(row, prompt);
  const key = process.env[row.secret];
  if (!key) throw new Error(`secret ${row.secret} is not set`);
  // a slow model may take longer (models.json "timeout_s"): every company works in its own lane, so it no longer holds the others up
  const ms = row.timeout_s ? row.timeout_s * 1000 : CALL_TIMEOUT_MS;
  if (OPENAI_LIKE[row.service]) {
    const r = await f(OPENAI_LIKE[row.service], {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: row.model, messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
    }, ms);
    if (!r.ok) throw new Error(`${row.service} HTTP ${r.status}`);
    return (await r.json()).choices?.[0]?.message?.content ?? "";
  }
  if (row.service === "google-ai-studio") {
    const r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${row.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
    }, ms);
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
 * The "terms" list of a word-list reply. A long list from a free model is often cut off before its end
 * (19 Nov 2026: a 100-word Law list stopped in the middle, so the whole reply was thrown away and the run made nothing);
 * then every term that was written out in full is still used.
 */
export function extractTerms(text) {
  // a whole reply is used as it is: a list, or (many letters in one request) an object of lists per letter
  try { const j = extractJson(text); if (j.terms && typeof j.terms === "object") return j.terms; } catch { /* cut off: salvage below */ }
  const at = text.indexOf('"terms"');
  if (at < 0) throw new Error("no JSON in model reply");
  const out = [];
  for (const m of text.slice(at + 7).matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) { try { out.push(JSON.parse(`"${m[1]}"`)); } catch { /* skip a broken string */ } }
  if (!out.length) throw new Error("no JSON in model reply");
  return out;
}

// a model that failed this often today (and more often than it answered) is tried only after the others:
// 19 Nov 2026 four broken models (402 / timeouts) came first in every request and ate most of each run
const SICK_MIN_FAILS = 3;

/**
 * Model pool: picks a row for a role, skipping excluded companies and rows whose daily call limit
 * is used up (counted from today's ledger). Records every call in the ledger (service/model only).
 */
export class Pool {
  // balance: the least-used row (by share of its daily limit) goes first, so every AI gets its turn. Off = list order (old behaviour).
  constructor(rows, { mock, dryRun = false, balance = false } = {}) {
    this.rows = rows; this.mock = mock; this.dryRun = dryRun; this.balance = balance;
    this.used = {};
    this.failed = {}; // failed calls today per model (from the ledger)
    this.benched = new Set(); // models that failed (timeout, server error, refused) in this run: skipped for the rest of the run
    for (const e of ledgerRead()) {
      const k = `${e.service}/${e.model}`;
      if (e.kind === "call") this.used[k] = (this.used[k] ?? 0) + 1;
      if (e.kind === "call-failed") this.failed[k] = (this.failed[k] ?? 0) + 1;
    }
  }
  /** Failed at least SICK_MIN_FAILS times today and more often than it answered. */
  sick(r) {
    const k = `${r.service}/${r.model}`, f = this.failed[k] ?? 0;
    return f >= SICK_MIN_FAILS && f * 2 > (this.used[k] ?? 0);
  }
  available(role, excludeCompanies = []) {
    const load = (r) => (r.daily_limit ? (this.used[`${r.service}/${r.model}`] ?? 0) / r.daily_limit : 0);
    const sorted = this.balance ? [...this.rows].sort((a, b) => load(a) - load(b)) : this.rows;
    const rows = [...sorted.filter((r) => !this.sick(r)), ...sorted.filter((r) => this.sick(r))]; // broken-today models last, still tried
    // "paused": true in config/models.json = the owner switched this model off until further notice (never called)
    return rows.filter((r) => !r.paused && r.role.includes(role) && !excludeCompanies.includes(r.company) && !this.benched.has(`${r.service}/${r.model}`) &&
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
      catch (e) {
        tried.push(`${k}: ${e.message}`);
        this.benched.add(k); // a slow or failing model is not tried again in this run (the next run tries it afresh)
        if (!this.dryRun) ledgerAppend({ kind: "call-failed", service: row.service, model: row.model, role, message: String(e.message).slice(0, 160) });
      }
    }
    throw new Error(`no model available for ${role} (excluded: ${excludeCompanies.join(",") || "none"}) ${tried.join("; ")}`);
  }
}
