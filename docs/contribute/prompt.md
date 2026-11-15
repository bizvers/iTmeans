# iTmeans: अपने AI को देने वाला संदेश (prompt)

नीचे की **पूरी** लाइनें (``` के बीच वाली) कॉपी कीजिए और अपने AI (Claude, ChatGPT, Gemini…) में चिपकाइए।
पहले ऊपर की चार लाइनें भरिए: क्षेत्र, उप-विषय, शब्द और आपका AI कौन-सा है। क्षेत्र और उप-विषय के नाम `README.md` की सूची से लीजिए।
AI जो जवाब दे, उसे **बिना बदले** एक `.json` फ़ाइल में सेव करके भेज दीजिए।

```
DOMAIN: web-development
SUBTOPIC: frontend
TERMS: Flexbox, Viewport, Lazy loading
MY AI: ChatGPT (gpt-5)

You are writing entries for iTmeans, a bilingual (Hindi + English) A-Z dictionary.
For EACH term in TERMS write one entry about its meaning in the field DOMAIN / SUBTOPIC.
If TERMS is empty, choose 10 important terms of that subtopic yourself.

Rules for every entry:
- Use ONLY facts you are sure of. Keep it short and plain. Technical terms stay in English even inside Hindi text.
- Hindi in Devanagari. Do not invent a Hindi translation of the term; "term_hi" is null unless a Hindi word is really used.
- "effect" and "effect_flow": NO numbers, NO percentages.
- If DOMAIN is law: no section numbers.
- field_meaning.hi: the FIRST sentence must be at most 60 characters including spaces. Put detail in the second sentence.
- Do not copy sentences from any website or book; write in your own words.
- "related": 2 to 5 OTHER English terms of the same field, as plain names (e.g. "Load balancer"), never the term itself.
- "level": "basic" or "advanced".
- "effect_flow": exactly 3 short steps showing how the effect happens.

Reply with ONE JSON object only, no other text, in exactly this shape
(put DOMAIN, SUBTOPIC and MY AI into the first fields; "ai_company" is the company that made your AI, e.g. OpenAI, Google, Anthropic):
{"format":"itmeans-draft-1","ai_company":"","ai_model":"","contributor":"","domain":"","subtopic":"",
"words":[
{"term":"","level":"basic","pronunciation_hi":"","term_hi":null,
"literal_meaning":{"hi":"","en":""},"field_meaning":{"hi":"","en":""},"effect":{"hi":"","en":""},
"effect_flow":[{"hi":"","en":""},{"hi":"","en":""},{"hi":"","en":""}],
"usage":{"hi":"","en":""},"example":{"hi":"","en":""},"caution":{"hi":"","en":""},
"related":["",""]}
]}
```

"contributor" में अपना नाम लिख सकते हैं (या ख़ाली छोड़ दें)। ईमेल या फ़ोन नंबर न लिखें: यह फ़ाइल सबको दिख सकती है।
