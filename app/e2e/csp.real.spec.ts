// SS-7 recheck: the published build's <meta> CSP (src/csp.ts) with the real Unity WebGL build. Unity must boot (blob:
// framework script, blob: decompression worker, wasm), a bought + equipped skin's sheet must load in Unity during an
// offline match, and nothing may trip the policy. Also: where the token and device id live, and that neither shows up
// in a URL or the console. Setup as real.spec.ts; build with `BK_CSP_LOCAL_API=1 npm run build` so the policy allows
// the local API (a plain build allows only the production API and the real suite cannot reach :8787).
import { expect, test, type Page } from "@playwright/test";
import { bridgeLog } from "./helpers";

const API = process.env.BK_E2E_API ?? "http://localhost:8787";
const UNITY_READY = 180_000;

declare global {
  interface Window {
    __BK_CSPV__?: string[];
  }
}

async function setup(page: Page) {
  await page.addInitScript(() => {
    window.__BK_BRIDGE_LOG__ = [];
    window.__BK_CSPV__ = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__BK_CSPV__!.push(`${e.violatedDirective} ${e.blockedURI}`), true);
  });
  if (API === "http://localhost:8787") return;
  await page.route(/^http:\/\/localhost:8787\//, async (route) => {
    const url = route.request().url().replace(/^http:\/\/localhost:8787/, API);
    try {
      const body = route.request().postDataBuffer();
      const response = await route.fetch(body ? { url, postData: body } : { url });
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
}

test("CSP meta: Unity boots, an equipped skin loads in an offline match, no violation, no token in URLs or console", async ({ page }) => {
  const urls: string[] = [];
  const unityFetches: string[] = []; // fetch/xhr: Unity's UnityWebRequest (React's sheet previews are <img>)
  const consoleLines: string[] = [];
  page.on("request", (r) => {
    urls.push(r.url());
    if (r.resourceType() === "fetch" || r.resourceType() === "xhr") unityFetches.push(r.url());
  });
  page.on("console", (m) => consoleLines.push(m.text()));
  await setup(page);

  await page.goto("./");
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "");
  expect(csp).toContain("script-src 'self' blob: 'wasm-unsafe-eval'");
  expect(csp).toContain("worker-src 'self' blob:");
  expect(csp).toContain("connect-src 'self' https://bombkicker-api-production.tdn548.workers.dev");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval' ");
  await expect(page.getByTestId("menu-online")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });

  // SEC-008: token and device id are in localStorage (bk_token, bk_device_id), nowhere else.
  const stored = await page.evaluate(() => ({ token: localStorage.getItem("bk_token"), device: localStorage.getItem("bk_device_id"), cookie: document.cookie }));
  const token = (JSON.parse(stored.token ?? "{}") as { accessToken?: string }).accessToken ?? "";
  expect(token.split(".")).toHaveLength(3);
  expect(stored.device).toMatch(/^bk-[0-9a-f]{32}$/);
  expect(stored.cookie).toBe("");

  // Buy and equip a 60-point skin through the API, then reload so init carries it.
  const skins = (await (await page.request.get(`${API}/v1/skins`)).json()) as { items: { key: string; price: number; onSale: boolean; soldOut: boolean }[] };
  const skin = skins.items.find((s) => s.onSale && !s.soldOut && s.price <= 60);
  expect(skin, "a 60-point skin on sale (npm run db:seed-skins)").toBeTruthy();
  const auth = { Authorization: `Bearer ${token}` };
  const buy = await page.request.post(`${API}/v1/shop/purchases`, { headers: auth, data: { skinKey: skin!.key, expectedPrice: skin!.price, idempotencyKey: crypto.randomUUID() } });
  expect(buy.status()).toBe(201);
  expect((await page.request.patch(`${API}/v1/me/equipped-skin`, { headers: auth, data: { skinKey: skin!.key } })).status()).toBe(200);

  await page.goto("./#/play/offline");
  await page.reload();
  await expect(page.getByTestId("start-offline")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });
  await expect.poll(async () => (await bridgeLog(page)).some((e) => e.dir === "R->U" && e.msg.type === "init")).toBe(true);
  const init = (await bridgeLog(page)).find((e) => e.dir === "R->U" && e.msg.type === "init")!.msg as { equippedSkin?: { key: string }; accessToken: string };
  expect(init.equippedSkin?.key).toBe(skin!.key);
  expect(init.accessToken).toBe("…"); // the test log is redacted like the console
  await page.getByTestId("start-offline").click();
  await expect(page.getByTestId("unity-layer")).toHaveClass(/visible/);
  const sheet = new RegExp(`/v1/skins/${skin!.key}/sheet/[0-9a-f]{16}\\.png$`);
  await expect.poll(() => unityFetches.some((u) => sheet.test(u)), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(5000); // a few seconds of play under the policy

  expect(await page.evaluate(() => window.__BK_CSPV__)).toEqual([]);
  expect(consoleLines.filter((l) => /Content Security Policy|Refused to/i.test(l))).toEqual([]);
  const freshToken = (JSON.parse((await page.evaluate(() => localStorage.getItem("bk_token"))) ?? "{}") as { accessToken?: string }).accessToken ?? "";
  for (const secret of [token, freshToken, stored.device!]) {
    expect(urls.filter((u) => u.includes(secret))).toEqual([]);
    expect(consoleLines.filter((l) => l.includes(secret))).toEqual([]);
  }
});

