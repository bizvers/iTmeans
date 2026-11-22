// Words of the website itself (buttons, labels) live in content/ui/<lang>.json, one file per language.
// Add a new language = add content/ui/<code>.json with the same keys as en.json (+ turn it on in taxonomy.json).
// The build check (scripts/validate-content.mjs) fails if an active language misses a key.
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(process.cwd(), "..", "content", "ui");

// In the Cloudflare build the words are written into the code (astro.config.mjs), since the Worker has no files.
declare const __ITM_DATA__: { ui: Record<string, Record<string, string>> } | undefined;
export const ui: Record<string, Record<string, string>> = typeof __ITM_DATA__ !== "undefined" ? __ITM_DATA__.ui : {};
if (typeof __ITM_DATA__ === "undefined") for (const f of fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((x) => x.endsWith(".json")) : []) {
  ui[path.basename(f, ".json")] = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8").replace(/^﻿/, ""));
}

export const tr = (lang: string, k: string) => (ui[lang] ?? ui.en)[k] ?? ui.en[k] ?? k;
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export const REPO_URL = "https://github.com/bizvers/iTmeans";
export const REPORT_URL = `${REPO_URL}/issues/new`; // "Report a mistake" opens a new issue in the repo
