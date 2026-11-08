// Device id rules (plan "Hosting and account migration"). Pure functions, tested in deviceId.test.ts.
import type { PlayerRef } from "../api/types";

export const DEVICE_ID_KEY = "bk_device_id";
export const TOKEN_KEY = "bk_token";

/** Same rule as the API and Unity's AccountLogic.IsValidDeviceId: 8-128 printable ASCII characters, no spaces. */
export function isValidDeviceId(id: unknown): id is string {
  return typeof id === "string" && /^[\x21-\x7E]{8,128}$/.test(id);
}

/** Unity's AccountLogic.NewDeviceId format: "bk-" + 32 lowercase hex characters. */
export function newDeviceId(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(16));
  return "bk-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type UnityBoot =
  | { state: "loading" }
  | { state: "ready"; legacyDeviceId: string | null }
  | { state: "failed" };

export type DeviceIdDecision =
  | { action: "use"; id: string }
  | { action: "adopt"; id: string }
  | { action: "create"; id: string }
  | { action: "wait" };

/**
 * - A valid stored id is always used and never overwritten (also not by a later legacyDeviceId).
 * - First visit (no valid stored id): wait for Unity's ready. Adopt its legacyDeviceId when valid, else create one.
 * - Unity failed on a first visit: keep waiting. Creating an id now would orphan an old account that Unity could still
 *   read after a reload, so the player reloads instead (the menu shows the "failed" state with a Reload button).
 */
export function decideDeviceId(stored: string | null, unity: UnityBoot, create: () => string = () => newDeviceId()): DeviceIdDecision {
  if (isValidDeviceId(stored)) return { action: "use", id: stored };
  if (unity.state !== "ready") return { action: "wait" };
  if (isValidDeviceId(unity.legacyDeviceId)) return { action: "adopt", id: unity.legacyDeviceId };
  return { action: "create", id: create() };
}

export interface StoredSession {
  deviceId: string;
  accessToken: string;
  expiresAt: string;
  player: PlayerRef;
}

/** Margin before expiry after which a stored token is not reused. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

export function readStoredSession(raw: string | null, deviceId: string, now: number): StoredSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<StoredSession>;
    if (s.deviceId !== deviceId || typeof s.accessToken !== "string" || typeof s.expiresAt !== "string") return null;
    if (!s.player || typeof s.player.id !== "string" || typeof s.player.displayName !== "string") return null;
    const exp = Date.parse(s.expiresAt);
    if (!Number.isFinite(exp) || exp - TOKEN_MARGIN_MS <= now) return null;
    return s as StoredSession;
  } catch {
    return null;
  }
}
