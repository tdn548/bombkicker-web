// SS-7 recheck on the mock build: the built site carries the <meta> CSP and the menu, shop and an offline match run
// without a violation; inside a frame the app does not start (clickjacking guard, src/frameGuard.ts).
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __BK_CSPV__?: string[];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__BK_MOCK__ = { loadMs: 300, matchMs: 800, recordDelayMs: 300 };
    window.__BK_CSPV__ = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__BK_CSPV__!.push(`${e.violatedDirective} ${e.blockedURI}`), true);
  });
});

test("menu, shop and an offline match run under the CSP without a violation", async ({ page }) => {
  await page.goto("./");
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "");
  expect(csp).toContain("script-src 'self' blob: 'wasm-unsafe-eval'");
  await expect(page.getByTestId("points")).toHaveText("60 điểm");
  await page.goto("./#/shop");
  await expect(page.getByTestId("skin-card-pig")).toBeVisible();
  await page.getByTestId("skin-card-pig").click();
  await expect(page.getByTestId("skin-detail")).toBeVisible();
  await page.goto("./#/play/offline");
  await expect(page.getByTestId("start-offline")).not.toHaveAttribute("aria-disabled");
  await page.getByTestId("start-offline").click();
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => window.__BK_CSPV__)).toEqual([]);
});

test("inside a frame the app does not start: link to its own tab, no login, no device id", async ({ page, baseURL }) => {
  const logins: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/v1/auth/guest")) logins.push(r.url());
  });
  // A same-origin page that frames the site (served by the test), so the frame's storage can be read below.
  await page.route("**/frame-test.html", (r) => r.fulfill({ contentType: "text/html", body: `<iframe id="f" src="${baseURL}" width="800" height="600"></iframe>` }));
  await page.goto("./frame-test.html");
  const frame = page.frameLocator("#f");
  await expect(frame.getByRole("link", { name: /Open BombKicker in its own tab/ })).toHaveAttribute("target", "_blank");
  await expect(frame.getByTestId("points")).toHaveCount(0);
  await page.waitForTimeout(1500); // the mock Unity would be ready by now if the app had started
  expect(await page.frames()[1].evaluate(() => localStorage.getItem("bk_device_id"))).toBeNull();
  expect(logins).toEqual([]);
});
