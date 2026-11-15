// Run: node --test worker/admin-login/worker.test.mjs   (no network; GitHub's answer is faked)
import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

const env = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "sec", ALLOWED_ORIGINS: "https://bizvers.github.io" };
const get = (path, cookie) => worker.fetch(new Request(`https://x.workers.dev${path}`, cookie ? { headers: { Cookie: cookie } } : {}), env);

test("/auth sends the person to GitHub with our client id and remembers a state", async () => {
  const r = await get("/auth");
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get("Location"));
  assert.equal(to.origin + to.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(to.searchParams.get("client_id"), "cid");
  assert.equal(to.searchParams.get("scope"), "public_repo,user");
  assert.match(r.headers.get("Set-Cookie"), /itmeans_state=.+HttpOnly/);
});

test("/callback with a wrong state is refused and never asks GitHub for a token", async () => {
  let called = false;
  const real = globalThis.fetch; globalThis.fetch = async () => { called = true; return { json: async () => ({}) }; };
  try {
    const text = await (await get("/callback?code=c&state=wrong", "itmeans_state=right")).text();
    assert.match(text, /authorization:github:error/);
    assert.match(text, /state-mismatch/);
    assert.equal(called, false);
  } finally { globalThis.fetch = real; }
});

test("/callback with a good state returns the token, addressed only to the allowed origin", async () => {
  const real = globalThis.fetch; globalThis.fetch = async () => ({ json: async () => ({ access_token: "TOK" }) });
  try {
    const text = await (await get("/callback?code=c&state=right", "itmeans_state=right")).text();
    assert.match(text, /authorization:github:success/);
    assert.match(text, /TOK/);
    assert.match(text, /\["https:\/\/bizvers\.github\.io"\]/); // only this origin may receive it
  } finally { globalThis.fetch = real; }
});

test("GitHub refusing the code gives an error, not a token", async () => {
  const real = globalThis.fetch; globalThis.fetch = async () => ({ json: async () => ({ error: "bad_verification_code" }) });
  try {
    const text = await (await get("/callback?code=c&state=right", "itmeans_state=right")).text();
    assert.match(text, /authorization:github:error/);
    assert.doesNotMatch(text, /access_token/);
  } finally { globalThis.fetch = real; }
});
