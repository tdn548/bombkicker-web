// Guest login and the device id (plan "Hosting and account migration"). React owns the login; Unity gets the token
// through the bridge (init / setToken, see UnitySync). The logic lives in authStore.ts.
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ApiClient } from "../api/client";
import { useUnity } from "../unity/UnityHost";
import { AuthStore, type AuthSnapshot, type AuthStatus, type Session } from "./authStore";

export type { AuthStatus, Session };

interface Auth extends AuthSnapshot {
  api: ApiClient;
  relogin(): Promise<string>;
  retry(): void;
}

const Ctx = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export function AuthProvider({ baseUrl, fetchImpl, children }: { baseUrl: string; fetchImpl: typeof fetch; children: ReactNode }) {
  const { boot, subscribe } = useUnity();
  const [store] = useState(() => new AuthStore({ baseUrl, fetch: fetchImpl, storage: localStorage }));
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // A stored device id logs in at once; a first visit waits for Unity's ready (legacyDeviceId).
  useEffect(() => store.start(), [store]);
  useEffect(() => store.onUnityBoot(boot), [store, boot]);
  // Unity got a 401 inside the game: log in again; UnitySync then sends setToken with the new token.
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type === "authExpired") store.relogin().catch(() => undefined);
      }),
    [store, subscribe],
  );

  const value = useMemo<Auth>(
    () => ({ ...snap, api: store.api, relogin: () => store.relogin(), retry: () => store.retry() }),
    [snap, store],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
