// iTmeans signature music, made from code so it is entirely our own (no samples, no catalog track).
// Motif "i-T-mea-ns": four notes of Bhupali (Sa Re Ga Pa Dha) on a santoor-like plucked string,
// over a tanpura-like drone and a soft pulse. Writes bed.wav (38 s, under the voice) and sting.wav (2.5 s, outro).
// Run: node video/brand/music/make-signature.mjs [outDir]
import fs from "node:fs";
import path from "node:path";

const SR = 44100, BPM = 100, BEAT = 60 / BPM;
const SA = 293.66; // D4
const ratio = { Sa: 1, Re: 9 / 8, Ga: 5 / 4, Pa: 3 / 2, Dha: 5 / 3, Sa2: 2 };
const hz = (n, oct = 0) => SA * ratio[n] * 2 ** oct;
// the motif: Ga Pa Dha— Sa'—— (short, short, long, longest)
const MOTIF = [["Ga", 0.5], ["Pa", 0.5], ["Dha", 1], ["Sa2", 2]];

let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1; // deterministic noise

function buffer(sec) { return [new Float32Array(Math.ceil(sec * SR)), new Float32Array(Math.ceil(sec * SR))]; }

// Karplus-Strong string; two strikes slightly detuned = santoor's doubled strings
function pluck(buf, t, f, amp, pan = 0, decay = 0.9965) {
  for (const det of [1, 1.0025]) {
    const N = Math.round(SR / (f * det)); const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = rnd();
    const start = Math.floor(t * SR), len = Math.floor(3.2 * SR);
    let idx = 0;
    for (let i = 0; i < len && start + i < buf[0].length; i++) {
      const a = ring[idx], b = ring[(idx + 1) % N];
      ring[idx] = (a + b) * 0.5 * decay; idx = (idx + 1) % N;
      const s = a * amp * 0.5;
      buf[0][start + i] += s * (1 - pan) ; buf[1][start + i] += s * (1 + pan);
    }
  }
}

// tanpura-like drone: buzzy harmonics, slow swell, re-plucked every 4 beats
function drone(buf, from, to, amp) {
  const notes = [hz("Pa", -1), hz("Sa"), hz("Sa"), hz("Sa", -1)];
  let k = 0;
  for (let t = from; t < to; t += BEAT) {
    const f = notes[k++ % 4], s0 = Math.floor(t * SR), len = Math.floor(BEAT * 4 * SR);
    for (let i = 0; i < len && s0 + i < buf[0].length; i++) {
      const tt = i / SR, env = Math.min(1, tt / 0.05) * Math.exp(-tt * 0.7);
      let v = 0; for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * f * h * tt + h) / h ** 1.2;
      const s = v * env * amp * 0.25; buf[0][s0 + i] += s * 0.9; buf[1][s0 + i] += s * 1.1;
    }
  }
}

function kick(buf, t, amp) {
  const s0 = Math.floor(t * SR), len = Math.floor(0.35 * SR);
  for (let i = 0; i < len && s0 + i < buf[0].length; i++) {
    const tt = i / SR, f = 50 + 70 * Math.exp(-tt * 30);
    const s = Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 9) * amp; buf[0][s0 + i] += s; buf[1][s0 + i] += s;
  }
}
function shaker(buf, t, amp) {
  const s0 = Math.floor(t * SR), len = Math.floor(0.08 * SR); let lp = 0;
  for (let i = 0; i < len && s0 + i < buf[0].length; i++) {
    const n = rnd(); const hp = n - lp; lp = n; const s = hp * Math.exp(-(i / SR) * 60) * amp;
    buf[0][s0 + i] += s * 0.7; buf[1][s0 + i] += s * 1.3;
  }
}

