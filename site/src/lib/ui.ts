// UI strings per language. Add a new language = add one block here (+ turn it on in taxonomy.json).
export const ui: Record<string, Record<string, string>> = {
  hi: {
    site: "iTmeans", tagline: "हर क्षेत्र का A–Z शब्दकोश",
    heroTitle: "हर क्षेत्र का A–Z शब्दकोश", heroSub: "क्षेत्र चुनिए, उप-विषय चुनिए, A से Z तक शब्द एक नज़र में।",
    search: "शब्द खोजें…", noResults: "कुछ नहीं मिला", domains: "क्षेत्र",
    words: "शब्द", word1: "शब्द", dense: "घना", open: "खुला", all: "सभी",
    basic: "बुनियादी", advanced: "आगे का", literal: "शाब्दिक अर्थ", fieldMeaning: "इस क्षेत्र में अर्थ",
    effect: "असर", glance: "एक नज़र में असर", usage: "प्रयोग", example: "उदाहरण", caution: "सावधानी",
    related: "जुड़े शब्द", prev: "पिछला शब्द", next: "अगला शब्द", back: "सूची पर लौटें",
    report: "ग़लती बताएँ", notAdvice: "यह क़ानूनी सलाह नहीं है।",
    provenance: "AI ने लिखा · AI ने जाँचा", written: "लिखा", checked: "जाँचा", date: "तारीख़",
    pending: "(जाँच का ब्योरा अभी नहीं)", sample: "नमूना शब्द",
    hourly: "कोश हर घंटे बढ़ता है", preview: "झलक", openPage: "पूरा पन्ना खोलें", empty: "इस अक्षर पर अभी कोई शब्द नहीं",
    emptySub: "इस उप-विषय में अभी शब्द नहीं हैं", pron: "उच्चारण", skip: "सामग्री पर जाएँ",
  },
  en: {
    site: "iTmeans", tagline: "An A–Z dictionary for every field",
    heroTitle: "An A–Z dictionary for every field", heroSub: "Pick a field, pick a subtopic, see every word from A to Z at a glance.",
    search: "Search words…", noResults: "Nothing found", domains: "Fields",
    words: "words", word1: "word", dense: "Dense", open: "Open", all: "All",
    basic: "Basic", advanced: "Advanced", literal: "Literal meaning", fieldMeaning: "Meaning in this field",
    effect: "Effect", glance: "Effect at a glance", usage: "Usage", example: "Example", caution: "Caution",
    related: "Related words", prev: "Previous word", next: "Next word", back: "Back to list",
    report: "Report a mistake", notAdvice: "This is not legal advice.",
    provenance: "Written by AI · Checked by AI", written: "Written", checked: "Checked", date: "Date",
    pending: "(check details not yet recorded)", sample: "Sample word",
    hourly: "The dictionary grows every hour", preview: "Preview", openPage: "Open full page", empty: "No words for this letter yet",
    emptySub: "No words in this subtopic yet", pron: "Pronunciation", skip: "Skip to content",
  },
};
export const tr = (lang: string, k: string) => (ui[lang] ?? ui.en)[k] ?? ui.en[k] ?? k;
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export const REPORT_URL = "https://github.com/"; // TODO stage 2: point to the repo's issue form once it exists
