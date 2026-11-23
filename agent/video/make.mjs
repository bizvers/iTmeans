// Makes one iTmeans video from a script file (rules: .claude/skills/itmeans-video/SKILL.md).
//   node --env-file=.env agent/video/make.mjs content/videos/<date>/<lang>--<domain>--<subtopic>.json [--no-render]
// Steps: code check -> footage (Mixkit, Free licence only, cached) -> shots with real effects (ffmpeg) -> voice (Gemini, cached)
// -> index.html from video/template -> hyperframes check -> render to video/out/<date>/<key>.mp4.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildHtml, LIMIT } from "../../video/template/build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const R = (...p) => path.join(ROOT, ...p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const BRAND = readJson(R("video/brand/brand.json"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 1 << 26, ...opts });

// ---------- 1. code check (SKILL.md §10, the parts code can see)
export function checkScript(S) {
  const errs = [], need = (ok, m) => { if (!ok) errs.push(m); };
  need(["hi", "en"].includes(S.lang), "lang must be hi or en");
  const art = readJson(R(S.article));
  need(art.status === "published", "article is not published");
  need(art.domain === S.domain && art.subtopic === S.subtopic, "article topic does not match");
  need(S.words?.length === 3 && S.words.every((w, i) => w.id === art.words[i]), "the three words must be the article's words, in order");
  const dir = R("content/words", S.domain, S.subtopic);
  const byId = Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(dir, f))).map((w) => [w.id, w]));
  for (const w of S.words ?? []) {
    const f = byId[w.id];
    need(f?.status === "published", `word ${w.id} not published`);
    if (!f) continue;
    need(w.term === f.term, `${w.id}: term must be "${f.term}"`);
    const fm = f.field_meaning?.[S.lang];
    need(!!fm, `${w.term}: no field_meaning.${S.lang} in the word file (English videos need all three)`);
    need(w.meaning === fm, `${w.term}: meaning must be the word file's field_meaning.${S.lang}`);
    need(Array.isArray(w.shots) && w.shots.length >= 1, `${w.term}: needs at least one shot`);
    const n = w.say.split(/\s+/).length; need(n >= 12 && n <= 30, `${w.term}: spoken line has ${n} words (12–30)`);
  }
  const kinds = new Set((S.words ?? []).map((w) => (w.shots?.length > 1 ? w.shots[1].mode ?? "cut" : "single") + (w.ring ? "r" : "") + (w.meter ? "m" : "") + (w.timeline ? "t" : "")));
  need(kinds.size >= 2, "use at least two different visualisations across the three words");
  const all = [S.hook.say, ...S.words.map((w) => w.say), S.takeaway.say].join(" ");
  if (S.lang === "en") need(!/[ऀ-ॿ]/.test(all), "English video must not have Devanagari in spoken text");
  if (S.domain === "law") need(!/\b(section|article|rule|धारा|अनुच्छेद)\s*\d+/i.test(all), "law: no section/article numbers");
  need(S.hook.show.every((l) => l.split(/\s+/).length <= 5), "hook lines: at most 5 words each");
  return errs;
}

// ---------- 2. footage: Mixkit, Free licence only
async function retry(fn, n = 4) { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= n - 1) throw e; await sleep(3000 * (i + 1)); } } }
// slug = the clip's Mixkit page name, e.g. "hotel-room-with-breakfast-served-4019"
async function mixkit(slug) {
  const id = /-(\d+)$/.exec(slug)?.[1]; if (!id) throw new Error(`clip "${slug}" must be a Mixkit page name ending in its number`);
  const out = R("video/cache/mixkit", `${id}.mp4`), meta = out.replace(/\.mp4$/, ".json");
  if (fs.existsSync(out) && fs.existsSync(meta)) return out;
  const page = `https://mixkit.co/free-stock-video/${slug}/`;
  const html = await retry(async () => (await fetch(page)).text());
  const lic = /"copyrightNotice":"([^"]+)"/.exec(html)?.[1] ?? "";
  if (!/Free/.test(lic)) throw new Error(`Mixkit ${id}: licence is "${lic || "unknown"}", only Free licence clips may be used`);
  const url = `https://assets.mixkit.co/videos/${id}/${id}-720.mp4`;
  const data = await retry(async () => { const res = await fetch(url); if (!res.ok) throw new Error(`Mixkit ${id}: download HTTP ${res.status}`); return Buffer.from(await res.arrayBuffer()); });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, data);
  fs.writeFileSync(meta, JSON.stringify({ id, page, licence: lic, url, fetched: new Date().toISOString() }, null, 1));
  return out;
}