function clap(buf, t, amp) {
  const s0 = Math.floor(t * SR), len = Math.floor(0.18 * SR); let lp = 0;
  for (let i = 0; i < len && s0 + i < buf[0].length; i++) {
    const tt = i / SR, n = rnd(); lp += (n - lp) * 0.5; const burst = tt < 0.03 ? (Math.floor(tt / 0.01) % 2 ? 0.6 : 1) : 1;
    const s = (n - lp) * Math.exp(-tt * 22) * amp * burst; buf[0][s0 + i] += s * 1.1; buf[1][s0 + i] += s * 0.9;
  }
}
function hat(buf, t, amp) {
  const s0 = Math.floor(t * SR), len = Math.floor(0.05 * SR); let p = 0;
  for (let i = 0; i < len && s0 + i < buf[0].length; i++) { const n = rnd(); const hp = n - p; p = n; const s = hp * Math.exp(-(i / SR) * 90) * amp; buf[0][s0 + i] += s * 0.8; buf[1][s0 + i] += s * 1.2; }
}
function bass(buf, t, f, d, amp) {
  const s0 = Math.floor(t * SR), len = Math.floor(d * SR);
  for (let i = 0; i < len && s0 + i < buf[0].length; i++) {
    const tt = i / SR, env = Math.min(1, tt / 0.005) * Math.min(1, (d - tt) / 0.03);
    const s = (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(4 * Math.PI * f * tt)) * env * amp; buf[0][s0 + i] += s; buf[1][s0 + i] += s;
  }
}
function dhol(buf, t, amp, f0) {
  const s0 = Math.floor(t * SR), len = Math.floor(0.3 * SR);
  for (let i = 0; i < len && s0 + i < buf[0].length; i++) {
    const tt = i / SR, f = f0 * (1 + 0.6 * Math.exp(-tt * 40));
    const s = (Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 12) + rnd() * 0.15 * Math.exp(-tt * 60)) * amp; buf[0][s0 + i] += s * 0.9; buf[1][s0 + i] += s * 1.1;
  }
}
function riser(buf, t, d) {
  const s0 = Math.floor(t * SR), len = Math.floor(d * SR); let lp = 0;
  for (let i = 0; i < len && s0 + i < buf[0].length; i++) { const x = i / len; const n = rnd(); lp += (n - lp) * (0.05 + 0.6 * x); const s = lp * x * x * 0.5; buf[0][s0 + i] += s; buf[1][s0 + i] += s; }
}

function motif(buf, t, amp, oct = 0) {
  let x = t; for (const [n, d] of MOTIF) { pluck(buf, x, hz(n, oct), amp, n === "Sa2" ? 0 : -0.2); x += d * BEAT; }
  return x;
}

function fade(buf, inS, outS) {
  const n = buf[0].length, a = inS * SR, b = outS * SR;
  for (let i = 0; i < n; i++) { const g = Math.min(1, i / a, (n - i) / b); buf[0][i] *= g; buf[1][i] *= g; }
}

function writeWav(file, buf) {
  let peak = 0; for (const ch of buf) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.89 / peak : 1, n = buf[0].length, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) { data.writeInt16LE(Math.round(Math.tanh(buf[0][i] * g) * 32767), i * 4); data.writeInt16LE(Math.round(Math.tanh(buf[1][i] * g) * 32767), i * 4 + 2); }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28);
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

const out = process.argv[2] ?? path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
fs.mkdirSync(out, { recursive: true });

// bed: 38 s, upbeat (124 BPM, the FAST beat): four-on-the-floor kick, clap on 2 and 4, 16th hats,
// a dhol figure, a Sa-Pa bassline and the santoor motif as the hook every 2 bars
const FB = 60 / 124;
const bed = buffer(38);
drone(bed, 0, 38, 0.18);
const bassNotes = ["Sa", "Sa", "Pa", "Ga"];
for (let bar = 0, t = 0; t < 37.5; bar++, t += FB * 4) {
  for (let b = 0; b < 4; b++) {
    const x = t + b * FB; if (x > 37.6) break;
    kick(bed, x, 0.9);
    if (b % 2 === 1) clap(bed, x, 0.45);
    for (let s = 0; s < 4; s++) hat(bed, x + s * FB / 4, s === 2 ? 0.16 : 0.07);
    bass(bed, x + FB / 2, hz(bassNotes[bar % 4], -2), FB * 0.45, 0.55);
  }
  // dhol: ta - dhi-na on the last beat of every bar
  dhol(bed, t + FB * 3, 0.5, 110); dhol(bed, t + FB * 3.5, 0.35, 160); dhol(bed, t + FB * 3.75, 0.3, 160);
  if (bar % 2 === 0) { let x = t; for (const [n, d] of MOTIF) { pluck(bed, x, hz(n, 1), 0.42, -0.15); x += d * FB / 2; } }
  else { const arp = ["Sa2", "Dha", "Pa", "Ga", "Pa", "Dha", "Sa2", "Dha"]; arp.forEach((n, i) => pluck(bed, t + i * FB / 2, hz(n, n === "Sa2" ? 0 : 1), 0.18, 0.25)); }
}
riser(bed, 36, 2);
fade(bed, 0.02, 0.3);
writeWav(path.join(out, "bed.wav"), bed);

// sting: the full motif, strong, with a low Sa underneath and a final shimmer
const st = buffer(2.6);
kick(st, 0, 0.6);
const end = motif(st, 0.02, 0.9);
pluck(st, 0.02, hz("Sa", -1), 0.6, 0, 0.998);
pluck(st, end - 2 * BEAT, hz("Sa2", 1), 0.3, 0.4);
drone(st, 0, 2.6, 0.35);
fade(st, 0.005, 0.6);
writeWav(path.join(out, "sting.wav"), st);

// tick: the one transition sound
const tk = buffer(0.12);
pluck(tk, 0, hz("Sa2", 1), 0.5, 0, 0.98);
fade(tk, 0.001, 0.06);
writeWav(path.join(out, "tick.wav"), tk);
console.log("wrote bed.wav, sting.wav, tick.wav to", out);
