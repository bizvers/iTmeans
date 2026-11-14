// Shared helpers: paths, JSON files, settings, ledger. No secrets are ever read or written here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ITMEANS_ROOT lets tests and mock runs work in a scratch copy instead of the real content.
export const REPO = process.env.ITMEANS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const P = {
  taxonomy: path.join(REPO, "content/taxonomy/taxonomy.json"),
  settings: path.join(REPO, "content/settings/settings.json"),
  words: path.join(REPO, "content/words"),
  held: path.join(REPO, "content/held"),
  queue: path.join(REPO, "content/queue"),
  ledger: path.join(REPO, "content/ledger"),
  models: path.join(REPO, "config/models.json"),
  prompts: path.join(REPO, "agent/prompts"),
};

export const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
};
export const writeJson = (f, data) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2) + "\n", "utf8");
};

export const today = (d = new Date()) => d.toISOString().slice(0, 10);

/** Ledger: one JSON object per line, per day. Entries: {t, kind, ...}. */
export function ledgerAppend(entry, date = today()) {
  fs.mkdirSync(P.ledger, { recursive: true });
  fs.appendFileSync(path.join(P.ledger, `${date}.jsonl`), JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n", "utf8");
}
export function ledgerRead(date = today()) {
  const f = path.join(P.ledger, `${date}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function slugify(term) {
  return term.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
