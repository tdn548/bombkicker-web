// React <-> Unity bridge, protocol v1 (plan "React <-> Unity bridge"; Unity side: SS-8 BridgeMessages.cs).
// React -> Unity: sendMessage("WebBridge", "Receive", json). Unity -> React: dispatchReactUnityEvent("bk", json).
import type { Mode, SkinDto } from "../api/types";

export const PROTOCOL_VERSION = 1;
export const BRIDGE_OBJECT = "WebBridge";
export const BRIDGE_METHOD = "Receive";
export const BRIDGE_EVENT = "bk";

export type Lang = "vi" | "en";
export type OfflineMap = 1 | 2 | 3 | 4 | "random";
export type Opponent = "bots" | "local";

// ---------- React -> Unity ----------

export type ToUnity =
  | {
      type: "init";
      accessToken: string;
      expiresAt: string;
      player: { id: string; displayName: string };
      equippedSkin: SkinDto | null;
      catalog: SkinDto[];
      lang: Lang;
    }
  | { type: "setLang"; lang: Lang }
  | { type: "setToken"; accessToken: string; expiresAt: string }
  | { type: "setEquippedSkin"; skin: SkinDto }
  | { type: "setCatalog"; catalog: SkinDto[] }
  | { type: "startOffline"; mode: Mode; opponent: Opponent; map: OfflineMap }
  | { type: "startOnline"; kind: "quick"; mode: Mode }
  | { type: "startOnline"; kind: "createRoom"; mode: Mode }
  | { type: "startOnline"; kind: "joinRoom"; roomCode: string }
  | { type: "cancelOnline" };

export function encodeToUnity(msg: ToUnity): string {
  const { type, ...rest } = msg;
  return JSON.stringify({ type, v: PROTOCOL_VERSION, ...rest });
}

/** For logs: never print the access token. */
export function redact(msg: ToUnity): string {
  return encodeToUnity(msg).replace(/"accessToken":"[^"]*"/, '"accessToken":"…"');
}

// ---------- Unity -> React ----------

export type Phase = "searching" | "starting" | "connecting" | "waiting" | "loading" | "inMatch" | "error";
export type MatchKind = "online" | "room" | "offline";
export type MatchResult = "win" | "loss" | "draw" | "left";

export interface StatusMessage {
  type: "status";
  phase: Phase;
  roomCode?: string;
  mode?: Mode;
  humans?: number;
  capacity?: number;
  seconds?: number;
  message?: string;
  code?: string;
}

export type FromUnity =
  | { type: "ready"; buildVersion: string; legacyDeviceId: string | null }
  | StatusMessage
  | { type: "matchEnded"; kind: MatchKind; mode: Mode; result: MatchResult; recorded: boolean }
  | { type: "returnedToMenu" }
  | { type: "authExpired" }
  | { type: "error"; code: string; message: string };

const PHASES: readonly Phase[] = ["searching", "starting", "connecting", "waiting", "loading", "inMatch", "error"];
const KINDS: readonly MatchKind[] = ["online", "room", "offline"];
const RESULTS: readonly MatchResult[] = ["win", "loss", "draw", "left"];

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
const mode = (v: unknown): Mode | undefined => (v === "1v1" || v === "2v2" ? v : undefined);

/**
 * Parse one Unity message. Returns null (caller logs it) for bad JSON, a wrong protocol version, unknown types or
 * missing required fields. Optional fields with a wrong type are dropped, not fatal.
 */
