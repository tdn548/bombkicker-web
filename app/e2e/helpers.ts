import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

/** Screenshots for the task folder (SS-13). Override with SHOT_DIR. */
export const SHOT_DIR = process.env.SHOT_DIR ?? path.resolve(import.meta.dirname, "../../../BombKicker/.agents/tasks/skin-shop/react-shell");

export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${info.project.name}--${name}.png`), fullPage: true });
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
