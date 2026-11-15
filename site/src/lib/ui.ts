// Words of the website itself (buttons, labels) live in content/ui/<lang>.json, one file per language.
// Add a new language = add content/ui/<code>.json with the same keys as en.json (+ turn it on in taxonomy.json).
// The build check (scripts/validate-content.mjs) fails if an active language misses a key.
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(process.cwd(), "..", "content", "ui");

export const ui: Record<string, Record<string, string>> = {};
for (const f of fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((x) => x.endsWith(".json")) : []) {
  ui[path.basename(f, ".json")] = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8").replace(/^﻿/, ""));
}

export const tr = (lang: string, k: string) => (ui[lang] ?? ui.en)[k] ?? ui.en[k] ?? k;
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export const REPORT_URL = "https://github.com/bizvers/iTmeans/issues/new"; // "Report a mistake" opens a new issue in the repo
