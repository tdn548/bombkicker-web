import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

/** Screenshots for the task folder (SS-13). Override with SHOT_DIR. */
export const SHOT_DIR = process.env.SHOT_DIR ?? path.resolve(import.meta.dirname, "../../../BombKicker/.agents/tasks/skin-shop/react-shell");

/** Screenshots of SS-14 (shop, leaderboard, profile). Override with SHOP_SHOT_DIR. */
export const SHOP_SHOT_DIR = process.env.SHOP_SHOT_DIR ?? path.resolve(import.meta.dirname, "../../../BombKicker/.agents/tasks/skin-shop/react-shop");
export async function shot(page: Page, info: TestInfo, name: string, dir: string = SHOT_DIR, fullPage = true): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${info.project.name}--${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

export type BridgeEntry = { dir: "R->U" | "U->R"; msg: Record<string, unknown> };

export async function bridgeLog(page: Page): Promise<BridgeEntry[]> {
  return page.evaluate(() => (window.__BK_BRIDGE_LOG__ ?? []) as never);
}

declare global {
  interface Window {
    __BK_BRIDGE_LOG__?: unknown[];
    __BK_MOCK__?: Record<string, unknown>;
  }
}
