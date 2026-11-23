// Run: node --test agent/cycle/models.test.mjs
// config/models.json rows are usable, and a row marked "paused" is never picked (owner's switch, 23 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Pool } from "./providers.mjs";

const cfg = JSON.parse(fs.readFileSync(new URL("../../config/models.json", import.meta.url), "utf8"));
const KNOWN = ["openrouter", "groq", "github-models", "cerebras", "mistral", "sambanova", "nvidia-nim", "cloudflare-workers-ai", "google-ai-studio", "cohere"];

test("every model row names a known service, a company, roles and a secret NAME (never a key)", () => {
  for (const r of cfg.models) {
    assert.ok(KNOWN.includes(r.service), `${r.model}: unknown service ${r.service}`);
    assert.ok(r.company && Array.isArray(r.role) && r.role.length, `${r.model}: company/role missing`);
    assert.match(r.secret, /^[A-Z][A-Z0-9_]+$/, `${r.model}: secret must be an env var name`);
  }
});

test("Cerebras and step-5 are paused; Cloudflare Workers AI adds three new companies", () => {
  const paused = cfg.models.filter((r) => r.paused).map((r) => `${r.service}/${r.model}`);
  assert.deepEqual(paused.sort(), ["cerebras/gpt-oss-120b", "cerebras/qwen-3.8-27b", "nvidia-nim/stepfun-ai/step-5-preview"]);
  const cf = cfg.models.filter((r) => r.service === "cloudflare-workers-ai");
  assert.deepEqual(cf.map((r) => r.company).sort(), ["Meta", "Mistral AI", "Zhipu AI"]);
  assert.ok(cf.every((r) => r.secret === "CLOUDFLARE_AI_TOKEN" && !r.paused));
});

test("a paused row is never offered by the pool", () => {
  const rows = [
    { service: "mock", model: "a", company: "A", role: ["writer"], paused: true },
    { service: "mock", model: "b", company: "B", role: ["writer"] },
  ];
  const pool = new Pool(rows, { dryRun: true });
  assert.deepEqual(pool.available("writer").map((r) => r.model), ["b"]);
});
