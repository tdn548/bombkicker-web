// Login state outside React (plain TS, tested in authStore.test.ts). AuthProvider subscribes with
// useSyncExternalStore. Rules: plan "Hosting and account migration" device id rules; token in memory + localStorage;
// one deduped re-login for every 401 and every Unity authExpired.
import { createApiClient, type ApiClient } from "../api/client";
import type { PlayerRef } from "../api/types";
import { DEVICE_ID_KEY, TOKEN_KEY, decideDeviceId, readStoredSession, type StoredSession, type UnityBoot } from "./deviceId";

export type AuthStatus = "waitingUnity" | "loggingIn" | "ready" | "error";

export interface Session {
  accessToken: string;
  expiresAt: string;
  player: PlayerRef;
}

export interface AuthSnapshot {
  status: AuthStatus;
  session: Session | null;
  deviceId: string | null;
  /** How the device id was chosen this page load (for tests and logs). */
  deviceIdSource: "stored" | "adopted" | "created" | null;
}

export interface AuthStoreDeps {
  baseUrl: string;
  fetch: typeof fetch;
  storage: Storage;
  now?: () => number;
  newId?: () => string;
}

export class AuthStore {
  readonly api: ApiClient;
  private snap: AuthSnapshot;
  private listeners = new Set<() => void>();
  private inflight: Promise<string> | null = null;
  private readonly deps: AuthStoreDeps;

  constructor(deps: AuthStoreDeps) {
    this.deps = deps;
    const stored = deps.storage.getItem(DEVICE_ID_KEY);
    const d = decideDeviceId(stored, { state: "loading" });
    this.snap = { status: "waitingUnity", session: null, deviceId: d.action === "use" ? d.id : null, deviceIdSource: d.action === "use" ? "stored" : null };
    this.api = createApiClient({
      baseUrl: deps.baseUrl,
      fetch: deps.fetch,
      getToken: () => this.snap.session?.accessToken ?? null,
      relogin: () => this.relogin(),
    });
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): AuthSnapshot => this.snap;

  private set(patch: Partial<AuthSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Start: reuse a stored token, else log in. A first visit waits for Unity (call onUnityBoot). */
  start(): void {
    if (!this.snap.deviceId || this.snap.session || this.inflight) return;
    const stored = readStoredSession(this.deps.storage.getItem(TOKEN_KEY), this.snap.deviceId, (this.deps.now ?? Date.now)());
    if (stored) {
      this.set({ session: { accessToken: stored.accessToken, expiresAt: stored.expiresAt, player: stored.player }, status: "ready" });
      return;
    }
    this.relogin().catch(() => undefined);
  }

  /** Unity's boot state changed: on a first visit this picks the device id (adopt legacyDeviceId once, or create). */
  onUnityBoot(boot: UnityBoot): void {
    if (this.snap.deviceId) return;
    const d = decideDeviceId(this.deps.storage.getItem(DEVICE_ID_KEY), boot, this.deps.newId);
    if (d.action === "wait") return;
    this.deps.storage.setItem(DEVICE_ID_KEY, d.id);
    this.set({ deviceId: d.id, deviceIdSource: d.action === "adopt" ? "adopted" : d.action === "create" ? "created" : "stored" });
    this.start();
  }

  /** Guest login with the current device id. Parallel callers share one request. */
  relogin(): Promise<string> {
    if (this.inflight) return this.inflight;
    const id = this.snap.deviceId;
    if (!id) return Promise.reject(new Error("no device id yet"));
    if (this.snap.status !== "ready") this.set({ status: "loggingIn" });
    const p = this.api
      .guestLogin(id)
      .then((r) => {
        const session: Session = { accessToken: r.accessToken, expiresAt: r.expiresAt, player: r.player };
        const stored: StoredSession = { deviceId: id, ...session };
        this.deps.storage.setItem(TOKEN_KEY, JSON.stringify(stored));
        this.set({ session, status: "ready" });
        return r.accessToken;
      })
      .catch((e: unknown) => {
        if (!this.snap.session) this.set({ status: "error" });
        throw e;
      })
      .finally(() => {
        this.inflight = null;
      });
    this.inflight = p;
    return p;
  }

  /** Retry button after a failed first login. */
  retry(): void {
    this.relogin().catch(() => undefined);
  }
}
