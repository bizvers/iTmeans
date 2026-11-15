# ChatGPT / Gemini से Excel में शब्द बनवाने का prompt

1. नीचे ``` के बीच का पूरा text कॉपी कीजिए। ऊपर की तीन लाइनें (DOMAIN, SUBTOPIC, TERMS) भरिए।
   एक बार में **15 शब्द** तक रखिए; ज़्यादा पर AI बीच में रुक सकता है।
2. ChatGPT या Gemini में चिपकाइए। वह एक Excel फ़ाइल (.xlsx) देगा।
   Gemini फ़ाइल न दे तो: "Export to Sheets" → Google Sheets में File → Download → Microsoft Excel (.xlsx)।
   अगर AI सिर्फ़ CSV text दे, तो उसे `.csv` फ़ाइल में सेव कर लीजिए; वह भी चलेगी।
3. फ़ाइल Claude को दीजिए और बताइए किस AI से बनी है। Claude चलाएगा: `node scripts/import-sheet.mjs <फ़ाइल> --ai=ChatGPT`
   इससे शब्द `content/drafts/` में पहुँचते हैं और हर घंटे का चक्र उन्हें जाँचकर छापता है (नतीजा `content/drafts/done/` में)।

```
DOMAIN: web-development
SUBTOPIC: frontend
TERMS: Flexbox, Viewport, Lazy loading, Media query, CSS Grid

Create an Excel file (.xlsx) for iTmeans, a bilingual (Hindi + English) dictionary.
One row per term in TERMS (if TERMS is empty, choose 15 important terms of this subtopic).
Row 1 must contain exactly these 26 column names, in this order:
domain, subtopic, term, level, pronunciation_hi, term_hi, literal_hi, literal_en, meaning_hi, meaning_en, effect_hi, effect_en, flow1_hi, flow1_en, flow2_hi, flow2_en, flow3_hi, flow3_en, usage_hi, usage_en, example_hi, example_en, caution_hi, caution_en, related, ai_company

What goes in each column:
- domain, subtopic: copy DOMAIN and SUBTOPIC exactly as given above (lowercase, with dashes).
- term: the English term.
- level: basic or advanced.
- pronunciation_hi: how the English term sounds, written in Devanagari.
- term_hi: a Hindi word for the term ONLY if one is really used; otherwise write null. Never invent one.
- literal_hi / literal_en: the plain everyday meaning of the word(s).
- meaning_hi / meaning_en: what it means in this field. In meaning_hi the FIRST sentence must be at most 60 characters including spaces; put detail in a second sentence.
- effect_hi / effect_en: what difference it makes. NO numbers, NO percentages.
- flow1 / flow2 / flow3 (_hi and _en): three short steps showing how that effect happens. NO numbers.
- usage: where or when it is used. example: one short real-life example. caution: one common mistake or risk.
- related: 2 to 5 OTHER English terms of the same field, separated by semicolons (e.g. Grid; Media query). Never the term itself.
- ai_company: the company that made you (OpenAI or Google).

Rules:
- Use ONLY facts you are sure of. Short, plain sentences. Technical terms stay in English even inside Hindi text.
- All _hi columns in Hindi (Devanagari); all _en columns in English. Every column must be filled (term_hi may be null).
- Write in your own words; do not copy from any website or book.
- If DOMAIN is law: no section numbers.
Give me the .xlsx file to download. If you cannot make a file, give the same table as CSV text in one code block.
```
