// Uploads the output of export-r2.mjs to the REAL R2 bucket (needs `wrangler login` on this computer, or
// CLOUDFLARE_API_TOKEN in CI). One wrangler call per object, several at once - fine for a few thousand objects;
// the hourly cycle will need a faster bulk path (scale step s2).
//   node scripts/r2-upload-remote.mjs [--from=site/.r2-export] [--bucket=itmeans-words] [--parallel=8]
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const FROM = path.resolve(REPO, arg("from", "site/.r2-export"));
const BUCKET = arg("bucket", "itmeans-words");
const PARALLEL = Number(arg("parallel", "8"));
const WRANGLER = path.join(REPO, "site", "node_modules", "wrangler", "bin", "wrangler.js");

const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name)); };
walk(FROM);

const putOnce = (f, key) => new Promise((resolve) => {
  let p;
  try {
    p = spawn(process.execPath, [WRANGLER, "r2", "object", "put", `${BUCKET}/${key}`, "--file", f, "--content-type", "application/json", "--remote"], { cwd: path.join(REPO, "site"), stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) { return resolve(`${key}: ${e.message}`); } // Windows sometimes refuses to start a process when many run at once
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  p.on("error", (e) => resolve(`${key}: ${e.message}`));
  p.on("close", (code) => resolve(code === 0 ? null : `${key}: ${err.trim().split("\n").pop()}`));
});
const put = async (f) => {
  const key = path.relative(FROM, f).split(path.sep).join("/");
  let e;
  for (let attempt = 1; attempt <= 3; attempt++) {
    e = await putOnce(f, key);
    if (!e) return null;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return e;
};

let next = 0, ok = 0;
const failed = [];
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (next < files.length) {
    const f = files[next++];
    const e = await put(f);
    if (e) failed.push(e); else ok++;
    if ((ok + failed.length) % 50 === 0) console.log(`  ${ok + failed.length}/${files.length}`);
  }
}));
console.log(`r2-upload-remote: ${ok} uploaded, ${failed.length} failed`);
for (const e of failed.slice(0, 10)) console.log("  " + e);
process.exitCode = failed.length ? 1 : 0;
