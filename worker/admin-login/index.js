// "Login with GitHub" bridge for the iTmeans admin page (Sveltia CMS). Runs as a free Cloudflare Worker.
// The admin page opens  <this worker>/auth  in a popup; GitHub asks the person to allow access; we trade GitHub's one-time
// code for an access token and hand it back to the admin page (and only to an allowed origin). No token is ever stored here.
// Who can change content is still decided by GitHub: only accounts with write access to the repository can save.
//
// Needs (set in Cloudflare, never in code):  GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET   (variable/secret)
//                                            ALLOWED_ORIGINS  e.g. "https://bizvers.github.io"  (comma separated)

const SCOPE = "public_repo,user"; // the content repository is public; "repo" would be needed only for a private one

const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } });

const cookie = (state) => `itmeans_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
const readCookie = (req, name) => (req.headers.get("Cookie") ?? "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1];

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// The small page GitHub sends the popup back to: it tells the admin page "authorizing", waits for the admin page to answer,
// then posts the result only to an allowed origin.
function resultPage(status, payload, origins) {
  const msg = `authorization:github:${status}:${JSON.stringify(payload)}`;
  return html(`<!doctype html><meta charset="utf-8"><title>iTmeans admin login</title><p>…</p>
<script>
(function () {
  var allowed = ${JSON.stringify(origins)};
  function receive(e) {
    if (allowed.indexOf(e.origin) === -1) return;
    window.opener.postMessage(${JSON.stringify(msg)}, e.origin);
    window.removeEventListener("message", receive, false);
    setTimeout(function () { window.close(); }, 300);
  }
  window.addEventListener("message", receive, false);
  window.opener && window.opener.postMessage("authorizing:github", "*");
})();
</script>`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origins = allowedOrigins(env);

    if (url.pathname === "/auth") {
      const state = crypto.randomUUID();
      const to = new URL("https://github.com/login/oauth/authorize");
      to.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      to.searchParams.set("scope", SCOPE);
      to.searchParams.set("state", state);
      return new Response(null, { status: 302, headers: { Location: to.toString(), "Set-Cookie": cookie(state) } });
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state || state !== readCookie(request, "itmeans_state")) {
        return resultPage("error", { error: "state-mismatch" }, origins);
      }
      const r = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "itmeans-admin-login" },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
      });
      const data = await r.json().catch(() => ({}));
      if (!data.access_token) return resultPage("error", { error: data.error ?? "no-token" }, origins);
      return resultPage("success", { token: data.access_token, provider: "github" }, origins);
    }

    return html("iTmeans admin login", 200);
  },
};
