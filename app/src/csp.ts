// Content Security Policy of the built site (SS-7 recheck, SEC-008). GitHub Pages cannot set response headers (D10),
// so the policy ships as <meta http-equiv="Content-Security-Policy"> in index.html, added by the Vite build only
// (`vite` dev serves inline scripts for hot reload and gets no policy). Pure code: used by vite.config.ts and tested in
// csp.test.ts. No import.meta.env here, this file also runs in Node.
//
// What each source is for (checked in Chrome against the 6000.3.10f1 gzip + decompression fallback build):
// - script-src blob: the Unity loader decompresses Web.framework.js.unityweb and runs it from a blob: <script>.
// - script-src 'wasm-unsafe-eval': WebAssembly.instantiate of Web.wasm.unityweb (allows wasm only, not eval()).
// - worker-src blob: the loader's gzip decompression Worker is made from a blob: URL.
// - connect-src / img-src API origin: React's fetches and sheet <img>; Unity's UnityWebRequest calls and sheet downloads.
// A meta policy cannot carry frame-ancestors (browsers ignore it there); main.tsx refuses to run inside a frame.

/** Production Worker (same value as Unity's ApiConfig.ProductionUrl). */
export const PRODUCTION_API_URL = "https://bombkicker-api-production.tdn548.workers.dev";

/** Local API origins Unity and React use for pages on this machine (`<page host>:8787`, config.ts LOCAL_API_PORT). */
export const LOCAL_API_ORIGINS = ["http://localhost:8787", "http://127.0.0.1:8787"] as const;

/** Origin of an http(s) URL, or null for anything else (so a bad env value cannot widen the policy). */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * API origins the policy allows. Production only, unless the build is for local tests:
 * - VITE_API_URL set (the site talks to that API; Unity uses `<page host>:8787`, so set it to that for LAN tests)
 * - BK_CSP_LOCAL_API=1 adds http://localhost:8787 and http://127.0.0.1:8787 (real e2e suite, local rehearsal)
 */
export function apiOrigins(env: { VITE_API_URL?: string; BK_CSP_LOCAL_API?: string }): string[] {
  const out = [PRODUCTION_API_URL];
  const override = originOf(env.VITE_API_URL);
  if (override) out.push(override);
  if (env.BK_CSP_LOCAL_API === "1") out.push(...LOCAL_API_ORIGINS);
  return [...new Set(out)];
}

export function buildCsp(api: readonly string[]): string {
  const apiList = api.join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' blob: 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    `connect-src 'self' ${apiList}`,
    `img-src 'self' data: blob: ${apiList}`,
    "style-src 'self'",
    "font-src 'self'",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function cspMetaTag(policy: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" />`;
}