export function parseFromUnity(json: unknown): FromUnity | null {
  if (typeof json !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== undefined && o.v !== PROTOCOL_VERSION) return null;
  switch (o.type) {
    case "ready":
      return {
        type: "ready",
        buildVersion: str(o.buildVersion) ?? "",
        legacyDeviceId: str(o.legacyDeviceId) ?? null,
      };
    case "status": {
      const phase = PHASES.find((p) => p === o.phase);
      if (!phase) return null;
      const s: StatusMessage = { type: "status", phase };
      const roomCode = str(o.roomCode);
      if (roomCode) s.roomCode = roomCode;
      const m = mode(o.mode);
      if (m) s.mode = m;
      for (const k of ["humans", "capacity", "seconds"] as const) {
        const n = int(o[k]);
        if (n !== undefined && n >= 0) s[k] = n;
      }
      const message = str(o.message);
      if (message !== undefined) s.message = message;
      const code = str(o.code);
      if (code !== undefined) s.code = code;
      return s;
    }
    case "matchEnded": {
      const kind = KINDS.find((k) => k === o.kind);
      const result = RESULTS.find((r) => r === o.result);
      const m = mode(o.mode);
      if (!kind || !result || !m) return null;
      return { type: "matchEnded", kind, mode: m, result, recorded: o.recorded === true };
    }
    case "returnedToMenu":
      return { type: "returnedToMenu" };
    case "authExpired":
      return { type: "authExpired" };
    case "error":
      return { type: "error", code: str(o.code) ?? "UNKNOWN", message: str(o.message) ?? "" };
    default:
      return null;
  }
}

/**
 * For the "ignored Unity message" log: the type and size only. The raw JSON is not printed, because a message that
 * fails to parse (for example "ready" with a wrong protocol version) can carry the legacy device id (SS-7 recheck).
 */
export function ignoredSummary(json: unknown): string {
  if (typeof json !== "string") return `non-string ${typeof json}`;
  let type = "?";
  try {
    const o: unknown = JSON.parse(json);
    if (typeof o === "object" && o !== null && typeof (o as { type?: unknown }).type === "string") {
      type = (o as { type: string }).type.slice(0, 32);
    }
  } catch {
    type = "bad JSON";
  }
  return `type=${type} length=${json.length}`;
}

// ---------- queue ----------

/**
 * Holds React -> Unity messages until Unity's "ready". sendMessage before the instance has loaded is dropped by
 * react-unity-webgl (console warning only), and Unity's WebBridge exists only after its first scene boots (about 2 s
 * after isLoaded, SS-1), so "ready" is the only safe point.
 */
export class BridgeQueue {
  private queue: ToUnity[] = [];
  private ready = false;
  private deliver: ((json: string, msg: ToUnity) => void) | null;

  constructor(deliver?: (json: string, msg: ToUnity) => void) {
    this.deliver = deliver ?? null;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get pending(): readonly ToUnity[] {
    return this.queue;
  }

  /** Set (or replace) the function that hands JSON to Unity. */
  connect(deliver: (json: string, msg: ToUnity) => void): void {
    this.deliver = deliver;
    this.flush();
  }

  send(msg: ToUnity): void {
    if (!this.ready || !this.deliver) {
      // Newer state replaces older state of the same kind; start/cancel messages are kept in order.
      if (msg.type === "setToken" || msg.type === "setLang" || msg.type === "setCatalog" || msg.type === "setEquippedSkin" || msg.type === "init") {
        this.queue = this.queue.filter((m) => m.type !== msg.type);
      }
      this.queue.push(msg);
      return;
    }
    this.deliver(encodeToUnity(msg), msg);
  }

  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.flush();
  }

  private flush(): void {
    if (!this.ready || !this.deliver) return;
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.deliver(encodeToUnity(m), m);
  }
}

// ---------- room codes (plan "Rooms on dedicated servers") ----------

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

/** Input rule (ux-spec 9.1): uppercase, strip spaces and dashes, max 6 characters. Reports characters never used. */
export function normalizeRoomCodeInput(raw: string): { code: string; badChar: boolean } {
  const cleaned = raw.toUpperCase().replace(/[\s-]+/g, "");
  const badChar = /[ILO01]/.test(cleaned);
  return { code: cleaned.slice(0, ROOM_CODE_LENGTH), badChar };
}

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c));
}
