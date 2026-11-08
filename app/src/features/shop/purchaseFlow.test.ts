// Purchase error mapping (ux-spec 2.5, every code from the contract + SS-7's 429) and the idempotency key rule (2.1).
import { describe, expect, it, vi } from "vitest";
import { ApiError, NETWORK_ERROR } from "../../api/client";
import type { Me, MySkins, PurchaseRequest } from "../../api/types";
import { isUncertain, mapPurchaseError, PurchaseSession, type PurchaseApi } from "./purchaseFlow";

const ctx = { points: 100, expectedPrice: 60 };
const err = (status: number, code: string, details?: Record<string, unknown>) => new ApiError(status, code, "x", details);

describe("mapPurchaseError", () => {
  it.each([
    [409, "SOLD_OUT", undefined, "soldOut", "err.soldOut", ["close"], ["skins"]],
    [410, "NOT_ON_SALE", undefined, "notOnSale", "err.notOnSale", ["close"], ["skins"]],
    [409, "ALREADY_OWNED", undefined, "alreadyOwned", "err.alreadyOwned", ["equip", "close"], ["skins"]],
    [404, "SKIN_NOT_FOUND", undefined, "skinNotFound", "err.skinNotFound", ["close"], ["skins"]],
    [429, "RATE_LIMITED", undefined, "rateLimited", "err.rateLimited", ["retry", "cancel"], []],
    [422, "IDEMPOTENCY_KEY_REUSED", undefined, "generic", "err.generic", ["close"], []],
    [400, "VALIDATION_ERROR", undefined, "generic", "err.generic", ["close"], ["me", "skins"]],
  ])("%i %s", (status, code, details, id, key, buttons, refetch) => {
    const v = mapPurchaseError(err(status, code, details), ctx);
    expect(v).toMatchObject({ id, message: { key }, buttons, refetch });
  });
  it("IDEMPOTENCY_KEY_REUSED is logged (a client bug)", () => {
    expect(mapPurchaseError(err(422, "IDEMPOTENCY_KEY_REUSED"), ctx).log).toBe(true);
  });
  it("PRICE_CHANGED within budget offers Buy for the new price (old price = the expectedPrice sent)", () => {
    const v = mapPurchaseError(err(409, "PRICE_CHANGED", { price: 80 }), ctx);
    expect(v).toMatchObject({ id: "priceChanged", message: { key: "err.priceChanged", params: { oldPrice: 60, price: 80 } }, buttons: ["buyAtPrice", "cancel"], newPrice: 80 });
    expect(mapPurchaseError(err(409, "PRICE_CHANGED", { price: 100 }), ctx).id).toBe("priceChanged");
  });
  it("PRICE_CHANGED above the balance only closes", () => {
    const v = mapPurchaseError(err(409, "PRICE_CHANGED", { price: 101 }), ctx);
    expect(v).toMatchObject({ id: "priceChangedTooHigh", message: { key: "err.priceChangedTooHigh", params: { price: 101, points: 100 } }, buttons: ["close"] });
  });
  it("NOT_ENOUGH_POINTS uses the API's numbers and refetches /v1/me", () => {
    const v = mapPurchaseError(err(409, "NOT_ENOUGH_POINTS", { points: 20, price: 60 }), ctx);
    expect(v).toMatchObject({ id: "notEnough", message: { key: "err.notEnough", params: { points: 20, price: 60 } }, refetch: ["me"] });
  });
  it("network, timeouts and 5xx are uncertain; 4xx are not", () => {
    expect(isUncertain(new ApiError(0, NETWORK_ERROR, "Failed to fetch"))).toBe(true);
    expect(isUncertain(err(500, "INTERNAL_ERROR"))).toBe(true);
    expect(isUncertain(err(503, "DATABASE_UNAVAILABLE"))).toBe(true);
    expect(isUncertain(new Error("boom"))).toBe(true);
    expect(isUncertain(err(409, "SOLD_OUT"))).toBe(false);
    expect(isUncertain(err(429, "RATE_LIMITED"))).toBe(false);
  });
});

