// Fake models for dry runs and tests. They cost nothing and need no keys.
// A term containing "Bad" is always objected to by the fake checkers (so it ends up in the held list).
export const MOCK_ROWS = [
  { service: "mock", model: "writer-1", company: "CompanyA", role: ["writer"], daily_limit: null },
  { service: "mock", model: "checker-1", company: "CompanyB", role: ["checker"], daily_limit: null },
  { service: "mock", model: "checker-2", company: "CompanyC", role: ["checker"], daily_limit: null },
];

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
  if (prompt.includes("independent checker")) {
    const bad = /Bad/.test(term);
    return JSON.stringify({ belongs_to_subtopic: true, literal_ok: true, field_ok: !bad, effect_usage_ok: true, hi_en_same: true, level_ok: true, score: bad ? 40 : 92, objections: bad ? ["field meaning is wrong (mock)"] : [] });
  }
  if (prompt.startsWith("Translate")) return '{"en":"This is a sample made for testing."}';
  if (prompt.startsWith("Original English")) return '{"score":90,"same":true}';
  throw new Error("mock: unknown prompt");
}

export const mockResolve = async (term) => ({ ok: true, url: `https://example.test/${encodeURIComponent(term)}`, text: `${term} is mentioned on this page, used only for dry runs.` });
