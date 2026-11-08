// Canvas preview of a skin sheet: one animation row, played at the row's fps, optional flip and team ring.
// The layout goes through the shared validator first; an invalid layout or a failed sheet download falls back to the
// bundled sheet of the same key, else a neutral silhouette with the name (ux-spec 2.5).
import { useEffect, useMemo, useRef, useState } from "react";
import type { SkinSheet } from "../api/types";
import { bundledSheetUrl, findBundled } from "./bundled";
import { frameRects, validateSkinLayout, type SkinAnim, type SkinLayout } from "./layout";

/** Team ring colors (SS-3, plan "Team ring"); the same two values as Unity's TeamRingConfig. */
export const TEAM_COLORS = { 1: "#FEE761", 2: "#B55088" } as const;
const RING_OUTLINE = "#181425";
/** Ring sprite 22 x 10 px, centred 11 px below the pivot (local y -11/16 at PPU 16). */
const RING_W = 22;
const RING_H = 10;
const RING_BELOW_PIVOT = 11;

export interface SpriteSource {
  key: string;
  name: string;
  sheet: Pick<SkinSheet, "url" | "width" | "height" | "layout">;
}

interface Props {
  skin: SpriteSource;
  anim?: SkinAnim;
  /** Integer zoom (pixel art stays sharp). */
  scale?: number;
  flip?: boolean;
  ring?: 1 | 2 | null;
  className?: string;
  /** Accessible label; the canvas is decorative when omitted. */
  label?: string;
}

interface Resolved {
  url: string;
  width: number;
  height: number;
  layout: SkinLayout;
}

function resolveSource(skin: SpriteSource, failed: boolean): Resolved | null {
  const v = validateSkinLayout(skin.sheet.layout, skin.sheet.width, skin.sheet.height);
  if (!failed && v.ok) return { url: skin.sheet.url, width: skin.sheet.width, height: skin.sheet.height, layout: v.layout };
  const b = findBundled(skin.key);
  if (b && (failed ? skin.sheet.url !== bundledSheetUrl(b.key) : true)) {
    return { url: bundledSheetUrl(b.key), width: b.width, height: b.height, layout: b.layout };
  }
  return null;
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SkinSprite({ skin, anim = "idle", scale = 4, flip = false, ring = null, className, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === skin.sheet.url;
  const src = useMemo(() => resolveSource(skin, failed), [skin, failed]);
  const [img, setImg] = useState<{ url: string; el: HTMLImageElement } | null>(null);
  const [bundledFailed, setBundledFailed] = useState(false);

  useEffect(() => {
    if (!src) return;
    const el = new Image();
    let alive = true;
    el.onload = () => alive && setImg({ url: src.url, el });
    el.onerror = () => {
      if (!alive) return;
      if (src.url === skin.sheet.url) setFailedUrl(src.url);
      else setBundledFailed(true);
    };
    el.src = src.url;
    return () => {
      alive = false;
    };
  }, [src, skin.sheet.url]);

  const row = src?.layout.rows.find((r) => r.anim === anim) ?? null;
  const cellW = row?.cellW ?? 32;
  const cellH = row?.cellH ?? 32;
  const pivotPx = src ? Math.round(src.layout.pivotY * cellH) : 12;
  // Room below the cell for the ring (its bottom edge is RING_BELOW_PIVOT + RING_H/2 under the pivot).
  const below = ring ? Math.max(0, RING_BELOW_PIVOT + RING_H / 2 - pivotPx) : 0;
  const w = Math.max(cellW, ring ? RING_W : 0);
  const h = cellH + below;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src || !row || !img || img.url !== src.url) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rects = frameRects(src.layout, src.height)[anim].topLeft;
    const draw = (frame: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      if (ring) drawRing(ctx, w / 2, cellH - pivotPx + RING_BELOW_PIVOT, TEAM_COLORS[ring]);
      const r = rects[frame % rects.length];
      const dx = (w - cellW) / 2;
      if (flip) {
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img.el, r.x, r.y, r.w, r.h, dx, 0, r.w, r.h);
        ctx.restore();
      } else {
        ctx.drawImage(img.el, r.x, r.y, r.w, r.h, dx, 0, r.w, r.h);
      }
    };
    if (reducedMotion() || rects.length === 1) {
      draw(0);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      draw(Math.floor(((now - t0) / 1000) * row.fps));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [src, row, img, anim, scale, flip, ring, w, cellW, cellH, pivotPx]);

  if (!src || bundledFailed) {
    return (
      <div className={`skin-sprite skin-sprite--fallback ${className ?? ""}`} style={{ width: 32 * scale, height: 32 * scale }} role={label ? "img" : undefined} aria-label={label}>
        <span className="skin-sprite__silhouette" aria-hidden="true" />
        <span className="skin-sprite__name">{skin.name}</span>
      </div>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      className={`skin-sprite ${className ?? ""}`}
      width={w * scale}
      height={h * scale}
      style={{ width: w * scale, height: h * scale }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-skin={skin.key}
    />
  );
}

function drawRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string) {
  // 1 px dark outline, 1 px rim in the team color, interior at alpha 96/255 (SS-3 sprite).
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, RING_W / 2 - 0.5, RING_H / 2 - 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 96 / 255;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = RING_OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, RING_W / 2 - 1.5, RING_H / 2 - 1.5, 0, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}
