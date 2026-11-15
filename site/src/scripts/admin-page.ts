// Admin page logic. The settings are saved to Firestore (config/settings); the hourly cycle applies them (scripts/sync-admin-settings.mjs).
import { getAccount, type Report } from "../lib/account";

const root = document.getElementById("adm");
(async () => {
  if (!root) return;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const acc = await getAccount();
  $("adm-loading").hidden = true;
  if (!acc) { $("adm-no").hidden = false; return; }
  const D = JSON.parse($("adm-data").textContent!);
  const flash = (t: string) => { $("f-msg").textContent = t; setTimeout(() => ($("f-msg").textContent = ""), 5000); };

  acc.onUser(async (u) => {
    $("adm-out").hidden = !!u; $("adm-in").hidden = true; $("adm-no").hidden = true;
    if (!u) return;
    if (!(await acc.isAdmin())) { $("adm-no").hidden = false; return; }
    $("adm-in").hidden = false;
    const saved = await acc.getConfig().catch(() => null);
    const S = { ...D.settings, ...(saved ?? {}) };
    ($("f-stop") as HTMLInputElement).checked = !!S.stop_all;
    ($("f-pct") as HTMLInputElement).value = String(S.pause_if_held_percent);
    ($("f-chk") as HTMLInputElement).value = String(S.checker_pass_score);
    ($("f-bt") as HTMLInputElement).value = String(S.backtranslation_pass_score);
    const capOf = (id: string) => (S.daily_caps as { domain: string; cap: number }[]).find((c) => c.domain === id)?.cap ?? 0;
    const caps = $("f-caps"); caps.replaceChildren();
    for (const d of D.domains) {
      const l = el("label", "num", d.name); const i = el("input") as HTMLInputElement;
      i.type = "number"; i.min = "0"; i.max = "500"; i.value = String(capOf(d.id)); i.dataset.domain = d.id; l.append(i); caps.append(l);
    }
    const toggles = (host: HTMLElement, items: any[], key: "id" | "code", got: Record<string, boolean> | undefined) => {
      host.replaceChildren();
      for (const x of items) {
        const l = el("label", "chk"); const i = el("input") as HTMLInputElement; i.type = "checkbox";
        i.checked = got && x[key] in got ? !!got[x[key]] : x.active; i.disabled = !!x.fixed; i.dataset.k = x[key];
        l.append(i, document.createTextNode(" " + x.name)); host.append(l);
      }
    };
    toggles($("f-domains"), D.domains, "id", saved?.domains); toggles($("f-langs"), D.languages, "code", saved?.languages);
    await loadReports();
  });

  const collect = () => ({
    stop_all: ($("f-stop") as HTMLInputElement).checked,
    pause_if_held_percent: Number(($("f-pct") as HTMLInputElement).value),
    checker_pass_score: Number(($("f-chk") as HTMLInputElement).value),
    backtranslation_pass_score: Number(($("f-bt") as HTMLInputElement).value),
    daily_caps: [...$("f-caps").querySelectorAll<HTMLInputElement>("input")].map((i) => ({ domain: i.dataset.domain!, cap: Number(i.value) })),
    domains: Object.fromEntries([...$("f-domains").querySelectorAll<HTMLInputElement>("input")].map((i) => [i.dataset.k!, i.checked])),
    languages: Object.fromEntries([...$("f-langs").querySelectorAll<HTMLInputElement>("input")].map((i) => [i.dataset.k!, i.checked])),
  });
  $("f-save").addEventListener("click", async () => {
    try { const prev = await acc.getConfig().catch(() => null); await acc.saveConfig({ ...collect(), ...(prev?.unpause ? { unpause: prev.unpause } : {}) }); flash(root.dataset.saved!); }
    catch { flash(root.dataset.error!); }
  });
  $("f-resume").addEventListener("click", async () => {
    try { await acc.saveConfig({ ...collect(), unpause: Date.now() }); flash(root.dataset.resumed!); } catch { flash(root.dataset.error!); }
  });

  async function loadReports() {
    const list = $("r-list"); list.replaceChildren();
    let rows: Report[] = [];
    try { rows = await acc.listReports(); } catch { /* not allowed or offline: show none */ }
    $("r-none").hidden = rows.length > 0;
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
