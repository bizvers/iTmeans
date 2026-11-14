# agent\cycle

घंटेवार चक्र का कोड (पड़ाव 3)। docs/pipeline.md देखें। कोई बाहरी package नहीं; सिर्फ़ Node 20+।

| फ़ाइल | काम |
| --- | --- |
| `cycle.mjs` | एक चक्र: शब्द चुनो → लिखो → 6 जाँचें → छापो या रोक-सूची |
| `checks.mjs` | कोड-जाँच, सोर्स-जाँच, नक़ल-जाँच, ठहराव-नियम (बिना AI) |
| `providers.mjs` | मॉडल बुलाना (चाबी सिर्फ़ environment से), सीमा गिनना, अगली सेवा पर जाना |
| `mock.mjs` | नक़ली मॉडल: बिना चाबी, बिना ख़र्च जाँचने के लिए |
| `cycle.test.mjs` | टेस्ट (scratch copy में चलते हैं, असली `content/` को नहीं छूते) |

```
node --test agent/cycle/cycle.test.mjs
```

असली चक्र: `CYCLE_ENABLED=true` और `config/models.json` (नमूना: `config/models.example.json`) चाहिए। `--mock` सिर्फ़ `ITMEANS_ROOT=<scratch folder>` के साथ चलता है।