// SS-14 mock suite: shop (B-F), leaderboard (G) and profile with the mock API and mock Unity, on desktop Chromium,
// desktop WebKit and iPhone 15 WebKit. Screenshots of every screen and dialog state go to SHOP_SHOT_DIR.
// The flows against the real API are in shop.real.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { bridgeLog, shot, SHOP_SHOT_DIR } from "./helpers";

const DEVICE = "bk-5ca1ab1e0123456789abcdef01234567";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((device) => {
    window.__BK_BRIDGE_LOG__ = [];
    window.__BK_MOCK__ = { loadMs: 300, matchMs: 1500, recordDelayMs: 300, ...JSON.parse(sessionStorage.getItem("knobs") ?? "{}") };
    if (!localStorage.getItem("bk_device_id")) localStorage.setItem("bk_device_id", device);
  }, DEVICE);
});

const knobs = (page: Page, k: Record<string, unknown>) =>
  page.evaluate((v) => {
    window.__BK_MOCK__ = { ...window.__BK_MOCK__, ...v };
  }, k);
const snap = (page: Page, info: Parameters<typeof shot>[1], name: string, full = true) => shot(page, info, name, SHOP_SHOT_DIR, full);
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

async function openShop(page: Page) {
  await page.goto("./#/shop");
  await expect(page.getByTestId("skin-card-human")).toBeVisible();
  await expect(page.getByTestId("shop-points")).toHaveText("Bạn có 60 điểm");
}
async function openSkin(page: Page, key: string) {
  await page.getByTestId(`skin-card-${key}`).click();
  await expect(page.getByTestId("skin-detail")).toHaveAttribute("data-skin", key);
  if (isPhone(page)) await expect(page.getByTestId("bottom-sheet")).toBeVisible();
}

test("B/C: grid, tabs, detail (desktop panel / phone sheet), preview tabs, too few points", async ({ page }, info) => {
  await openShop(page);
  await expect(page.getByTestId("skin-card-human")).toHaveAttribute("data-state", "inUse");
  await expect(page.getByTestId("skin-card-pig-star")).toContainText("Hết hàng");
  await expect(page.getByTestId("skin-card-goblin-king")).toContainText("Còn 3/10");
  await page.waitForTimeout(300);
  await snap(page, info, "B-grid-all");
  await page.getByTestId("shop-tab-legendary").click();
  await expect(page.getByTestId("skin-grid").getByRole("listitem")).toHaveCount(1);
  await snap(page, info, "B-tab-legendary");
  await page.getByTestId("shop-tab-owned").click();
  await expect(page.getByTestId("skin-grid").getByRole("listitem")).toHaveCount(1);
  await page.getByTestId("shop-tab-all").click();

  await openSkin(page, "skeleton");
  const action = page.getByTestId("shop-action");
  await expect(action).toHaveText("Mua · 160 điểm");
  await expect(action).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Cần thêm 100 điểm, khoảng 5 trận thắng (thắng = +20).")).toBeVisible();
  await snap(page, info, "C-too-few-points", false);
  // Playwright refuses to click aria-disabled buttons; dispatch the click like a tap would
  await action.dispatchEvent("click");
  await expect(page.getByTestId("buy-dialog")).toHaveCount(0);

  for (const anim of ["walk", "swing", "death"] as const) {
    await page.getByRole("radio", { name: { walk: "Đi bộ", swing: "Vung vợt", death: "Bị hạ" }[anim] }).click();
    await expect(page.getByTestId("preview-stage")).toHaveAttribute("data-anim", anim);
  }
  await page.getByRole("radio", { name: "Đội 2 (bên phải)" }).click();
  await expect(page.getByTestId("preview-stage")).toHaveAttribute("data-team", "2");
  await page.waitForTimeout(200);
  await snap(page, info, "C-preview-death-team2", false);

  if (isPhone(page)) {
    // Back closes the sheet and stays in the shop (ux-spec 6.2)
    await page.goBack();
    await expect(page.getByTestId("bottom-sheet")).toHaveCount(0);
    await expect(page.getByTestId("skin-grid")).toBeVisible();
    await openSkin(page, "goblin-king");
    await page.getByTestId("sheet-close").click();
    await expect(page.getByTestId("bottom-sheet")).toHaveCount(0);
    await expect(page.getByTestId("skin-card-goblin-king")).toBeFocused();
  }

  await openSkin(page, "goblin-king");
  await expect(page.getByTestId("detail-limited")).toHaveText("Phiên bản giới hạn: chỉ có 10 bản");
  await expect(page.getByText("Còn 3/10 bản.")).toBeVisible();
  await snap(page, info, "C-limited-legendary", false);
  await openSkinFromGridIfDesktop(page, "pig-star");
});

