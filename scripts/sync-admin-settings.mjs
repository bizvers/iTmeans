// Brings the settings the admin page saved (Firestore document config/settings) into the repository files before each hourly cycle:
//   content/settings/settings.json   stop_all, daily caps, pause %, pass scores
//   content/taxonomy/taxonomy.json   which subjects (domains) and languages are switched on; new subjects/subtopics and renamed ones
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

// Ids become web addresses (/hi/<domain>/<subtopic>/), so: lowercase a-z, 0-9 and single dashes. These names are already pages of the site.
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RESERVED = new Set(["admin", "me", "privacy", "pagefind", "_astro"]);
const okId = (x) => typeof x === "string" && x.length <= 40 && SLUG.test(x) && !RESERVED.has(x);
/** A display name: 1-60 characters, no line breaks or control characters. Returns the trimmed name or undefined. */
const okName = (x) => { if (typeof x !== "string") return; const t = x.trim().replace(/\s+/g, " "); return t.length >= 1 && t.length <= 60 && !/[\u0000-\u001f<>]/.test(t) ? t : undefined; };

/** New subjects / subtopics and renames saved on the admin page. Adding the same thing again changes nothing; nothing is ever deleted. */
function applyTaxonomyEdits(doc, taxonomy, settings, changes) {
  for (const a of Array.isArray(doc.add_domains) ? doc.add_domains : []) {
    const en = okName(a?.en), hi = okName(a?.hi);
    if (!okId(a?.id) || !en || !hi || taxonomy.domains.some((d) => d.id === a.id)) continue;
    const order = Math.max(0, ...taxonomy.domains.map((d) => d.order ?? 0)) + 1;
    taxonomy.domains.push({ id: a.id, en, hi, order, active: false, subtopics: [] }); // starts switched off, daily cap 0
    if (!settings.daily_caps.some((c) => c.domain === a.id)) settings.daily_caps.push({ domain: a.id, cap: 0 });
    changes.push(`new domain ${a.id}`);
  }
  for (const a of Array.isArray(doc.add_subtopics) ? doc.add_subtopics : []) {
    const d = taxonomy.domains.find((x) => x.id === a?.domain);
    const en = okName(a?.en), hi = okName(a?.hi);
    if (!d || !okId(a?.id) || !en || !hi || d.subtopics.some((s) => s.id === a.id)) continue;
    d.subtopics.push({ id: a.id, en, hi });
    changes.push(`new subtopic ${d.id}/${a.id}`);
  }
  for (const r of Array.isArray(doc.rename) ? doc.rename : []) {
    const d = taxonomy.domains.find((x) => x.id === r?.domain);
    const item = d && (r.subtopic ? d.subtopics.find((s) => s.id === r.subtopic) : d);
    const en = okName(r?.en), hi = okName(r?.hi);
    if (!item || !en || !hi || (item.en === en && item.hi === hi)) continue;
    item.en = en; item.hi = hi;
    changes.push(`renamed ${d.id}${r.subtopic ? "/" + r.subtopic : ""}`);
  }
}

/** Words per letter (min/max), the topic finishing line, review size, one topic's own rules, and which topic to work on now. */
function applyTopicRules(doc, taxonomy, settings, changes) {
  const known = new Set(taxonomy.domains.flatMap((d) => d.subtopics.map((s) => `${d.id}/${s.id}`)));
  const clean = (r, allowReview) => {
    const o = {};
    const min = int(r?.min, 0, 100), max = int(r?.max, 1, 100), target = int(r?.target, 1, 5000);
    if (min !== undefined) o.min = min;
    if (max !== undefined) o.max = max;
    if (o.min !== undefined && o.max !== undefined && o.min > o.max) o.min = o.max;
    if (target !== undefined) o.target = target;
    if (r?.mode === "popular" || r?.mode === "letters") o.mode = r.mode;
    if (allowReview) { const rv = int(r?.review_every, 10, 100000), pt = int(r?.popular_target, 1, 5000); if (rv !== undefined) o.review_every = rv; if (pt !== undefined) o.popular_target = pt; }
    return o;
  };
  const set = (where, key, val) => { if (JSON.stringify(where[key]) !== JSON.stringify(val)) { where[key] = val; return true; } return false; };
  if (doc.topic_defaults && typeof doc.topic_defaults === "object") {
    const next = { ...(settings.topic_defaults ?? {}), ...clean(doc.topic_defaults, true) };
    if (next.min > next.max) next.min = next.max;
    if (set(settings, "topic_defaults", next)) changes.push(`topic_defaults=${JSON.stringify(next)}`);
  }
  if (doc.topic_rules && typeof doc.topic_rules === "object") {
    const next = {};
    for (const [k, r] of Object.entries(doc.topic_rules)) { if (!known.has(k)) continue; const c = clean(r, false); if (Object.keys(c).length) next[k] = c; }
    if (set(settings, "topic_rules", next)) changes.push("topic_rules changed");
  }
  if (typeof doc.current_topic === "string") {
    const v = known.has(doc.current_topic) ? doc.current_topic : "";
    if (v !== (settings.current_topic ?? "")) { if (v) settings.current_topic = v; else delete settings.current_topic; changes.push(`current_topic=${v || "(automatic)"}`); }
  }
}

/** Applies one settings document to the repository files. Returns a list of what changed. */
export function applySettings(doc) {
  const changes = [];
  const taxonomy = readJson(P.taxonomy);
  const settings = readJson(P.settings);
  const was = { t: JSON.stringify(taxonomy), s: JSON.stringify(settings) };

  if (typeof doc.stop_all === "boolean" && doc.stop_all !== settings.stop_all) { settings.stop_all = doc.stop_all; changes.push(`stop_all=${doc.stop_all}`); }
  if (typeof doc.no_daily_cap === "boolean" && doc.no_daily_cap !== !!settings.no_daily_cap) { settings.no_daily_cap = doc.no_daily_cap; changes.push(`no_daily_cap=${doc.no_daily_cap}`); }
  const pct = int(doc.pause_if_held_percent, 1, 100), chk = int(doc.checker_pass_score, 0, 100), bt = int(doc.backtranslation_pass_score, 0, 100);
  if (pct !== undefined && pct !== settings.pause_if_held_percent) { settings.pause_if_held_percent = pct; changes.push(`pause_if_held_percent=${pct}`); }
  if (chk !== undefined && chk !== settings.checker_pass_score) { settings.checker_pass_score = chk; changes.push(`checker_pass_score=${chk}`); }
  if (bt !== undefined && bt !== settings.backtranslation_pass_score) { settings.backtranslation_pass_score = bt; changes.push(`backtranslation_pass_score=${bt}`); }

  applyTaxonomyEdits(doc, taxonomy, settings, changes); // first, so a subject added and switched on in the same save works
  applyTopicRules(doc, taxonomy, settings, changes);
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
  // switching subjects / languages on or off (a NEW language is never created from here)
  for (const [id, on] of Object.entries(doc.domains ?? {})) {
    const d = taxonomy.domains.find((x) => x.id === id);
    if (!d || typeof on !== "boolean" || d.active === on) continue;
    if (on && !d.subtopics.length) { changes.push(`domain ${id} not switched on: it has no subtopic`); continue; }
    d.active = on; changes.push(`domain ${id} active=${on}`);
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