function fakeApi() {
  const calls: PurchaseRequest[] = [];
  let i = 0;
  const outcomes: (() => Promise<unknown>)[] = [];
  const api: PurchaseApi & { calls: PurchaseRequest[]; queue(fn: () => Promise<unknown>): void; owned: string[]; checkFails: boolean } = {
    calls,
    owned: ["human"],
    checkFails: false,
    queue: (fn) => outcomes.push(fn),
    purchase: (body) => {
      calls.push(body);
      const fn = outcomes[i++];
      return (fn ? fn() : Promise.resolve({ purchaseId: "p", skinKey: body.skinKey, pricePaid: body.expectedPrice, points: 40, remaining: null })) as never;
    },
    mySkins: () =>
      api.checkFails ? Promise.reject(new ApiError(0, NETWORK_ERROR, "down")) : Promise.resolve<MySkins>({ equipped: "human", owned: api.owned.map((key) => ({ key, source: "default", acquiredAt: null })) }),
    me: () => Promise.resolve({ points: 40 } as Me),
  };
  return api;
}

describe("PurchaseSession: one idempotency key per dialog open", () => {
  it("every retry (network, 429, PRICE_CHANGED) reuses the key made when the dialog opened", async () => {
    const api = fakeApi();
    api.queue(() => Promise.reject(new ApiError(0, NETWORK_ERROR, "Failed to fetch")));
    api.queue(() => Promise.reject(err(429, "RATE_LIMITED")));
    api.queue(() => Promise.reject(err(409, "PRICE_CHANGED", { price: 80 })));
    const s = new PurchaseSession(api, "pig");
    expect(s.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect((await s.attempt(60, 100)).kind).toBe("error");
    expect((await s.attempt(60, 100)).kind).toBe("error");
    const pc = await s.attempt(60, 100);
    expect(pc.kind === "error" && pc.view.newPrice).toBe(80);
    const ok = await s.attempt(80, 100);
    expect(ok).toEqual({ kind: "unlocked", points: 40, replay: false });
    expect(api.calls.map((c) => c.idempotencyKey)).toEqual(Array(4).fill(s.idempotencyKey));
    expect(api.calls.map((c) => c.expectedPrice)).toEqual([60, 60, 60, 80]);
  });
  it("a new session (dialog closed and opened again) gets a new key", () => {
    const api = fakeApi();
    const a = new PurchaseSession(api, "pig");
    const b = new PurchaseSession(api, "pig");
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });
  it("network error + the skin is now owned -> unlocked (the purchase committed, the answer was lost)", async () => {
    const api = fakeApi();
    api.queue(() => {
      api.owned.push("pig");
      return Promise.reject(new ApiError(0, NETWORK_ERROR, "timeout"));
    });
    const out = await new PurchaseSession(api, "pig").attempt(60, 100);
    expect(out).toEqual({ kind: "unlocked", points: 40, replay: true });
  });
  it("network error + not owned -> err.network (not charged); check fails too -> err.networkUnknown", async () => {
    const api = fakeApi();
    api.queue(() => Promise.reject(err(503, "DATABASE_UNAVAILABLE")));
    const s = new PurchaseSession(api, "pig");
    const out = await s.attempt(60, 100);
    expect(out.kind === "error" && out.view.id).toBe("network");
    expect(out.kind === "error" && out.view.buttons).toEqual(["retry", "cancel"]);
    api.checkFails = true;
    api.queue(() => Promise.reject(new ApiError(0, NETWORK_ERROR, "down")));
    const out2 = await s.attempt(60, 100);
    expect(out2.kind === "error" && out2.view.id).toBe("networkUnknown");
    expect(api.calls[0].idempotencyKey).toBe(api.calls[1].idempotencyKey);
  });
  it("4xx answers skip the ownership check", async () => {
    const api = fakeApi();
    const spy = vi.spyOn(api, "mySkins");
    api.queue(() => Promise.reject(err(409, "SOLD_OUT")));
    const out = await new PurchaseSession(api, "pig").attempt(60, 100);
    expect(out.kind === "error" && out.view.id).toBe("soldOut");
    expect(spy).not.toHaveBeenCalled();
  });
});
