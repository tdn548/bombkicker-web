// Skin sprite sheet layout validator (plan "Sprite sheet layout"). Port of bombkicker-api src/lib/skinLayout.ts
// (branch skin-shop, SS-5); keep the two in sync. Both run the shared vectors in test/fixtures/skin-layouts/*.json
// (copied from bombkicker-api test/fixtures/skin-layouts, README there explains the no-cascade rules).
export const SKIN_ANIMS = ["idle", "walk", "swing", "death"] as const;
export type SkinAnim = (typeof SKIN_ANIMS)[number];
export type SkinLayoutErrorCode =
  | "IMAGE_TOO_LARGE"
  | "LAYOUT_TYPE"
  | "UNKNOWN_KEY"
  | "VERSION"
  | "PIVOT_RANGE"
  | "ROWS_TYPE"
  | "ANIM_UNKNOWN"
  | "ANIM_DUPLICATE"
  | "ANIM_MISSING"
  | "CELL_RANGE"
  | "FRAMES_RANGE"
  | "FPS_RANGE"
  | "Y_TYPE"
  | "ROW_OUTSIDE_IMAGE"
  | "SWING_TOO_LONG"
  | "DEATH_TOO_LONG";
export type SkinLayoutRow = { anim: SkinAnim; y: number; cellW: number; cellH: number; frames: number; fps: number };
export type SkinLayout = { v: 1; pivotY: number; rows: SkinLayoutRow[] };
export type Rect = { x: number; y: number; w: number; h: number };
export type AnimFrames = { fps: number; frameTime: number; topLeft: Rect[]; unity: Rect[] };

export const SHEET_MAX_SIZE = 1024;
const SWING_MAX_S = 0.5;
const DEATH_MAX_S = 1.0;
const DURATION_EPSILON = 1e-9;
const TOP_KEYS = new Set(["v", "pivotY", "rows"]);
const ROW_KEYS = new Set(["anim", "y", "cellW", "cellH", "frames", "fps"]);

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isAnim = (v: unknown): v is SkinAnim => typeof v === "string" && (SKIN_ANIMS as readonly string[]).includes(v);

export type SkinLayoutResult = { ok: true; layout: SkinLayout } | { ok: false; errors: SkinLayoutErrorCode[] };

/** Validates a parsed layout JSON against the PNG's size. Errors are each code once, sorted. */
export function validateSkinLayout(layout: unknown, width: number, height: number): SkinLayoutResult {
  const errors = new Set<SkinLayoutErrorCode>();
  const sizeOk = isInt(width) && isInt(height);
  if (!(sizeOk && width >= 1 && width <= SHEET_MAX_SIZE && height >= 1 && height <= SHEET_MAX_SIZE)) {
    errors.add("IMAGE_TOO_LARGE");
  }
  if (!isObject(layout)) return { ok: false, errors: ["LAYOUT_TYPE"] };
  if (Object.keys(layout).some((k) => !TOP_KEYS.has(k))) errors.add("UNKNOWN_KEY");
  if (layout.v !== 1) errors.add("VERSION");
  const pivot = layout.pivotY;
  if (!(isNum(pivot) && pivot >= 0 && pivot <= 1)) errors.add("PIVOT_RANGE");
  const rows = layout.rows;
  if (!Array.isArray(rows)) {
    errors.add("ROWS_TYPE");
    return done(errors, layout);
  }
  const seen = new Set<SkinAnim>();
  for (const row of rows as unknown[]) {
    if (!isObject(row)) {
      errors.add("ROWS_TYPE");
      continue;
    }
    if (Object.keys(row).some((k) => !ROW_KEYS.has(k))) errors.add("UNKNOWN_KEY");
    const anim = row.anim;
    if (!isAnim(anim)) errors.add("ANIM_UNKNOWN");
    else if (seen.has(anim)) errors.add("ANIM_DUPLICATE");
    else seen.add(anim);
    const { y, cellW, cellH, frames, fps } = row;
    const okCell = isInt(cellW) && isInt(cellH) && cellW >= 1 && cellW <= 256 && cellH >= 1 && cellH <= 256;
    const okFrames = isInt(frames) && frames >= 1 && frames <= 16;
    const okFps = isNum(fps) && fps >= 1 && fps <= 30;
    if (!okCell) errors.add("CELL_RANGE");
    if (!okFrames) errors.add("FRAMES_RANGE");
    if (!okFps) errors.add("FPS_RANGE");
    if (!isInt(y)) errors.add("Y_TYPE");
    // Bounds only when the row's own numbers are valid (no cascades).
    if (isInt(y) && okCell && okFrames && sizeOk) {
      if (y < 0 || y + cellH > height || frames * cellW > width) errors.add("ROW_OUTSIDE_IMAGE");
    }
    if (okFrames && okFps) {
      const duration = frames / fps;
      if (anim === "swing" && duration > SWING_MAX_S + DURATION_EPSILON) errors.add("SWING_TOO_LONG");
      if (anim === "death" && duration > DEATH_MAX_S + DURATION_EPSILON) errors.add("DEATH_TOO_LONG");
    }
  }
  if (SKIN_ANIMS.some((a) => !seen.has(a))) errors.add("ANIM_MISSING");
  return done(errors, layout);
}

function done(errors: Set<SkinLayoutErrorCode>, layout: Record<string, unknown>): SkinLayoutResult {
  if (errors.size > 0) return { ok: false, errors: [...errors].sort() };
  return { ok: true, layout: layout as unknown as SkinLayout };
}

/** Frame rects per anim for a valid layout: top-left origin (canvas) and Unity's bottom-left origin. */
export function frameRects(layout: SkinLayout, height: number): Record<SkinAnim, AnimFrames> {
  const out = {} as Record<SkinAnim, AnimFrames>;
  for (const row of layout.rows) {
    const topLeft: Rect[] = [];
    const unity: Rect[] = [];
    for (let i = 0; i < row.frames; i++) {
      topLeft.push({ x: i * row.cellW, y: row.y, w: row.cellW, h: row.cellH });
      unity.push({ x: i * row.cellW, y: height - row.y - row.cellH, w: row.cellW, h: row.cellH });
    }
    out[row.anim] = { fps: row.fps, frameTime: 1 / row.fps, topLeft, unity };
  }
  return out;
}
