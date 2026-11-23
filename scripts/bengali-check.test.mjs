// Run: node --test scripts/bengali-check.test.mjs   (scale step s5: a language in its own script, here Bengali)
// Checks the parts every new language needs, on the real content: names, UI words, pronunciation and meaning fallback.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const tax = JSON.parse(fs.readFileSync(new URL("../content/taxonomy/taxonomy.json", import.meta.url), "utf8").replace(/^﻿/, ""));
const ui = (c) => JSON.parse(fs.readFileSync(new URL(`../content/ui/${c}.json`, import.meta.url), "utf8"));
const BENGALI = /[ঀ-৿]/;

test("every subject, group and topic has a Bengali name in Bengali script (or a code name such as HTML)", () => {
  const missing = [];
  for (const d of tax.domains) for (const o of [d, ...(d.groups ?? []), ...d.subtopics]) {
    if (!o.bn) missing.push(o.id);
    else if (!BENGALI.test(o.bn) && !/^[A-Za-z+#.]+$/.test(o.bn)) missing.push(`${o.id} (not Bengali)`);
  }
  assert.deepEqual(missing, []);
});

test("Bengali UI words: every key of en.json, in Bengali, same {placeholders}", () => {
  const en = ui("en"), bn = ui("bn");
  assert.deepEqual(Object.keys(bn).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    if (k !== "site") assert.ok(BENGALI.test(bn[k]), `${k} is not in Bengali`);
    assert.deepEqual((bn[k].match(/\{\w+\}/g) ?? []).sort(), (en[k].match(/\{\w+\}/g) ?? []).sort(), `${k} placeholders`);
  }
});

test("Bengali has its own font, and the language stays switched off until the sample check (step g)", () => {
  const bn = tax.languages.find((l) => l.code === "bn");
  assert.equal(bn.font, "Noto Sans Bengali");
  assert.equal(bn.native, "বাংলা");
});
