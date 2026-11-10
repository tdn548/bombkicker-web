// Room code input with the real Unity build loaded (owner bug, relay-rooms run): on iPhone typing did nothing (only
// paste worked), on a MacBook Backspace/Delete did nothing; uppercase while typing is intended.
// Cause (repro on the live build 242307d): Unity's WebGL keyboard listeners on window call preventDefault while
// WebGLInput.captureAllKeyboardInput is true (Unity's default), even when a React <input> has focus. The fix makes the
// embedded build release the keyboard while React menus are on screen and take it back when a match starts.
// Every keydown is logged with who called preventDefault (stack) and whether the default was prevented after all
// listeners ran, so a failure names the listener.
// Needs BK_E2E_REAL=1, the Unity build in public/game, BK_CSP_LOCAL_API=1 npm run build, the local API (README).
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { bridgeLog } from "./helpers";

const API = process.env.BK_E2E_API ?? "http://localhost:8787";
const UNITY_READY = 180_000;
const EVIDENCE_DIR =
  process.env.BK_EVIDENCE_DIR ?? path.resolve(import.meta.dirname, "../../../BombKicker/.agents/tasks/skin-shop/relay-rooms/input-evidence");

type KeyLog = { type: string; key: string; target: string; preventedAfter: boolean; preventedBy: string | null };

async function routeApi(page: Page) {
  if (API === "http://localhost:8787") return;
  await page.route(/^http:\/\/localhost:8787\//, async (route) => {
    const url = route.request().url().replace(/^http:\/\/localhost:8787/, API);
    try {
      const body = route.request().postDataBuffer();
      await route.fulfill({ response: await route.fetch(body ? { url, postData: body } : { url }) });
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
}

/** Records every keydown: target, whether its default was prevented once all listeners ran, and by whom. */
async function watchKeys(page: Page) {
  await page.addInitScript(() => {
    window.__BK_BRIDGE_LOG__ = [];
    const log: KeyLog[] = [];
    (window as unknown as { __BK_KEYS__: KeyLog[] }).__BK_KEYS__ = log;
    const orig = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function (this: Event) {
      if (this.type === "keydown" || this.type === "keypress" || this.type === "beforeinput") {
        const stack = (new Error().stack ?? "").split("\n").slice(1, 4).join(" | ").trim();
        (this as unknown as { __by?: string }).__by ??= stack || "(no stack)";
      }
      return orig.call(this);
    };
    for (const type of ["keydown", "keypress", "beforeinput"]) {
      window.addEventListener(
        type,
        (e) => {
          const t = e.target as HTMLElement | null;
          const target = t ? `${t.tagName.toLowerCase()}${t.id ? "#" + t.id : ""}${t.dataset?.testid ? `[${t.dataset.testid}]` : ""}` : "?";
          const key = e instanceof KeyboardEvent ? e.key : ((e as InputEvent).inputType ?? "");
          // After dispatch: every listener (Unity's included) has run.
          setTimeout(() => log.push({ type, key, target, preventedAfter: e.defaultPrevented, preventedBy: (e as unknown as { __by?: string }).__by ?? null }), 0);
        },
        true,
      );
    }
  });
}

const keys = (page: Page) => page.evaluate(() => (window as unknown as { __BK_KEYS__: KeyLog[] }).__BK_KEYS__.slice());

function saveEvidence(name: string, data: unknown) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

async function openOnline(page: Page) {
  await routeApi(page);
  await watchKeys(page);
  await page.goto("./#/play/online");
  await expect(page.getByTestId("quick-match")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });
  expect((await bridgeLog(page)).some((e) => e.dir === "U->R" && e.msg.type === "ready")).toBe(true);
}

/** Focus the field the way the platform does: a tap on touch devices, a click elsewhere. */
async function focusCode(page: Page, touch: boolean) {
  const input = page.getByTestId("room-code");
  if (touch) await input.tap();
  else await input.click();
  await expect(input).toBeFocused();
  return input;
}

test("room code: type, Backspace, Delete, paste and uppercase work with Unity loaded", async ({ page }, info) => {
  test.setTimeout(360_000);
  const touch = info.project.use.hasTouch === true;
  await openOnline(page);
  const input = await focusCode(page, touch);
  const steps: { step: string; value: string }[] = [];
  const record = async (step: string) => steps.push({ step, value: await input.inputValue() });
  try {
    await page.keyboard.type("ab2c", { delay: 30 });
    await record("type ab2c");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await record("Backspace x2");
    // Forward delete with the caret at the start (set directly: Home does not move the caret in macOS WebKit).
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 0));
    await page.keyboard.press("Delete");
    await record("caret at start + Delete");
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(el.value.length, el.value.length));
    // Paste: the text arrives as one input event without key events (like a paste or an iOS suggestion).
    await page.keyboard.insertText("k7m2qx");
    await record("paste k7m2qx");
  } finally {
    saveEvidence(`${info.project.name}--typing`, { steps, keys: await keys(page) });
  }
  expect(steps).toEqual([
    { step: "type ab2c", value: "AB2C" },
    { step: "Backspace x2", value: "AB" },
    { step: "caret at start + Delete", value: "B" },
    { step: "paste k7m2qx", value: "BK7M2Q" },
  ]);
  // No listener blocked an editing key aimed at the field.
  const blocked = (await keys(page)).filter((k) => k.target.includes("[room-code]") && k.preventedAfter);
  expect(blocked).toEqual([]);
  await expect(page.getByTestId("join-room")).not.toHaveAttribute("aria-disabled");
});

test("gameplay keys still go to Unity in a match; the room code field works again after it", async ({ page }, info) => {
  test.setTimeout(480_000);
  test.skip(info.project.use.hasTouch === true, "phones play with the on-screen controls; the keyboard part is desktop only");
  const logs: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("[Embedded] Keyboard capture")) logs.push(m.text());
  });
  await routeApi(page);
  await watchKeys(page);
  await page.goto("./#/play/offline");
  await expect(page.getByTestId("start-offline")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });
  await page.getByTestId("start-offline").click();
  await expect(page.getByTestId("unity-layer")).toHaveClass(/visible/);
  await page.waitForTimeout(6000); // intro
  for (let i = 0; i < 3; i++) {
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(150);
    await page.keyboard.up("ArrowRight");
  }
  await expect.poll(async () => (await keys(page)).filter((k) => k.type === "keydown" && k.key === "ArrowRight").length).toBeGreaterThan(0);
  const arrows = (await keys(page)).filter((k) => k.type === "keydown" && k.key === "ArrowRight");
  saveEvidence(`${info.project.name}--gameplay`, { arrows, logs });
  // Unity owns the keys again: its window listener prevents the default (no page scroll) as before the fix.
  expect(arrows.every((k) => k.preventedAfter && (k.preventedBy ?? "").includes("keyEventHandlerFunc"))).toBe(true);
  expect(logs.some((l) => l.includes("capture on"))).toBe(true);
  // A bots match ends on its own (the player stands still), then back to the menu.
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 400_000 });
  await expect.poll(async () => (await bridgeLog(page)).some((e) => e.msg.type === "returnedToMenu"), { timeout: 30_000 }).toBe(true);
  expect(logs.filter((l) => l.includes("capture off")).length).toBeGreaterThan(0);
  await page.getByTestId("result-menu").click();
  await page.getByTestId("menu-online").click();
  const input = await focusCode(page, false);
  await page.keyboard.type("x9y", { delay: 30 });
  await page.keyboard.press("Backspace");
  await expect(input).toHaveValue("X9");
});
