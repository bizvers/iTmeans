# खाते चालू करना (एक बार का सेटअप)

कोड तैयार है (पाठक के खाते: `site/src/lib/account.ts`, एडमिन पन्ना: `site/src/pages/[lang]/admin/`)। नीचे वे सेवाएँ हैं जो **यूज़र के अपने खाते** से बनती हैं। जब तक ये न हों, साइट पर कोई sign-in नहीं दिखता और बाक़ी सब वैसे ही चलता है।

## क. पाठक के खाते: Firebase (मुफ़्त Spark प्लान) — ✅ हो चुका (15 नवं 2026)
प्रोजेक्ट `itmeans-b5f02`: login (Google, ईमेल), मंज़ूर डोमेन, Firestore (`(default)`), नियम और वेब-ऐप `itmeans-web` बन चुके। चार सार्वजनिक मान `.github/workflows/deploy.yml` में हैं (Variables की ज़रूरत नहीं रही)। नीचे के कदम सिर्फ़ संदर्भ के लिए, या नया प्रोजेक्ट बनाना हो तो।

1. https://console.firebase.google.com → **Add project** → नाम `itmeans` (Google Analytics बंद रखें)।
2. **Build → Authentication → Get started** → *Sign-in method* में **Google** और **Email/Password** चालू करें।
3. उसी जगह **Settings → Authorized domains** में `bizvers.github.io` जोड़ें।
4. **Build → Firestore Database → Create database** → *Production mode*, जगह `asia-south1 (Mumbai)`।
5. Firestore के **Rules** टैब में `firestore.rules` (इस भंडार की जड़ में) की पूरी सामग्री चिपकाकर **Publish** करें।
6. **Project settings (गियर) → Your apps → Web (`</>`)** → ऐप का नाम `itmeans-web` → दिखने वाले `firebaseConfig` से ये चार मान लें: `apiKey`, `authDomain`, `projectId`, `appId`। (ये मान सार्वजनिक होने के लिए ही बने हैं, गुप्त नहीं।)
7. GitHub भंडार → **Settings → Secrets and variables → Actions → Variables** टैब → चार नए Variables: `PUBLIC_FIREBASE_API_KEY`, `PUBLIC_FIREBASE_AUTH_DOMAIN`, `PUBLIC_FIREBASE_PROJECT_ID`, `PUBLIC_FIREBASE_APP_ID`।
8. Actions → **deploy** → *Run workflow*। इसके बाद साइट के ऊपर "साइन इन" दिखेगा।

ग़लती की रिपोर्टें Firebase कंसोल के Firestore में `reports` में दिखती हैं (नाम, ईमेल, शब्द, संदेश)। पाठक का खाता हटाना हो तो Authentication → Users में उसे हटाएँ, और Firestore में `users/<uid>`।

## ख. एडमिन पन्ना (साइट का अपना, वही Firebase login)
कोई Cloudflare या GitHub token नहीं चाहिए। एडमिन पन्ना `https://bizvers.github.io/iTmeans/hi/admin/` है (साइन इन करने पर ऊपर "एडमिन" का लिंक भी दिखता है, अगर खाता एडमिन हो)।
- **एडमिन कौन:** जिस खाते के लिए Firestore में `admins/<उसका-uid>` नाम का दस्तावेज़ है। पहला एडमिन आपका खाता है: आप साइट पर पहली बार Google से साइन इन कीजिए, फिर वह दस्तावेज़ Firebase कंसोल में बन जाएगा (मैं Chrome से बना दूँगा)। नया एडमिन जोड़ना = उसके uid का वैसा ही दस्तावेज़।
- **क्या कर सकता है:** रोज़ की सीमा, "सब रोको", ठहराव की प्रतिशत और अंक-सीमाएँ, क्षेत्र/भाषा चालू-बंद, चक्र का ठहराव हटाना, और पाठकों की भेजी ग़लतियाँ देखकर "सुलझा दिया" करना।
- **कैसे लागू होता है:** सेव करने पर सेटिंग Firestore (`config/settings`) में जाती है; हर घंटे चक्र से पहले `scripts/sync-admin-settings.mjs` उसे `content/settings/settings.json`, `taxonomy.json`, `pause.json` में उतार देता है।
- **सुरक्षा:** `firestore.rules` में `config` सबको पढ़ने योग्य है (उसमें कोई गुप्त बात नहीं), लिखना सिर्फ़ एडमिन; ग़लतियों की रिपोर्ट सिर्फ़ एडमिन पढ़ सकता है।
## ग. जाँच
- ऊपर "साइन इन" → खाता बनाएँ → किसी शब्द पर "पढ़ लिया" → "मेरा पन्ना" पर गिनती बढ़ी दिखे।
- एडमिन पन्ने पर login करके कोई सेटिंग बदलकर सेव करें।
