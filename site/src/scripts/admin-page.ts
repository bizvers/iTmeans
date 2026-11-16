// Admin page logic. The settings are saved to Firestore (config/settings); the hourly cycle applies them (scripts/sync-admin-settings.mjs).
import { getAccount, type Report } from "../lib/account";

const root = document.getElementById("adm");
(async () => {
  if (!root) return;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // Control buttons: show one panel at a time; the open panel is kept in the address (#cycle) so a reload stays on it.
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".ctl [data-panel]")];
  const frame = root.querySelector<HTMLIFrameElement>("#site-frame iframe");
  const show = (id: string) => {
    if (!tabs.some((b) => b.dataset.panel === id)) id = "site";
    for (const b of tabs) {
      const on = b.dataset.panel === id;
      b.setAttribute("aria-selected", String(on));
      $("p-" + b.dataset.panel).hidden = !on;
    }
    if (id === "site" && frame && !frame.src) frame.src = frame.dataset.src!; // load the site only when it is first looked at
  };
  tabs.forEach((b) => b.addEventListener("click", () => { show(b.dataset.panel!); history.replaceState(null, "", "#" + b.dataset.panel); }));
  show(location.hash.slice(1));

  // Site view: desktop width or phone width
  root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b, _, all) => b.addEventListener("click", () => {
    all.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("site-frame").classList.toggle("mob", b.dataset.view === "mob");
  }));

  const acc = await getAccount();
  $("adm-loading").hidden = true;
  if (!acc) { $("adm-no").hidden = false; return; }
  const D = JSON.parse($("adm-data").textContent!);
  const msgs = [...root.querySelectorAll<HTMLElement>(".f-msg")];
  const flash = (t: string) => { msgs.forEach((m) => (m.textContent = t)); setTimeout(() => msgs.forEach((m) => (m.textContent = "")), 5000); };

  acc.onUser(async (u) => {
    $("adm-out").hidden = !!u; $("adm-in").hidden = true; $("adm-no").hidden = true;
    if (!u) return;
    if (!(await acc.isAdmin())) { $("adm-no").hidden = false; return; }
    $("adm-in").hidden = false;
    const saved = await acc.getConfig().catch(() => null);
    const S = { ...D.settings, ...(saved ?? {}) };
    ($("f-stop") as HTMLInputElement).checked = !!S.stop_all;
    ($("f-nocap") as HTMLInputElement).checked = !!S.no_daily_cap;
    ($("f-pct") as HTMLInputElement).value = String(S.pause_if_held_percent);
    ($("f-chk") as HTMLInputElement).value = String(S.checker_pass_score);
    ($("f-bt") as HTMLInputElement).value = String(S.backtranslation_pass_score);
    capOf = (id: string) => (S.daily_caps as { domain: string; cap: number }[]).find((c) => c.domain === id)?.cap ?? 0;
    tax = loadTaxonomy(saved);
    renderDomains(); renderCaps();
    renderTopics({ ...D.settings, ...(saved ?? {}), topic_defaults: { ...D.settings.topic_defaults, ...(saved?.topic_defaults ?? {}) } });
    const toggles = (host: HTMLElement, items: any[], key: "id" | "code", got: Record<string, boolean> | undefined) => {
      host.replaceChildren();
      for (const x of items) {
        const l = el("label", "chk"); const i = el("input") as HTMLInputElement; i.type = "checkbox";
        i.checked = got && x[key] in got ? !!got[x[key]] : x.active; i.disabled = !!x.fixed; i.dataset.k = x[key];
        l.append(i, document.createTextNode(" " + x.name)); host.append(l);
      }
    };
    toggles($("f-langs"), D.languages, "code", saved?.languages);
    await loadReports();
  });

  // ---- subjects (domains) and subtopics: switch on/off, rename, add. Nothing is deleted (old addresses must keep working).
  // New and renamed items are saved in the settings document (add_domains, add_subtopics, rename); the hourly cycle adds them to
  // content/taxonomy/taxonomy.json (scripts/sync-admin-settings.mjs checks every name and id again).
  type Sub = { id: string; en: string; hi: string; isNew?: boolean };
  type Dom = { id: string; en: string; hi: string; active: boolean; subtopics: Sub[]; isNew?: boolean };
  const I = JSON.parse(root.dataset.i18n!);
  const RESERVED = new Set(["admin", "me", "privacy", "pagefind", "_astro"]);
  const slug = (en: string) => en.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  const cleanName = (x: string) => { const t = x.trim().replace(/\s+/g, " "); return t.length >= 1 && t.length <= 60 && !/[<>]/.test(t) ? t : ""; };
  const shown = (x: { en: string; hi: string }) => (D.lang === "en" ? x.en : x.hi);
  const other = (x: { en: string; hi: string }) => (D.lang === "en" ? x.hi : x.en);
  let tax: Dom[] = [];
  let capOf = (_id: string) => 0;
  const orig = (id: string) => (D.domains as Dom[]).find((d) => d.id === id);

  function loadTaxonomy(saved: any): Dom[] {
    const t: Dom[] = (D.domains as Dom[]).map((d) => ({ ...d, subtopics: d.subtopics.map((s) => ({ ...s })) }));
    for (const a of saved?.add_domains ?? []) if (!t.some((d) => d.id === a.id)) t.push({ id: a.id, en: a.en, hi: a.hi, active: false, subtopics: [], isNew: true });
    for (const a of saved?.add_subtopics ?? []) {
      const d = t.find((x) => x.id === a.domain);
      if (d && !d.subtopics.some((s) => s.id === a.id)) d.subtopics.push({ id: a.id, en: a.en, hi: a.hi, isNew: true });
    }
    for (const r of saved?.rename ?? []) {
      const d = t.find((x) => x.id === r.domain), item = d && (r.subtopic ? d.subtopics.find((s) => s.id === r.subtopic) : d);
      if (item) { item.en = r.en; item.hi = r.hi; }
    }
    for (const d of t) if (saved?.domains && d.id in saved.domains) d.active = !!saved.domains[d.id];
    return t;
  }

  /** Keeps what was typed/ticked before the list is drawn again. */
  function readBack() {
    for (const i of $("f-domains").querySelectorAll<HTMLInputElement>("input[type=checkbox][data-k]")) { const d = tax.find((x) => x.id === i.dataset.k); if (d) d.active = i.checked; }
  }

  function nameInputs(hi = "", en = "") {
    const a = el("input") as HTMLInputElement, b = el("input") as HTMLInputElement;
    a.maxLength = b.maxLength = 60; a.value = hi; b.value = en; a.placeholder = I.nameHi; b.placeholder = I.nameEn;
    a.setAttribute("aria-label", I.nameHi); b.setAttribute("aria-label", I.nameEn);
    return [a, b] as const;
  }

  function renderDomains() {
    const host = $("f-domains"); host.replaceChildren();
    for (const d of tax) {
      const box = el("div", "dom"), head = el("div", "dom-head");
      const l = el("label", "chk"), cb = el("input") as HTMLInputElement;
      cb.type = "checkbox"; cb.dataset.k = d.id; cb.checked = d.active; cb.disabled = !d.subtopics.length; cb.title = d.subtopics.length ? "" : I.needSub;
      l.append(cb, el("b", undefined, " " + shown(d)), el("span", "other", other(d)));
      const tag = el("span", "tag" + (d.isNew ? " new" : d.active ? " on" : ""), d.isNew ? I.pending : d.active ? I.on : I.off);
      const rn = el("button", "lnk", I.rename) as HTMLButtonElement; rn.type = "button";
      head.append(l, tag, rn);
      const chips = el("div", "chips");
      for (const s of d.subtopics) chips.append(el("span", s.isNew ? "new" : undefined, shown(s)));
      const msg = el("p", "desc"); msg.setAttribute("role", "status");
      // add a subtopic
      const [shi, sen] = nameInputs(); const add = el("button", "btn", I.add) as HTMLButtonElement; add.type = "button";
      const addRow = el("div", "addrow"); addRow.append(shi, sen, add); addRow.hidden = true;
      const openAdd = el("button", "lnk", I.addSub) as HTMLButtonElement; openAdd.type = "button";
      openAdd.addEventListener("click", () => { addRow.hidden = !addRow.hidden; if (!addRow.hidden) shi.focus(); });
      head.append(openAdd);
      add.addEventListener("click", () => {
        const hi = cleanName(shi.value), en = cleanName(sen.value), id = slug(en);
        if (!hi || !en) { msg.textContent = I.errNames; return; }
        if (!id) { msg.textContent = I.errEnglish; return; }
        if (RESERVED.has(id)) { msg.textContent = I.errReserved; return; }
        if (d.subtopics.some((s) => s.id === id)) { msg.textContent = I.errExists; return; }
        readBack(); d.subtopics.push({ id, en, hi, isNew: true }); renderDomains(); renderCaps(); flash(I.added);
      });
      // rename the subject and its subtopics
      const edit = el("div", "edit"); edit.hidden = true;
      rn.addEventListener("click", () => {
        if (!edit.hidden) { edit.hidden = true; return; }
        edit.replaceChildren();
        const rows: [Sub | Dom, HTMLInputElement, HTMLInputElement][] = [];
        for (const x of [d, ...d.subtopics]) { const [a, b] = nameInputs(x.hi, x.en); const r = el("div", "addrow"); r.append(a, b); edit.append(r); rows.push([x, a, b]); }
        const ok = el("button", "btn", I.ok) as HTMLButtonElement; ok.type = "button";
        ok.addEventListener("click", () => {
          if (rows.some(([, a, b]) => !cleanName(a.value) || !cleanName(b.value))) { msg.textContent = I.errNames; return; }
          readBack(); for (const [x, a, b] of rows) { x.hi = cleanName(a.value); x.en = cleanName(b.value); }
          renderDomains(); renderCaps(); flash(I.added);
        });
        edit.append(ok); edit.hidden = false;
      });
      box.append(head, chips, edit, addRow, msg); host.append(box);
    }
  }

  /** One daily-cap box per subject (new ones start at 0); keeps numbers already typed. */
  function renderCaps() {
    const caps = $("f-caps");
    const typed = new Map([...caps.querySelectorAll<HTMLInputElement>("input")].map((i) => [i.dataset.domain!, i.value]));
    caps.replaceChildren();
    for (const d of tax) {
      const l = el("label", "num", shown(d)); const i = el("input") as HTMLInputElement;
      i.type = "number"; i.min = "0"; i.max = "500"; i.value = typed.get(d.id) ?? String(capOf(d.id)); i.dataset.domain = d.id; l.append(i); caps.append(l);
    }
  }

  // ---- topics: words per letter, one topic's own rule, which topic is worked on now, and the 5 suggested topics
  type Rule = { min?: number; max?: number; target?: number; mode?: "letters" | "popular" };
  type Topic = { key: string; domain: string; id: string; en: string; hi: string; words: number; done: boolean };
  let rules: Record<string, Rule> = {};
  const topics = D.topics as Topic[];
  const topicName = (k: string) => { const x = topics.find((t) => t.key === k); return x ? shown(x) : k; };
  const num = (id: string) => { const v = ($(id) as HTMLInputElement).value.trim(); return v === "" ? undefined : Number(v); };
  const opt = (value: string, text: string) => { const o = el("option", undefined, text) as HTMLOptionElement; o.value = value; return o; };

  function renderRules() {
    const host = $("rl-list"); host.replaceChildren();
    const keys = Object.keys(rules);
    if (!keys.length) host.append(el("p", "desc", I.ruleNone));
    for (const k of keys) {
      const r = rules[k], row = el("div", "rep-head");
      const what = r.mode === "popular" ? `${I.rulePopular}: ${r.target ?? "—"}` : `${I.ruleLetters}: ${r.min ?? "—"}–${r.max ?? "—"}${r.target ? `, ${I.ruleTarget}: ${r.target}` : ""}`;
      const rm = el("button", "lnk", I.ruleRemove) as HTMLButtonElement; rm.type = "button";
      rm.addEventListener("click", () => { delete rules[k]; renderRules(); });
      row.append(el("b", undefined, topicName(k)), el("span", undefined, what), rm); host.append(row);
    }
  }

  function renderSuggestions() {
    const host = $("sg-list"); host.replaceChildren();
    const open = (D.suggestions as { domain: string; id: string; en: string; hi: string }[]).filter((s) => {
      const d = tax.find((x) => x.id === s.domain);
      return d && !d.subtopics.some((x) => x.id === s.id);
    });
    $("sg-none").hidden = open.length > 0;
    for (const s of open) {
      const row = el("div", "rep-head"), b = el("button", "btn", I.approveBtn) as HTMLButtonElement; b.type = "button";
      b.addEventListener("click", () => {
        const d = tax.find((x) => x.id === s.domain)!;
        readBack(); d.subtopics.push({ id: s.id, en: s.en, hi: s.hi, isNew: true });
        renderDomains(); renderCaps(); renderSuggestions(); fillTopicSelects(); flash(I.approvedRemind);
      });
      row.append(el("b", undefined, shown(s)), el("span", undefined, `${shown(tax.find((x) => x.id === s.domain)!)} › ${other(s)}`), b); host.append(row);
    }
  }

  function fillTopicSelects(current = ($("f-current") as HTMLSelectElement).value) {
    const all = tax.flatMap((d) => d.subtopics.map((s) => ({ key: `${d.id}/${s.id}`, name: `${shown(d)} › ${shown(s)}` })));
    const cur = $("f-current") as HTMLSelectElement, sel = $("rl-topic") as HTMLSelectElement;
    cur.replaceChildren(opt("", I.workAuto)); sel.replaceChildren();
    for (const x of all) { cur.append(opt(x.key, x.name)); sel.append(opt(x.key, x.name)); }
    cur.value = all.some((x) => x.key === current) ? current : "";
  }

  function renderTopics(S: any) {
    const df = S.topic_defaults;
    ($("f-tmin") as HTMLInputElement).value = String(df.min); ($("f-tmax") as HTMLInputElement).value = String(df.max); ($("f-trev") as HTMLInputElement).value = String(df.review_every);
    rules = { ...(S.topic_rules ?? {}) };
    fillTopicSelects(S.current_topic ?? ""); renderRules(); renderSuggestions();
    const t = topics.find((x) => x.key === D.nowKey);
    const r = (D.nowKey && rules[D.nowKey]) || {};
    const target = r.target ?? (r.mode === "popular" ? df.popular_target : 26 * (r.max ?? df.max));
    $("tp-now").textContent = t ? `${shown(t)} — ${t.words} / ${target} ${I.topicWords}` : I.topicNone;
    $("tp-total").textContent = String(D.progress.total);
    $("tp-review").hidden = !D.progress.review;
  }

  $("rl-add").addEventListener("click", () => {
    const key = ($("rl-topic") as HTMLSelectElement).value; if (!key) return;
    const mode = ($("rl-mode") as HTMLSelectElement).value as "letters" | "popular";
    const r: Rule = { mode };
    const min = num("rl-min"), max = num("rl-max"), target = num("rl-target");
    if (mode === "letters") { if (min !== undefined) r.min = min; if (max !== undefined) r.max = max; }
    if (target !== undefined) r.target = target;
    rules[key] = r; renderRules(); flash(I.added);
  });

  $("nd-add").addEventListener("click", () => {
    const v = (id: string) => cleanName(($(id) as HTMLInputElement).value), msg = $("nd-msg");
    const hi = v("nd-hi"), en = v("nd-en"), shi = v("nd-shi"), sen = v("nd-sen"), id = slug(en), sid = slug(sen);
    if (!hi || !en || !shi || !sen) { msg.textContent = I.errNames; return; }
    if (!id || !sid) { msg.textContent = I.errEnglish; return; }
    if (RESERVED.has(id) || RESERVED.has(sid)) { msg.textContent = I.errReserved; return; }
    if (tax.some((d) => d.id === id)) { msg.textContent = I.errExists; return; }
    readBack();
    tax.push({ id, en, hi, active: false, isNew: true, subtopics: [{ id: sid, en: sen, hi: shi, isNew: true }] });
    for (const f of ["nd-hi", "nd-en", "nd-shi", "nd-sen"]) ($(f) as HTMLInputElement).value = "";
    msg.textContent = I.added; renderDomains(); renderCaps();
  });

  const taxonomyEdits = () => {
    readBack();
    const rename: Record<string, string>[] = [];
    for (const d of tax.filter((x) => !x.isNew)) {
      const o = orig(d.id)!;
      if (o.en !== d.en || o.hi !== d.hi) rename.push({ domain: d.id, en: d.en, hi: d.hi });
      for (const s of d.subtopics.filter((x) => !x.isNew)) {
        const os = o.subtopics.find((x) => x.id === s.id)!;
        if (os.en !== s.en || os.hi !== s.hi) rename.push({ domain: d.id, subtopic: s.id, en: s.en, hi: s.hi });
      }
    }
    return {
      add_domains: tax.filter((d) => d.isNew).map(({ id, en, hi }) => ({ id, en, hi })),
      add_subtopics: tax.flatMap((d) => d.subtopics.filter((s) => s.isNew).map(({ id, en, hi }) => ({ domain: d.id, id, en, hi }))),
      rename,
    };
  };

  const collect = () => ({
    ...taxonomyEdits(),
    stop_all: ($("f-stop") as HTMLInputElement).checked,
    no_daily_cap: ($("f-nocap") as HTMLInputElement).checked,
    pause_if_held_percent: Number(($("f-pct") as HTMLInputElement).value),
    checker_pass_score: Number(($("f-chk") as HTMLInputElement).value),
    backtranslation_pass_score: Number(($("f-bt") as HTMLInputElement).value),
    daily_caps: [...$("f-caps").querySelectorAll<HTMLInputElement>("input")].map((i) => ({ domain: i.dataset.domain!, cap: Number(i.value) })),
    topic_defaults: Object.fromEntries(Object.entries({ min: num("f-tmin"), max: num("f-tmax"), review_every: num("f-trev") }).filter(([, v]) => v !== undefined)), // Firestore refuses undefined
    topic_rules: rules,
    current_topic: ($("f-current") as HTMLSelectElement).value,
    domains: Object.fromEntries([...$("f-domains").querySelectorAll<HTMLInputElement>("input[type=checkbox][data-k]")].map((i) => [i.dataset.k!, i.checked])),
    languages: Object.fromEntries([...$("f-langs").querySelectorAll<HTMLInputElement>("input")].map((i) => [i.dataset.k!, i.checked])),
  });
  // Both save buttons (cycle panel and subjects panel) save everything: all fields stay in the page even when their panel is hidden.
  root.querySelectorAll<HTMLButtonElement>(".f-save").forEach((b) => b.addEventListener("click", async () => {
    try { const prev = await acc.getConfig().catch(() => null); await acc.saveConfig({ ...collect(), ...(prev?.unpause ? { unpause: prev.unpause } : {}) }); flash(root.dataset.saved!); }
    catch { flash(root.dataset.error!); }
  }));
  $("f-resume").addEventListener("click", async () => {
    try { await acc.saveConfig({ ...collect(), unpause: Date.now() }); flash(root.dataset.resumed!); } catch { flash(root.dataset.error!); }
  });

  async function loadReports() {
    const list = $("r-list"); list.replaceChildren();
    let rows: Report[] = [];
    try { rows = await acc.listReports(); } catch { /* not allowed or offline: show none */ }
    $("r-none").hidden = rows.length > 0;
    const open = rows.filter((r) => r.status !== "done").length;
    $("r-count").textContent = String(open); $("r-count").hidden = open === 0;
    rows.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.at - a.at);
    for (const r of rows) {
      const c = el("div", "rep-item" + (r.status === "done" ? " done" : ""));
      const head = el("div", "rep-head");
      const w = el("a", undefined, r.t) as HTMLAnchorElement; w.href = `${D.base}${r.p}/`;
      head.append(el("b", undefined, r.name || "—"), el("span", undefined, r.email || ""), w, el("small", undefined, new Date(r.at).toLocaleString()));
      c.append(head, el("p", undefined, r.text));
      if (r.status !== "done") {
        const b = el("button", "btn", root.dataset.markdone!);
        b.addEventListener("click", async () => { try { await acc.setReportStatus(r.id, "done"); await loadReports(); } catch { flash(root.dataset.error!); } });
        c.append(b);
      } else c.append(el("small", undefined, root.dataset.done!));
      list.append(c);
    }
  }
})();
