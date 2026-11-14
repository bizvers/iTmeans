import { defineConfig } from "astro/config";

// ASTRO_BASE is "/iTmeans" on GitHub Pages (a project site lives under the repo name) and empty for a custom domain.
// ASTRO_SITE is the full address, e.g. https://bizvers.github.io (only needed for absolute links).
export default defineConfig({
  output: "static",
  trailingSlash: "always",
  base: process.env.ASTRO_BASE || "/",
  site: process.env.ASTRO_SITE || undefined,
});
