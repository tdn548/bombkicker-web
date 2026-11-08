// In-browser mock of the public API (development and tests without the Worker). Same routes and bodies as
// bombkicker-api docs/api.md for what the player site uses. State lives in localStorage ("bk_mock_db") so a reload
// keeps the player, like the real API. Enable with `npm run dev:mock` or `?mock=1`.
// Shop test knobs (window.__BK_MOCK__, see src/unity/mockUnity.ts): purchaseErrors / equipErrors are queues of API
// error codes (or "network": no answer and nothing stored, "networkCommitted": the purchase commits but the answer is
// lost, "networkDown": no answer and every request after it fails until the queue moves on), one per attempt.
import { BUNDLED_SKINS, bundledSheetUrl } from "../skins/bundled";
import type { Leaderboard, LedgerItem, LedgerReason, Me, MySkins, SkinDto } from "./types";

const DB_KEY = "bk_mock_db";
const STARTER_POINTS = 60;
const POINTS_WIN = 20;
const POINTS_LOSS = 10;

interface MockSkinDef {
  key: string;
  name: string;
  sheetOf: string;
  price: number;
  rarity: SkinDto["rarity"];
  sort: number;
  stockLimit: number | null;
  /** Copies sold to other (imaginary) players. */
  soldElsewhere: number;
  isDefault?: boolean;
}

export const MOCK_SKINS: MockSkinDef[] = [
  { key: "human", name: "Human", sheetOf: "human", price: 0, rarity: "common", sort: 0, stockLimit: null, soldElsewhere: 0, isDefault: true },
  { key: "goblin", name: "Goblin", sheetOf: "goblin", price: 60, rarity: "common", sort: 10, stockLimit: null, soldElsewhere: 0 },
  { key: "pig", name: "Pig", sheetOf: "pig", price: 60, rarity: "common", sort: 20, stockLimit: null, soldElsewhere: 0 },
  { key: "skeleton", name: "Skeleton", sheetOf: "skeleton", price: 160, rarity: "rare", sort: 30, stockLimit: null, soldElsewhere: 0 },
  { key: "pig-star", name: "Star Pig", sheetOf: "pig", price: 300, rarity: "epic", sort: 40, stockLimit: 5, soldElsewhere: 5 },
  { key: "goblin-king", name: "Goblin King", sheetOf: "goblin", price: 500, rarity: "legendary", sort: 50, stockLimit: 10, soldElsewhere: 7 },
];

interface MockPlayer {
  id: string;
  deviceId: string;
  displayName: string;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  equipped: string;
  owned: string[];
  ledger?: LedgerItem[];
  purchases?: { key: string; skinKey: string; points: number; pricePaid: number; purchaseId: string }[];
}

interface MockDb {
  players: MockPlayer[];
  /** Copies sold per skin key (by players of this mock). */
  sold?: Record<string, number>;
}

function load(storage: Storage): MockDb {
  try {
    const raw = storage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as MockDb;
  } catch {
    // fall through
  }
  return { players: [] };
}

const NAMES = ["Blue Rocket", "Tiny Fox", "Happy Owl", "Cosmic Mango", "Swift Comet"];
const SUGGEST = ["Brave Tiger", "Lucky Panda", "Quick Otter", "Sunny Whale", "Jolly Koala", "Mighty Ant", "Calm Bear"];

function skinDto(def: MockSkinDef, sold: number): SkinDto {
  const s = BUNDLED_SKINS.find((b) => b.key === def.sheetOf)!;
  const remaining = def.stockLimit === null ? null : Math.max(0, def.stockLimit - def.soldElsewhere - sold);
  return {
    key: def.key,
    name: def.name,
    rarity: def.rarity,
    price: def.price,
    isDefault: !!def.isDefault,
    onSale: !def.isDefault,
    stockLimit: def.stockLimit,
    remaining,
    soldOut: remaining === 0,
    sortOrder: def.sort,
    sheet: { url: bundledSheetUrl(s.key), version: s.version, width: s.width, height: s.height, layout: s.layout },
  };
}

export function mockCatalog(db: MockDb = { players: [] }): SkinDto[] {
  return MOCK_SKINS.map((d) => skinDto(d, db.sold?.[d.key] ?? 0));
}

export interface MockApi {
  fetch: typeof fetch;
  /** Called by the mock Unity when an online match ends (the real game server posts the match). */
  recordMatch(token: string, result: "win" | "loss" | "draw"): void;
}

type ShopKnobs = { purchaseErrors?: string[]; equipErrors?: string[]; purchaseDelayMs?: number };
const shopKnobs = (): ShopKnobs => (typeof window !== "undefined" ? ((window.__BK_MOCK__ ?? {}) as ShopKnobs) : {});
function takeKnob(name: "purchaseErrors" | "equipErrors"): string | undefined {
  const k = shopKnobs();
  const q = k[name];
  if (!q || q.length === 0) return undefined;
  const [first, ...rest] = q;
  if (typeof window !== "undefined") window.__BK_MOCK__ = { ...window.__BK_MOCK__, [name]: rest } as never;
  return first;
}

