// Shop rules from ux-spec.md (SS-4) section 1: the action button state table (1.2), card badges (1.3) and the grid
// filter. Pure functions, so every row of the table is a unit test (shopLogic.test.ts).
import type { MySkins, Rarity, SkinDto } from "../../api/types";
import type { MessageKey } from "../../i18n/vi";
import { WIN_POINTS } from "../../i18n/params";

export type Text = { key: MessageKey; params?: Record<string, string | number> };

export interface ActionInputs {
  /** /v1/me, /v1/me/skins and /v1/skins all loaded at least once. */
  loaded: boolean;
  skin: SkinDto | null;
  owned: boolean;
  equipped: boolean;
  /** A PATCH /v1/me/equipped-skin for this skin is in flight. */
  equipPending: boolean;
  points: number;
}

export type ActionKind = "skeleton" | "equipping" | "inUse" | "equip" | "notOnSale" | "soldOut" | "free" | "buy" | "cantAfford";

export interface ActionView {
  /** Row number of the ux-spec 1.2 table (1-11; row 10 is the stock helper added to 8, 9 and 11). */
  row: number;
  kind: ActionKind;
  label: Text | null;
  enabled: boolean;
  helpers: Text[];
  /** What a press does: open dialog D ("buy"), equip at once ("equip"), nothing. */
  action: "buy" | "equip" | null;
}

const stockHelper = (s: SkinDto): Text[] =>
  s.stockLimit !== null ? [{ key: "shop.helper.stock", params: { remaining: s.remaining ?? 0, stockLimit: s.stockLimit } }] : [];

/** ux-spec 1.2, evaluated top to bottom, first match wins. */
export function actionView(i: ActionInputs): ActionView {
  const s = i.skin;
  if (!i.loaded || !s) return { row: 1, kind: "skeleton", label: null, enabled: false, helpers: [], action: null };
  if (i.equipPending) return { row: 2, kind: "equipping", label: { key: "shop.action.equipping" }, enabled: false, helpers: [], action: null };
  if (i.equipped) {
    return { row: 3, kind: "inUse", label: { key: "shop.action.inUse" }, enabled: false, helpers: [{ key: "shop.helper.inUse" }], action: null };
  }
  if (i.owned && (s.onSale || s.isDefault)) return { row: 4, kind: "equip", label: { key: "shop.action.equip" }, enabled: true, helpers: [], action: "equip" };
  if (i.owned) {
    return { row: 5, kind: "equip", label: { key: "shop.action.equip" }, enabled: true, helpers: [{ key: "shop.helper.retiredOwned" }], action: "equip" };
  }
  if (!s.onSale) {
    return { row: 6, kind: "notOnSale", label: { key: "shop.action.notOnSale" }, enabled: false, helpers: [{ key: "shop.helper.notOnSale" }], action: null };
  }
  if (s.soldOut) {
    return {
      row: 7,
      kind: "soldOut",
      label: { key: "shop.action.soldOut" },
      enabled: false,
      helpers: [{ key: "shop.helper.soldOut", params: { stockLimit: s.stockLimit ?? 0 } }],
      action: null,
    };
  }
  if (s.price === 0) return { row: 8, kind: "free", label: { key: "shop.action.free" }, enabled: true, helpers: stockHelper(s), action: "buy" };
  const buyLabel: Text = { key: "shop.action.buy", params: { price: s.price } };
  if (i.points >= s.price) return { row: 9, kind: "buy", label: buyLabel, enabled: true, helpers: stockHelper(s), action: "buy" };
  const need = s.price - i.points;
  const wins = Math.ceil(need / WIN_POINTS);
  // Row 11 first, then row 10 on a second line.
  return {
    row: 11,
    kind: "cantAfford",
    label: buyLabel,
    enabled: false,
    helpers: [{ key: wins === 1 ? "shop.helper.need.one" : "shop.helper.need.many", params: { need, wins } }, ...stockHelper(s)],
    action: null,
  };
}

export type Badge = Text & { kind: "inUse" | "owned" | "soldOut" | "price" };

/** ux-spec 1.3. Price badges add the stock line for limited skins. Every badge is text. */
export function cardBadges(s: SkinDto, owned: boolean, equipped: boolean): Badge[] {
  if (equipped) return [{ kind: "inUse", key: "shop.badge.inUse" }];
  if (owned) return [{ kind: "owned", key: "shop.badge.owned" }];
  if (s.soldOut) return [{ kind: "soldOut", key: "shop.badge.soldOut" }];
  if (!s.onSale) return [];
  const price: Badge = { kind: "price", key: "shop.badge.price", params: { price: s.price } };
  if (s.stockLimit === null) return [price];
  return [price, { kind: "price", key: "shop.badge.stock", params: { remaining: s.remaining ?? 0, stockLimit: s.stockLimit } }];
}

export const RARITIES: Rarity[] = ["common", "rare", "epic", "legendary"];
export type ShopTab = "all" | "owned" | Rarity;

export function ownedSet(mySkins: MySkins | null): Set<string> {
  return new Set(mySkins?.owned.map((o) => o.key) ?? []);
}

/** Skins the grid can show: `!onSale && !owned` stay out of every tab (ux-spec 1.2 rules). API order is kept. */
export function visibleSkins(catalog: SkinDto[], owned: Set<string>): SkinDto[] {
  return catalog.filter((s) => s.onSale || owned.has(s.key));
}

export function filterTab(skins: SkinDto[], tab: ShopTab, owned: Set<string>): SkinDto[] {
  if (tab === "all") return skins;
  if (tab === "owned") return skins.filter((s) => owned.has(s.key));
  return skins.filter((s) => s.rarity === tab);
}

/** Rarity tabs only for rarities the grid has, so no tab is empty. */
export function rarityTabs(skins: SkinDto[]): Rarity[] {
  return RARITIES.filter((r) => skins.some((s) => s.rarity === r));
}
