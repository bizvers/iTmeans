// The fixed iTmeans video template (rules: .claude/skills/itmeans-video/SKILL.md).
// buildHtml(script, ctx) -> index.html text for a 45 s, 1080x1920 HyperFrames composition.
// ctx: { voiceDur: {id: seconds}, fontCss, brand } . Shots are files assets/shots/<shotId>.mp4 made by agent/video/make.mjs.

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const RAIL_TOP = 250, STEP = 1060 / 26, BEAT = 60 / 124;
export const T = { hook: [0, 3], w: [[3, 13], [13, 23], [23, 33]], take: [33, 38], outro: [38, 45] };
export const V = { hook: 0.15, w: [3.35, 13.35, 23.35], take: 33.0, outro: 39.4 };
export const LIMIT = { hook: 2.85, word: 9.4, take: 5.0, outro: 5.5 }; // longest allowed voice line (s)

const UI = {
  hi: { today: "आज के शब्द", remember: "याद रखिए", ok: "बाद में", law: "यह क़ानूनी सलाह नहीं है" },
  en: { today: "Today's words", remember: "Remember", ok: "After", law: "This is not legal advice" },
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function buildHtml(S, ctx) {
  const L = UI[S.lang], C = S.color, CL = S.colorLight ?? "#c9b8ff";
  const tw = [], media = [], audio = [], add = (s) => tw.push(s);
  let z = 1;
  const shot = (id, file, start, dur, style = "") =>
    media.push(`<div class="shot" id="${id}" style="z-index:${z++};${style}"><video id="${id}-v" class="clip" src="assets/shots/${file}.mp4" data-start="${start}" data-duration="${dur}" muted playsinline data-track-index="${z}"></video></div>`);
  const voice = (id, at) => audio.push(`<audio id="v-${id}" class="clip" src="assets/voice/${id}.wav" data-start="${at}" data-duration="${ctx.voiceDur[id].toFixed(2)}" data-volume="1" data-track-index="40"></audio>`);
  const push = (id, a, b, from = 1, to = 1.1) => add(`tl.fromTo("#${id}",{scale:${from}},{scale:${to},duration:${(b - a).toFixed(2)},ease:"none"},${a});`);
  const punch = (id, t) => add(`tl.fromTo("#${id}-v",{scale:1.0},{scale:1.05,duration:.12,ease:"power2.out",yoyo:true,repeat:1},${t.toFixed(2)});`);

  // captions: the spoken line in chunks of <= 5 words (break at । ? .), the word being said lit
  let capN = 0;
  const captions = (text, start, dur, until) => {
    const words = text.split(/\s+/).filter(Boolean), total = words.reduce((n, w) => n + w.length + 1, 0);
    const chunks = []; let cur = [];
    for (const w of words) { cur.push(w); if (cur.length === 5 || /[।?.!]$/.test(w)) { chunks.push(cur); cur = []; } }
    if (cur.length) chunks.push(cur);
    const at = (p) => +(start + dur * (p / total)).toFixed(2);
    let pos = 0, html = "";
    chunks.forEach((ch, i) => {
      const len = ch.reduce((n, w) => n + w.length + 1, 0), s0 = at(pos), s1 = i === chunks.length - 1 ? until : at(pos + len);
      const id = `cap${++capN}`; let p2 = pos;
      const spans = ch.map((w, j) => { const t = at(p2); p2 += w.length + 1;
        add(`tl.fromTo("#${id}-${j}",{backgroundColor:"rgba(0,0,0,0)"},{backgroundColor:"${C}",duration:.06},${t});`);
        if (!(i === chunks.length - 1 && j === ch.length - 1)) add(`tl.to("#${id}-${j}",{backgroundColor:"rgba(0,0,0,0)",duration:.08},${at(p2)});`);
        return `<span id="${id}-${j}">${esc(w)}</span>`; }).join(" ");
      html += `<p id="${id}" class="clip cap" data-start="${s0}" data-duration="${(s1 - s0).toFixed(2)}">${spans}</p>`;
      pos += len;
    });
    return html;
  };

  // a run of shots for one scene: first is the base; each next one comes in at its `at` by "wipe" or "cut"
  const sceneShots = (prefix, shots, a, b) => {
    const chips = [];
    shots.forEach((s, k) => {
      const id = `${prefix}-s${k}`, mode = k === 0 ? "base" : s.mode ?? "cut";
      shot(id, `${prefix}-${k}`, a, b - a + 0.2, mode === "wipe" ? "clip-path:inset(0 100% 0 0)" : mode === "cut" ? "opacity:0" : "");
      push(id, a, b, 1.0, s.zoom ?? 1.1);
      const t = a + (s.at ?? 0);
      if (mode === "wipe") {
        add(`tl.fromTo("#${id}",{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:.7,ease:"power2.inOut"},${t.toFixed(2)});`);
        add(`tl.fromTo("#${prefix}-bar",{x:0,opacity:1},{x:1080,duration:.7,ease:"power2.inOut"},${t.toFixed(2)});tl.set("#${prefix}-bar",{opacity:0},${(t + 0.75).toFixed(2)});`);
        punch(id, t + 0.7);
      }
      if (mode === "cut") {
        add(`tl.set("#${id}",{opacity:1},${t.toFixed(2)});`);
        for (let j = 0; j < k; j++) if ((shots[j].mode ?? "cut") === "cut" || j === 0) add(`tl.set("#${prefix}-s${j}",{opacity:0},${t.toFixed(2)});`);
        punch(id, t);
      }
      if (s.label) {
        chips.push(`<span class="chip ${s.tone ?? ""}" id="${prefix}-c${k}" style="left:120px;top:430px">${esc(s.label)}</span>`);
        add(`tl.set("#${prefix}-c${k}",{opacity:0},${a});tl.fromTo("#${prefix}-c${k}",{opacity:0,scale:.8},{opacity:1,scale:1,duration:.2,ease:"back.out(2)"},${(t + (mode === "wipe" ? 0.75 : 0.02)).toFixed(2)});`);
        const next = shots.slice(k + 1).find((n) => n.label);
        if (next) add(`tl.set("#${prefix}-c${k}",{opacity:0},${(a + next.at).toFixed(2)});`);
      }
      if (s.needle != null) add(`tl.to("#${prefix}-needle",{rotation:${s.needle},duration:.25,ease:"power3.out"},${t.toFixed(2)});`);
      if (s.meter != null) add(`tl.to("#${prefix}-knob",{x:${Math.round(s.meter * 640)},duration:.5,ease:"power2.inOut"},${t.toFixed(2)});`);
      if (s.track) add(`tl.to("#${prefix}-aud",{x:${s.track},duration:.6,ease:"power3.inOut"},${t.toFixed(2)});`);
    });
    return chips.join("") + `<i class="wbbar" id="${prefix}-bar"></i>`;
  };
  const extras = (prefix, w, a) => {
    let h = "";
    if (w.ring) { h += `<div class="huering" id="${prefix}-ring"><i id="${prefix}-needle"></i></div>`; add(`tl.fromTo("#${prefix}-ring",{opacity:0,scale:.5},{opacity:1,scale:1,duration:.35,ease:"back.out(2)"},${a + 2.6});`); }
    if (w.meter) h += `<div class="meter"><i id="${prefix}-knob"></i></div>`;
    if (w.timeline) h += `<div class="tline"><div class="trk"><span>${S.lang === "hi" ? "तस्वीर" : "Picture"}</span><b class="v1"></b><b class="v2"></b></div><div class="trk"><span>${S.lang === "hi" ? "आवाज़" : "Sound"}</span><b class="a1"></b><b class="a2" id="${prefix}-aud"></b></div></div>`;
    return h;
  };

  // HOOK
  const H = S.hook;
  shot("hk-a", "hk-0", 0, 3.2); push("hk-a", 0, 3, 1.02, 1.12);
  if (H.shots[1]) { shot("hk-b", "hk-1", 0, 3.2, "clip-path:inset(0 0 0 50%)"); push("hk-b", 0, 3, 1.02, 1.12); }
  voice("hook", V.hook);
  const hook = `<section id="hook" class="clip scene" data-start="0" data-duration="3">
  ${(H.labels ?? []).map((l, i) => `<span class="chip" style="${i ? "right:200px" : "left:120px"};top:430px">${esc(l)}</span>`).join("")}
  ${H.shots[1] ? `<i class="split"></i>` : ""}
  <h1 class="q" id="hook-q">${H.show.map(esc).join("<br>")}</h1></section>`;
  add(`tl.fromTo("#hook-q",{scale:1.06},{scale:1,duration:.35,ease:"power3.out"},0);`);

  // WORDS
  const scenes = S.words.map((w, i) => {
    const [a, b] = T.w[i], p = `w${i + 1}`, big = w.term.length > 10 ? 104 : 132;
    voice(p, V.w[i]);
    const vEnd = V.w[i] + ctx.voiceDur[p];
    const chips = sceneShots(p, w.shots, a, b);
    add(`tl.fromTo("#${p}-term",{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:.55,ease:"steps(${w.term.length})"},${a + 0.1});`);
    add(`tl.fromTo("#${p}-pron",{opacity:0,y:24},{opacity:1,y:0,duration:.25,ease:"power3.out"},${a + 0.7});`);
    add(`tl.fromTo("#${p}-mean",{opacity:0,x:-30},{opacity:1,x:0,duration:.3,ease:"power3.out"},${a + 1.3});`);
    add(`tl.to("#rail-mark",{y:${(AZ.indexOf(w.letter) * STEP).toFixed(1)},duration:.35,ease:"power3.inOut"},${a + 0.05});`);
    add(`tl.to("#az-${w.letter}",{color:"#ffffff",duration:.1},${a + 0.3});tl.to("#az-${w.letter}",{color:"rgba(255,255,255,.55)",duration:.1},${b - 0.1});`);
    add(`tl.fromTo("#bar${i}",{scaleX:0},{scaleX:1,duration:${b - a - 0.3},ease:"none"},${a + 0.15});`);
    return `<section id="${p}" class="clip scene" data-start="${a}" data-duration="${b - a}">
  ${chips}${extras(p, w, a)}
  <p class="kick">${i + 1} / 3${w.kind ? ` · ${esc(w.kind)}` : ""}</p>
  <h2 class="term" id="${p}-term" style="font-size:${big}px">${esc(w.term)}</h2>
  <p class="pron" id="${p}-pron">${esc(w.pron)}${w.literal ? ` <span>/ ${esc(w.literal)}</span>` : ""}</p>
  <p class="mean" id="${p}-mean">${esc(w.meaning)}</p>
  ${captions(w.say, V.w[i], ctx.voiceDur[p], Math.min(b, vEnd + 0.5))}</section>`;
  });

  // TAKEAWAY
  shot("tk-a", "tk-0", 33, 5.2); push("tk-a", 33, 38, 1.0, 1.15);
  voice("take", V.take);
  const take = `<section id="take" class="clip scene" data-start="33" data-duration="5">
  <p class="kick">${L.remember}</p>
  <ol class="steps">${S.takeaway.steps.map((s, i) => `<li id="tk-s${i}"><b>${i + 1}</b><span>${esc(s)}</span></li>`).join("")}</ol></section>`;
  S.takeaway.steps.forEach((_, i) => add(`tl.fromTo("#tk-s${i}",{opacity:0,x:-60},{opacity:1,x:0,duration:.3,ease:"power3.out"},${33.15 + i * 1.8});`));

  // OUTRO (fixed): paper page, the logo (ctx.logo = the site's itmeans-logo.svg) revealed letter by letter, the rail leafed through
  voice("outro", V.outro);
  const O = ctx.brand.outro[S.lang];
  const outro = `<section id="outro" class="clip scene" data-start="38" data-duration="7">
  <div class="mark" id="ot-mark">${ctx.logo}</div>
  <p class="o1" id="ot-1">${esc(O[0])}</p><p class="o2" id="ot-2">${esc(O[1])}</p><p class="o3" id="ot-3">${esc(O[2])}</p></section>`;
  add(`tl.fromTo("#ot-mark",{clipPath:"inset(0 100% 0 0)",scale:1.15},{clipPath:"inset(0 0% 0 0)",scale:1,duration:.5,ease:"steps(7)"},38.1);`);
  add(`tl.fromTo("#ot-1",{opacity:0,y:20},{opacity:1,y:0,duration:.3},39.3);tl.fromTo("#ot-2",{opacity:0,scale:.7},{opacity:1,scale:1,duration:.3,ease:"back.out(2.5)"},40.6);tl.fromTo("#ot-3",{opacity:0,y:20},{opacity:1,y:0,duration:.3},42.2);`);
  add(`tl.to("#ot-2",{scale:1.06,duration:${(BEAT / 2).toFixed(2)},yoyo:true,repeat:5,ease:"sine.inOut"},41.2);`);
  AZ.forEach((l, i) => add(`tl.fromTo("#az-${l}",{color:"rgba(255,255,255,.55)"},{color:"#ffffff",duration:.05},${(38.15 + i * 0.04).toFixed(2)});`));
  add(`tl.set("#railbg",{backgroundColor:"${C}"},38);tl.set("#rail-mark",{opacity:0},38);`);

  // music, ticks, wipes on every cut
  audio.push(`<audio id="m-bed" class="clip" src="assets/music/bed.wav" data-start="0" data-duration="38" data-volume="0.42" data-track-index="41"></audio>`);
  audio.push(`<audio id="m-sting" class="clip" src="assets/music/sting.wav" data-start="38" data-duration="2.6" data-volume="1" data-track-index="42"></audio>`);
  [3, 13, 23, 33, 38].forEach((t, i) => {
    audio.push(`<audio id="m-tick${i}" class="clip" src="assets/music/tick.wav" data-start="${t - 0.05}" data-duration="0.12" data-volume="0.6" data-track-index="43"></audio>`);
    add(`tl.fromTo("#wipe",{xPercent:-101},{xPercent:0,duration:.15,ease:"power2.in",immediateRender:${i === 0}},${t - 0.15});tl.to("#wipe",{xPercent:101,duration:.15,ease:"power2.out"},${t});`);
  });
  const law = S.domain === "law" ? `<div id="lawnote" class="clip lawnote" data-start="0" data-duration="38" data-track-index="36">${L.law}</div>` : "";

  return `<!doctype html>
<html lang="${S.lang}">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=1080, height=1920">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
${ctx.fontCss}
:root { --paper:#f6f1e6; --ink:#1b1a17; --acc:${C}; --acc-l:${CL}; }
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:1080px; height:1920px; overflow:hidden; background:#000; }
#root { position:relative; width:1080px; height:1920px; overflow:hidden; font-family:"Noto Sans Devanagari", sans-serif; color:#fff; background:#000; }
.shot { position:absolute; inset:0; }
.shot video { position:absolute; left:0; top:0; width:1080px; height:1920px; object-fit:cover; }
.shade { position:absolute; inset:0; z-index:30; background:linear-gradient(180deg, rgba(10,8,20,.55) 0, rgba(10,8,20,0) 380px, rgba(10,8,20,0) 620px, rgba(10,8,20,.78) 800px, rgba(10,8,20,.85) 1260px, rgba(10,8,20,.25) 1500px, rgba(10,8,20,.1) 1920px); }
.rail { position:absolute; left:0; top:${RAIL_TOP - 20}px; width:84px; height:1100px; z-index:31; background:rgba(10,8,20,.45); border-radius:0 18px 18px 0; }
.rail.letters { background:transparent; z-index:33; }
.rail b { position:absolute; left:0; width:84px; height:${STEP.toFixed(2)}px; display:grid; place-items:center; font:700 28px/1 "Space Grotesk"; color:rgba(255,255,255,.55); }
#railmk { z-index:32; }
#rail-mark { position:absolute; left:12px; top:${RAIL_TOP}px; width:60px; height:${STEP.toFixed(2)}px; border-radius:10px; background:var(--acc); }
.head { position:absolute; z-index:34; left:120px; width:760px; top:290px; display:flex; justify-content:space-between; font:600 32px/1.2 "Noto Sans Devanagari"; background:rgba(10,8,20,.6); padding:12px 18px 14px; border-radius:14px; }
.prog { position:absolute; z-index:34; left:120px; width:760px; top:368px; display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
.prog i { height:10px; border-radius:5px; background:rgba(255,255,255,.3); overflow:hidden; display:block; }
.prog i b { display:block; height:100%; background:var(--acc-l); transform-origin:left; }
.scene { position:absolute; inset:0; z-index:35; }
.q { position:absolute; left:120px; width:760px; top:800px; font:700 ${S.lang === "en" ? 88 : 96}px/1.2 "Noto Sans Devanagari"; text-shadow:0 4px 24px rgba(0,0,0,.4); }
.split { position:absolute; left:538px; top:380px; width:6px; height:460px; background:#fff; border-radius:3px; }
.chip { position:absolute; font:700 36px/1 "Noto Sans Devanagari"; background:#fff; color:var(--ink); border-radius:40px; padding:14px 26px 16px; box-shadow:0 6px 20px rgba(0,0,0,.3); }
.chip.ok { background:#1f9d5c; color:#fff; } .chip.warn { background:#d62828; color:#fff; }
.wbbar { position:absolute; left:-6px; top:0; width:8px; height:1920px; background:#fff; box-shadow:0 0 30px #fff; opacity:0; }
.huering { position:absolute; right:190px; top:420px; width:170px; height:170px; border-radius:50%; background:conic-gradient(from 0deg, #ff3b3b, #ffd23b, #3bff6a, #3bc3ff, #7a3bff, #ff3bd2, #ff3b3b); box-shadow:0 0 0 6px #fff, 0 10px 30px rgba(0,0,0,.4); }
.huering i { position:absolute; left:81px; top:12px; width:8px; height:73px; background:#fff; border-radius:4px; transform-origin:50% 100%; box-shadow:0 0 0 3px var(--ink); }
.meter { position:absolute; left:120px; width:690px; top:540px; height:16px; border-radius:8px; background:linear-gradient(90deg,#8d8d8d,#ff3bd2 70%,#ff2020); box-shadow:0 0 0 4px #fff; }
.meter i { position:absolute; left:-22px; top:-14px; width:44px; height:44px; border-radius:50%; background:#fff; box-shadow:0 0 0 6px var(--ink); }
.tline { position:absolute; left:120px; width:700px; top:520px; display:grid; gap:12px; background:rgba(10,8,20,.7); border-radius:18px; padding:18px; }
.trk { position:relative; height:54px; border-radius:10px; background:rgba(255,255,255,.12); }
.trk span { position:absolute; left:12px; top:12px; font:600 26px/1 "Noto Sans Devanagari"; color:rgba(255,255,255,.85); }
.trk b { position:absolute; top:8px; height:38px; border-radius:8px; }
.trk .v1 { left:150px; width:250px; background:#4f7cff; } .trk .v2 { left:404px; width:250px; background:#ffb547; }
.trk .a1 { left:150px; width:250px; background:rgba(79,124,255,.55); } .trk .a2 { left:404px; width:250px; background:rgba(255,181,71,.7); }
.kick { position:absolute; left:120px; top:720px; font:600 36px/1.2 "Noto Sans Devanagari"; color:rgba(255,255,255,.85); }
.term { position:absolute; left:120px; width:760px; top:766px; font-family:"Space Grotesk"; font-weight:700; line-height:1.05; letter-spacing:-.02em; white-space:nowrap; }
.pron { position:absolute; left:120px; width:760px; top:910px; font:700 ${S.lang === "en" ? 44 : 60}px/1.2 "Noto Sans Devanagari"; color:var(--acc-l); }
.pron span { color:rgba(255,255,255,.8); font-weight:400; font-size:${S.lang === "en" ? 34 : 42}px; }
.mean { position:absolute; left:120px; width:720px; top:1000px; font:600 42px/1.35 "Noto Sans Devanagari"; padding-left:28px; border-left:12px solid var(--acc-l); }
.cap { position:absolute; left:120px; width:740px; top:1150px; font:700 42px/1.5 "Noto Sans Devanagari"; }
.cap span { border-radius:8px; padding:0 6px; }
.steps { position:absolute; left:120px; width:740px; top:820px; list-style:none; display:grid; gap:36px; }
.steps li { display:flex; gap:28px; align-items:center; font:700 ${S.lang === "en" ? 56 : 64}px/1.25 "Noto Sans Devanagari"; text-shadow:0 3px 18px rgba(0,0,0,.5); }
.steps b { flex:none; width:96px; height:96px; border-radius:50%; background:var(--acc); color:#fff; display:grid; place-items:center; font:700 56px/1 "Space Grotesk"; }
.lawnote { position:absolute; z-index:36; left:120px; top:1290px; font:600 30px/1 "Noto Sans Devanagari"; color:rgba(255,255,255,.85); }
#outro { background:var(--paper); color:var(--ink); display:grid; align-content:center; justify-items:center; gap:46px; padding:0 160px 380px 120px; text-align:center; }
.mark { line-height:0; }
.mark svg { display:block; width:720px; height:auto; }
.o1 { font:600 50px/1.35 "Noto Sans Devanagari"; }
.o2 { font:700 56px/1 "Space Grotesk"; background:var(--acc); color:#fff; border-radius:60px; padding:28px 56px; }
.o3 { font:700 72px/1 "Space Grotesk"; color:var(--acc); }
#wipe { position:absolute; inset:0; background:var(--acc); }
#wipewrap { z-index:60; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="45" data-width="1080" data-height="1920">
  ${media.join("\n  ")}
  <div id="shade" class="clip shade" data-start="0" data-duration="38" data-track-index="30" data-layout-ignore></div>
  <div id="railbg" class="clip rail" data-start="0" data-duration="45" data-track-index="31" data-layout-ignore></div>
  <div id="railmk" class="clip" data-start="3" data-duration="35" data-track-index="32" data-layout-ignore><i id="rail-mark"></i></div>
  <div id="rail" class="clip rail letters" data-start="0" data-duration="45" data-track-index="33" data-layout-ignore>${AZ.map((l, i) => `<b id="az-${l}" style="top:${(20 + i * STEP).toFixed(1)}px">${l}</b>`).join("")}</div>
  <div id="head" class="clip head" data-start="0" data-duration="38" data-track-index="34"><span>${esc(S.path)}</span><span>${L.today}</span></div>
  <div id="prog" class="clip prog" data-start="3" data-duration="30" data-track-index="35">${[0, 1, 2].map((i) => `<i><b id="bar${i}"></b></i>`).join("")}</div>
  ${law}
  ${hook}
  ${scenes.join("\n  ")}
  ${take}
  ${outro}
  <div id="wipewrap" class="clip" data-start="2.8" data-duration="35.4" data-track-index="60" data-layout-ignore><div id="wipe"></div></div>
  ${audio.join("\n  ")}
</div>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
  ${tw.join("\n  ")}
  window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
}
