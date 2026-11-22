// Stand-in for "cloudflare:workers" in the static (GitHub Pages) build, which never reads R2.
export const env: Record<string, unknown> = {};