const GRADE = {
  none: "null", warm: "colorbalance=rs=.28:gs=.06:bs=-.38:rm=.22:gm=.04:bm=-.32:rh=.12:bh=-.22",
  cool: "colorbalance=rs=-.3:gs=-.02:bs=.35:rm=-.22:bm=.3:rh=-.12:bh=.2",
};
function gradeFilter(g = "none") {
  if (GRADE[g]) return GRADE[g];
  let m;
  if ((m = /^hue:(-?\d+)$/.exec(g))) return `hue=h=${m[1]}`;
  if ((m = /^sat:([\d.]+)$/.exec(g))) return `hue=s=${m[1]}`;
  if ((m = /^bright:(-?[\d.]+)$/.exec(g))) return `eq=brightness=${m[1]}:contrast=${1 + Math.abs(+m[1]) * 0.6}`;
  if ((m = /^gamma:([\d.]+)$/.exec(g))) return `eq=gamma=${m[1]}`;
  throw new Error(`unknown grade "${g}"`);
}
// one vertical shot: crop a 9:16 window (x = 0..1 across the frame), grade, optional jump (cut out a middle part)
function makeShot(src, s, dur, out) {
  const crop = `crop=ih*9/16:ih:(iw-ih*9/16)*${s.x ?? 0.5}:0,scale=1080:1920:flags=lanczos,fps=30,setsar=1,${gradeFilter(s.grade)}`;
  const enc = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", out];
  if (s.jump) { // [[start,len],[start,len]] joined back to back: the picture visibly jumps
    const parts = s.jump.map(([a, l], i) => `[0:v]trim=start=${a}:duration=${l},setpts=PTS-STARTPTS,${crop}[p${i}]`).join(";");
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-filter_complex", `${parts};${s.jump.map((_, i) => `[p${i}]`).join("")}concat=n=${s.jump.length}:v=1[v]`, "-map", "[v]", "-t", String(dur), ...enc]);
  } else run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-stream_loop", "-1", "-ss", String(s.ss ?? 0), "-t", String(dur), "-i", src, "-vf", crop, ...enc]);
}

