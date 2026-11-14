import { languages, domains, allWords, nameIn, t2 } from "../../lib/content";
export function getStaticPaths() { return languages.map((l) => ({ params: { lang: l.code } })); }
export function GET({ params }: { params: { lang: string } }) {
  const lang = params.lang;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const data = allWords().map((w) => {
    const d = domains.find((x) => x.id === w.domain)!;
    const s = d.subtopics.find((x) => x.id === w.subtopic)!;
    return {
      term: w.term, url: `${base}/${lang}/${w.domain}/${w.subtopic}/${w.slug}/`,
      meaning: t2(w.field_meaning, lang).split(/[।.]/)[0],
      where: `${nameIn(d, lang)} › ${nameIn(s, lang)}`,
      key: [w.term, w.pronunciation_hi, w.term_hi ?? "", t2(w.field_meaning, lang)].join(" ").toLowerCase(),
    };
  });
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}
