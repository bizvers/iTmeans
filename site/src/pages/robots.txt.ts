// robots.txt: tells search engines what to read and where the sitemap is.
// The Cloudflare build stays closed to search engines unless built with ITM_PUBLIC=1 (cloudflare.yml sets it since
// scale step s4, 23 Nov 2026, when itmeans.org became the only site), so a local or trial build is never indexed.
import { onCloudflare } from "../lib/content";
import { abs } from "../lib/sitemap";
export const prerender = true;
export const GET = () => {
  const closed = onCloudflare && !process.env.ITM_PUBLIC;
  const body = closed
    ? "# Trial copy: not for search engines yet.\nUser-agent: *\nDisallow: /\n"
    // personal and admin pages, and the suggestion API, have nothing for search engines
    : `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /*/admin/\nDisallow: /*/me/\n\nSitemap: ${abs("sitemap-index.xml")}\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
