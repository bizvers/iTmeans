// Loads the output of export-r2.mjs into an R2 bucket. Run from the repo root:
//   node scripts/export-r2.mjs && node scripts/r2-load-local.mjs [--from=site/.r2-export] [--remote]
// Default: the LOCAL bucket (on this computer, no Cloudflare account needed), for trying the site with `wrangler dev`.
// --remote: the REAL bucket, through one wrangler session (needs `wrangler login` on this computer).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(REPO, "site");
const FROM = path.resolve(REPO, process.argv.find((a) => a.startsWith("--from="))?.slice(7) ?? "site/.r2-export");
const { getPlatformProxy } = createRequire(path.join(SITE, "package.json"))("wrangler");

const REMOTE = process.argv.includes("--remote");
process.chdir(SITE); // local state lives in site/.wrangler/state, where `wrangler dev` looks
let configPath = path.join(SITE, "wrangler.jsonc");
if (REMOTE) {
  // same settings, but the bucket binding points at the real bucket
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\s*\/\/.*$/gm, ""));
  cfg.r2_buckets = cfg.r2_buckets.map((b) => ({ ...b, remote: true }));
  fs.mkdirSync(path.join(SITE, ".wrangler"), { recursive: true });
  configPath = path.join(SITE, ".wrangler", "wrangler.remote.json");
  fs.writeFileSync(configPath, JSON.stringify(cfg));
}
const { env, dispose } = await getPlatformProxy({ configPath, persist: !REMOTE, remoteBindings: REMOTE });
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name)); };
walk(FROM);
// the real bucket is reached through a proxy that dislikes many requests at once: fewer at a time, and retry
const BATCH = REMOTE ? 6 : 50;
const putOne = async (f) => {
  const key = path.relative(FROM, f).split(path.sep).join("/");
  for (let attempt = 1; ; attempt++) {
    try { return await env.WORDS.put(key, fs.readFileSync(f, "utf8"), { httpMetadata: { contentType: "application/json" } }); }
    catch (e) { if (attempt >= 4) throw new Error(`${key}: ${e.message}`); await new Promise((r) => setTimeout(r, 1000 * attempt)); }
  }
};
let done = 0;
for (let i = 0; i < files.length; i += BATCH) {
  await Promise.all(files.slice(i, i + BATCH).map(putOne));
  done += Math.min(BATCH, files.length - i);
  if (REMOTE && done % 60 < BATCH) console.log(`  ${done}/${files.length}`);
}
await dispose();
console.log(`r2-load-local: ${done} objects in the ${REMOTE ? "REAL" : "local"} bucket`);
