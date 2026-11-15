# खाते चालू करना (एक बार का सेटअप)

कोड तैयार है (पाठक के खाते: `site/src/lib/account.ts`, एडमिन login: `worker/admin-login/`)। नीचे वे सेवाएँ हैं जो **यूज़र के अपने खाते** से बनती हैं। जब तक ये न हों, साइट पर कोई sign-in नहीं दिखता और बाक़ी सब वैसे ही चलता है।

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

## ख. एडमिन login: "GitHub से login" बटन
1. **GitHub OAuth App** (सीधा पता, "Developer settings" ढूँढना नहीं पड़ेगा): https://github.com/settings/applications/new
   - Application name: `iTmeans admin` · Homepage URL: `https://bizvers.github.io/iTmeans/`
   - Authorization callback URL: `https://itmeans-admin-login.<आपका-workers-नाम>.workers.dev/callback` (अगला कदम बनने पर पता पक्का होता है; बाद में बदला जा सकता है)।
   - **Register application** → *Client ID* दिखेगा; **Generate a new client secret** से secret बनाएँ (वह एक ही बार दिखता है)।
2. **Cloudflare** (मुफ़्त खाता): Workers & Pages → Create → Worker → नाम `itmeans-admin-login` → `worker/admin-login/index.js` की सामग्री चिपकाकर Deploy।
3. उस Worker की **Settings → Variables and Secrets** में: `GITHUB_CLIENT_ID` (Text), `GITHUB_CLIENT_SECRET` (**Secret**), `ALLOWED_ORIGINS` = `https://bizvers.github.io`।
4. `site/public/admin/config.yml` के `backend:` में `base_url: https://itmeans-admin-login.<नाम>.workers.dev` जोड़ें (मैं जोड़ दूँगा, पता बताइए)।
5. `https://bizvers.github.io/iTmeans/admin/` पर अब **"Login with GitHub"** बटन आएगा।

**एडमिन कौन:** भंडार (Settings → Collaborators) में जोड़े गए GitHub खाते ही सामग्री सेव कर सकेंगे।

## ग. जाँच
- ऊपर "साइन इन" → खाता बनाएँ → किसी शब्द पर "पढ़ लिया" → "मेरा पन्ना" पर गिनती बढ़ी दिखे।
- एडमिन पन्ने पर login करके कोई सेटिंग बदलकर सेव करें।
