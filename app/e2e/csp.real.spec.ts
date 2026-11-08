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
