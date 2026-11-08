/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { apiOrigins, buildCsp, cspMetaTag } from "./src/csp.ts";

// Built index.html gets the CSP as a <meta> tag (GitHub Pages cannot send headers, D10). Build only: the dev server
// needs inline scripts for hot reload. Local builds that talk to a local API: BK_CSP_LOCAL_API=1 or VITE_API_URL.
function cspMeta(policy: string): Plugin {
  return {
    name: "bk-csp-meta",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      // Right after <meta charset> (which must stay in the first 1024 bytes), before any script or stylesheet.
      handler: (html) => {
        const out = html.replace(/(<meta charset="UTF-8" \/>)/i, `$1\n    ${cspMetaTag(policy)}`);
        if (out === html) throw new Error("bk-csp-meta: <meta charset> not found in index.html");
        return out;
      },
    },
  };
}

// The site is served from the GitHub Pages project path https://tdn548.github.io/bombkicker-web/ (D10).
// Keep the same path locally so Unity's PlayerPrefs folder (md5 of the page URL) matches the old site (SS-1).
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ["VITE_", "BK_"]), ...process.env };
  return {
    base: "/bombkicker-web/",
    plugins: [react(), cspMeta(buildCsp(apiOrigins(env)))],
    server: { port: 5180, strictPort: true },
    preview: { port: 8000, strictPort: false },
    build: { outDir: "dist", sourcemap: true },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["src/test/setup.ts"],
      restoreMocks: true,
    },
  };
});
