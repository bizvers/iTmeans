// Run: node --test scripts/import-sheet.test.mjs   (builds a small .xlsx in memory; no files, no network)
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { COLUMNS, readXlsx, readCsv, rowsToPackets } from "./import-sheet.mjs";

/** Minimal zip writer (deflate) — enough to make an .xlsx like Excel/Google Sheets do. */
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = zlib.deflateRawSync(Buffer.from(text, "utf8")), n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); centrals.push(ch, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const col = (i) => String.fromCharCode(65 + (i % 26)).padStart(i >= 26 ? 2 : 1, "A"); // A..Z, AA..AZ
const row = (r, vals) => vals.map((v, i) => `<c r="${col(i)}${r}" t="inlineStr"><is><t>${v.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></is></c>`).join("");

const values = { domain: "web-development", subtopic: "frontend", term: "Flexbox", level: "basic", pronunciation_hi: "फ़्लेक्सबॉक्स", term_hi: "null",
  literal_hi: "लचीला डिब्बा।", literal_en: "A flexible box.", meaning_hi: "चीज़ें एक लाइन में सजाने का तरीका।", meaning_en: "A way to lay items out in a row.",
  effect_hi: "पन्ना हर स्क्रीन पर ठीक दिखता है।", effect_en: "The page fits every screen.", flow1_hi: "डिब्बा बना", flow1_en: "Box made", flow2_hi: "चीज़ें सजीं", flow2_en: "Items placed",
  flow3_hi: "स्क्रीन पर फिट", flow3_en: "Fits the screen", usage_hi: "मेनू में।", usage_en: "In menus.", example_hi: "ऊपर की पट्टी।", example_en: "A top bar.",
  caution_hi: "पुराने ब्राउज़र।", caution_en: "Old browsers.", related: "Grid; Media query", ai_company: "ChatGPT" };

test("reads an .xlsx (inline and shared strings) and makes one draft per AI company", () => {
  const sheet = `<worksheet><sheetData><row r="1">${row(1, COLUMNS)}</row><row r="2">${row(2, COLUMNS.map((c) => values[c]))}</row>`
    + `<row r="3"><c r="A3" t="s"><v>0</v></c><c r="C3" t="s"><v>1</v></c></row></sheetData></worksheet>`;
  const buf = zip({ "xl/sharedStrings.xml": "<sst><si><t>web-development</t></si><si><r><t>Half</t></r><r><t> row</t></r></si></sst>", "xl/worksheets/sheet1.xml": sheet });
  const rows = readXlsx(buf);
  assert.equal(rows[1][2], "Flexbox"); assert.equal(rows[2][2], "Half row");
  const { packets, skipped } = rowsToPackets(rows);
  assert.equal(packets.length, 1); assert.equal(packets[0].ai_company, "ChatGPT"); assert.equal(packets[0].format, "itmeans-draft-1");
  const w = packets[0].words[0];
  assert.equal(w.term_hi, null); assert.deepEqual(w.related, ["Grid", "Media query"]); assert.equal(w.effect_flow[2].en, "Fits the screen");
  assert.equal(skipped.length, 1); assert.match(skipped[0].reason, /empty/);
});

test("CSV with quotes and commas; --ai fills a missing company; a sheet without column names is refused", () => {
  const cols = COLUMNS.filter((c) => c !== "ai_company");
  const csv = "﻿" + cols.join(",") + "\n" + cols.map((c) => (c === "related" ? '"Grid, Media query"' : `"${values[c]}"`)).join(",") + "\n";
  const { packets } = rowsToPackets(readCsv(csv), { ai: "Gemini" });
  assert.equal(packets[0].ai_company, "Gemini"); assert.deepEqual(packets[0].words[0].related, ["Grid", "Media query"]);
  assert.throws(() => rowsToPackets([["a", "b"], ["1", "2"]]), /missing/);
});
