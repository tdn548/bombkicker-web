// Mock suite: the site built with `--mode mock` (mock API + mock Unity). Screens A, H, I, J on desktop and iPhone,
// plus the flows that do not need the real game. The real suite (real.spec.ts) repeats the flows with Unity + API.
import { expect, test } from "@playwright/test";
import { bridgeLog, shot } from "./helpers";

const LEGACY = "bk-f77dc74e0123456789abcdef01234567";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__BK_BRIDGE_LOG__ = [];
    window.__BK_MOCK__ = { loadMs: 1500, matchMs: 1500, recordDelayMs: 1500, ...JSON.parse(sessionStorage.getItem("knobs") ?? "{}") };
  });
});

async function knobs(page: import("@playwright/test").Page, k: Record<string, unknown>) {
  await page.evaluate((v) => {
    sessionStorage.setItem("knobs", JSON.stringify(v));
    window.__BK_MOCK__ = { ...window.__BK_MOCK__, ...v };
  }, k);
}

test("A: loading -> ready menu; first visit adopts the legacy id; reload keeps the player", async ({ page }, info) => {
  await page.goto("./");
  await knobs(page, { legacyDeviceId: LEGACY });
  await page.reload();
  await expect(page.getByText("Đang tải tài khoản…")).toBeVisible();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByTestId("menu-online")).toHaveAttribute("aria-disabled", "true");
  await shot(page, info, "A-menu-loading");
  await expect(page.getByTestId("points")).toHaveText("60 điểm");
  await expect(page.getByTestId("menu-online")).not.toHaveAttribute("aria-disabled");
  expect(await page.evaluate(() => localStorage.getItem("bk_device_id"))).toBe(LEGACY);
  const name = await page.getByTestId("player-name").textContent();
  await page.waitForTimeout(300);
  await shot(page, info, "A-menu-ready");
  await page.reload();
  await expect(page.getByTestId("player-name")).toHaveText(name!);
  await expect.poll(async () => (await bridgeLog(page)).find((e) => e.msg.type === "init")?.msg).toMatchObject({ lang: "vi", accessToken: "…" });
});

test("hash route survives the boot: #/play/offline is restored after ready", async ({ page }) => {
  await page.goto("./#/play/offline");
  // before ready the URL has no route (SS-1), the screen already shows it
  expect(new URL(page.url()).hash).toBe("");
  await expect(page.getByRole("heading", { name: "Chơi offline" })).toBeVisible();
  await expect(page.getByTestId("start-offline")).not.toHaveAttribute("aria-disabled");
  await expect.poll(() => new URL(page.url()).hash).toBe("#/play/offline");
});

test("I + offline match: start -> Unity -> result -> menu", async ({ page }, info) => {
  await page.goto("./#/play/offline");
  await expect(page.getByTestId("start-offline")).not.toHaveAttribute("aria-disabled");
  const touchOnly = info.project.name.includes("iphone");
  await expect(page.getByRole("radio", { name: "Bạn cùng bàn phím" })).toHaveCount(touchOnly ? 0 : 1);
  if (!touchOnly) {
    await page.getByRole("radio", { name: "Bạn cùng bàn phím" }).click();
    await page.getByRole("radio", { name: "2v2" }).click();
    await expect(page.getByText("I J K L + H")).toBeVisible();
    await shot(page, info, "I-offline-local-2v2");
    await page.getByRole("radio", { name: "Đấu với bot" }).click();
    await page.getByRole("radio", { name: "1v1" }).click();
  }
  await page.getByRole("radio", { name: /Ice Age/ }).click();
  await shot(page, info, "I-offline");
  await page.getByTestId("start-offline").click();
  await expect(page.getByTestId("mock-match")).toBeVisible();
  await shot(page, info, "I-offline-in-match");
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("points-line")).toHaveText("Trận offline không tính điểm.");
  await shot(page, info, "J-result-offline");
  await page.getByTestId("result-menu").click();
  await expect(page.getByTestId("equipped-preview")).toBeVisible();
  const start = (await bridgeLog(page)).find((e) => e.msg.type === "startOffline");
  expect(start?.msg).toMatchObject({ mode: "1v1", opponent: "bots", map: 2 });
});

test("H + quick match: searching -> Unity -> result with +20", async ({ page }, info) => {
  await page.goto("./#/play/online");
  await expect(page.getByTestId("quick-match")).not.toHaveAttribute("aria-disabled");
  await shot(page, info, "H-online");
  await page.getByTestId("quick-match").click();
  await expect(page.getByTestId("searching-overlay")).toBeVisible();
  await expect(page.getByText("Đang chờ người chơi")).toBeVisible();
  await shot(page, info, "H-quick-waiting");
  await expect(page.getByTestId("mock-match")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("points-line")).toHaveText("+20 điểm", { timeout: 15000 });
  await expect(page.getByText("Tổng: 80 điểm")).toBeVisible();
  await shot(page, info, "J-result-win");
});