// BUG-SS18-001: Unity's WebSocket to the game server must pass connect-src. Production builds allow
// wss://*.pr.edgegap.net:*; a build-site.sh --local-api build also allows ws/wss to localhost and 127.0.0.1 (any port).
// Setup: the API with an Edgegap emulator that starts a Mac dev dedicated server per deployment and reports
// wss://127.0.0.1:<port> (BombKicker .agents/tasks/skin-shop/qa-run/tools/edgegap-emu.mjs, a TLS front with a local test
// CA, hence ignoreHTTPSErrors), or QUICKMATCH_1V1_HOST/PORT pointing at a local dedicated server. Run it against the
// build-site.sh output: `scripts/serve-site.sh dist-local --port 8000`, then BK_E2E_REAL=1 BK_E2E_PORT=8000.
// A dev server started with BK_DEV_FORCE_END_AFTER ends the match early; otherwise it runs its full 150 s.
test.describe("game server WebSocket", () => {
  test.use({ ignoreHTTPSErrors: true });
  test("CSP meta: a 1v1 quick match connects to the game server and starts, no violation", async ({ page }) => {
    test.setTimeout(600_000);
    const sockets: string[] = [];
    const consoleLines: string[] = [];
    page.on("websocket", (ws) => sockets.push(ws.url()));
    page.on("console", (m) => consoleLines.push(m.text()));
    await setup(page);
    await page.goto("./#/play/online");
    const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "");
    const connect = csp.split(";").find((d) => d.trim().startsWith("connect-src")) ?? "";
    expect(connect.split(/\s+/)).toContain("wss://*.pr.edgegap.net:*");
    await expect(page.getByTestId("quick-match")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });
    await page.getByTestId("quick-match").click();
    const phase = async () => {
      const log = await bridgeLog(page);
      const s = log.filter((e) => e.dir === "U->R" && e.msg.type === "status").map((e) => e.msg as { phase: string; code?: string });
      return s.some((m) => m.phase === "inMatch") ? "inMatch" : (s.find((m) => m.phase === "error")?.code ?? (s.some((m) => m.phase === "error") ? "error" : "pending"));
    };
    // searching -> starting (server deploy) -> connecting -> waiting (bot fill) -> loading -> inMatch
    await expect.poll(phase, { timeout: 240_000, intervals: [1000] }).not.toBe("pending");
    // One server slot locally (EDGEGAP_MAX_CONCURRENT=1): the previous test's server may still be stopping. Retry like a
    // player would ("Thử lại"), at most 6 times 20 s apart.
    for (let i = 0; i < 6 && (await phase()) === "SERVERS_FULL"; i++) {
      await page.waitForTimeout(20_000);
      await page.evaluate(() => (window.__BK_BRIDGE_LOG__ = []));
      await page.getByTestId("online-error").locator("..").getByRole("button").first().click();
      await expect.poll(phase, { timeout: 240_000, intervals: [1000] }).not.toBe("pending");
    }
    expect(await phase(), `online error: ${JSON.stringify(await page.evaluate(() => window.__BK_CSPV__))}`).toBe("inMatch");
    await expect(page.getByTestId("unity-layer")).toHaveClass(/visible/);
    expect(sockets.filter((u) => /^wss?:\/\//.test(u)).length, `WebSockets: ${sockets.join(", ")}`).toBeGreaterThan(0);
    await page.waitForTimeout(5000); // a few seconds of online play under the policy
    expect(await page.evaluate(() => window.__BK_CSPV__)).toEqual([]);
    expect(consoleLines.filter((l) => /Content Security Policy|Refused to/i.test(l))).toEqual([]);
    await expect.poll(async () => (await bridgeLog(page)).some((e) => e.dir === "U->R" && e.msg.type === "matchEnded"), { timeout: 240_000, intervals: [2000] }).toBe(true);
    await expect(page.getByTestId("result")).toBeVisible();
    expect(await page.evaluate(() => window.__BK_CSPV__)).toEqual([]);
  });
});
