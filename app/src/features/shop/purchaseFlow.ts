// Purchase flow for dialogs D, E, F (ux-spec 2.1, 2.5). Pure logic, no React:
// - PurchaseSession holds ONE idempotencyKey, made when dialog D opens and reused for every retry while D or its error
//   state is open (also after PRICE_CHANGED). The dialog makes a new session (new key) only when it is opened again.
// - mapPurchaseError turns an API error into what dialog F shows.
// - A network error, timeout or 5xx may hide a committed purchase, so attempt() asks GET /v1/me/skins once before it
//   claims "you were not charged" (ux-spec 2.5 check rule).
import { ApiError, NETWORK_ERROR } from "../../api/client";
import type { Me, MySkins, PurchaseRequest, PurchaseResponse } from "../../api/types";
import type { Text } from "./shopLogic";

export type ErrorButton = "close" | "cancel" | "retry" | "buyAtPrice" | "equip";

export interface PurchaseErrorView {
  /** Stable id for tests and data-testid. */
  id: string;
  message: Text;
  buttons: ErrorButton[];
  /** Data to refetch when the error shows. */
  refetch: ("me" | "skins")[];
  /** PRICE_CHANGED within budget: the price for "Buy for {price}" (same key, expectedPrice = this). */
  newPrice?: number;
  /** IDEMPOTENCY_KEY_REUSED is a client bug: log it. */
  log?: boolean;
}

export interface ErrorContext {
  points: number;
  /** The price React sent (the {oldPrice} of PRICE_CHANGED). */
  expectedPrice: number;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** True for answers that may hide a committed purchase: no HTTP answer, timeout, or a 5xx. */
export function isUncertain(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.code === NETWORK_ERROR || e.status === 0 || e.status >= 500;
}

/** ux-spec 2.5 table. Network/5xx answers are not mapped here (see attempt()). */
export function mapPurchaseError(e: ApiError, ctx: ErrorContext): PurchaseErrorView {
  const d = e.details ?? {};
  switch (e.code) {
    case "SOLD_OUT":
      return { id: "soldOut", message: { key: "err.soldOut" }, buttons: ["close"], refetch: ["skins"] };
    case "NOT_ON_SALE":
      return { id: "notOnSale", message: { key: "err.notOnSale" }, buttons: ["close"], refetch: ["skins"] };
    case "PRICE_CHANGED": {
      const price = num(d.price) ?? ctx.expectedPrice;
      if (price <= ctx.points) {
        return {
          id: "priceChanged",
          message: { key: "err.priceChanged", params: { oldPrice: ctx.expectedPrice, price } },
          buttons: ["buyAtPrice", "cancel"],
          refetch: ["skins"],
          newPrice: price,
        };
      }
      return {
        id: "priceChangedTooHigh",
        message: { key: "err.priceChangedTooHigh", params: { price, points: ctx.points } },
        buttons: ["close"],
        refetch: ["skins"],
      };
    }
    case "NOT_ENOUGH_POINTS": {
      const points = num(d.points) ?? ctx.points;
      const price = num(d.price) ?? ctx.expectedPrice;
      return { id: "notEnough", message: { key: "err.notEnough", params: { points, price } }, buttons: ["close"], refetch: ["me"] };
    }
    case "ALREADY_OWNED":
      return { id: "alreadyOwned", message: { key: "err.alreadyOwned" }, buttons: ["equip", "close"], refetch: ["skins"] };
    case "SKIN_NOT_FOUND":
      return { id: "skinNotFound", message: { key: "err.skinNotFound" }, buttons: ["close"], refetch: ["skins"] };
    case "RATE_LIMITED":
      // The per-player limit (20 per 60 s) answers before the purchase runs, so nothing was stored. Retrying with the
      // same key later is safe.
      return { id: "rateLimited", message: { key: "err.rateLimited" }, buttons: ["retry", "cancel"], refetch: [] };
    case "IDEMPOTENCY_KEY_REUSED":
      return { id: "generic", message: { key: "err.generic" }, buttons: ["close"], refetch: [], log: true };
    default:
      return { id: "generic", message: { key: "err.generic" }, buttons: ["close"], refetch: ["me", "skins"], log: true };
  }
}

export const NETWORK_VIEW: PurchaseErrorView = { id: "network", message: { key: "err.network" }, buttons: ["retry", "cancel"], refetch: [] };
export const NETWORK_UNKNOWN_VIEW: PurchaseErrorView = {
  id: "networkUnknown",
  message: { key: "err.networkUnknown" },
  buttons: ["retry", "cancel"],
  refetch: [],
};

export type PurchaseOutcome =
  | { kind: "unlocked"; points: number | null; replay: boolean }
  | { kind: "error"; view: PurchaseErrorView };

export interface PurchaseApi {
  purchase(body: PurchaseRequest): Promise<PurchaseResponse>;
  mySkins(): Promise<MySkins>;
  me(): Promise<Me>;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export class PurchaseSession {
  /** Made once per dialog open. Never changes for the life of the session. */
  readonly idempotencyKey: string;
  readonly skinKey: string;
  private readonly api: PurchaseApi;

  constructor(api: PurchaseApi, skinKey: string, key: string = newIdempotencyKey()) {
    this.api = api;
    this.skinKey = skinKey;
    this.idempotencyKey = key;
  }

  async attempt(expectedPrice: number, points: number): Promise<PurchaseOutcome> {
    try {
      const r = await this.api.purchase({ skinKey: this.skinKey, expectedPrice, idempotencyKey: this.idempotencyKey });
      return { kind: "unlocked", points: r.points, replay: false };
    } catch (e) {
      if (!isUncertain(e)) return { kind: "error", view: mapPurchaseError(e as ApiError, { points, expectedPrice }) };
      // Check rule: did the purchase commit before the answer got lost?
      try {
        const [mine, me] = await Promise.allSettled([this.api.mySkins(), this.api.me()]);
        if (mine.status === "rejected") return { kind: "error", view: NETWORK_UNKNOWN_VIEW };
        if (mine.value.owned.some((o) => o.key === this.skinKey)) {
          return { kind: "unlocked", points: me.status === "fulfilled" ? me.value.points : null, replay: true };
        }
        return { kind: "error", view: NETWORK_VIEW };
      } catch {
        return { kind: "error", view: NETWORK_UNKNOWN_VIEW };
      }
    }
  }
}
