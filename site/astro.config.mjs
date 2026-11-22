import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

// ASTRO_BASE is "/iTmeans" on GitHub Pages (a project site lives under the repo name) and empty for a custom domain.
// ASTRO_SITE is the full address, e.g. https://bizvers.github.io (only needed for absolute links).
//
// ITM_TARGET=cloudflare builds the scale version (docs/decisions.md, 22 Nov 2026): home, subject and topic pages are
// still made at build time, but word pages are made on request from the R2 bucket (binding WORDS) and cached by the CDN.
// Without ITM_TARGET the site is built exactly as before (every page static, for GitHub Pages).
const cf = process.env.ITM_TARGET === "cloudflare";
const here = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.resolve(here, "..", "content");

// In the Worker there is no ../content folder, so taxonomy and UI words are written into the code at build time.
function inlinedData() {
  const read = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  const ui = {};
  for (const f of fs.readdirSync(path.join(contentDir, "ui")).filter((x) => x.endsWith(".json"))) ui[path.basename(f, ".json")] = read(path.join(contentDir, "ui", f));
  return { taxonomy: read(path.join(contentDir, "taxonomy", "taxonomy.json")), ui };
}

// Word pages render on request in the Cloudflare build (instead of being listed by getStaticPaths).
const onDemandWords = {
  name: "itm-on-demand-words",
  hooks: {
    "astro:route:setup": ({ route }) => {
      if (/\[slug\]\.astro$/.test(route.component)) route.prerender = false;
    },
  },
};

const adapter = cf ? (await import("@astrojs/cloudflare")).default({ prerenderEnvironment: "node", imageService: "passthrough", imagesBindingName: false }) : undefined;

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  base: process.env.ASTRO_BASE || "/",
  site: process.env.ASTRO_SITE || (cf ? "https://itmeans.org" : undefined),
  ...(cf ? { adapter, session: false, integrations: [onDemandWords] } : {}),
  vite: {
    define: {
      __ITM_TARGET__: JSON.stringify(cf ? "cloudflare" : "static"),
      ...(cf ? { __ITM_DATA__: JSON.stringify(inlinedData()) } : {}),
    },
    // the static build never talks to Cloudflare; this stub stands in for the runtime module
    resolve: cf ? {} : { alias: { "cloudflare:workers": path.resolve(here, "src/lib/cf-stub.ts") } },
  },
});
