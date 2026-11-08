// Public API shapes (bombkicker-api docs/api.md, branch skin-shop; plan "Public API additions").
import type { SkinLayout } from "../skins/layout";

export type Mode = "1v1" | "2v2";
export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface PlayerRef {
  id: string;
  displayName: string;
}

export interface GuestLoginResponse {
  accessToken: string;
  expiresAt: string;
  player: PlayerRef;
}

export interface Stats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface Me {
  id: string;
  displayName: string;
  stats: Stats;
  points: number;
  equippedSkin: string;
}

export interface SkinSheet {
  url: string;
  version: string;
  width: number;
  height: number;
  layout: SkinLayout;
}

export interface SkinDto {
  key: string;
  name: string;
  rarity: Rarity;
  price: number;
  isDefault: boolean;
  onSale: boolean;
  stockLimit: number | null;
  remaining: number | null;
  soldOut: boolean;
  sortOrder: number;
  sheet: SkinSheet;
}

export interface MySkins {
  equipped: string;
  owned: { key: string; source: "default" | "purchase"; acquiredAt: string | null }[];
}

/** POST /v1/shop/purchases body. The idempotency key goes in the body (CORS allows no custom headers). */
export interface PurchaseRequest {
  skinKey: string;
  expectedPrice: number;
  idempotencyKey: string;
}
/** 201 (new purchase) or 200 (same idempotencyKey again: the stored result, nothing charged twice). */
export interface PurchaseResponse {
  purchaseId: string;
  skinKey: string;
  pricePaid: number;
  /** Balance right after that purchase. */
  points: number;
  remaining: number | null;
}
export type LedgerReason = "match_win" | "match_loss" | "purchase" | "refund" | "admin_adjust" | "starter";
export interface LedgerItem {
  delta: number;
  balanceAfter: number;
  reason: LedgerReason;
  matchId: string | null;
  skinKey: string | null;
  createdAt: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface LeaderboardRow {
  rank: number;
  playerId: string;
  displayName: string;
  wins: number;
  matchesPlayed: number;
  winRate: number;
}
export interface LeaderboardMe {
  /** null under 3 all-human matches of the mode. */
  rank: number | null;
  wins: number;
  matchesPlayed: number;
  winRate: number;
}
export interface Leaderboard {
  items: LeaderboardRow[];
  me: LeaderboardMe | null;
}
/** Error codes the player site reacts to (others are shown as generic errors). */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "SERVERS_FULL"
  | "SERVER_START_FAILED"
  | "MODE_UNAVAILABLE"
  | "SERVER_GONE"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "SKIN_NOT_FOUND"
  | "ALREADY_OWNED"
  | "SOLD_OUT"
  | "PRICE_CHANGED"
  | "NOT_ENOUGH_POINTS"
  | "NOT_ON_SALE"
  | "IDEMPOTENCY_KEY_REUSED"
  | "NOT_OWNED"
  | "INVALID_DISPLAY_NAME"
  | "DATABASE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | (string & {});

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: Record<string, unknown> };
}
