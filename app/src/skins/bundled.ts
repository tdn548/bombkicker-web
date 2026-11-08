// The 4 skins built into the Unity game (bombkicker-api db/seed-skins, SS-3). Sheets are byte copies in
// public/skins/<key>.png. Used as the preview fallback when a remote sheet fails (ux-spec 2.5) and by the mock API.
import type { SkinLayout } from "./layout";

const row = (anim: "idle" | "walk" | "swing" | "death", y: number, cellW: number, frames: number, fps: number) => ({
  anim,
  y,
  cellW,
  cellH: 32,
  frames,
  fps,
});

export interface BundledSkin {
  key: string;
  name: string;
  width: number;
  height: number;
  version: string;
  layout: SkinLayout;
}

export const BUNDLED_SKINS: BundledSkin[] = [
  {
    key: "human",
    name: "Human",
    width: 960,
    height: 128,
    version: "c3bda2e7568ea0b0",
    layout: { v: 1, pivotY: 0.375, rows: [row("idle", 0, 32, 9, 8), row("walk", 32, 32, 8, 12), row("swing", 64, 96, 10, 25), row("death", 96, 32, 13, 14.9425)] },
  },
  {
    key: "goblin",
    name: "Goblin",
    width: 864,
    height: 128,
    version: "13bd8326f2e9e298",
    layout: { v: 1, pivotY: 0.375, rows: [row("idle", 0, 32, 8, 8), row("walk", 32, 32, 8, 12), row("swing", 64, 96, 9, 25), row("death", 96, 32, 9, 10.3448)] },
  },
  {
    key: "pig",
    name: "Pig",
    width: 576,
    height: 128,
    version: "0c332bfbb7d91ca8",
    layout: { v: 1, pivotY: 0.375, rows: [row("idle", 0, 32, 4, 8), row("walk", 32, 32, 8, 12), row("swing", 64, 96, 6, 25), row("death", 96, 32, 9, 10.3448)] },
  },
  {
    key: "skeleton",
    name: "Skeleton",
    width: 672,
    height: 128,
    version: "a575f89ae7ea755f",
    layout: { v: 1, pivotY: 0.375, rows: [row("idle", 0, 32, 6, 8), row("walk", 32, 32, 8, 12), row("swing", 64, 96, 7, 25), row("death", 96, 32, 10, 11.4943)] },
  },
];

export function bundledSheetUrl(key: string): string {
  return `${import.meta.env.BASE_URL}skins/${key}.png`;
}

export function findBundled(key: string): BundledSkin | undefined {
  return BUNDLED_SKINS.find((s) => s.key === key);
}
