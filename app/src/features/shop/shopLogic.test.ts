// Every row of the ux-spec 1.2 action button table and the 1.3 card badges.
import { describe, expect, it } from "vitest";
import type { SkinDto } from "../../api/types";
import { actionView, cardBadges, filterTab, rarityTabs, visibleSkins, type ActionInputs } from "./shopLogic";

const skin = (over: Partial<SkinDto> = {}): SkinDto => ({
  key: "pig",
  name: "Pig",
  rarity: "common",
  price: 60,
  isDefault: false,
  onSale: true,
  stockLimit: null,
  remaining: null,
  soldOut: false,
  sortOrder: 10,
  sheet: { url: "x", version: "0000000000000000", width: 576, height: 128, layout: { v: 1, pivotY: 0.375, rows: [] } },
  ...over,
});
const base = (over: Partial<ActionInputs> = {}): ActionInputs => ({ loaded: true, skin: skin(), owned: false, equipped: false, equipPending: false, points: 100, ...over });
const helperKeys = (i: ActionInputs) => actionView(i).helpers.map((h) => h.key);

describe("action button (ux-spec 1.2)", () => {
  it("row 1: not loaded -> skeleton, no text, off", () => {
    const v = actionView(base({ loaded: false }));
    expect(v).toMatchObject({ row: 1, kind: "skeleton", label: null, enabled: false, helpers: [], action: null });
    expect(actionView(base({ skin: null })).row).toBe(1);
  });
  it("row 2: equip in flight wins over everything after it", () => {
    const v = actionView(base({ owned: true, equipped: true, equipPending: true }));
    expect(v).toMatchObject({ row: 2, label: { key: "shop.action.equipping" }, enabled: false, helpers: [] });
  });
  it("row 3: equipped -> In use, off, helper", () => {
    const v = actionView(base({ owned: true, equipped: true }));
    expect(v).toMatchObject({ row: 3, label: { key: "shop.action.inUse" }, enabled: false, action: null });
    expect(helperKeys(base({ owned: true, equipped: true }))).toEqual(["shop.helper.inUse"]);
  });
  it("row 4: owned, on sale or default -> Equip, no helper", () => {
    expect(actionView(base({ owned: true }))).toMatchObject({ row: 4, label: { key: "shop.action.equip" }, enabled: true, helpers: [], action: "equip" });
    const def = skin({ key: "human", isDefault: true, onSale: false, price: 0 });
    expect(actionView(base({ skin: def, owned: true }))).toMatchObject({ row: 4, enabled: true, action: "equip" });
  });
  it("row 5: owned but no longer sold -> Equip with the retired helper", () => {
    const v = actionView(base({ skin: skin({ onSale: false }), owned: true }));
    expect(v).toMatchObject({ row: 5, enabled: true, action: "equip" });
    expect(v.helpers.map((h) => h.key)).toEqual(["shop.helper.retiredOwned"]);
  });
  it("row 6: not owned, not on sale -> Not on sale, off", () => {
    const v = actionView(base({ skin: skin({ onSale: false }) }));
    expect(v).toMatchObject({ row: 6, label: { key: "shop.action.notOnSale" }, enabled: false, action: null });
    expect(v.helpers.map((h) => h.key)).toEqual(["shop.helper.notOnSale"]);
  });
  it("row 7: sold out -> Sold out with the copy count", () => {
    const v = actionView(base({ skin: skin({ stockLimit: 10, remaining: 0, soldOut: true }) }));
    expect(v).toMatchObject({ row: 7, label: { key: "shop.action.soldOut" }, enabled: false });
    expect(v.helpers).toEqual([{ key: "shop.helper.soldOut", params: { stockLimit: 10 } }]);
  });
  it("row 8: price 0 -> Get for free (opens D), stock helper when limited", () => {
    expect(actionView(base({ skin: skin({ price: 0 }) }))).toMatchObject({ row: 8, label: { key: "shop.action.free" }, enabled: true, helpers: [], action: "buy" });
    const limited = actionView(base({ skin: skin({ price: 0, stockLimit: 5, remaining: 2 }) }));
    expect(limited.helpers).toEqual([{ key: "shop.helper.stock", params: { remaining: 2, stockLimit: 5 } }]);
  });
  it("row 9: enough points (also exactly the price) -> Buy · price, opens D", () => {
    expect(actionView(base({ points: 60 }))).toMatchObject({ row: 9, label: { key: "shop.action.buy", params: { price: 60 } }, enabled: true, helpers: [], action: "buy" });
  });
  it("row 10: limited stock adds the stock line to row 9", () => {
    const v = actionView(base({ skin: skin({ stockLimit: 10, remaining: 3 }) }));
    expect(v.row).toBe(9);
    expect(v.helpers).toEqual([{ key: "shop.helper.stock", params: { remaining: 3, stockLimit: 10 } }]);
  });
  it("row 11: too few points -> Buy · price, off, need N more, about M wins", () => {
    const v = actionView(base({ skin: skin({ price: 160, rarity: "rare" }), points: 60 }));
    expect(v).toMatchObject({ row: 11, kind: "cantAfford", label: { key: "shop.action.buy", params: { price: 160 } }, enabled: false, action: null });
    expect(v.helpers).toEqual([{ key: "shop.helper.need.many", params: { need: 100, wins: 5 } }]);
  });
  it("row 11: one win -> the singular copy; 1 point short is still one win", () => {
    expect(actionView(base({ points: 59 })).helpers[0]).toEqual({ key: "shop.helper.need.one", params: { need: 1, wins: 1 } });
    expect(actionView(base({ points: 40 })).helpers[0]).toEqual({ key: "shop.helper.need.one", params: { need: 20, wins: 1 } });
    expect(actionView(base({ points: 39 })).helpers[0]).toEqual({ key: "shop.helper.need.many", params: { need: 21, wins: 2 } });
  });
  it("rows 11 + 10: need line first, then the stock line", () => {
    const v = actionView(base({ skin: skin({ price: 500, stockLimit: 10, remaining: 4, rarity: "legendary" }), points: 0 }));
    expect(v.helpers.map((h) => h.key)).toEqual(["shop.helper.need.many", "shop.helper.stock"]);
    expect(v.helpers[0].params).toEqual({ need: 500, wins: 25 });
  });
  it("sold out beats affordability and a free price", () => {
    expect(actionView(base({ skin: skin({ price: 0, stockLimit: 1, remaining: 0, soldOut: true }) })).row).toBe(7);
    expect(actionView(base({ skin: skin({ stockLimit: 1, remaining: 0, soldOut: true }), points: 0 })).row).toBe(7);
  });
  it("owning a sold-out skin still allows Equip", () => {
    expect(actionView(base({ skin: skin({ stockLimit: 1, remaining: 0, soldOut: true }), owned: true })).row).toBe(4);
  });
});

