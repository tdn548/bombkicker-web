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
// - connect-src game servers (BUG-SS18-001): Unity's WebSocket transport to the dedicated server. Edgegap gives
//   wss://<deployment id>.pr.edgegap.net:<dynamic external port> (bombkicker-api docs/api.md, src/lib/edgegap.ts: host =
//   the deployment fqdn, port = ports.gameport.external, TLS Upgrade on, so always wss). Local test builds
//   (BK_CSP_LOCAL_API=1) also allow ws/wss to localhost, 127.0.0.1 and the LAN API host, any port (local Edgegap
//   emulator, Mac dev server); deploy-commit.sh refuses any build that names them.
// - connect-src Unity Services (relay rooms, D5b): the room creator's browser hosts the match over Unity Relay.
//   Captured from the WebGL client in a full room flow (BombKicker .agents/tasks/skin-shop/relay-rooms/csp-capture.md):
//   player-auth (UGS anonymous sign-in), lobby (Multiplayer Services session: create, join by code, heartbeat, leave),
//   relay-allocations (regions, allocate, join code, join), wss://wire.unity3d.com (lobby events) and the Relay server
//   wss://<allocation>.<region>.relay.uf.unity3d.com:<37000-37100> (NGO traffic; WebKit needs the explicit port wildcard).
// A meta policy cannot carry frame-ancestors (browsers ignore it there); main.tsx refuses to run inside a frame.

/** Production Worker (same value as Unity's ApiConfig.ProductionUrl). */
export const PRODUCTION_API_URL = "https://bombkicker-api-production.tdn548.workers.dev";

/** Local API origins Unity and React use for pages on this machine (`<page host>:8787`, config.ts LOCAL_API_PORT). */
export const LOCAL_API_ORIGINS = ["http://localhost:8787", "http://127.0.0.1:8787"] as const;

/** Game servers in production: Edgegap deployments, TLS on a dynamic port. */
export const PRODUCTION_GAME_SERVERS = ["wss://*.pr.edgegap.net:*"] as const;
/** Unity Services the WebGL client calls for relay rooms (https APIs and the lobby events WebSocket). */
export const PRODUCTION_UNITY_SERVICES = [
  "https://player-auth.services.api.unity.com",
  "https://lobby.services.api.unity.com",
  "https://relay-allocations.services.api.unity.com",
  "wss://wire.unity3d.com",
] as const;
/** Unity Relay servers: TLS WebSocket on an allocation-numbered host and a port from 37000-37100. */
export const PRODUCTION_UNITY_RELAY = "wss://*.relay.uf.unity3d.com:*";
/** Every Unity source in connect-src (production and local builds alike). */
export const UNITY_SOURCES: readonly string[] = [...PRODUCTION_UNITY_SERVICES, PRODUCTION_UNITY_RELAY];
/** Hosts a local test build may open WebSockets to (any port). */
export const LOCAL_GAME_SERVER_HOSTS = ["localhost", "127.0.0.1"] as const;
/** localhost, 127.x or a private LAN IPv4 (10.x, 172.16-31.x, 192.168.x); same rule as config.ts isLocalHost. */
function isLocalOrLanHost(host: string): boolean {
  if (host === "localhost") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
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

/**
 * WebSocket sources for Unity's game server connection. Always the Edgegap pattern. Only with BK_CSP_LOCAL_API=1
 * (build-site.sh --local-api): ws:// and wss:// to localhost, 127.0.0.1 and the VITE_API_URL host if that host is
 * local or on the LAN, any port. VITE_API_URL alone never adds a WebSocket source.
 */
export function gameServerSources(env: { VITE_API_URL?: string; BK_CSP_LOCAL_API?: string }): string[] {
  const out: string[] = [...PRODUCTION_GAME_SERVERS];
  if (env.BK_CSP_LOCAL_API !== "1") return out;
  const hosts: string[] = [...LOCAL_GAME_SERVER_HOSTS];
  const override = originOf(env.VITE_API_URL);
  if (override) {
    const host = new URL(override).hostname;
    if (isLocalOrLanHost(host)) hosts.push(host);
  }
  for (const h of new Set(hosts)) out.push(`ws://${h}:*`, `wss://${h}:*`);
  return out;
}
export function buildCsp(
  api: readonly string[],
  gameServers: readonly string[] = PRODUCTION_GAME_SERVERS,
  unity: readonly string[] = UNITY_SOURCES,
): string {
  const apiList = api.join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' blob: 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    `connect-src 'self' ${[...api, ...gameServers, ...unity].join(" ")}`,
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