// ---------- 3. voice: Gemini TTS (key from .env / secrets, never printed), cached by text
let lastCall = 0;
const dayOut = new Set(); // voice models whose free daily limit (10 lines) is spent
async function tts(text, lang, out, extraStyle = "") {
  const v = BRAND.voice, hash = crypto.createHash("sha1").update([v.model, v.name, v.style[lang], text].join("|")).digest("hex").slice(0, 16);
  const cache = extraStyle ? out : R("video/cache/voice", `${hash}.wav`);
  if (!fs.existsSync(cache)) {
    const key = process.env.GEMINI_API_KEY; if (!key) throw new Error("GEMINI_API_KEY is not set (.env / GitHub secret)");
    for (let attempt = 0; ; attempt++) {
      const model = (v.models ?? [v.model]).find((m) => !dayOut.has(m));
      if (!model) throw new Error("Gemini TTS: today's free limit is used up on every voice model (resets after midnight Pacific time)");
      const wait = lastCall + 21000 - Date.now(); if (wait > 0) await sleep(wait); // free tier: 3 a minute
      lastCall = Date.now();
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${v.style[lang]}${extraStyle} ${text}` }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v.name } } } } }),
      });
      if (res.status === 429) {
        const body = await res.text();
        if (/PerDay/.test(body)) { dayOut.add(model); continue; } // this model's daily free limit is spent: try the next one
        if (attempt < 4) { await sleep(35000); continue; }
      }
      if (!res.ok) throw new Error(`Gemini TTS HTTP ${res.status}`);
      const b64 = (await res.json()).candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (!b64) throw new Error("Gemini TTS returned no audio");
      const pcm = Buffer.from(b64, "base64"), h = Buffer.alloc(44), sr = 24000;
      h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
      h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
      h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
      fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, Buffer.concat([h, pcm]));
      break;
    }
  }
  if (cache !== out) fs.copyFileSync(cache, out);
  const b = fs.readFileSync(out); return b.readUInt32LE(40) / b.readUInt32LE(28);
}

// All of a video's new lines in ONE request (the free limit is 10 requests a day per model), then cut at the pauses.
// Falls back to one request per line when the pauses cannot be found cleanly.
async function ttsBatch(lines, lang, dir) {
  const v = BRAND.voice, cached = (t) => R("video/cache/voice", crypto.createHash("sha1").update([v.model, v.name, v.style[lang], t].join("|")).digest("hex").slice(0, 16) + ".wav");
  const todo = lines.filter(([, t]) => !fs.existsSync(cached(t)));
  if (todo.length > 1) {
    const joined = R("video/cache/voice", `batch-${Date.now()}.wav`);
    try {
      await tts(todo.map(([, t]) => t).join("\n\n...\n\n"), lang, joined, " Read each paragraph, then stay completely silent for two full seconds before the next paragraph:");
      const text = spawnSync("ffmpeg", ["-hide_banner", "-i", joined, "-af", "silencedetect=noise=-38dB:d=0.75", "-f", "null", "-"], { encoding: "utf8" }).stderr ?? "";
      const sil = [...text.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
      const total = fs.readFileSync(joined).readUInt32LE(40) / fs.readFileSync(joined).readUInt32LE(28);
      const gaps = sil.filter(([a, b]) => a > 0.2 && b < total - 0.2).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, todo.length - 1).sort((x, y) => x[0] - y[0]);
      if (gaps.length === todo.length - 1) {
        let start = 0;
        todo.forEach(([, t], i) => {
          const end = i < gaps.length ? gaps[i][0] + 0.12 : total;
          run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", joined, "-ss", String(Math.max(0, start - 0.08)), "-to", String(end), "-af", "silenceremove=start_periods=1:start_threshold=-45dB", "-c:a", "pcm_s16le", cached(t)]);
          if (i < gaps.length) start = gaps[i][1];
        });
      }
    } catch (e) { if (/free limit/.test(e.message)) throw e; }
  }
  const dur = {};
  for (const [id, t] of lines) dur[id] = await tts(t, lang, path.join(dir, `${id}.wav`)); // cached lines are just copied
  return dur;
}

// ---------- main
export async function makeVideo(file, { render = true } = {}) {
  const S = readJson(path.resolve(file));
  const errs = checkScript(S);
  if (errs.length) throw new Error("script check failed:\n - " + errs.join("\n - "));
  const [c, cl] = BRAND.colors[S.domain] ?? ["#5b34c4", "#c9b8ff"]; S.color ??= c; S.colorLight ??= cl;
  const key = path.basename(file, ".json"), work = R("video/work", S.date, key), A = (...p) => path.join(work, "assets", ...p);
  for (const d of ["shots", "voice", "music", "fonts"]) fs.mkdirSync(A(d), { recursive: true });
  fs.writeFileSync(path.join(work, "hyperframes.json"), fs.readFileSync(R("video/template/hyperframes.json")));
  fs.writeFileSync(path.join(work, "meta.json"), JSON.stringify({ id: key, name: key }, null, 2));

  // brand: music + fonts (made once, copied)
  if (!fs.existsSync(R("video/brand/music/out/bed.wav"))) run("node", [R("video/brand/music/make-signature.mjs"), R("video/brand/music/out")]);
  for (const f of ["bed.wav", "sting.wav", "tick.wav"]) fs.copyFileSync(R("video/brand/music/out", f), A("music", f));
  if (!fs.existsSync(R("video/brand/fonts/files/fonts.css"))) run("node", [R("video/brand/fonts/get-fonts.mjs"), R("video/brand/fonts/files")]);
  for (const f of fs.readdirSync(R("video/brand/fonts/files"))) fs.copyFileSync(R("video/brand/fonts/files", f), A("fonts", f));

  // footage -> shots
  const credits = new Map();
  const doShots = async (prefix, list, dur) => { for (const [k, s] of list.entries()) { const src = await mixkit(s.clip); credits.set(s.clip, readJson(src.replace(/\.mp4$/, ".json")).page); makeShot(src, s, dur, A("shots", `${prefix}-${k}.mp4`)); } };
  await doShots("hk", S.hook.shots, 3.4);
  for (const [i, w] of S.words.entries()) await doShots(`w${i + 1}`, w.shots, 10.4);
  await doShots("tk", [S.takeaway.shot], 5.4);

  // voice
  const lines = [["hook", S.hook.say], ...S.words.map((w, i) => [`w${i + 1}`, w.say]), ["take", S.takeaway.say], ["outro", BRAND.outroSay[S.lang]]];
  const voiceDur = await ttsBatch(lines, S.lang, A("voice"));
  const over = [["hook", LIMIT.hook], ["w1", LIMIT.word], ["w2", LIMIT.word], ["w3", LIMIT.word], ["take", LIMIT.take], ["outro", LIMIT.outro]].filter(([id, l]) => voiceDur[id] > l);
  if (over.length) throw new Error("spoken line too long for its slot (shorten the script): " + over.map(([id, l]) => `${id} ${voiceDur[id].toFixed(1)}s > ${l}s`).join(", "));

  fs.writeFileSync(path.join(work, "index.html"), buildHtml(S, { voiceDur, fontCss: fs.readFileSync(A("fonts", "fonts.css"), "utf8"), brand: BRAND }));
  fs.writeFileSync(path.join(work, "credits.json"), JSON.stringify([...credits].map(([id, page]) => ({ id, page, licence: "Mixkit Stock Video Free License" })), null, 1));
  console.log(`built ${work}`);
  if (!render) return work;

  const outFile = R("video/out", S.date, `${key}.mp4`); fs.mkdirSync(path.dirname(outFile), { recursive: true });
  run("npx", ["--yes", "hyperframes@0.9.86", "render", "-o", outFile], { cwd: work, shell: true, stdio: ["ignore", "inherit", "inherit"] });
  console.log(`rendered ${outFile}`);
  return outFile;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: node --env-file=.env agent/video/make.mjs <script.json> [--no-render]"); process.exit(2); }
  makeVideo(file, { render: !process.argv.includes("--no-render") }).catch((e) => { console.error(e.message); process.exit(1); });
}