const STATUS: Record<string, number> = {
  SOLD_OUT: 409,
  ALREADY_OWNED: 409,
  PRICE_CHANGED: 409,
  NOT_ENOUGH_POINTS: 409,
  NOT_ON_SALE: 410,
  SKIN_NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  NOT_OWNED: 403,
  INTERNAL_ERROR: 500,
};

export function createMockApi(storage: Storage = localStorage, latencyMs = 150): MockApi {
  const save = (db: MockDb) => storage.setItem(DB_KEY, JSON.stringify(db));
  const playerFromToken = (db: MockDb, auth: string | null): MockPlayer | null => {
    const m = /^Bearer mock\.([0-9a-f-]+)\.(\d+)$/.exec(auth ?? "");
    if (!m || Number(m[2]) < Date.now()) return null;
    return db.players.find((p) => p.id === m[1]) ?? null;
  };
  const meBody = (p: MockPlayer): Me => {
    const played = p.wins + p.losses + p.draws;
    return {
      id: p.id,
      displayName: p.displayName,
      stats: { matchesPlayed: played, wins: p.wins, losses: p.losses, draws: p.draws, winRate: played ? Math.round((p.wins / played) * 10000) / 10000 : 0 },
      points: p.points,
      equippedSkin: p.equipped,
    };
  };
  const ledger = (p: MockPlayer, delta: number, reason: LedgerReason, skinKey: string | null = null) => {
    p.ledger = [{ delta, balanceAfter: p.points, reason, matchId: reason.startsWith("match") ? crypto.randomUUID() : null, skinKey, createdAt: new Date().toISOString() }, ...(p.ledger ?? [])];
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const error = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
    json(status, { error: { code, message, ...(details ? { details } : {}) } });
  let down = false;

  async function handle(url: URL, init: RequestInit): Promise<Response> {
    const db = load(storage);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const path = url.pathname;
    if (method === "POST" && path === "/v1/auth/guest") {
      const deviceId = body.deviceId;
      if (typeof deviceId !== "string" || !/^[\x21-\x7E]{8,128}$/.test(deviceId)) return error(400, "VALIDATION_ERROR", "deviceId: invalid");
      let p = db.players.find((x) => x.deviceId === deviceId);
      if (!p) {
        p = {
          id: crypto.randomUUID(),
          deviceId,
          displayName: `${NAMES[db.players.length % NAMES.length]} ${10 + db.players.length}`,
          points: STARTER_POINTS,
          wins: 0,
          losses: 0,
          draws: 0,
          equipped: "human",
          owned: [],
        };
        ledger(p, STARTER_POINTS, "starter");
        db.players.push(p);
        save(db);
      }
      const exp = Date.now() + 14 * 24 * 3600 * 1000;
      return json(200, { accessToken: `mock.${p.id}.${exp}`, expiresAt: new Date(exp).toISOString(), player: { id: p.id, displayName: p.displayName } });
    }
    if (method === "GET" && path === "/v1/skins") return json(200, { items: mockCatalog(db) });
    if (method === "GET" && path === "/v1/leaderboard") {
      const mode = url.searchParams.get("mode");
      const p = playerFromToken(db, headers.get("Authorization"));
      const names = ["Blue Rocket 42", "Tiny Fox 7", "Happy Owl 13", "Cosmic Mango 5", "Swift Comet 88", "Brave Tiger 3", "Lucky Panda 21", "Quick Otter 9"];
      const items = names.map((n, i) => {
        const played = 20 - i * 2;
        const wins = (mode === "2v2" ? 12 : 14) - i;
        return { rank: i + 1, playerId: `00000000-0000-4000-8000-00000000000${i}`, displayName: n, wins, matchesPlayed: played, winRate: Math.round((wins / played) * 10000) / 10000 };
      });
      const played = p ? p.wins + p.losses + p.draws : 0;
      const me: Leaderboard["me"] = p ? { rank: played >= 3 ? 24 : null, wins: p.wins, matchesPlayed: played, winRate: played ? p.wins / played : 0 } : null;
      return json(200, { items, me });
    }
    const p = playerFromToken(db, headers.get("Authorization"));
    if (!p) return error(401, "UNAUTHORIZED", "Invalid or expired token");
    if (method === "GET" && path === "/v1/me") return json(200, meBody(p));
    if (method === "PATCH" && path === "/v1/me") {
      const name = body.displayName;
      if (typeof name !== "string" || !SUGGEST.some((s) => name.startsWith(s))) return error(422, "INVALID_DISPLAY_NAME", "Display name must be picked from the suggestions");
      p.displayName = name;
      save(db);
      return json(200, meBody(p));
    }
    if (method === "GET" && path === "/v1/names/suggestions") {
      const n = Math.floor(Math.random() * 90) + 10;
      return json(200, { names: SUGGEST.slice(0, 5).map((s, i) => `${s} ${n + i}`) });
    }
    if (method === "GET" && path === "/v1/me/skins") {
      const owned: MySkins["owned"] = [{ key: "human", source: "default", acquiredAt: null }, ...p.owned.map((k) => ({ key: k, source: "purchase" as const, acquiredAt: new Date().toISOString() }))];
      return json(200, { equipped: p.equipped, owned });
    }
    if (method === "GET" && path === "/v1/me/points") {
      const items = p.ledger ?? [];
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const from = Number(url.searchParams.get("cursor") ?? 0);
      const page = items.slice(from, from + limit);
      return json(200, { items: page, nextCursor: from + limit < items.length ? String(from + limit) : null });
    }
    if (method === "PATCH" && path === "/v1/me/equipped-skin") {
      const forced = takeKnob("equipErrors");
      if (forced === "network") throw new TypeError("Failed to fetch");
      if (forced) return error(STATUS[forced] ?? 500, forced, "mock error");
      const key = String(body.skinKey);
      if (!MOCK_SKINS.some((s) => s.key === key)) return error(404, "SKIN_NOT_FOUND", "Skin not found");
      if (key !== "human" && !p.owned.includes(key)) return error(403, "NOT_OWNED", "Skin not owned");
      p.equipped = key;
      save(db);
      return json(200, { equipped: key });
    }
    if (method === "POST" && path === "/v1/shop/purchases") {
      const skinKey = String(body.skinKey);
      const idem = String(body.idempotencyKey);
      const prior = p.purchases?.find((x) => x.key === idem);
      const forced = takeKnob("purchaseErrors");
      if (forced === "network" || forced === "networkDown") {
        down = forced === "networkDown";
        throw new TypeError("Failed to fetch");
      }
      if (prior) {
        if (prior.skinKey !== skinKey) return error(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency key used for another skin");
        return json(200, { purchaseId: prior.purchaseId, skinKey, pricePaid: prior.pricePaid, points: prior.points, remaining: null });
      }
      if (forced && forced !== "networkCommitted") {
        if (forced === "PRICE_CHANGED") return error(409, forced, "Price changed", { price: Number(body.expectedPrice) + 20 });
        if (forced === "NOT_ENOUGH_POINTS") return error(409, forced, "Not enough points", { points: p.points, price: Number(body.expectedPrice) });
        return error(STATUS[forced] ?? 500, forced, "mock error");
      }
      const def = MOCK_SKINS.find((s) => s.key === skinKey);
      if (!def) return error(404, "SKIN_NOT_FOUND", "Skin not found");
      if (def.isDefault || p.owned.includes(skinKey)) return error(409, "ALREADY_OWNED", "Already owned");
      const dto = skinDto(def, db.sold?.[skinKey] ?? 0);
      if (dto.price !== Number(body.expectedPrice)) return error(409, "PRICE_CHANGED", "Price changed", { price: dto.price });
      if (dto.soldOut) return error(409, "SOLD_OUT", "Sold out");
      if (dto.price > p.points) return error(409, "NOT_ENOUGH_POINTS", "Not enough points", { points: p.points, price: dto.price });
      p.points -= dto.price;
      p.owned.push(skinKey);
      db.sold = { ...db.sold, [skinKey]: (db.sold?.[skinKey] ?? 0) + 1 };
      const purchaseId = crypto.randomUUID();
      p.purchases = [...(p.purchases ?? []), { key: idem, skinKey, points: p.points, pricePaid: dto.price, purchaseId }];
      ledger(p, -dto.price, "purchase", skinKey);
      save(db);
      if (forced === "networkCommitted") throw new TypeError("Failed to fetch");
      const remaining = dto.remaining === null ? null : dto.remaining - 1;
      return json(201, { purchaseId, skinKey, pricePaid: dto.price, points: p.points, remaining });
    }
    return error(404, "NOT_FOUND", "Not found");
  }

  return {
    fetch: async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://mock.local");
      await new Promise((r) => setTimeout(r, latencyMs + (url.pathname === "/v1/shop/purchases" ? (shopKnobs().purchaseDelayMs ?? 0) : 0)));
      if (down && url.pathname !== "/v1/shop/purchases") throw new TypeError("Failed to fetch");
      down = false;
      return handle(url, init);
    },
    recordMatch(token, result) {
      const db = load(storage);
      const p = playerFromToken(db, `Bearer ${token}`);
      if (!p) return;
      if (result === "win") {
        p.wins++;
        p.points += POINTS_WIN;
        ledger(p, POINTS_WIN, "match_win");
      } else if (result === "loss") {
        p.losses++;
        const before = p.points;
        p.points = Math.max(0, p.points - POINTS_LOSS);
        ledger(p, p.points - before, "match_loss");
      } else p.draws++;
      save(db);
    },
  };
}
