// Wordmark builder: real font outlines (opentype.js) -> SVG paths, with the chakra as the dot of the i.
window.LAB = (() => {
  const V = "5.3.0";
  const fontUrl = (id, w) => `https://cdn.jsdelivr.net/npm/@fontsource/${id}@${V}/files/${id}-latin-${w}-normal.woff`;
  const cache = {};
  async function loadFont(id, w) {
    const k = id + w;
    if (!cache[k]) cache[k] = fetch(fontUrl(id, w)).then((r) => { if (!r.ok) throw new Error(r.status + " " + id + " " + w); return r.arrayBuffer(); }).then((b) => opentype.parse(b));
    return cache[k];
  }
  const contours = (cmds) => { const out = []; let cur = null; for (const c of cmds) { if (c.type === "M") { cur = []; out.push(cur); } if (cur) cur.push(c); } return out; };
  function bbox(cmds) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of cmds) for (const [a, b] of [["x", "y"], ["x1", "y1"], ["x2", "y2"]]) if (c[a] !== undefined) { x0 = Math.min(x0, c[a]); x1 = Math.max(x1, c[a]); y0 = Math.min(y0, c[b]); y1 = Math.max(y1, c[b]); }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  const pd = (cmds) => { const P = new opentype.Path(); P.commands = cmds; return P.toPathData(2); };
  const f2 = (n) => Math.round(n * 100) / 100;
  const circle = (cx, cy, r, rev) => `M${f2(cx - r)} ${f2(cy)}a${f2(r)} ${f2(r)} 0 1 ${rev ? 0 : 1} ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 ${rev ? 0 : 1} ${f2(-2 * r)} 0Z`;

  // chakra centred at cx,cy with outer radius R. o: {ring, hub, spoke, spokes} as fractions of R
  function chakra(cx, cy, R, o) {
    const ringIn = R * (1 - o.ring);
    let d = circle(cx, cy, R) + circle(cx, cy, ringIn, true);
    d += circle(cx, cy, R * o.hub);
    const n = o.spokes || 0, hw = (R * o.spoke) / 2;
    for (let k = 0; k < n; k++) {
      const a = (k * 2 * Math.PI) / n, ca = Math.cos(a), sa = Math.sin(a), px = -sa * hw, py = ca * hw;
      const r0 = R * o.hub * 0.6, r1 = ringIn + R * 0.02;
      const p = [[cx + ca * r0 + px, cy + sa * r0 + py], [cx + ca * r1 + px, cy + sa * r1 + py], [cx + ca * r1 - px, cy + sa * r1 - py], [cx + ca * r0 - px, cy + sa * r0 - py]];
      d += `M${p.map((q) => f2(q[0]) + " " + f2(q[1])).join("L")}Z`;
    }
    return d;
  }

  // returns {parts:{i,t,rest,dot}, box}
  async function build(id, w, o) {
    const font = await loadFont(id, w);
    const S = 100, sc = S / font.unitsPerEm;
    const text = [...(o.text || "ıtmeans")];
    const hasDotless = font.charToGlyphIndex("ı") > 0;
    const placed = []; let x = 0;
    text.forEach((ch, i) => {
      const g = ch === "ı" && !hasDotless ? font.charToGlyph("i") : font.charToGlyph(ch);
      if (i > 0) { const prev = placed[i - 1]; x += (font.getKerningValue(prev.g, g) || 0) * sc + (o.track || 0) * S + ((o.pairs || {})[prev.ch + ch] || 0) * S; }
      placed.push({ ch, g, x }); x += g.advanceWidth * sc;
    });
    const parts = { i: [], t: [], rest: [] };
    placed.forEach((P, k) => {
      let cmds = P.g.getPath(P.x, 0, S).commands;
      if (k === 0) { const cs = contours(cmds); if (cs.length > 1) { cs.sort((a, b) => bbox(a).y0 - bbox(b).y0); if (!hasDotless) cs.shift(); } parts.i.push(...cs.flat()); }
      else if (k === 1) parts.t.push(...cmds); else parts.rest.push(...cmds);
    });
    // the font's own i-dot, as the reference for size and gap
    const ics = contours(font.charToGlyph("i").getPath(0, 0, S).commands).map(bbox).sort((a, b) => a.y0 - b.y0);
    const fdot = ics[0], fstem = ics[ics.length - 1];
    const stem = bbox(parts.i), stemW = stem.w;
    const R = stemW * o.dotScale / 2;
    const gap = (fstem.y0 - fdot.y1) * (o.gapScale || 1);
    const cx = stem.cx + (o.dotDx || 0) * stemW, cy = stem.y0 - gap - R;
    const dot = chakra(cx, cy, R, o.chakra);
    const all = bbox([...parts.i, ...parts.t, ...parts.rest]);
    const box = { x0: Math.min(all.x0, cx - R), y0: Math.min(all.y0, cy - R), x1: Math.max(all.x1, cx + R), y1: all.y1 };
    box.w = box.x1 - box.x0; box.h = box.y1 - box.y0;
    return { parts: { i: pd(parts.i), t: pd(parts.t), rest: pd(parts.rest), dot }, box, stemW, xh: -stem.y0, R, font };
  }

  // colors: {i,t,rest,dot}
  function svg(m, colors, height, pad = 0) {
    const b = m.box, p = pad * b.h;
    const vb = [b.x0 - p, b.y0 - p, b.w + 2 * p, b.h + 2 * p].map(f2).join(" ");
    const W = f2((height * (b.w + 2 * p)) / (b.h + 2 * p));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${W}" height="${height}">` +
      `<path fill="${colors.i}" d="${m.parts.i}"/><path fill="${colors.t}" d="${m.parts.t}"/>` +
      (m.parts.rest ? `<path fill="${colors.rest}" d="${m.parts.rest}"/>` : "") +
      `<path fill="${colors.dot}" fill-rule="evenodd" d="${m.parts.dot}"/></svg>`;
  }
  return { build, svg, chakra, bbox };
})();
