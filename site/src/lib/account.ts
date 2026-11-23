// Reader accounts (browser only). Two back ends behind one interface:
//   "firebase": real accounts (Firebase Auth + Firestore). Needs PUBLIC_FIREBASE_* values at build time.
//   "mock":     data kept in this browser only; used to test the screens without any account (PUBLIC_AUTH_MODE=mock at build time).
// With neither, getAccount() returns null and the site simply shows no sign-in. The word content itself never lives here.
export interface AUser { uid: string; name: string; email: string }
/** d = domain id, s = subtopic id, p = "domain/subtopic/slug" (page path), t = term */
export interface Meta { d: string; s: string; p: string; t: string }
export interface Account {
  mode: "firebase" | "mock";
  onUser(cb: (u: AUser | null) => void): void;
  signInGoogle(): Promise<void>;
  signInEmail(email: string, pw: string): Promise<void>;
  signUpEmail(name: string, email: string, pw: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  getRead(): Promise<Record<string, Meta & { at: number }>>;
  setRead(id: string, meta: Meta, on: boolean): Promise<void>;
  getNotes(): Promise<Record<string, Meta & { text: string; at: number }>>;
  saveNote(id: string, meta: Meta, text: string): Promise<void>;
  report(id: string, meta: Meta, text: string): Promise<void>;
  /** The reader's own choices (today's-words subjects), so they follow the reader to every device. */
  getPrefs(): Promise<Prefs>;
  setPrefs(p: Prefs): Promise<void>;
  // ---- admin only (Firestore rules decide; a non-admin gets an error or false) ----
  isAdmin(): Promise<boolean>;
  getConfig(): Promise<Record<string, any> | null>;
  saveConfig(data: Record<string, any>): Promise<void>;
  listReports(): Promise<Report[]>;
  setReportStatus(id: string, status: "new" | "done"): Promise<void>;
}
export interface Prefs { subjects?: string[] }
export interface Report { id: string; name: string; email: string; wordId: string; t: string; p: string; text: string; at: number; status: string }

const env = import.meta.env;
let cached: Promise<Account | null> | null = null;
export function getAccount(): Promise<Account | null> {
  if (!cached) {
    cached = (async () => {
      if (env.PUBLIC_AUTH_MODE === "mock") return mockAccount();
      if (env.PUBLIC_FIREBASE_API_KEY && env.PUBLIC_FIREBASE_PROJECT_ID) return await firebaseAccount();
      return null;
    })().catch(() => null);
  }
  return cached;
}

// ------------------------------------------------------------------ Firebase
async function firebaseAccount(): Promise<Account> {
  const [{ initializeApp }, A, F] = await Promise.all([import("firebase/app"), import("firebase/auth"), import("firebase/firestore")]);
  const app = initializeApp({
    apiKey: env.PUBLIC_FIREBASE_API_KEY, authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN ?? `${env.PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: env.PUBLIC_FIREBASE_PROJECT_ID, appId: env.PUBLIC_FIREBASE_APP_ID,
  });
  const auth = A.getAuth(app), db = F.getFirestore(app);
  const me = () => { const u = auth.currentUser; if (!u) throw new Error("not-signed-in"); return u; };
  const toUser = (u: any): AUser => ({ uid: u.uid, name: u.displayName || (u.email ?? "").split("@")[0], email: u.email ?? "" });
  return {
    mode: "firebase",
    onUser: (cb) => { A.onAuthStateChanged(auth, (u) => cb(u ? toUser(u) : null)); },
    signInGoogle: async () => { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); },
    signInEmail: async (e, p) => { await A.signInWithEmailAndPassword(auth, e, p); },
    signUpEmail: async (name, e, p) => { const c = await A.createUserWithEmailAndPassword(auth, e, p); await A.updateProfile(c.user, { displayName: name }); },
    resetPassword: async (e) => { await A.sendPasswordResetEmail(auth, e); },
    signOut: async () => { await A.signOut(auth); },
    getRead: async () => {
      const s = await F.getDocs(F.collection(db, "users", me().uid, "read"));
      return Object.fromEntries(s.docs.map((d) => [d.id, d.data() as any]));
    },
    setRead: async (id, meta, on) => {
      const ref = F.doc(db, "users", me().uid, "read", id);
      if (on) await F.setDoc(ref, { ...meta, at: Date.now() }); else await F.deleteDoc(ref);
    },
    getNotes: async () => {
      const s = await F.getDocs(F.collection(db, "users", me().uid, "notes"));
      return Object.fromEntries(s.docs.map((d) => [d.id, d.data() as any]));
    },
    saveNote: async (id, meta, text) => {
      const ref = F.doc(db, "users", me().uid, "notes", id);
      if (text.trim()) await F.setDoc(ref, { ...meta, text: text.trim(), at: Date.now() }); else await F.deleteDoc(ref);
    },
    report: async (id, meta, text) => {
      const u = me();
      await F.addDoc(F.collection(db, "reports"), { uid: u.uid, name: toUser(u).name, email: u.email ?? "", wordId: id, ...meta, text: text.trim(), at: Date.now(), status: "new" });
    },
    getPrefs: async () => { const d = await F.getDoc(F.doc(db, "users", me().uid, "prefs", "main")); return d.exists() ? (d.data() as Prefs) : {}; },
    setPrefs: async (p) => { await F.setDoc(F.doc(db, "users", me().uid, "prefs", "main"), { subjects: (p.subjects ?? []).slice(0, 40), at: Date.now() }, { merge: true }); },
    isAdmin: async () => { try { return (await F.getDoc(F.doc(db, "admins", me().uid))).exists(); } catch { return false; } },
    getConfig: async () => { const d = await F.getDoc(F.doc(db, "config", "settings")); return d.exists() ? (d.data() as any) : null; },
    saveConfig: async (data) => { await F.setDoc(F.doc(db, "config", "settings"), { ...data, savedAt: Date.now(), savedBy: me().uid }); },
    listReports: async () => {
      const s = await F.getDocs(F.collection(db, "reports"));
      return s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a: any, b: any) => b.at - a.at);
    },
    setReportStatus: async (id, status) => { await F.updateDoc(F.doc(db, "reports", id), { status }); },
  };
}

// ------------------------------------------------------------------ mock (this browser only; for testing the screens)
function mockAccount(): Account {
  const K = "itmeans-mock-";
  const get = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(K + k) ?? "null") ?? d; } catch { return d; } };
  const set = (k: string, v: unknown) => { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch {} };
  const listeners: ((u: AUser | null) => void)[] = [];
  const fire = () => { const u = get<AUser | null>("user", null); listeners.forEach((f) => f(u)); };
  const login = (u: AUser) => { set("user", u); fire(); };
  return {
    mode: "mock",
    onUser: (cb) => { listeners.push(cb); cb(get<AUser | null>("user", null)); },
    signInGoogle: async () => login({ uid: "mock-1", name: "परीक्षण पाठक", email: "test@example.com" }),
    signInEmail: async (e) => login({ uid: "mock-1", name: e.split("@")[0], email: e }),
    signUpEmail: async (name, e) => login({ uid: "mock-1", name, email: e }),
    resetPassword: async () => {},
    signOut: async () => { set("user", null); fire(); },
    getRead: async () => get("read", {}),
    setRead: async (id, meta, on) => { const r = get<Record<string, any>>("read", {}); if (on) r[id] = { ...meta, at: Date.now() }; else delete r[id]; set("read", r); },
    getNotes: async () => get("notes", {}),
    saveNote: async (id, meta, text) => { const r = get<Record<string, any>>("notes", {}); if (text.trim()) r[id] = { ...meta, text: text.trim(), at: Date.now() }; else delete r[id]; set("notes", r); },
    report: async (id, meta, text) => { const r = get<any[]>("reports", []); const u = get<AUser | null>("user", null); r.push({ id: "r" + (r.length + 1), wordId: id, ...meta, name: u?.name ?? "", email: u?.email ?? "", text, at: Date.now(), status: "new" }); set("reports", r); },
    getPrefs: async () => get<Prefs>("prefs", {}),
    setPrefs: async (p) => set("prefs", p),
    isAdmin: async () => get<boolean>("admin", true),
    getConfig: async () => get<Record<string, any> | null>("config", null),
    saveConfig: async (data) => set("config", { ...data, savedAt: Date.now() }),
    listReports: async () => get<Report[]>("reports", []).slice().reverse(),
    setReportStatus: async (id, status) => { const r = get<Report[]>("reports", []); const x = r.find((y) => y.id === id); if (x) x.status = status; set("reports", r); },
  };
}
