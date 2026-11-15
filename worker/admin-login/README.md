# एडमिन login पुल (Cloudflare Worker)

एडमिन पन्ने (`/admin/`) में "Login with GitHub" बटन के पीछे का छोटा प्रोग्राम। मुफ़्त Cloudflare Workers पर चलता है। कोई token या चाबी कोड में नहीं; `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` सिर्फ़ Cloudflare में रखे जाते हैं।

**कौन सेव कर सकता है:** यह पुल सिर्फ़ login कराता है। सामग्री बदलने का अधिकार GitHub तय करता है: जिस खाते को भंडार `bizvers/iTmeans` में लिखने का अधिकार (collaborator) है वही एडमिन। नया एडमिन = भंडार में उसे जोड़ना (Settings → Collaborators)।

## एक बार का सेटअप (ब्योरा `docs/accounts-setup.md` में)
1. GitHub में एक OAuth App (callback: `https://<worker-पता>/callback`)।
2. Cloudflare में यह Worker (`wrangler deploy`, या डैशबोर्ड से) और दो मान: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`।
3. `site/public/admin/config.yml` के `backend` में `base_url: https://<worker-पता>`।
