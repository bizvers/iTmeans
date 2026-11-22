// Edge cache for pages made on request (Cloudflare build only; static pages never reach this).
// A word page is made once from R2, then Cloudflare's cache in each city keeps it (as long as its Cache-Control says),
// so the next readers get it without running the page or reading R2.
// Works on a custom domain (itmeans.org); on *.workers.dev the cache API does nothing and every request renders.
import { defineMiddleware } from "astro:middleware";
import { onCloudflare } from "./lib/content";

interface EdgeCache { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> }

export const onRequest = defineMiddleware(async (context, next) => {
  const cache = onCloudflare && context.request.method === "GET"
    ? ((globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default)
    : undefined;
  if (!cache) return next();

  // one copy per address, whatever the query string (?theme= is read by the page's own script)
  const url = new URL(context.request.url);
  url.search = "";
  const key = new Request(url.toString(), { method: "GET" });

  const hit = await cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set("X-Itm-Cache", "HIT");
    return res;
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
  return res;
});
