// SS-14 real suite (BK_E2E_REAL=1): the normal build against a local bombkicker-api on :8787 (branch skin-shop-admin,
// ADMIN_DEV_BYPASS, seeded skins) and, for the equip -> offline match test, the Unity WebGL build in public/game.
// Extra skins for these tests are created through the admin API (unique keys per run):
//   race-<n>: common, 60 points, stock 1 (two players buy the last copy at once)
//   tint-<n>: epic, 60 points, the goblin sheet recoloured magenta, so Player 1 can be found in the Unity canvas
// Shop-only tests block the Unity build (the shop does not need it) and preset a device id, so login is immediate.
import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { bridgeLog, shot, SHOP_SHOT_DIR } from "./helpers";

const API = process.env.BK_E2E_API ?? "http://localhost:8787";
const ADMIN = { "X-Requested-With": "bombkicker-admin" };
const FIX = path.resolve(import.meta.dirname, "fixtures");
const snap = (page: Page, info: Parameters<typeof shot>[1], name: string, full = false) => shot(page, info, `real-${name}`, SHOP_SHOT_DIR, full);
const newDevice = () => `bk-${crypto.randomUUID().replace(/-/g, "")}`;

async function adminSkin(request: APIRequestContext, def: { key: string; name: string; rarity: string; price: number; stockLimit: number | null; sheet: string; layout: string }) {
  const created = await request.post(`${API}/admin/api/skins`, { headers: ADMIN, data: { key: def.key, name: def.name, rarity: def.rarity, price: def.price, stockLimit: def.stockLimit, sortOrder: 90 } });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const png = fs.readFileSync(def.sheet);
  const layout = Buffer.from(fs.readFileSync(def.layout, "utf8").replace(/\s+/g, "")).toString("base64url");
  const up = await request.post(`${API}/admin/api/skins/${id}/sheet`, {
    headers: { ...ADMIN, "Content-Type": "image/png", "X-Sheet-Layout": layout },
    data: png,
  });
  expect(up.status(), await up.text()).toBe(200);
  const act = await request.post(`${API}/admin/api/skins/${id}/status`, { headers: ADMIN, data: { status: "ACTIVE" } });
  expect(act.status(), await act.text()).toBe(200);
  return id;
}
const setStatus = (request: APIRequestContext, id: string, status: "ACTIVE" | "INACTIVE") =>
  request.post(`${API}/admin/api/skins/${id}/status`, { headers: ADMIN, data: { status } });

