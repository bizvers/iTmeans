// Fetches the site's fonts (Google Fonts, open licence) as local woff2 files + a fonts.css that points at them,
// so renders never depend on the network. Only the Devanagari and Latin subsets are kept.
// Run: node video/brand/fonts/get-fonts.mjs <outDir>
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2]; if (!out) { console.error("usage: get-fonts.mjs <outDir>"); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const url = "https://fonts.googleapis.com/css2?family=Rozha+One&family=Space+Grotesk:wght@500;700&family=Noto+Sans+Devanagari:wght@400;600;700&display=block";
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const css = await (await fetch(url, { headers: { "User-Agent": ua } })).text();
const blocks = css.split(/(?=\/\* )/).filter((b) => /\/\* (devanagari|latin) \*\//.test(b));
let local = "", n = 0;
for (const b of blocks) {
  const fam = /font-family: '([^']+)'/.exec(b)[1], w = /font-weight: (\d+)/.exec(b)[1], sub = /\/\* (\w+) \*\//.exec(b)[1];
  const src = /url\((https:[^)]+)\)/.exec(b)[1];
  const name = `${fam.replace(/\s+/g, "")}-${w}-${sub}.woff2`;
  fs.writeFileSync(path.join(out, name), Buffer.from(await (await fetch(src)).arrayBuffer()));
  local += b.replace(src, `assets/fonts/${name}`); n++;
}
fs.writeFileSync(path.join(out, "fonts.css"), local);
console.log(`saved ${n} font files to ${out}`);