async function openSkinFromGridIfDesktop(page: Page, key: string) {
  if (isPhone(page)) {
    await page.getByTestId("sheet-close").click();
  }
  await openSkin(page, key);
  await expect(page.getByTestId("shop-action")).toHaveText("Hết hàng");
  await expect(page.getByText("Đã bán hết 5 bản.")).toBeVisible();
}

test("D -> E -> Equip now: In use, toast, setEquippedSkin to Unity", async ({ page }, info) => {
  await openShop(page);
  await expect.poll(async () => (await bridgeLog(page)).some((e) => e.msg.type === "init")).toBe(true);
  await openSkin(page, "pig");
  await expect(page.getByTestId("shop-action")).toHaveText("Mua · 60 điểm");
  await page.getByTestId("shop-action").click();
  await expect(page.getByTestId("buy-title")).toHaveText("Mua Pig?");
  await expect(page.getByTestId("buy-price")).toHaveText("Giá: 60 điểm");
  await expect(page.getByTestId("buy-balance")).toHaveText("Điểm của bạn: 60 → 0");
  await expect(page.getByTestId("buy-cancel")).toBeFocused();
  await snap(page, info, "D-confirm", false);
  await page.getByTestId("buy-confirm").click();
  await expect(page.getByTestId("unlocked-dialog")).toContainText("Đã mở khóa Pig!");
  await expect(page.getByTestId("unlocked-balance")).toHaveText("Bạn còn 0 điểm.");
  await page.waitForTimeout(300);
  await snap(page, info, "E-unlocked", false);
  await page.getByTestId("unlocked-equip").click();
  await expect(page.getByTestId("toast")).toHaveText("Đã trang bị Pig. Bạn sẽ dùng skin này ở trận offline và online.");
  await expect(page.getByTestId("shop-action")).toHaveText("Đang dùng");
  await snap(page, info, "C-in-use-toast", false);
  await expect.poll(async () => (await bridgeLog(page)).filter((e) => e.msg.type === "setEquippedSkin").map((e) => (e.msg.skin as { key: string }).key)).toContain("pig");
  // the mock Unity puts the equipped skin on Player 1 in an offline match
  await page.goto("./#/play/offline");
  await page.getByTestId("start-offline").click();
  await expect(page.getByTestId("mock-match")).toContainText("Player 1 skin pig");
});

const ERRORS: [string, string, string][] = [
  ["SOLD_OUT", "F-sold-out", "Vừa hết hàng, có người mua bản cuối trước bạn. Bạn chưa bị trừ điểm."],
  ["NOT_ON_SALE", "F-not-on-sale", "Skin này không còn bán nữa. Bạn chưa bị trừ điểm."],
  ["PRICE_CHANGED", "F-price-changed-too-high", "Giá vừa đổi thành 80 điểm. Bạn có 60 điểm nên chưa mua được. Bạn chưa bị trừ điểm."],
  ["NOT_ENOUGH_POINTS", "F-not-enough", "Chưa đủ điểm: bạn có 60, cần 60. Bạn chưa bị trừ điểm."],
  ["ALREADY_OWNED", "F-already-owned", "Bạn đã có skin này rồi."],
  ["SKIN_NOT_FOUND", "F-skin-not-found", "Không tìm thấy skin này. Có thể nó vừa bị gỡ. Bạn chưa bị trừ điểm."],
  ["RATE_LIMITED", "F-rate-limited", "Bạn bấm nhanh quá. Chờ khoảng 1 phút rồi thử lại. Bạn chưa bị trừ điểm."],
  ["IDEMPOTENCY_KEY_REUSED", "F-generic", "Có lỗi, bạn chưa bị trừ điểm. Hãy thử lại."],
  ["network", "F-network", "Lỗi mạng. Bạn chưa bị trừ điểm. Hãy thử lại."],
  ["networkDown", "F-network-unknown", "Không kết nối được. Nếu lần mua vừa rồi đã xong, skin sẽ có trong mục Đã có."],
];

