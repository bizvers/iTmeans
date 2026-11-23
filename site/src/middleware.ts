// Edge cache for pages made on request (Cloudflare build only; static pages never reach this).
// A word page is made once from R2, then Cloudflare's cache in each city keeps it (as long as its Cache-Control says),
// so the next readers get it without running the page or reading R2.
// Works on a custom domain (itmeans.org); on *.workers.dev the cache API does nothing and every request renders.
import { defineMiddleware } from "astro:middleware";
import { onCloudflare } from "./lib/content";

interface EdgeCache { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> }

// Safe browser defaults for every page made on request. Static files get the same list from public/_headers.
// The CSP part is the low-risk half only (no script-src, so nothing the site loads today is blocked).
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=15552000",
  "Content-Security-Policy": "base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'",
};
function withSecurityHeaders(res: Response): Response {
  try { for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v); } catch { /* immutable headers: leave as is */ }
  return res;
}

// Google sign-in under our own name: Firebase's sign-in pages (/__/auth/...) are served from itmeans.org
// by forwarding them to the project's firebaseapp.com address. Then PUBLIC_FIREBASE_AUTH_DOMAIN can be itmeans.org and
// Google shows "itmeans.org" instead of "itmeans-63c55.firebaseapp.com". Only GET/HEAD, only this path, no cookies forwarded.
const FIREBASE_HOST = "itmeans-63c55.firebaseapp.com";
async function forwardToFirebase(req: Request, url: URL): Promise<Response> {
  const upstream = await fetch(`https://${FIREBASE_HOST}${url.pathname}${url.search}`, {
    method: req.method,
    headers: { "accept": req.headers.get("accept") ?? "*/*", "accept-language": req.headers.get("accept-language") ?? "", "user-agent": req.headers.get("user-agent") ?? "" },
    redirect: "manual",
  });
  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  return new Response(upstream.body, { status: upstream.status, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const reqUrl = new URL(context.request.url);
  if (reqUrl.pathname.startsWith("/__/auth/") && (context.request.method === "GET" || context.request.method === "HEAD")) {
    return forwardToFirebase(context.request, reqUrl);
  }
  const cache = onCloudflare && context.request.method === "GET"
    ? ((globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default)
    : undefined;
  if (!cache) return withSecurityHeaders(await next());

  // pages: one copy per address, whatever the query string (?theme= is read by the page's own script);
  // /api/... and /search/: the query is the question, so it stays in the key
  const url = new URL(context.request.url);
  if (!url.pathname.includes("/api/") && !/\/search\/$/.test(url.pathname)) url.search = "";
  const key = new Request(url.toString(), { method: "GET" });

  const hit = await cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set("X-Itm-Cache", "HIT");
    return withSecurityHeaders(res);
  }
  const res = await next();
  // keep only good, public pages (a missing word must not stay "missing" for a day)
  if (res.status === 200 && /\bpublic\b/.test(res.headers.get("Cache-Control") ?? "")) {
    const copy = res.clone();
    const store = cache.put(key, copy);
    const ctx = (context.locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext;
    if (ctx) ctx.waitUntil(store); else await store;
  }
  res.headers.set("X-Itm-Cache", "MISS");
  return withSecurityHeaders(res);
});
