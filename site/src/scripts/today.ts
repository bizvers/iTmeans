// "Today's words" in the browser: the reader's subjects (kept in this browser, and in the account when signed in),
// word of the day (flip card) and today's question from those subjects, word pop-ups and reading progress on a story.
import { getAccount } from "../lib/account";

const KEY = "itmeans-subjects";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
type S = { k: string; d: string; c: string; dn: string; t: string; u: string; lede: string; m: string; w: [string, string, string][] };

// ---------------------------------------------------------------- day page
const dataEl = $("td-data");
if (dataEl && $("td-mine")) {
  const { stories, i18n } = JSON.parse(dataEl.textContent || "{}") as { stories: S[]; i18n: Record<string, string> };
  const all = [...new Set(stories.map((s) => s.d))];
  const date = (document.querySelector(".td") as HTMLElement)?.dataset.date ?? "";
  const seed = [...date].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  let saved: string[] | null = null;
  try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (Array.isArray(v)) saved = v; } catch {}
  let sel = new Set(saved ?? all);

  const apply = () => {
    const mine = $("td-mine")!;
    mine.classList.toggle("first", saved === null);
    mine.querySelector("b")!.textContent = saved === null ? i18n.pick : i18n.mine;
    document.querySelectorAll<HTMLElement>("[data-subj]").forEach((el) => {
      const k = el.dataset.subj!;
      if (el.classList.contains("td-chip")) { if (k === "*") el.textContent = sel.size ? i18n.none : i18n.all; else el.setAttribute("aria-pressed", String(sel.has(k))); }
      else el.hidden = !sel.has(k);
    });
    const mineStories = stories.filter((s) => sel.has(s.d));
    $("td-none")!.hidden = mineStories.length > 0;
    $("td-wod")!.hidden = !mineStories.length;
    $("td-quiz")!.hidden = !mineStories.length;
    if (!mineStories.length) return;
    // word of the day: one of the reader's stories, the same all day
    const h = mineStories[seed % mineStories.length];
    const wod = $("td-wod")!;
    wod.className = `td-wod ${h.c}`;
    $("td-wm")!.textContent = h.m; $("td-wtag")!.textContent = `${i18n.wordOfDay} · ${h.dn}`;
    $("td-wword")!.textContent = h.w[0][0]; $("td-whi")!.textContent = h.w[0][1]; $("td-wmean")!.textContent = h.w[0][2];
    $("td-wtitle")!.textContent = h.t; $("td-wlede")!.textContent = h.lede; $<HTMLAnchorElement>("td-wopen")!.href = h.u;
    setFlip(false);
    // today's question: the meaning of a word from another of the reader's stories; wrong answers from other stories
    const q = mineStories[(seed + 1) % mineStories.length], word = q.w[q.w.length - 1];
    const wrong = stories.filter((s) => s.k !== q.k).map((s) => s.w[1][2]).filter((m) => m && m !== word[2]);
    const opts = [word[2], wrong[seed % Math.max(1, wrong.length)], wrong[(seed + 3) % Math.max(1, wrong.length)]].filter((x, i, a) => x && a.indexOf(x) === i);
    const order = opts.map((t, i) => ({ t, ok: i === 0, r: (seed >> i) & 7 })).sort((a, b) => a.r - b.r);
    $("td-quiz")!.className = `td-quiz ${q.c}`;
    $("td-qh")!.textContent = `"${word[0]}" ${i18n.q}`;
    const box = $("td-opts")!;
    box.innerHTML = "";
    for (const o of order) {
      const b = document.createElement("button"); b.type = "button"; b.className = "td-opt"; b.textContent = o.t;
      b.addEventListener("click", () => {
        box.querySelectorAll(".td-opt").forEach((x) => x.classList.remove("right", "wrong"));
        b.classList.add(o.ok ? "right" : "wrong");
        const msg = $("td-qmsg")!; msg.textContent = "";
        if (o.ok) { msg.append(`${i18n.correct} `); const a = document.createElement("a"); a.href = q.u; a.textContent = q.t; msg.append(a); }
        else msg.textContent = i18n.tryAgain;
      });
      box.appendChild(b);
    }
    $("td-qmsg")!.textContent = "";
  };

  let acc: Awaited<ReturnType<typeof getAccount>> = null, signedIn = false;
  const save = () => {
    saved = [...sel];
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {}
    if (acc && signedIn) acc.setPrefs({ subjects: saved }).catch(() => {});
  };
  document.querySelectorAll<HTMLButtonElement>(".td-chip").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.subj!;
    if (k === "*") sel = sel.size ? new Set() : new Set(all);
    else if (sel.has(k)) sel.delete(k); else sel.add(k);
    save(); apply();
  }));

  const flip = $("td-flip")!;
  function setFlip(on: boolean) {
    flip.classList.toggle("on", on);
    $("td-flipbtn")!.setAttribute("aria-expanded", String(on));
    flip.querySelector(".back")!.setAttribute("aria-hidden", String(!on));
    flip.querySelector(".front")!.setAttribute("aria-hidden", String(on));
    $("td-flipback")!.tabIndex = on ? 0 : -1; $("td-flipbtn")!.tabIndex = on ? -1 : 0;
  }
  $("td-flipbtn")!.addEventListener("click", () => setFlip(true));
  $("td-flipback")!.addEventListener("click", () => setFlip(false));
  apply();

  // signed in: the account's choice wins (same subjects on every device); a first choice made here is copied up
  getAccount().then((a) => {
    acc = a;
    a?.onUser(async (u) => {
      signedIn = !!u;
      if (!u) return;
      try {
        const p = await a.getPrefs();
        if (Array.isArray(p.subjects)) { saved = p.subjects; sel = new Set(p.subjects); try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {} apply(); }
        else if (saved) await a.setPrefs({ subjects: saved });
      } catch { /* rules not published yet or offline: this browser's choice still works */ }
    });
  });
}