test("F: every purchase error code shows its dialog F copy", async ({ page }, info) => {
  test.setTimeout(120_000);
  await openShop(page);
  await openSkin(page, "pig");
  for (const [code, name, text] of ERRORS) {
    await knobs(page, { purchaseErrors: [code] });
    await page.getByTestId("shop-action").click();
    await page.getByTestId("buy-confirm").click();
    await expect(page.getByTestId("buy-error")).toContainText(text);
    await expect(page.getByRole("alertdialog")).toBeVisible();
    if (name === "F-sold-out" || name === "F-network" || name === "F-network-unknown" || name === "F-rate-limited") await snap(page, info, name, false);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("buy-dialog")).toHaveCount(0);
  }
});

test("G: leaderboard 1v1/2v2 with the pinned own row", async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.goto("./#/leaderboard");
  await expect(page.getByTestId("lb-row")).toHaveCount(8);
  await expect(page.getByTestId("lb-pinned-unranked")).toHaveText("Chưa có hạng: chơi thêm 3 trận online với người thật để có hạng.");
  await snap(page, info, "G-leaderboard-1v1-unranked", false);
  await page.getByRole("radio", { name: "2v2" }).click();
  await expect(page.getByTestId("lb-row").first()).toContainText("12");
  // play 3 mock online matches so `me` has a rank
  // in-app navigation (a hash-only page.goto is a same-document jump the router may miss)
  await page.getByRole("link", { name: "Quay lại" }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("menu-online").click();
    await page.getByTestId("quick-match").click();
    await expect(page.getByTestId("result")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("result")).not.toHaveAttribute("data-points-state", "saving", { timeout: 15_000 });
    await page.getByTestId("result-menu").click();
  }
  await page.getByRole("link", { name: "Bảng xếp hạng" }).click();
  await expect(page.getByTestId("lb-pinned-rank")).toHaveText("Hạng 24");
  await snap(page, info, "G-leaderboard-2v2-ranked", false);
});

test("Profile: name change from suggestions, owned x/N, points history, language switch -> setLang", async ({ page }, info) => {
  test.setTimeout(90_000);
  await openShop(page);
  await openSkin(page, "goblin");
  await page.getByTestId("shop-action").click();
  await page.getByTestId("buy-confirm").click();
  await page.getByTestId("unlocked-later").click();
  await page.goto("./#/profile");
  await expect(page.getByTestId("profile-owned")).toHaveText("Skin đã có: 2/6");
  await expect(page.getByTestId("points-history")).toContainText("Mua skin Goblin");
  await expect(page.getByTestId("points-history")).toContainText("-60 điểm");
  await expect(page.getByTestId("points-history")).toContainText("Điểm khởi đầu");
  await page.getByTestId("name-change").click();
  await expect(page.getByTestId("name-picker").getByRole("radio")).toHaveCount(5);
  await snap(page, info, "P-profile-name-picker");
  const second = page.getByTestId("name-picker").getByRole("radio").nth(1);
  const name = await second.getAttribute("value");
  await second.check();
  await page.getByTestId("name-save").click();
  await expect(page.getByTestId("profile-name")).toHaveText(name!);
  await page.getByRole("radio", { name: "English" }).click();
  await expect(page.getByText("Points history")).toBeVisible();
  await expect.poll(async () => (await bridgeLog(page)).find((e) => e.msg.type === "setLang")?.msg).toMatchObject({ lang: "en" });
  await snap(page, info, "P-profile-en");
  await page.goto("./#/shop");
  await expect(page.getByTestId("shop-points")).toHaveText("You have 0 points");
  await snap(page, info, "B-grid-en");
});
