// Manual search check (needs a finished build: cd site; npm run build). Serves site/dist on a free port and queries
// Pagefind's real JS client from Node, once as a Hindi page (<html lang="hi">) and once as an English page.
// Run: node scripts/check-search.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site", "dist");
const types = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json", ".css": "text/css" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(dist, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const run = async (lang, queries) => {
  globalThis.document = { documentElement: { lang }, querySelector: () => ({ getAttribute: () => lang }) }; globalThis.location = { href: `http://localhost:${port}/${lang}/`, origin: `http://localhost:${port}`, pathname: `/${lang}/`, search: "" }; // Pagefind picks the language index from <html lang>
  const pf = await import(pathToFileURL(path.join(dist, "pagefind/pagefind.js")).href + "?" + lang);
  await pf.options({ basePath: `http://localhost:${port}/pagefind/`, baseUrl: "/" });
  for (const q of queries) {
    const r = await pf.search(q);
    const hits = await Promise.all(r.results.slice(0, 4).map((x) => x.data()));
    console.log(`[${lang}] ${JSON.stringify(q)} -> ${hits.length ? hits.map((h) => `${h.meta.term} (${h.url})`).join(" | ") : "NOTHING"}`);
  }
};
try {
  await run("hi", ["कैश", "सर्वर", "डेटा", "ए-पी-आई", "API", "cache", "api", "रंग", "रंगों", "तस्वीर", "cache सर्वर", "कलर", "हील", "फोटो", "layer", "लेयर", "आवाज़"]);
  await run("en", ["cache", "api", "server", "color", "database", "retouch", "layer", "Application programming interface", "caching", "zzzzzz"]);
} catch (e) { console.log("ERROR", e); }
server.close();
process.exit(0);




