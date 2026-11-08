import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_SKINS } from "./bundled";
import { frameRects, validateSkinLayout, type AnimFrames, type SkinAnim } from "./layout";

// Shared vectors copied from bombkicker-api test/fixtures/skin-layouts (SS-3); the API and Unity run the same files.
type Vector = {
  name: string;
  note: string;
  image: { width: number; height: number };
  layout: unknown;
  expect: { valid: true; frames: Record<SkinAnim, AnimFrames> } | { valid: false; errors: string[] };
};

const dir = resolve(import.meta.dirname, "../../test/fixtures/skin-layouts");
const vectors: Vector[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Vector);

describe("skin sheet layout validator (shared vectors)", () => {
  it("has all 30 vectors", () => {
    expect(vectors.length).toBe(30);
    expect(vectors.filter((v) => v.expect.valid).length).toBe(6);
  });

  for (const v of vectors) {
    it(`${v.name}: ${v.note}`, () => {
      const r = validateSkinLayout(v.layout, v.image.width, v.image.height);
      if (!v.expect.valid) {
        expect(r.ok).toBe(false);
        expect(r.ok ? [] : r.errors).toEqual([...v.expect.errors].sort());
        return;
      }
      expect(r).toEqual({ ok: true, layout: v.layout });
      if (!r.ok) return;
      const rects = frameRects(r.layout, v.image.height);
      expect(Object.keys(rects).sort()).toEqual(["death", "idle", "swing", "walk"]);
      for (const [anim, want] of Object.entries(v.expect.frames) as [SkinAnim, AnimFrames][]) {
        const got = rects[anim];
        expect(got.fps).toBe(want.fps);
        expect(Math.abs(got.frameTime - want.frameTime)).toBeLessThan(1e-6);
        expect(got.topLeft).toEqual(want.topLeft);
        expect(got.unity).toEqual(want.unity);
      }
    });
  }

  it("treats a non-object layout as LAYOUT_TYPE only", () => {
    for (const layout of [null, [], "x", 1]) expect(validateSkinLayout(layout, 64, 64)).toEqual({ ok: false, errors: ["LAYOUT_TYPE"] });
  });

  it("bundled fallback layouts equal the valid-<key> vectors", () => {
    for (const b of BUNDLED_SKINS) {
      const v = vectors.find((x) => x.name === `valid-${b.key}`);
      expect(v, b.key).toBeDefined();
      expect(b.layout).toEqual(v!.layout);
      expect({ width: b.width, height: b.height }).toEqual(v!.image);
    }
  });
});
