// SS-19: the production connect-src must let Unity open its game server WebSocket, wss://<12 hex>.pr.edgegap.net:<dynamic
// port> (UTP WebSocketNetworkInterface.GetServerURL: "wss://" + host + ":" + port + "/"), in WebKit and Chromium.
// WebKit checks connect-src synchronously in the WebSocket constructor: a blocked URL throws SecurityError and fires
// securitypolicyviolation at once, an allowed one just waits on the network (this test never needs the server).
// Runs in the mock projects (desktop Chromium, desktop WebKit, iPhone WebKit); the mock build carries the production CSP.
import { expect, test, type Page } from "@playwright/test";
import { PRODUCTION_GAME_SERVERS, apiOrigins, buildCsp, gameServerSources } from "../src/csp.ts";
const SERVERS = ["wss://0123456789ab.pr.edgegap.net:31593/", "wss://4e813af7bd5a.pr.edgegap.net:30849/", "wss://4e813af7bd5a.pr.edgegap.net:32217/"];
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
