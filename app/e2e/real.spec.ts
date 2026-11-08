// Real suite (BK_E2E_REAL=1): normal build + Unity WebGL build (SS-8) in public/game + local bombkicker-api (SS-5).
// Unity's ApiConfig sends local pages to <page host>:8787. When BK_E2E_API is set (e.g. http://127.0.0.1:8797, because
// :8787 is used by another task), every request to localhost:8787 (React and Unity) is forwarded there.
// Quick match also needs a local 1v1 dedicated server where the API's QUICKMATCH_1V1_HOST/PORT point (see README).
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { bridgeLog, shot } from "./helpers";

const API = process.env.BK_E2E_API ?? "http://localhost:8787";

async function routeApi(page: Page) {
  await page.addInitScript(() => {
    window.__BK_BRIDGE_LOG__ = [];
  });
  if (API === "http://localhost:8787") return;
  await page.route(/^http:\/\/localhost:8787\//, async (route) => {
    const url = route.request().url().replace(/^http:\/\/localhost:8787/, API);
    try {
      const req = route.request();
      const body = req.postDataBuffer();
      const response = await route.fetch(body ? { url, postData: body } : { url });
      await route.fulfill({ response });
    } catch {
      // the test ended while Unity was still polling
      await route.abort().catch(() => undefined);
    }
  });
}

async function apiMe(page: Page) {
  const token = await page.evaluate(() => (JSON.parse(localStorage.getItem("bk_token") ?? "{}") as { accessToken?: string }).accessToken);
  const r = await page.request.get(`${API}/v1/me`, { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()) as { id: string; points: number; stats: { matchesPlayed: number } };
}

const UNITY_READY = 180_000;

test("first visit creates a player (after Unity ready), reload keeps it", async ({ page }, info) => {
  await routeApi(page);
  await page.goto("./");
  await expect(page.getByText(/Đang tải game|Đang khởi động game/)).toBeVisible();
  await shot(page, info, "real-A-loading");
  await expect(page.getByTestId("menu-online")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });
  await expect(page.getByTestId("points")).toHaveText("60 điểm");
  const ready = (await bridgeLog(page)).find((e) => e.dir === "U->R" && e.msg.type === "ready");
  expect(ready?.msg).toMatchObject({ type: "ready" });
  const deviceId = await page.evaluate(() => localStorage.getItem("bk_device_id"));
  expect(deviceId).toMatch(/^bk-/);
  const me1 = await apiMe(page);
  await expect.poll(async () => (await bridgeLog(page)).some((e) => e.dir === "R->U" && e.msg.type === "init")).toBe(true);
  await page.waitForTimeout(500);
  await shot(page, info, "real-A-menu");
  await page.reload();
  await expect(page.getByTestId("points")).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem("bk_device_id"))).toBe(deviceId);
  expect((await apiMe(page)).id).toBe(me1.id);
  await expect(page.getByTestId("menu-online")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });
});

