// robots.txt: tells search engines what to read and where the sitemap is.
// The Cloudflare version is a trial (scale step s1) that copies the GitHub Pages site, so it asks search engines to stay
// away until it becomes the real site (scale step s4): then build it with ITM_PUBLIC=1.
// Note: on GitHub Pages this file sits at /iTmeans/robots.txt, where search engines do not look; the sitemap is
// then given to Google Search Console by hand.
import { onCloudflare } from "../lib/content";
import { abs } from "../lib/sitemap";
export const prerender = true;
export const GET = () => {
  const closed = onCloudflare && !process.env.ITM_PUBLIC;
  const body = closed
    ? "# Trial copy: not for search engines yet.\nUser-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\n\nSitemap: ${abs("sitemap-index.xml")}\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
