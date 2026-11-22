// The list of all sitemap files (give this one address to Google Search Console).
import { indexXml, xml } from "../lib/sitemap";
export const prerender = true;
export const GET = () => xml(indexXml());