async function apiMe(page: Page) {
  const token = await page.evaluate(() => (JSON.parse(localStorage.getItem("bk_token") ?? "{}") as { accessToken?: string }).accessToken);
  const r = await page.request.get(`${API}/v1/me`, { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()) as { id: string; points: number; equippedSkin: string };
}

// POST /v1/auth/guest allows 10 logins per 60 s per IP; every page here is a new player, so keep them 6.5 s apart.
let lastLogin = 0;
async function paceLogin() {
  const wait = lastLogin + 6500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastLogin = Date.now();
}

/** A fresh player whose page skips the Unity build. */
async function shopPage(context: BrowserContext, opts: { unity?: boolean } = {}) {
  await paceLogin();
  const page = await context.newPage();
  const device = newDevice();
  await page.addInitScript((d) => {
    window.__BK_BRIDGE_LOG__ = [];
    if (!localStorage.getItem("bk_device_id")) localStorage.setItem("bk_device_id", d);
  }, device);
  if (!opts.unity) await page.route(/\/game\/Build\//, (r) => r.abort());
  blocked.add(page);
  if (opts.unity) blocked.delete(page);
  return page;
}
const blocked = new WeakSet<Page>();

/** Menu link click without layout shift: with the Unity build blocked, wait until its failed box has replaced the bar. */
async function menuLink(page: Page, name: string) {
  if (blocked.has(page)) await expect(page.getByRole("button", { name: "Tải lại" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name }).click();
}
/** Back to the menu; on a phone the bottom sheet (modal) closes first. */
async function backToMenu(page: Page) {
  if (await page.getByTestId("bottom-sheet").count()) await page.getByTestId("sheet-close").click();
  await page.getByRole("link", { name: "Quay lại" }).click();
}

async function openShop(page: Page, skin?: string) {
  await page.goto("./");
  await menuLink(page, "Cửa hàng");
  if (skin) await openSkin(page, skin);
  await expect(page.getByTestId("skin-card-human")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("shop-points")).toHaveText("Bạn có 60 điểm");
}
async function openSkin(page: Page, key: string) {
  await page.getByTestId(`skin-card-${key}`).click();
  await expect(page.getByTestId("skin-detail")).toHaveAttribute("data-skin", key);
  await expect(page.getByTestId("shop-action")).not.toHaveAttribute("data-kind", "skeleton");
}

test.describe("shop against the local API", () => {
  test("buy with enough points: D -> E -> Equip now; the API has the purchase and the equip", async ({ context }, info) => {
    const page = await shopPage(context);
    await openShop(page);
    await page.waitForTimeout(300);
    await snap(page, info, "B-grid", true);
    await openSkin(page, "pig");
    await expect(page.getByTestId("shop-action")).toHaveText("Mua · 60 điểm");
    await page.getByTestId("shop-action").click();
    await expect(page.getByTestId("buy-balance")).toHaveText("Điểm của bạn: 60 → 0");
    await snap(page, info, "D-confirm");
    await page.getByTestId("buy-confirm").click();
    await expect(page.getByTestId("unlocked-dialog")).toContainText("Đã mở khóa Pig!");
    await expect(page.getByTestId("unlocked-balance")).toHaveText("Bạn còn 0 điểm.");
    await snap(page, info, "E-unlocked");
    await page.getByTestId("unlocked-equip").click();
    await expect(page.getByTestId("toast")).toContainText("Đã trang bị Pig.");
    await expect(page.getByTestId("shop-action")).toHaveText("Đang dùng");
    await expect(page.getByTestId("skin-card-pig")).toHaveAttribute("data-state", "inUse");
    await snap(page, info, "C-in-use");
    const me = await apiMe(page);
    expect(me).toMatchObject({ points: 0, equippedSkin: "pig" });
    // points history on the profile shows the purchase (in-app navigation: the route gate may still be closed)
    await backToMenu(page);
    await page.getByTestId("player-name").click();
    await expect(page.getByTestId("points-history")).toContainText("Mua skin Pig");
    await expect(page.getByTestId("profile-owned")).toContainText("Skin đã có: 2/");
    await snap(page, info, "P-profile", true);
  });

  test("buy with too few points: Buy is disabled with the helper, no dialog", async ({ context }, info) => {
    const page = await shopPage(context);
    await openShop(page);
    await openSkin(page, "skeleton");
    const action = page.getByTestId("shop-action");
    await expect(action).toHaveText("Mua · 160 điểm");
    await expect(action).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Cần thêm 100 điểm, khoảng 5 trận thắng (thắng = +20).")).toBeVisible();
    await snap(page, info, "C-too-few-points");
    await action.dispatchEvent("click");
    await expect(page.getByTestId("buy-dialog")).toHaveCount(0);
    expect((await apiMe(page)).points).toBe(60);
  });

  test("two players buy the last copy at once: one unlocks, the other gets 'sold out just now', balance unchanged", async ({ browser, request }, info) => {
    const key = `race-${Date.now().toString(36)}`;
    const id = await adminSkin(request, { key, name: "Race Goblin", rarity: "common", price: 60, stockLimit: 1, sheet: path.join(FIX, "magenta-sheet.png"), layout: path.join(FIX, "magenta-layout.json") });
    const opts = { ...info.project.use };
    const ctxA = await browser.newContext(opts);
    const ctxB = await browser.newContext(opts);
    try {
      const [a, b] = [await shopPage(ctxA), await shopPage(ctxB)];
      await Promise.all([openShop(a), openShop(b)]);
      for (const p of [a, b]) {
        await openSkin(p, key);
        await expect(p.getByText("Còn 1/1 bản.")).toBeVisible();
        await p.getByTestId("shop-action").click();
        await expect(p.getByTestId("buy-stock")).toHaveText("Còn 1/1 bản");
      }
      await Promise.all([a.getByTestId("buy-confirm").click(), b.getByTestId("buy-confirm").click()]);
      const outcome = async (p: Page) => {
        await expect(p.getByTestId("unlocked-dialog").or(p.getByTestId("buy-error"))).toBeVisible({ timeout: 20_000 });
        return (await p.getByTestId("unlocked-dialog").count()) > 0 ? "won" : "lost";
      };
      const results = await Promise.all([outcome(a), outcome(b)]);
      expect([...results].sort()).toEqual(["lost", "won"]);
      const loser = results[0] === "lost" ? a : b;
      const winner = loser === a ? b : a;
      await expect(loser.getByTestId("buy-error")).toHaveText("⚠ Vừa hết hàng, có người mua bản cuối trước bạn. Bạn chưa bị trừ điểm.");
      await snap(loser, info, "F-sold-out-just-now");
      expect((await apiMe(loser)).points).toBe(60);
      expect((await apiMe(winner)).points).toBe(0);
      await loser.getByTestId("buy-err-close").click();
      await expect(loser.getByTestId("shop-action")).toHaveText("Hết hàng");
      await expect(loser.getByText("Đã bán hết 1 bản.")).toBeVisible();
      await expect(loser.getByTestId("shop-points")).toHaveText("Bạn có 60 điểm");
      await snap(loser, info, "C-sold-out-after-race");
    } finally {
      await ctxA.close();
      await ctxB.close();
      // keep later grids clean: only the owner still sees it
      await setStatus(request, id, "INACTIVE");
    }
  });

  test("leaderboard: own row pinned", async ({ context }, info) => {
    const page = await shopPage(context);
    await page.goto("./");
    await menuLink(page, "Bảng xếp hạng");
    await expect(page.getByTestId("lb-pinned")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lb-pinned-unranked")).toHaveText("Chưa có hạng: chơi thêm 3 trận online với người thật để có hạng.");
    await snap(page, info, "G-leaderboard", true);
  });
});

test("equip -> the offline match shows the skin on Player 1 (Unity WebGL build)", async ({ context, request, browserName }, info) => {
  test.skip(browserName !== "chromium", "one Unity run is enough; WebKit headless WebGL is slow");
  test.setTimeout(420_000);
  const key = `tint-${Date.now().toString(36)}`;
  const id = await adminSkin(request, { key, name: "Magenta Goblin", rarity: "epic", price: 60, stockLimit: null, sheet: path.join(FIX, "magenta-sheet.png"), layout: path.join(FIX, "magenta-layout.json") });
  const page = await shopPage(context, { unity: true });
  const logs: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("[Skins]")) logs.push(m.text());
  });
  try {
    await openShop(page);
    await openSkin(page, key);
    await page.getByTestId("shop-action").click();
    await page.getByTestId("buy-confirm").click();
    await page.getByTestId("unlocked-equip").click();
    await expect(page.getByTestId("shop-action")).toHaveText("Đang dùng");
    expect((await apiMe(page)).equippedSkin).toBe(key);
    // In-app navigation: before Unity's ready the route is not in the URL (SS-1 gate), so page.goto(#...) would not move.
    await backToMenu(page);
    await expect(page.getByTestId("menu-offline")).not.toHaveAttribute("aria-disabled", { timeout: 180_000 });
    await expect(page.getByTestId("equipped-preview")).toContainText("Magenta Goblin");
    await snap(page, info, "A-menu-equipped");
    await page.getByTestId("menu-offline").click();
    await expect(page.getByTestId("start-offline")).not.toHaveAttribute("aria-disabled");
    // Unity got the skin: in init (if it became ready after the equip) or as setEquippedSkin
    const log = await bridgeLog(page);
    const sentKey = log
      .filter((e) => e.dir === "R->U" && (e.msg.type === "setEquippedSkin" || e.msg.type === "init"))
      .map((e) => (e.msg.type === "init" ? (e.msg.equippedSkin as { key?: string } | null)?.key : (e.msg.skin as { key: string }).key))
      .pop();
    expect(sentKey).toBe(key);
    await page.getByTestId("start-offline").click();
    await expect(page.getByTestId("unity-layer")).toHaveClass(/visible/);
    await page.waitForTimeout(7000);
    const file = await snap(page, info, "I-offline-player1-skin");
    // Count magenta pixels (the recoloured sheet) in the screenshot; Player 1 is Team 1 on the left half.
    const b64 = fs.readFileSync(file).toString("base64");
    const stats = await page.evaluate(async (data) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const c = new OffscreenCanvas(img.width, img.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      let n = 0;
      let sx = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 200 && px[i + 1] < 70 && px[i + 2] > 200) {
          n++;
          sx += (i / 4) % img.width;
        }
      }
      return { n, cx: n ? sx / n / img.width : -1 };
    }, b64);
    expect(stats.n).toBeGreaterThan(50);
    expect(stats.cx).toBeLessThan(0.5);
    await expect.poll(() => logs.some((l) => l.includes(key) && l.includes(" ready in "))).toBe(true);
    console.log(`magenta pixels ${stats.n}, centre x ${stats.cx.toFixed(2)}; skin logs: ${logs.join(" | ")}`);
  } finally {
    await setStatus(request, id, "INACTIVE");
  }
});