// ---------------------------------------------------------------- story page
const wordsEl = $("td-words");
if (wordsEl) {
  const words = JSON.parse(wordsEl.textContent || "[]") as [string, string, string][];
  let pop: HTMLDivElement | null = null;
  const close = () => { pop?.remove(); pop = null; };
  const show = (a: HTMLElement) => {
    close();
    const w = words[+(a.dataset.i ?? 0)]; if (!w) return;
    pop = document.createElement("div"); pop.className = "td-pop"; pop.setAttribute("role", "tooltip");
    const b = document.createElement("b"); b.textContent = w[0];
    const i = document.createElement("i"); i.textContent = w[1];
    pop.append(b, i, w[2]);
    document.body.appendChild(pop);
    const r = a.getBoundingClientRect();
    pop.style.left = Math.max(16, Math.min(scrollX + r.left, scrollX + innerWidth - pop.offsetWidth - 16)) + "px";
    pop.style.top = scrollY + r.bottom + 8 + "px";
  };
  document.querySelectorAll<HTMLAnchorElement>(".td-w").forEach((a) => {
    a.addEventListener("mouseenter", () => { if (matchMedia("(hover: hover)").matches) show(a); });
    a.addEventListener("mouseleave", () => { if (matchMedia("(hover: hover)").matches) close(); });
    a.addEventListener("focus", () => show(a));
    a.addEventListener("blur", close);
    // touch: the first tap shows the meaning, a second tap opens the word's page
    a.addEventListener("click", (e) => { if (!matchMedia("(hover: hover)").matches && pop?.dataset.for !== a.dataset.i) { e.preventDefault(); show(a); pop!.dataset.for = a.dataset.i; } });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  const prog = $("td-prog");
  const onScroll = () => { const h = document.documentElement.scrollHeight - innerHeight; if (prog) prog.style.width = (h > 0 ? Math.min(100, (scrollY / h) * 100) : 100) + "%"; };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
}
