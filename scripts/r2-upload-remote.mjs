// Uploads the output of export-r2.mjs to the REAL R2 bucket. Needs `wrangler login` on this computer, or
// CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID) in GitHub Actions.
//   node scripts/r2-upload-remote.mjs [--from=site/.r2-export] [--bucket=itmeans-words] [--parallel=6] [--all]
// By default only objects that changed since the last upload are sent: the bucket keeps manifest.json
// (key -> sha1), written last, so an interrupted upload is simply repeated next time. --all sends everything.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const FROM = path.resolve(REPO, arg("from", "site/.r2-export"));
const BUCKET = arg("bucket", "itmeans-words");
const PARALLEL = Number(arg("parallel", "6"));
const ALL = process.argv.includes("--all");
const WRANGLER = path.join(REPO, "site", "node_modules", "wrangler", "bin", "wrangler.js");
const SITE = path.join(REPO, "site");

const run = (args) => new Promise((resolve) => {
  let p;
  try { p = spawn(process.execPath, [WRANGLER, ...args], { cwd: SITE, stdio: ["ignore", "ignore", "pipe"] }); }
  catch (e) { return resolve(e.message); } // Windows sometimes refuses to start a process when many run at once
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  p.on("error", (e) => resolve(e.message));
  p.on("close", (code) => resolve(code === 0 ? null : err.trim().split("\n").pop() || `exit ${code}`));
});
const retry = async (args) => {
  let e;
  for (let attempt = 1; attempt <= 3; attempt++) {
    e = await run(args);
    if (!e) return null;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return e;
};
const putArgs = (key, file) => ["r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", "application/json", "--remote"];

const local = JSON.parse(fs.readFileSync(path.join(FROM, "manifest.json"), "utf8"));
let remote = {};
if (!ALL) {
  const tmp = path.join(os.tmpdir(), `itm-manifest-${process.pid}.json`);
  const e = await run(["r2", "object", "get", `${BUCKET}/manifest.json`, "--file", tmp, "--remote"]);
  if (!e && fs.existsSync(tmp)) { try { remote = JSON.parse(fs.readFileSync(tmp, "utf8")); } catch {} fs.rmSync(tmp, { force: true }); }
  else console.log("  no manifest in the bucket yet: sending everything");
}
const keys = Object.keys(local).filter((k) => remote[k] !== local[k]);
const gone = Object.keys(remote).filter((k) => !(k in local));
console.log(`r2-upload-remote: ${keys.length} of ${Object.keys(local).length} objects changed${gone.length ? `, ${gone.length} no longer exported (left in the bucket)` : ""}`);

let next = 0, ok = 0;
const failed = [];
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (next < keys.length) {
    const key = keys[next++];
    const e = await retry(putArgs(key, path.join(FROM, ...key.split("/"))));
    if (e) failed.push(`${key}: ${e}`); else ok++;
    if ((ok + failed.length) % 100 === 0) console.log(`  ${ok + failed.length}/${keys.length}`);
  }
}));
// the manifest goes last and only when everything else arrived, so a failed run is redone next time
if (!failed.length && keys.length) {
  const e = await retry(putArgs("manifest.json", path.join(FROM, "manifest.json")));
  if (e) failed.push(`manifest.json: ${e}`);
}
console.log(`r2-upload-remote: ${ok} uploaded, ${failed.length} failed`);
for (const e of failed.slice(0, 10)) console.log("  " + e);
process.exitCode = failed.length ? 1 : 0;
