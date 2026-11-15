// "My learning" page: how many words read in each subject and topic, and the reader's own notes.
import { getAccount } from "../lib/account";

const root = document.getElementById("me");
(async () => {
  if (!root) return;
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const acc = await getAccount();
  $("me-loading").hidden = true;
  if (!acc) { $("me-out").hidden = false; return; }
  const { domains, base } = JSON.parse($("me-data").textContent!);
  const pattern = root.dataset.of!, readWord = root.dataset.word!, words = root.dataset.words!;
  const of = (read: number, total: number) => pattern.replace("{read}", String(read)).replace("{total}", String(total));
  const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  acc.onUser(async (u) => {
    $("me-out").hidden = !!u; $("me-in").hidden = !u;
    if (!u) return;
    $("me-name").textContent = u.name; $("me-email").textContent = u.email;
    const [read, notes] = await Promise.all([acc.getRead(), acc.getNotes()]);
    const count: Record<string, number> = {};
    for (const r of Object.values(read)) { const k = `${r.d}/${r.s}`; count[k] = (count[k] ?? 0) + 1; }
    const all = Object.values(count).reduce((a, b) => a + b, 0);
    const grand = domains.reduce((a: number, d: any) => a + d.subs.reduce((x: number, s: any) => x + s.total, 0), 0);
    $("me-total").textContent = of(all, grand);
    const host = $("me-subjects"); host.replaceChildren();
    for (const d of domains) {
      const got = d.subs.reduce((a: number, s: any) => a + (count[`${d.id}/${s.id}`] ?? 0), 0);
      const tot = d.subs.reduce((a: number, s: any) => a + s.total, 0);
      const sec = el("section", "msub");
      const h = el("h3"); h.append(el("span", undefined, d.name), el("small", undefined, `${of(got, tot)} ${readWord}`));
      sec.append(h, bar(got, tot));
      for (const s of d.subs) {
        const g = count[`${d.id}/${s.id}`] ?? 0;
        const row = el("a", "mrow"); (row as HTMLAnchorElement).href = s.url;
        row.append(el("span", undefined, s.name), bar(g, s.total), el("small", undefined, `${g}/${s.total}`));
        sec.append(row);
      }
      host.append(sec);
    }
    const nh = $("me-notes"); nh.replaceChildren();
    const list = Object.values(notes).sort((a, b) => b.at - a.at);
    $("me-nonotes").hidden = list.length > 0;
    for (const n of list) {
      const c = el("a", "mnote"); (c as HTMLAnchorElement).href = `${base}${n.p}/`;
      c.append(el("b", undefined, n.t), el("p", undefined, n.text));
      nh.append(c);
    }
  });
  function bar(a: number, b: number) {
    const w = el("span", "bar"); const i = el("i"); i.style.width = `${b ? Math.round((a / b) * 100) : 0}%`; w.append(i); return w;
  }
  void words;
})();
