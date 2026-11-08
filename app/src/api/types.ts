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
  | "DATABASE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | (string & {});

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: Record<string, unknown> };
}
