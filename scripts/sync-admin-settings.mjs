// Brings the settings the admin page saved (Firestore document config/settings) into the repository files before each hourly cycle:
//   content/settings/settings.json   stop_all, daily caps, pause %, pass scores
//   content/taxonomy/taxonomy.json   which subjects (domains) and languages are switched on
//   content/settings/pause.json      "resume" pressed by the admin
// The document is readable by anyone (it holds no secrets) and writable only by admins (see firestore.rules), so no key is needed here.
// If the document is missing or Firestore cannot be reached this prints a note and changes nothing (the cycle must never stop because of it).
// Run: node scripts/sync-admin-settings.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { P, readJson, writeJson } from "../agent/cycle/lib.mjs";

const PROJECT = process.env.FIREBASE_PROJECT_ID ?? "itmeans-b5f02";
const URL_ = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/config/settings`;

/** Firestore REST value -> plain JSON */
export function fromFs(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(fromFs);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, fromFs(x)]));
  return null;
}

const int = (x, lo, hi) => (Number.isInteger(x) && x >= lo && x <= hi ? x : undefined);

/** Applies one settings document to the repository files. Returns a list of what changed. */
export function applySettings(doc) {
  const changes = [];
  const taxonomy = readJson(P.taxonomy);
  const settings = readJson(P.settings);
  const was = { t: JSON.stringify(taxonomy), s: JSON.stringify(settings) };

  if (typeof doc.stop_all === "boolean" && doc.stop_all !== settings.stop_all) { settings.stop_all = doc.stop_all; changes.push(`stop_all=${doc.stop_all}`); }
  const pct = int(doc.pause_if_held_percent, 1, 100), chk = int(doc.checker_pass_score, 0, 100), bt = int(doc.backtranslation_pass_score, 0, 100);
  if (pct !== undefined && pct !== settings.pause_if_held_percent) { settings.pause_if_held_percent = pct; changes.push(`pause_if_held_percent=${pct}`); }
  if (chk !== undefined && chk !== settings.checker_pass_score) { settings.checker_pass_score = chk; changes.push(`checker_pass_score=${chk}`); }
  if (bt !== undefined && bt !== settings.backtranslation_pass_score) { settings.backtranslation_pass_score = bt; changes.push(`backtranslation_pass_score=${bt}`); }

  const known = new Set(taxonomy.domains.map((d) => d.id));
  if (Array.isArray(doc.daily_caps)) {
    for (const c of doc.daily_caps) {
      const cap = int(c?.cap, 0, 500);
      if (!known.has(c?.domain) || cap === undefined) continue;
      const row = settings.daily_caps.find((x) => x.domain === c.domain);
      if (row) { if (row.cap !== cap) { row.cap = cap; changes.push(`cap ${c.domain}=${cap}`); } }
      else { settings.daily_caps.push({ domain: c.domain, cap }); changes.push(`cap ${c.domain}=${cap}`); }
    }
  }
  // switching subjects / languages on or off (a NEW subject or language is never created from here)
  for (const [id, on] of Object.entries(doc.domains ?? {})) {
    const d = taxonomy.domains.find((x) => x.id === id);
    if (d && typeof on === "boolean" && d.active !== on) { d.active = on; changes.push(`domain ${id} active=${on}`); }
  }
  for (const [code, on] of Object.entries(doc.languages ?? {})) {
    const l = taxonomy.languages.find((x) => x.code === code);
    if (!l || typeof on !== "boolean" || ["hi", "en"].includes(code)) continue; // Hindi and English stay on
    if (l.active !== on) { l.active = on; changes.push(`language ${code} active=${on}`); }
  }
  if (JSON.stringify(taxonomy) !== was.t) writeJson(P.taxonomy, taxonomy);
  if (JSON.stringify(settings) !== was.s) writeJson(P.settings, settings);

  // "resume" pressed after the cycle paused itself
  if (typeof doc.unpause === "number") {
    const pause = readJson(P.pause, { paused: false, reason: "", at: "" });
    if (pause.paused && doc.unpause > (Date.parse(pause.at) || 0)) {
      writeJson(P.pause, { paused: false, reason: "", at: "" });
      changes.push("pause cleared by admin");
    }
  }
  return changes;
}

export async function syncFromFirestore({ fetchImpl = fetch } = {}) {
  let res;
  try { res = await fetchImpl(URL_); } catch (e) { return { ok: false, note: `Firestore not reachable (${e.message}); settings unchanged` }; }
  if (res.status === 404) return { ok: true, note: "no admin settings saved yet", changes: [] };
  if (!res.ok) return { ok: false, note: `Firestore answered ${res.status}; settings unchanged` };
  const body = await res.json();
  const doc = fromFs({ mapValue: { fields: body.fields ?? {} } });
  return { ok: true, changes: applySettings(doc) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await syncFromFirestore();
  console.log(r.note ?? (r.changes.length ? `Applied from admin page: ${r.changes.join(", ")}` : "Admin settings already applied."));
}
