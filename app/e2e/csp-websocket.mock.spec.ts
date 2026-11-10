// SS-19: the production connect-src must let Unity open its game server WebSocket, wss://<12 hex>.pr.edgegap.net:<dynamic
// port> (UTP WebSocketNetworkInterface.GetServerURL: "wss://" + host + ":" + port + "/"), in WebKit and Chromium.
// WebKit checks connect-src synchronously in the WebSocket constructor: a blocked URL throws SecurityError and fires
// securitypolicyviolation at once, an allowed one just waits on the network (this test never needs the server).
// Runs in the mock projects (desktop Chromium, desktop WebKit, iPhone WebKit); the mock build carries the production CSP.
// Relay rooms (D5b): the same for the Unity Relay server WebSocket, the lobby events WebSocket and the Unity Services
// https APIs, with the URLs captured from the WebGL client (BombKicker .agents/tasks/skin-shop/relay-rooms/csp-capture.md).
// The https calls are answered by page.route (CSP is checked before routing), so no request reaches Unity.
import { expect, test, type Page } from "@playwright/test";
import { PRODUCTION_GAME_SERVERS, PRODUCTION_UNITY_RELAY, UNITY_SOURCES, apiOrigins, buildCsp, gameServerSources } from "../src/csp.ts";
const SERVERS = ["wss://0123456789ab.pr.edgegap.net:31593/", "wss://4e813af7bd5a.pr.edgegap.net:30849/", "wss://4e813af7bd5a.pr.edgegap.net:32217/"];
const RELAY_SOCKETS = [
  "wss://9010128584376776252.us-central1.relay.uf.unity3d.com:37011/",
  "wss://8803433085686526831.us-central1.relay.uf.unity3d.com:37000/",
  "wss://1234567890123456789.europe-west4.relay.uf.unity3d.com:37100/",
  "wss://wire.unity3d.com/v2/ws",
];
const UNITY_HTTPS = [
  "https://player-auth.services.api.unity.com/v1/authentication/anonymous",
  "https://lobby.services.api.unity.com/v1/create",
  "https://lobby.services.api.unity.com/v1/joinbycode",
  "https://relay-allocations.services.api.unity.com/v1/allocate",
  "https://relay-allocations.services.api.unity.com/v1/regions",
];
/** Calls each https URL with fetch in the page (answered locally by page.route); returns the violations. */
async function fetchAll(page: Page, urls: string[]): Promise<string[]> {
  await page.route(/^https:\/\/[a-z-]+\.services\.api\.unity\.com\//, (r) =>
    r.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } }),
  );
  return page.evaluate(async (urls) => {
    const out: string[] = [];
    const onViolation = (e: SecurityPolicyViolationEvent) => out.push(`violation ${e.violatedDirective} ${e.blockedURI}`);
    document.addEventListener("securitypolicyviolation", onViolation, true);
    for (const u of urls) await fetch(u, { method: "POST", body: "{}" }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    document.removeEventListener("securitypolicyviolation", onViolation, true);
    return out;
  }, urls);
}
/** Opens each URL as a WebSocket in the page; returns the violations and constructor errors. */
async function openSockets(page: Page, urls: string[]): Promise<string[]> {
  return page.evaluate(async (urls) => {
    const out: string[] = [];
    const onViolation = (e: SecurityPolicyViolationEvent) => out.push(`violation ${e.violatedDirective} ${e.blockedURI}`);
    document.addEventListener("securitypolicyviolation", onViolation, true);
    for (const u of urls) {
      try {
        const ws = new WebSocket(u);
        ws.onerror = () => undefined;
        setTimeout(() => ws.close(), 300);
      } catch (e) {
        out.push(`throw ${u} ${String(e)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 500)); // the violation event is queued as a task
    document.removeEventListener("securitypolicyviolation", onViolation, true);
    return out;
  }, urls);
}
/** A page at the real Pages origin with only `policy` as its meta CSP. */
async function pageWithPolicy(page: Page, policy: string) {
  await page.route("https://tdn548.github.io/csp-probe/", (r) =>
    r.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${policy}" /></head><body></body></html>` }),
  );
  await page.goto("https://tdn548.github.io/csp-probe/");
}
const production = buildCsp(apiOrigins({}), gameServerSources({}));
test("built site: Unity's game server WebSocket passes the production connect-src", async ({ page }) => {
  await page.goto("./");
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "");
  expect(csp).toBe(production);
  expect(await openSockets(page, SERVERS)).toEqual([]);
});
test("production policy at the Pages origin allows the Edgegap WebSocket", async ({ page }) => {
  await pageWithPolicy(page, production);
  expect(await openSockets(page, SERVERS)).toEqual([]);
});
test("built site: the Unity Relay and lobby WebSockets and the Unity Services APIs pass the production connect-src", async ({ page }) => {
  await page.goto("./");
  expect(await openSockets(page, RELAY_SOCKETS)).toEqual([]);
  expect(await fetchAll(page, UNITY_HTTPS)).toEqual([]);
});
test("production policy at the Pages origin allows Unity Relay and Unity Services", async ({ page }) => {
  await pageWithPolicy(page, production);
  expect(await openSockets(page, RELAY_SOCKETS)).toEqual([]);
  expect(await fetchAll(page, UNITY_HTTPS)).toEqual([]);
});
// Negative controls: the same check reports a block in this engine, so a green result above means "allowed".
for (const [name, policy] of [
  ["without the game server source", production.replace(` ${PRODUCTION_GAME_SERVERS.join(" ")}`, "")],
  ["with the host but no port wildcard", production.replace(PRODUCTION_GAME_SERVERS.join(" "), "wss://*.pr.edgegap.net")],
] as const) {
  test(`negative control: a policy ${name} blocks the WebSocket`, async ({ page }) => {
    expect(policy).not.toBe(production);
    await pageWithPolicy(page, policy);
    const out = await openSockets(page, SERVERS.slice(0, 1));
    expect(out.some((l) => l.startsWith("violation connect-src") && l.includes("pr.edgegap.net"))).toBe(true);
  });
}
for (const [name, policy, check] of [
  ["without the Unity sources", production.replace(` ${UNITY_SOURCES.join(" ")}`, ""), "relay.uf.unity3d.com"],
  ["with the Relay host but no port wildcard", production.replace(PRODUCTION_UNITY_RELAY, "wss://*.relay.uf.unity3d.com"), "relay.uf.unity3d.com"],
] as const) {
  test(`negative control: a policy ${name} blocks the Relay WebSocket`, async ({ page }) => {
    expect(policy).not.toBe(production);
    await pageWithPolicy(page, policy);
    const out = await openSockets(page, RELAY_SOCKETS.slice(0, 1));
    expect(out.some((l) => l.startsWith("violation connect-src") && l.includes(check))).toBe(true);
  });
}
test("negative control: a policy without the Unity sources blocks the Unity Services APIs and the lobby WebSocket", async ({ page }) => {
  await pageWithPolicy(page, production.replace(` ${UNITY_SOURCES.join(" ")}`, ""));
  const out = [...(await openSockets(page, ["wss://wire.unity3d.com/v2/ws"])), ...(await fetchAll(page, UNITY_HTTPS.slice(0, 2)))];
  expect(out.some((l) => l.includes("wire.unity3d.com"))).toBe(true);
  expect(out.some((l) => l.startsWith("violation connect-src") && l.includes("player-auth.services.api.unity.com"))).toBe(true);
  expect(out.some((l) => l.startsWith("violation connect-src") && l.includes("lobby.services.api.unity.com"))).toBe(true);
});
