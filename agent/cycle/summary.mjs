// Monitoring: prints a short Markdown report of today's cycle (and appends it to the GitHub Actions run page).
// Run: node agent/cycle/summary.mjs
import fs from "node:fs";
import { P, readJson, ledgerRead, today } from "./lib.mjs";

const led = ledgerRead();
const words = led.filter((e) => e.kind === "word");
const pub = words.filter((e) => e.outcome === "published"), held = words.filter((e) => e.outcome === "held");
const settings = readJson(P.settings), pause = readJson(P.pause, { paused: false });
const models = readJson(P.models, { models: [] }).models;
const calls = {};
for (const e of led.filter((x) => x.kind === "call")) calls[`${e.service}/${e.model}`] = (calls[`${e.service}/${e.model}`] ?? 0) + 1;
const last = led.filter((e) => ["skip", "limits", "error", "paused"].includes(e.kind)).slice(-3);

const out = [
  `## iTmeans cycle — ${today()}`,
  `Status: ${settings.stop_all ? "STOPPED (stop_all in admin)" : pause.paused ? `PAUSED (${pause.reason})` : "running"}`,
  `Words today: ${pub.length} published, ${held.length} held` + (held.length ? ` (${Math.round(held.length * 100 / (pub.length + held.length))}% held)` : ""),
  "", "| Model | Calls today | Daily limit |", "| --- | --- | --- |",
  ...models.map((m) => `| ${m.service}/${m.model} | ${calls[`${m.service}/${m.model}`] ?? 0} | ${m.daily_limit ?? "-"} |`),
  "", "Daily caps (published today / cap):",
  ...(settings.daily_caps ?? []).map((c) => `- ${c.domain}: ${pub.filter((e) => e.domain === c.domain).length} / ${c.cap}`),
  ...(last.length ? ["", "Last notes:", ...last.map((e) => `- ${e.kind}: ${(e.reason ?? e.message ?? "").slice(0, 160)}`)] : []),
].join("\n");
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + "\n");