test("H rooms: create shows the code; leave sends cancelOnline; join errors", async ({ page }, info) => {
  await page.goto("./#/play/online");
  await expect(page.getByTestId("create-room")).not.toHaveAttribute("aria-disabled");
  await page.getByTestId("create-room").click();
  await expect(page.getByTestId("room-code-display").first()).toHaveText("K7M2QX");
  await expect(page.getByText("Chưa vào trận nên không bị trừ điểm.")).toBeVisible();
  await shot(page, info, "H-room-code");
  await expect(page.getByText("Đang chờ bạn bè", { exact: true })).toBeVisible({ timeout: 5000 });
  // Relay rooms (D5b): no bots, no countdown; the room starts when it is full
  await expect(page.getByTestId("searching-overlay")).toContainText("Mã phòng: K7M2QX · 1/2 người chơi · Đang chờ bạn bè…");
  await expect(page.getByTestId("searching-overlay")).not.toContainText("Bot");
  await shot(page, info, "H-room-waiting");
  await page.getByTestId("cancel-online").click();
  await expect(page.getByTestId("searching-overlay")).toHaveCount(0);
  expect((await bridgeLog(page)).some((e) => e.dir === "R->U" && e.msg.type === "cancelOnline")).toBe(true);

  // code input: lower case and dashes are cleaned, bad characters explained
  const input = page.getByTestId("room-code");
  await input.fill("k7m-2q");
  await expect(input).toHaveValue("K7M2Q");
  await expect(page.getByTestId("join-room")).toHaveAttribute("aria-disabled", "true");
  await input.fill("AAAO");
  await expect(page.getByText("Mã phòng không có chữ I, L, O và số 0, 1.")).toBeVisible();
  await shot(page, info, "H-code-badchar");

  for (const [code, text] of [
    ["AAAAAA", "Không tìm thấy phòng AAAAAA. Mã có thể bị sai, hoặc phòng đã đóng."],
    ["FFFFFF", "Phòng FFFFFF đã đủ người."],
    ["GGGGGG", "Phòng GGGGGG đã bắt đầu trận. Hãy nhờ bạn tạo phòng mới."],
    ["CCCCCC", "Phòng CCCCCC đã đóng."],
    ["RRRRRR", "Không kết nối được dịch vụ phòng. Kiểm tra mạng rồi thử lại."],
  ] as const) {
    await expect(page.getByTestId("join-room")).toBeVisible();
    await input.fill(code);
    await expect(page.getByTestId("join-room")).not.toHaveAttribute("aria-disabled", { timeout: 5000 });
    await input.press("Enter");
    await expect(page.getByTestId("online-error")).toHaveText(text);
    if (code === "AAAAAA") {
      await shot(page, info, "H-error-room-not-found");
      await page.getByRole("button", { name: "Nhập lại" }).click();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("AAAAAA");
    } else {
      await page.getByRole("button", { name: "Đóng" }).click();
    }
    await expect(page.getByTestId("searching-overlay")).toHaveCount(0);
  }
});

test("H rooms: the host leaving mid-match shows HOST_LEFT (no result, no points)", async ({ page }, info) => {
  await page.goto("./#/play/online");
  await knobs(page, { matchMs: 30000, hostLeftAfterMs: 800 });
  await expect(page.getByTestId("join-room")).toBeVisible();
  await page.getByTestId("room-code").fill("K7M2QX");
  await expect(page.getByTestId("join-room")).not.toHaveAttribute("aria-disabled", { timeout: 5000 });
  await page.getByTestId("join-room").click();
  await expect(page.getByTestId("mock-match")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("online-error")).toHaveText("Chủ phòng đã rời trận. Trận này không tính điểm.", { timeout: 5000 });
  await expect(page.getByTestId("online-error")).toHaveAttribute("data-code", "HOST_LEFT");
  await shot(page, info, "H-room-host-left");
  expect((await bridgeLog(page)).some((e) => e.msg.type === "matchEnded")).toBe(false);
  await page.getByRole("button", { name: "Đóng" }).click();
  await expect(page.getByTestId("searching-overlay")).toHaveCount(0);
  await expect(page.getByTestId("quick-match")).toBeVisible();
});

test("J: leaving an online match shows the D16 copy when the result is not in yet", async ({ page }, info) => {
  await page.goto("./#/play/online");
  await knobs(page, { result: "left", recordDelayMs: 30000 });
  await expect(page.getByTestId("quick-match")).not.toHaveAttribute("aria-disabled");
  await page.getByTestId("quick-match").click();
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Bạn đã rời trận")).toBeVisible();
  await expect(page.getByText("Rời trận được tính là thua.")).toBeVisible();
  await expect(page.getByTestId("points-line")).toHaveText("Đang lưu kết quả…");
  await expect(page.getByTestId("points-line")).toHaveText("Trận vẫn đang tiếp tục. -10 điểm sẽ được trừ khi trận kết thúc.", { timeout: 15000 });
  await shot(page, info, "J-result-left");
});

test("English: Profile switch sends setLang and changes the copy", async ({ page }, info) => {
  await page.goto("./");
  await expect(page.getByTestId("player-name")).toBeVisible();
  await page.getByTestId("player-name").click();
  await page.getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  expect((await bridgeLog(page)).find((e) => e.msg.type === "setLang")?.msg).toMatchObject({ lang: "en" });
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  await page.getByRole("link", { name: /Back/ }).click();
  await expect(page.getByTestId("menu-online")).toHaveText("Play online");
  await shot(page, info, "A-menu-en");
  await page.getByTestId("menu-online").click();
  await shot(page, info, "H-online-en");
});

test("A: Unity load failure shows Reload, Play stays off", async ({ page }, info) => {
  await page.goto("./");
  await knobs(page, { failLoad: true });
  await page.reload();
  await expect(page.getByText("Không tải được game. Kiểm tra mạng rồi tải lại trang.")).toBeVisible();
  await expect(page.getByTestId("menu-online")).toHaveAttribute("aria-disabled", "true");
  await shot(page, info, "A-menu-failed");
});
