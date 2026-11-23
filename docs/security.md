# सुरक्षा: हालत और जाँच-सूची

पहली जाँच 24 नवं 2026 (कोड और सेटिंग-फ़ाइलें)। Cloudflare, Firebase और GitHub के dashboard की सेटिंग कोड से नहीं दिखतीं; वे "यूज़र के काम" में हैं।

## क्या सुरक्षित है
- साइट ज़्यादातर पक्के पन्ने हैं; अपना server/database/पासवर्ड नहीं।
- `.env` git में नहीं जाता; कोड में कोई असली चाबी नहीं (सिर्फ़ Firebase की सार्वजनिक वेब-चाबी, जो सामान्य है)।
- Firestore नियम: हर पाठक सिर्फ़ अपना डेटा; एडमिन साइट से नहीं बनता; रिपोर्ट सिर्फ़ एडमिन पढ़ें।
- D1 खोज में सवाल `bind` से जाता है (SQL injection नहीं)।
- लेख का पाठ पन्ने पर आने से पहले `esc()` से साफ़ होता है।

## 24 नवं को किए सुधार
| क्या | कहाँ |
| --- | --- |
| `<script type="application/json">` में डेटा `safeJson` से जाता है (`<`, `>`, `&` बदल जाते हैं), ताकि AI के लिखे पाठ में `</script>` हो तो भी कोड न चले | `site/src/lib/safe-json.ts`, 5 पन्ने/घटक |
| सुरक्षा-हेडर: `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS, और CSP का हल्का हिस्सा (`frame-ancestors`, `base-uri`, `object-src`, `form-action`) | `site/public/_headers` (पक्की फ़ाइलें), `site/src/middleware.ts` (माँग पर बने पन्ने) |
| सामग्री की सुरक्षा-जाँच: `javascript:`, `</script`, `on...=` जैसी चीज़ों पर build और चक्र रुकते हैं; `<script>` टैग और लिंक सिर्फ़ चेतावनी | `scripts/scan-content-safety.mjs`, `validate-content.mjs` से अपने-आप चलती है |
| Firestore नियम: फ़ील्ड-गिनती और आकार की सीमा (पढ़ा निशान, नोट, पसंद, रिपोर्ट); एडमिन रिपोर्ट में सिर्फ़ `status` बदल सकता है | `firestore.rules` |

## जानी-बूझी बातें (अभी ठीक नहीं की)
- **`npm audit`: 4 high**, सब `firebase` → `@grpc/grpc-js` की राह से। यह grpc का server-वाला हिस्सा है; हमारी साइट Firebase सिर्फ़ browser में चलाती है, इसलिए असर नहीं। सुझाया `--force` हल `firebase` को 9.14 पर गिराता है, इसलिए नहीं किया। नया firebase आने पर दोबारा देखें।
- **पूरा CSP (`script-src`) नहीं लगा।** साइट inline script और Firebase/Google से लोड करती है; पूरी CSP बिना असली जाँच के कुछ तोड़ सकती है। अगला क़दम: पहले `Content-Security-Policy-Report-Only` से देखना।
- GitHub Actions के पैकेज टैग (`@v4`) से जुड़े हैं, commit-hash से नहीं।

## यूज़र के काम (खाते की सुरक्षा)
- [ ] Google, GitHub, Cloudflare, Firebase और डोमेन-खाते पर 2-step verification।
- [ ] GitHub में `main` पर branch protection (सीधे push नहीं, PR ज़रूरी)।
- [ ] Google Cloud में Firebase वेब-चाबी पर HTTP referrer पाबंदी (`itmeans.org/*`)।
- [ ] `firestore.rules` की नई फ़ाइल Firebase console में publish करना (Firestore → Rules)।
- [ ] Firebase और Cloudflare में ख़र्च/सीमा का अलर्ट।
- [ ] API चाबियाँ समय-समय पर बदलना; किसी चैट या स्क्रीन में दिख जाएँ तो तुरंत।

## हर पड़ाव के बाद दोहराएँ
1. `node scripts/validate-content.mjs` (इसमें सुरक्षा-स्कैन शामिल)।
2. `npm audit --omit=dev` (site/ में); नया high दिखे तो यहाँ दर्ज करें।
3. नए `set:html`, `innerHTML` या `<form>` जुड़े हों तो जाँचें कि `safeJson` / `esc` लगा है।
4. `firestore.rules` में कोई नया रास्ता जुड़ा हो तो उसमें आकार की सीमा हो।
5. `git grep` से चाबी-जैसे पाठ (`AIza`, `sk-`, `gsk_`, `nvapi-`, `ghp_`) की जाँच, `content/` छोड़कर।
