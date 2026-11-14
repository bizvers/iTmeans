// Shared helpers: paths, JSON files, settings, ledger. No secrets are ever read or written here.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ITMEANS_ROOT lets tests and mock runs work in a scratch copy instead of the real content.
export const REPO = process.env.ITMEANS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const P = {
  taxonomy: path.join(REPO, "content/taxonomy/taxonomy.json"),
  settings: path.join(REPO, "content/settings/settings.json"),
  pause: path.join(REPO, "content/settings/pause.json"), // written by the pause rule (check 6); clear it in the admin page to resume
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

// ---------------------------------------------------------------- permanent word IDs
// Every word (published, queued or held) has ONE id that never changes, even if its slug, subtopic or term is edited.
// Only code makes ids; AI models and CMS users never type one. Alphabet has no l, o, 0, 1 (hard to tell apart).
export const ID_RE = /^w-[a-km-np-z2-9]{8}$/;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** New id that is not in `taken`; adds it to `taken`. */
export function newId(taken) {
  for (;;) {
    const b = crypto.randomBytes(8);
    const id = "w-" + [...b].map((x) => ALPHABET[x % 32]).join("");
    if (!taken.has(id)) { taken.add(id); return id; }
  }
}

const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f)) : []);

/** Every published/held-status word file: [{file, w}] (all domains in the folder, active or not). */
export function loadWords() {
  const out = [];
  if (!fs.existsSync(P.words)) return out;
  const dirs = (p) => fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const d of dirs(P.words)) for (const s of dirs(path.join(P.words, d))) {
    for (const file of jsonFiles(path.join(P.words, d, s))) out.push({ file, domain: d, sub: s, w: readJson(file) });
  }
  return out;
}
/** Queue files: [{file, domain, sub, entries}] */
export function loadQueues() {
  return jsonFiles(P.queue).map((file) => {
    const [domain, sub] = path.basename(file, ".json").split("__");
    return { file, domain, sub, entries: readJson(file, []) };
  });
}
/** Held records: [{file, h}] */
export const loadHeld = () => jsonFiles(P.held).map((file) => ({ file, h: readJson(file) }));

export function takenIds() {
  const ids = new Set();
  for (const { w } of loadWords()) if (w.id) ids.add(w.id);
  for (const q of loadQueues()) for (const e of q.entries) if (e.id) ids.add(e.id);
  for (const { h } of loadHeld()) if (h.id) ids.add(h.id);
  return ids;
}

/** Gives an id to every word, queue entry and held record that lacks one. Returns how many were added. */
export function assignMissingIds({ write = true } = {}) {
  const taken = takenIds();
  let n = 0;
  for (const x of loadWords()) if (!x.w.id) { x.w = { id: newId(taken), ...x.w }; n++; if (write) writeJson(x.file, x.w); }
  for (const q of loadQueues()) {
    let changed = false;
    q.entries = q.entries.map((e) => { if (e.id) return e; changed = true; n++; return { id: newId(taken), ...e }; });
    if (changed && write) writeJson(q.file, q.entries);
  }
  for (const x of loadHeld()) if (!x.h.id) { x.h = { id: newId(taken), ...x.h }; n++; if (write) writeJson(x.file, x.h); }
  return n;
}

export function removeFromQueue(domain, sub, id) {
  const f = path.join(P.queue, `${domain}__${sub}.json`);
  const q = readJson(f, null);
  if (q) writeJson(f, q.filter((e) => e.id !== id));
}

/**
 * Turns the writer's "related" list (English terms, or old-style slugs) into permanent ids.
 * Order of lookup (same domain only): published word -> queued term -> held word -> NEW queue entry in this subtopic.
 * With write=false nothing is saved (dry runs), but ids are still returned.
 */
export function resolveRelated(items, { domain, sub, selfId, write = true }) {
  const words = loadWords().filter((x) => x.domain === domain);
  const queues = loadQueues();
  const held = loadHeld().filter((x) => x.h.domain === domain);
  const taken = takenIds();
  const out = [];
  for (const raw of items ?? []) {
    const item = String(raw).trim();
    if (!item) continue;
    let id = ID_RE.test(item) ? item : null;
    const s = slugify(item);
    if (!id && s) {
      const w = words.find((x) => x.w.slug === s && x.w.status === "published" && x.sub === sub) ?? words.find((x) => x.w.slug === s && x.w.status === "published");
      id = w?.w.id
        ?? queues.filter((q) => q.domain === domain).flatMap((q) => q.entries).find((e) => slugify(e.term) === s)?.id
        ?? held.find((x) => x.h.slug === s)?.h.id ?? null;
      if (!id) { // brand-new related term: reserve an id in this subtopic's queue
        const term = /^[a-z0-9-]+$/.test(item) ? item.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) : item;
        id = newId(taken);
        const q = queues.find((x) => x.domain === domain && x.sub === sub) ?? (queues.push({ file: path.join(P.queue, `${domain}__${sub}.json`), domain, sub, entries: [] }), queues.at(-1));
        q.entries.push({ id, term, both: false });
        if (write) writeJson(q.file, q.entries);
      }
    }
    if (id && id !== selfId && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 5);
}
