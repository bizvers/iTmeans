// Tiny local server for the logo lab: serves this folder and saves exported files (POST /save) into ./out.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const port = Number(process.argv[3] || 4455);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".css": "text/css; charset=utf-8" };

http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (req.method === "POST" && u.pathname === "/save") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const { name, data, base64 } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!/^[\w.-]+$/.test(name)) throw new Error("bad name");
        const out = path.join(root, "out");
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, name), base64 ? Buffer.from(data, "base64") : data);
        res.end("ok");
      } catch (e) { res.statusCode = 400; res.end(String(e.message || e)); }
    });
    return;
  }
  let p = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
  if (!p.startsWith(root)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(p).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`logo lab on http://localhost:${port}`));
