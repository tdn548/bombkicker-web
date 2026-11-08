// In-browser mock of the public API (development and tests without the Worker). Same routes and bodies as
// bombkicker-api docs/api.md for what the player site uses. State lives in localStorage ("bk_mock_db") so a reload
// keeps the player, like the real API. Enable with `npm run dev:mock` or `?mock=1`.
import { BUNDLED_SKINS, bundledSheetUrl } from "../skins/bundled";
import type { Me, MySkins, SkinDto } from "./types";

const DB_KEY = "bk_mock_db";
const STARTER_POINTS = 60;
const POINTS_WIN = 20;
const POINTS_LOSS = 10;
const PRICES: Record<string, { price: number; rarity: SkinDto["rarity"]; sort: number }> = {
  human: { price: 0, rarity: "common", sort: 0 },
  goblin: { price: 60, rarity: "common", sort: 10 },
  pig: { price: 60, rarity: "common", sort: 20 },
  skeleton: { price: 160, rarity: "rare", sort: 30 },
};

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
}

interface MockDb {
  players: MockPlayer[];
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

export function mockCatalog(): SkinDto[] {
  return BUNDLED_SKINS.map((s) => {
    const p = PRICES[s.key];
    return {
      key: s.key,
      name: s.name,
      rarity: p.rarity,
      price: p.price,
      isDefault: s.key === "human",
      onSale: s.key !== "human",
      stockLimit: null,
      remaining: null,
      soldOut: false,
      sortOrder: p.sort,
      sheet: { url: bundledSheetUrl(s.key), version: s.version, width: s.width, height: s.height, layout: s.layout },
    };
  });
}

export interface MockApi {
  fetch: typeof fetch;
  /** Called by the mock Unity when an online match ends (the real game server posts the match). */
  recordMatch(token: string, result: "win" | "loss" | "draw"): void;
}

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

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const error = (status: number, code: string, message: string) => json(status, { error: { code, message } });

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
        db.players.push(p);
        save(db);
      }
      const exp = Date.now() + 14 * 24 * 3600 * 1000;
      return json(200, { accessToken: `mock.${p.id}.${exp}`, expiresAt: new Date(exp).toISOString(), player: { id: p.id, displayName: p.displayName } });
    }
    if (method === "GET" && path === "/v1/skins") return json(200, { items: mockCatalog() });

    const p = playerFromToken(db, headers.get("Authorization"));
    if (!p) return error(401, "UNAUTHORIZED", "Invalid or expired token");
    if (method === "GET" && path === "/v1/me") return json(200, meBody(p));
    if (method === "GET" && path === "/v1/me/skins") {
      const owned: MySkins["owned"] = [{ key: "human", source: "default", acquiredAt: null }, ...p.owned.map((k) => ({ key: k, source: "purchase" as const, acquiredAt: new Date().toISOString() }))];
      return json(200, { equipped: p.equipped, owned });
    }
    return error(404, "NOT_FOUND", "Not found");
  }

  return {
    fetch: async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://mock.local");
      await new Promise((r) => setTimeout(r, latencyMs));
      return handle(url, init);
    },
    recordMatch(token, result) {
      const db = load(storage);
      const p = playerFromToken(db, `Bearer ${token}`);
      if (!p) return;
      if (result === "win") {
        p.wins++;
        p.points += POINTS_WIN;
      } else if (result === "loss") {
        p.losses++;
        p.points = Math.max(0, p.points - POINTS_LOSS);
      } else p.draws++;
      save(db);
    },
  };
}
