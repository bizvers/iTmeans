// Header: sign-in button, sign-in / sign-up dialog, "my page" link, sign-out. Does nothing when accounts are not set up.
import { getAccount } from "../lib/account";

const acct = document.getElementById("acct");
const dlg = document.getElementById("authdlg") as HTMLDialogElement | null;
const S: Record<string, string> = JSON.parse(document.getElementById("acct-i18n")?.textContent ?? "{}");

(async () => {
  const acc = await getAccount();
  if (!acct || !dlg || !acc) return; // feature off: the header shows no account controls
  acct.hidden = false;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const inBtn = $("signin"), box = $("userbox"), me = $<HTMLAnchorElement>("melink"), outBtn = $("signout");
  const form = $<HTMLFormElement>("authform"), err = $("autherr"), title = $("authtitle"), submit = $("authsubmit");
  const nameRow = $("f-name"), toggle = $("toggle"), forgot = $("forgot"), g = $("gbtn");
  let mode: "in" | "up" = "in";

  const paint = () => {
    title.textContent = mode === "in" ? S.signIn : S.signUp;
    submit.textContent = mode === "in" ? S.signIn : S.signUp;
    toggle.textContent = mode === "in" ? S.noAccount : S.haveAccount;
    nameRow.hidden = mode === "in";
    (nameRow.querySelector("input") as HTMLInputElement).required = mode === "up";
    forgot.hidden = mode === "up";
    err.hidden = true;
  };
  const show = (m: "in" | "up") => { mode = m; paint(); if (!dlg.open) dlg.showModal(); };
  const fail = (e: any) => { err.textContent = `${S.errorTry}${e?.code ? ` (${e.code})` : ""}`; err.hidden = false; };

  acc.onUser((u) => {
    inBtn.hidden = !!u; box.hidden = !u;
    const adm = document.getElementById("adminlink");
    if (adm) { adm.hidden = true; if (u) acc.isAdmin().then((a) => { adm.hidden = !a; }).catch(() => {}); }
    if (u) { me.textContent = u.name; }
    document.documentElement.dataset.signedin = u ? "1" : "0";
  });
  inBtn.addEventListener("click", () => show("in"));
  document.addEventListener("click", (e) => { // any element marked data-open-signin opens the dialog (used by the word page)
    if ((e.target as HTMLElement).closest("[data-open-signin]")) show("in");
  });
  toggle.addEventListener("click", () => show(mode === "in" ? "up" : "in"));
  outBtn.addEventListener("click", () => acc.signOut());
  dlg.querySelector(".dlg-x")!.addEventListener("click", () => dlg.close());
  g.addEventListener("click", async () => { try { await acc.signInGoogle(); dlg.close(); } catch (e) { fail(e); } });
  forgot.addEventListener("click", async () => {
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    if (!email) { (form.elements.namedItem("email") as HTMLInputElement).focus(); return; }
    try { await acc.resetPassword(email); err.textContent = S.resetSent; err.hidden = false; } catch (e) { fail(e); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value.trim();
    try {
      if (mode === "in") await acc.signInEmail(v("email"), v("password"));
      else await acc.signUpEmail(v("name"), v("email"), v("password"));
      form.reset(); dlg.close();
    } catch (er) { fail(er); }
  });
  paint();
})();