test("old player: the live standalone build's device id is adopted at the same URL, even when opened on #/play/offline", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium" || API === "http://localhost:8787", "needs request routing with POST bodies (Chromium)");
  test.setTimeout(420_000);
  // 1. The current live site (repo root of bombkicker-web main: Unity's own index.html + Build/) at the same URL.
  const root = path.resolve(import.meta.dirname, "../..");
  let oldDeviceId: string | null = null;
  const serveOld = async (route: import("@playwright/test").Route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/bombkicker-web\//, "") || "index.html";
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: "" });
    const type = rel.endsWith(".html") ? "text/html" : rel.endsWith(".js") ? "application/javascript" : "application/octet-stream";
    await route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { "content-type": type } });
  };
  await page.route(/^http:\/\/localhost:\d+\/bombkicker-web\/($|index\.html|Build\/|TemplateData\/|StreamingAssets\/)/, serveOld);
  await page.route(/^http:\/\/localhost:8787\//, async (route) => {
    const req = route.request();
    if (req.url().endsWith("/v1/auth/guest") && req.method() === "POST") oldDeviceId = (JSON.parse(req.postData() ?? "{}") as { deviceId?: string }).deviceId ?? null;
    try {
      const body = req.postDataBuffer();
      const response = await route.fetch(body ? { url: req.url().replace(/^http:\/\/localhost:8787/, API), postData: body } : { url: req.url().replace(/^http:\/\/localhost:8787/, API) });
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
  await page.goto("./");
  await expect.poll(() => oldDeviceId, { timeout: 180_000 }).toMatch(/^bk-/);
  await page.waitForTimeout(3000); // PlayerPrefs.Save -> IndexedDB
  await shot(page, info, "real-old-live-build");
  await page.unrouteAll({ behavior: "ignoreErrors" });

  // 2. The React site, opened on a hash route: the hash is out of the URL until Unity is ready (SS-1).
  await page.addInitScript(() => {
    window.__BK_BRIDGE_LOG__ = [];
  });
  await page.route(/^http:\/\/localhost:8787\//, async (route) => {
    try {
      const req = route.request();
      const body = req.postDataBuffer();
      const url = req.url().replace(/^http:\/\/localhost:8787/, API);
      await route.fulfill({ response: await route.fetch(body ? { url, postData: body } : { url }) });
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
  // "?from=old" only avoids the cached old index.html; a query does not change Unity's PlayerPrefs folder (SS-1 B4).
  await page.goto("./?from=old#/play/offline");
  await expect(page.getByTestId("start-offline")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });
  const ready = (await bridgeLog(page)).find((e) => e.dir === "U->R" && e.msg.type === "ready");
  expect(ready?.msg.legacyDeviceId).toBe("(set)");
  expect(await page.evaluate(() => localStorage.getItem("bk_device_id"))).toBe(oldDeviceId);
  await expect.poll(() => new URL(page.url()).hash).toBe("#/play/offline");
  await shot(page, info, "real-old-player-adopted");
});

test("offline bots match returns to the menu", async ({ page }, info) => {
  test.setTimeout(420_000);
  await routeApi(page);
  await page.goto("./#/play/offline");
  await expect(page.getByTestId("start-offline")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });
  await page.getByTestId("start-offline").click();
  await expect(page.getByTestId("unity-layer")).toHaveClass(/visible/);
  await page.waitForTimeout(8000);
  await shot(page, info, "real-I-in-match");
  // A bots match ends on its own (elimination or the time limit). The player stands still and loses or the clock runs out.
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 360_000 });
  await expect(page.getByTestId("points-line")).toHaveText("Trận offline không tính điểm.");
  await shot(page, info, "real-J-offline");
  const log = await bridgeLog(page);
  expect(log.find((e) => e.msg.type === "matchEnded")?.msg).toMatchObject({ kind: "offline", recorded: false });
  await expect.poll(async () => (await bridgeLog(page)).some((e) => e.msg.type === "returnedToMenu"), { timeout: 30_000 }).toBe(true);
  await page.getByTestId("result-menu").click();
  await expect(page.getByTestId("equipped-preview")).toBeVisible();
  await expect(page.getByTestId("menu-offline")).not.toHaveAttribute("aria-disabled");
});

test("quick match against the local dedicated server: searching -> Unity -> result with the right delta", async ({ page }, info) => {
  test.setTimeout(420_000);
  // Playwright's WebKit drops the body of Unity's XHR POSTs when the request is routed, so with BK_E2E_API the
  // quick match only runs in Chromium. Without routing (API really on :8787) it runs in WebKit too.
  test.skip(info.project.name.includes("webkit") && API !== "http://localhost:8787", "WebKit route loses Unity's POST bodies");
  await routeApi(page);
  await page.goto("./#/play/online");
  await expect(page.getByTestId("quick-match")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });
  const before = await apiMe(page);
  await page.getByTestId("quick-match").click();
  await expect(page.getByTestId("searching-overlay")).toBeVisible();
  await shot(page, info, "real-H-searching");
  try {
    await expect(page.getByTestId("unity-layer")).toHaveClass(/visible/, { timeout: 120_000 });
  } catch (e) {
    console.log("bridge log:", JSON.stringify((await bridgeLog(page)).map((x) => `${x.dir} ${JSON.stringify(x.msg).slice(0, 160)}`)));
    throw e;
  }
  await page.waitForTimeout(5000);
  await shot(page, info, "real-H-in-match");
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 300_000 });
  await expect(page.getByTestId("result")).not.toHaveAttribute("data-points-state", "saving", { timeout: 15_000 });
  const after = await apiMe(page);
  expect(after.stats.matchesPlayed).toBe(before.stats.matchesPlayed + 1);
  const delta = after.points - before.points;
  await expect(page.getByTestId("points-line")).toHaveAttribute("data-delta", String(delta));
  await shot(page, info, "real-J-online");
  const ended = (await bridgeLog(page)).find((e) => e.msg.type === "matchEnded")?.msg;
  expect(ended).toMatchObject({ kind: "online", recorded: true });
  const phases = (await bridgeLog(page)).filter((e) => e.msg.type === "status").map((e) => e.msg.phase);
  expect(phases).toContain("inMatch");
  console.log(`quick match: result ${String(ended?.result)}, delta ${delta}, phases ${phases.join(",")}`);
});