describe("card badges (ux-spec 1.3) and grid filter", () => {
  it("equipped / owned / sold out / price (+ stock)", () => {
    expect(cardBadges(skin(), true, true).map((b) => b.key)).toEqual(["shop.badge.inUse"]);
    expect(cardBadges(skin(), true, false).map((b) => b.key)).toEqual(["shop.badge.owned"]);
    expect(cardBadges(skin({ soldOut: true, stockLimit: 3, remaining: 0 }), false, false).map((b) => b.key)).toEqual(["shop.badge.soldOut"]);
    expect(cardBadges(skin(), false, false)).toEqual([{ kind: "price", key: "shop.badge.price", params: { price: 60 } }]);
    expect(cardBadges(skin({ stockLimit: 10, remaining: 3 }), false, false).map((b) => [b.key, b.params])).toEqual([
      ["shop.badge.price", { price: 60 }],
      ["shop.badge.stock", { remaining: 3, stockLimit: 10 }],
    ]);
  });
  it("hides not-on-sale skins the player does not own; keeps owned retired ones and defaults", () => {
    const cat = [
      skin({ key: "human", isDefault: true, onSale: false, price: 0 }),
      skin({ key: "pig" }),
      skin({ key: "old", onSale: false }),
      skin({ key: "retired", onSale: false, rarity: "epic" }),
    ];
    const owned = new Set(["human", "retired"]);
    expect(visibleSkins(cat, owned).map((s) => s.key)).toEqual(["human", "pig", "retired"]);
    const vis = visibleSkins(cat, owned);
    expect(filterTab(vis, "owned", owned).map((s) => s.key)).toEqual(["human", "retired"]);
    expect(filterTab(vis, "epic", owned).map((s) => s.key)).toEqual(["retired"]);
    expect(rarityTabs(vis)).toEqual(["common", "epic"]);
  });
});
