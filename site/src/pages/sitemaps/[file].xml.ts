// One sitemap file per language and part: /sitemaps/hi-1.xml, /sitemaps/en-1.xml ...
import type { APIRoute } from "astro";
import { files, fileXml, xml } from "../../lib/sitemap";
export const prerender = true;
export const getStaticPaths = () => files().map((file) => ({ params: { file } }));
export const GET: APIRoute = ({ params }) => xml(fileXml(params.file!) ?? "");
