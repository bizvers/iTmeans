// Fake models for dry runs and tests. They cost nothing and need no keys.
// A term containing "Bad" is always objected to by the fake checkers (so it ends up in the held list).
export const MOCK_ROWS = [
  { service: "mock", model: "writer-1", company: "CompanyA", role: ["writer"], daily_limit: null },
  { service: "mock", model: "checker-1", company: "CompanyB", role: ["checker", "list"], daily_limit: null },
  { service: "mock", model: "checker-2", company: "CompanyC", role: ["checker", "list"], daily_limit: null },
];

// short stage: a letter has fake words "<L>one" .. "<L>four" ... except X/Y/Z, which have none (so "no forcing" can be tested)
const SHORT_WORDS = (l) => (/[XYZ]/.test(l) ? [] : [`${l}alpha`, `${l}beta`, `${l}gamma`, `${l}delta`, `${l}epsilon`, `${l}zeta`, `${l}eta`]);

export function mockModel(_row, prompt) {
  const term = /Term: "([^"]+)"/.exec(prompt)?.[1] ?? /for the term "([^"]+)"/.exec(prompt)?.[1] ?? "Thing";
  if (prompt.includes("You write ONE entry")) {
    return "```json\n" + JSON.stringify({
      level: "basic", pronunciation_hi: "नमूना", term_hi: null,
      literal_meaning: { hi: "एक नमूना अर्थ।", en: "A sample literal meaning." },
      field_meaning: { hi: "यह जाँच के लिए बना नमूना है।", en: "This is a sample made for testing." },
      effect: { hi: "जाँच आसान होती है।", en: "Testing becomes easier." },
      effect_flow: [{ hi: "पहला कदम", en: "First step" }, { hi: "दूसरा कदम", en: "Second step" }, { hi: "तीसरा कदम", en: "Third step" }],
      usage: { hi: "सिर्फ़ परीक्षण में।", en: "Only in testing." },
      example: { hi: "एक नक़ली उदाहरण।", en: "A fake example." },
      caution: { hi: "असली नहीं है।", en: "It is not real." },
      related: ["alpha", "beta"],
    }) + "\n```";
  }
  if (prompt.includes("FOR EACH OF THESE LETTERS")) {
    const letters = /FOR EACH OF THESE LETTERS: ([A-Z, ]+)/.exec(prompt)?.[1].split(/,\s*/).filter(Boolean) ?? [];
    return JSON.stringify({ terms: Object.fromEntries(letters.map((l) => [l, SHORT_WORDS(l)])) });
  }
  if (prompt.includes("START WITH THE LETTER")) {
    const l = /LETTER "(.)"/.exec(prompt)?.[1] ?? "A";
    return JSON.stringify({ terms: SHORT_WORDS(l) });
  }
  if (prompt.includes("You write SHORT entries")) {
    const terms = [...prompt.split("Terms:")[1].split("\n")[0].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return JSON.stringify({ entries: terms.map((t) => ({ term: t, pronunciation_hi: "नमूना", meaning_hi: "जाँच के लिए नमूना।", kind_en: "term", kind_hi: "शब्द" })) });
  }
  if (prompt.includes("checking short dictionary entries")) {
    const bad = [...prompt.matchAll(/^- (\S*Bad\S*) \|/gm)].map((m) => ({ term: m[1], reason: "wrong meaning (mock)" }));
    return JSON.stringify({ bad });
  }
  if (prompt.includes("Suggest 5 NEW topics")) return JSON.stringify({ topics: ["One", "Two", "Three", "Four", "Five", "Six"].map((n) => ({ en: `New ${n}`, hi: `नया ${n}` })) });
  if (prompt.includes("independent checker")) {
    const bad = /Bad/.test(term);
    return JSON.stringify({ belongs_to_subtopic: true, literal_ok: true, field_ok: !bad, effect_usage_ok: true, hi_en_same: true, level_ok: true, score: bad ? 40 : 92, objections: bad ? ["field meaning is wrong (mock)"] : [] });
  }
  if (prompt.startsWith("Translate")) return '{"en":"This is a sample made for testing."}';
  if (prompt.startsWith("Original English")) return '{"score":90,"same":true}';
  throw new Error("mock: unknown prompt");
}

// globalThis.__mockNoSource (a RegExp) lets a test say which terms have no source page
export const mockResolve = async (term) => globalThis.__mockNoSource?.test(term)
  ? { ok: false, reason: "no trusted source: no Wikipedia page for this term" }
  : { ok: true, url: `https://example.test/${encodeURIComponent(term)}`, text: `${term} is mentioned on this page, used only for dry runs.` };
