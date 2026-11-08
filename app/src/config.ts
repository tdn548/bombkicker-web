// App-wide switches. Change hosting-related behaviour only here.

/**
 * Router mode. "hash" while the site is on GitHub Pages (D10): Pages has no SPA fallback, so routes live after "#".
 * "browser" is for a host with an index.html fallback (Cloudflare Pages, after the deadline).
 */
export const ROUTER_MODE: "hash" | "browser" = "hash";

/** Production Worker (same value as Unity's ApiConfig.ProductionUrl). */
export const PRODUCTION_API_URL = "https://bombkicker-api-production.tdn548.workers.dev";
/** wrangler dev port; Unity's ApiConfig uses the same port when the page is served from localhost or the LAN. */
export const LOCAL_API_PORT = 8787;

/**
 * True for pages served from this machine or the LAN (localhost, 127.x, 10.x, 192.168.x, 172.16-31.x).
 * Same rule as Unity's ApiConfig.LocalPageHost, so React and Unity always talk to the same API.
 */
export function isLocalHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** API base URL: VITE_API_URL if set, else the local API for local pages, else production. No trailing slash. */
export function resolveApiUrl(hostname: string, override: string | undefined): string {
  if (override && /^https?:\/\//.test(override)) return override.replace(/\/+$/, "");
  if (isLocalHost(hostname)) return `http://${hostname}:${LOCAL_API_PORT}`;
  return PRODUCTION_API_URL;
}

const env = import.meta.env;

/** Mock API and mock Unity (development without the Worker or the WebGL build): `npm run dev:mock` or `?mock=1`. */
export const USE_MOCK =
  env.MODE === "mock" || (typeof location !== "undefined" && new URLSearchParams(location.search).has("mock"));

export const API_URL = resolveApiUrl(typeof location !== "undefined" ? location.hostname : "localhost", env.VITE_API_URL);

/** Unity WebGL build, copied to public/game/ (SS-16 deploy script; by hand for local tests). */
export const UNITY_BUILD = {
  loaderUrl: `${env.BASE_URL}game/Build/Web.loader.js`,
  dataUrl: `${env.BASE_URL}game/Build/Web.data.unityweb`,
  frameworkUrl: `${env.BASE_URL}game/Build/Web.framework.js.unityweb`,
  codeUrl: `${env.BASE_URL}game/Build/Web.wasm.unityweb`,
  streamingAssetsUrl: `${env.BASE_URL}game/StreamingAssets`,
  // Same values as the live Unity page, so nothing Unity derives from them changes.
  companyName: "KhuongDuy",
  productName: "BombKicker",
  productVersion: "1.0",
};

/** SS-1: cap the canvas resolution on phones (GPU and battery). */
export const UNITY_MAX_DPR = 2;
