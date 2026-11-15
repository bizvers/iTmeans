// Word page: read mark, own note, report with the reader's name. Needs a signed-in reader.
import { getAccount } from "../lib/account";

const root = document.getElementById("acts") as HTMLElement | null;
(async () => {
  const acc = await getAccount();
  if (!root || !acc) return; // accounts not set up: the block stays hidden
  const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const out = q("acts-out"), inn = q("acts-in"), read = q("act-read"), note = q<HTMLTextAreaElement>("act-note");
  const saveBtn = q("act-save"), msg = q("act-msg"), rep = q<HTMLTextAreaElement>("rep-text"), send = q("rep-send"), rmsg = q("rep-msg");
  const id = root.dataset.id!;
  const meta = { d: root.dataset.d!, s: root.dataset.s!, p: root.dataset.p!, t: root.dataset.t! };
  let isRead = false;
  const flash = (el: HTMLElement, t: string) => { el.textContent = t; setTimeout(() => (el.textContent = ""), 3500); };
  const paintRead = () => { read.textContent = isRead ? root.dataset.isread! : root.dataset.mark!; read.classList.toggle("p", isRead); };
  root.hidden = false;

  acc.onUser(async (u) => {
    out.hidden = !!u; inn.hidden = !u;
    if (!u) return;
    try {
      const [r, n] = await Promise.all([acc.getRead(), acc.getNotes()]);
      isRead = !!r[id]; note.value = n[id]?.text ?? ""; paintRead();
    } catch { flash(msg, root.dataset.err!); }
  });
  read.addEventListener("click", async () => {
    try { await acc.setRead(id, meta, !isRead); isRead = !isRead; paintRead(); } catch { flash(msg, root.dataset.err!); }
  });
  saveBtn.addEventListener("click", async () => {
    try { await acc.saveNote(id, meta, note.value); flash(msg, root.dataset.saved!); } catch { flash(msg, root.dataset.err!); }
  });
  send.addEventListener("click", async () => {
    if (!rep.value.trim()) { rep.focus(); return; }
    try { await acc.report(id, meta, rep.value); rep.value = ""; flash(rmsg, root.dataset.sent!); } catch { flash(rmsg, root.dataset.err!); }
  });
})();
