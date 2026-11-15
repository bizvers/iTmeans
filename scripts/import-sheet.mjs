// Turns an Excel (.xlsx) or CSV sheet of words, made by ChatGPT/Gemini with docs/contribute/excel-prompt.md, into contributor drafts
// (format "itmeans-draft-1", see agent/cycle/ingest.mjs). No outside packages: .xlsx is read with node:zlib.
// Run: node scripts/import-sheet.mjs <file.xlsx|file.csv> [--ai=ChatGPT] [--dry]
//   writes one draft per AI company into content/drafts/ (the hourly cycle checks and publishes them),
//   prints every row it had to skip and why. --ai fills ai_company where the sheet leaves it empty. --dry only checks.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

export const COLUMNS = ["domain", "subtopic", "term", "level", "pronunciation_hi", "term_hi", "literal_hi", "literal_en", "meaning_hi", "meaning_en",
  "effect_hi", "effect_en", "flow1_hi", "flow1_en", "flow2_hi", "flow2_en", "flow3_hi", "flow3_en", "usage_hi", "usage_en",
  "example_hi", "example_en", "caution_hi", "caution_en", "related", "ai_company"];
const OPTIONAL = new Set(["term_hi", "ai_company", "pronunciation_hi"]);

// ---------- .xlsx: a zip of XML files. Reads the first sheet, shared and inline strings.
function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not an .xlsx file (no zip directory)");
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    p += 46 + nameLen + extra + comment;
  }
  return files;
}
const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const textOf = (xml) => unxml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export function readXlsx(buf) {
  const f = unzip(buf);
  const shared = f["xl/sharedStrings.xml"] ? [...f["xl/sharedStrings.xml"].toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const sheetName = Object.keys(f).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))[0];
  if (!sheetName) throw new Error("the .xlsx file has no sheet");
  const rows = [];
  for (const r of f[sheetName].toString("utf8").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? "", ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1], type = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const val = type === "s" ? shared[+v] ?? "" : type === "inlineStr" ? textOf(body) : v != null ? unxml(v) : "";
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows;
}

// ---------- CSV (comma or semicolon or tab, quotes allowed)
export function readCsv(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/)[0];
  const sep = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Sheet rows (first row = column names) -> { packets: [{ai_company, words}], skipped: [{row, reason}] } */
export function rowsToPackets(rows, { ai } = {}) {
  const head = (rows[0] ?? []).map((h) => String(h).trim().toLowerCase().replace(/\s+/g, "_"));
  const missing = COLUMNS.filter((c) => !OPTIONAL.has(c) && !head.includes(c));
  if (missing.length) throw new Error(`the first row must have the column names; missing: ${missing.join(", ")}`);
  const byCompany = new Map(), skipped = [];
  rows.slice(1).forEach((cells, i) => {
    const g = (k) => String(cells[head.indexOf(k)] ?? "").trim();
    if (!cells.some((x) => String(x).trim())) return; // empty line
    const empty = COLUMNS.filter((c) => !OPTIONAL.has(c) && !g(c));
    if (empty.length) { skipped.push({ row: i + 2, term: g("term"), reason: `empty: ${empty.join(", ")}` }); return; }
    const company = g("ai_company") || ai || "";
    if (!company) { skipped.push({ row: i + 2, term: g("term"), reason: "which AI wrote it? fill ai_company or use --ai=" }); return; }
    const pair = (k) => ({ hi: g(`${k}_hi`), en: g(`${k}_en`) });
    const word = {
      domain: g("domain").toLowerCase(), subtopic: g("subtopic").toLowerCase(), term: g("term"),
      level: g("level").toLowerCase() === "advanced" ? "advanced" : "basic", pronunciation_hi: g("pronunciation_hi"),
      term_hi: g("term_hi") && !/^(null|none|-)$/i.test(g("term_hi")) ? g("term_hi") : null,
      literal_meaning: pair("literal"), field_meaning: pair("meaning"), effect: pair("effect"),
      effect_flow: [pair("flow1"), pair("flow2"), pair("flow3")], usage: pair("usage"), example: pair("example"), caution: pair("caution"),
      related: g("related").split(/[;,|]/).map((x) => x.trim()).filter(Boolean),
    };
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push(word);
  });
  const packets = [...byCompany].map(([company, words]) => ({ format: "itmeans-draft-1", ai_company: company, ai_model: "", contributor: "", words }));
  return { packets, skipped };
}

export function readSheet(file) {
  const buf = fs.readFileSync(file);
  return /\.xlsx$/i.test(file) ? readXlsx(buf) : readCsv(buf.toString("utf8"));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) { console.error("usage: node scripts/import-sheet.mjs <file.xlsx|file.csv> [--ai=ChatGPT] [--dry]"); process.exit(2); }
  const ai = process.argv.find((a) => a.startsWith("--ai="))?.slice(5);
  const { packets, skipped } = rowsToPackets(readSheet(file), { ai });
  for (const s of skipped) console.log(`skipped row ${s.row} ${s.term ? `(${s.term}) ` : ""}- ${s.reason}`);
  const root = process.env.ITMEANS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const base = path.basename(file).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-");
  for (const p of packets) {
    const out = path.join(root, "content/drafts", `${base}-${p.ai_company.replace(/[^A-Za-z0-9]+/g, "")}.json`);
    if (!process.argv.includes("--dry")) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(p, null, 2) + "\n", "utf8"); }
    console.log(`${process.argv.includes("--dry") ? "would write" : "wrote"} ${p.words.length} words (${p.ai_company}) -> ${path.relative(root, out)}`);
  }
  if (!packets.length) console.log("no usable rows");
}
