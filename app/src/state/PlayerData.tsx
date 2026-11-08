// Player data shared by the screens: /v1/me, /v1/me/skins and the skin catalog (/v1/skins).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Me, MySkins, SkinDto } from "../api/types";
import { useAuth } from "../auth/AuthProvider";

type Load<T> = { state: "idle" | "loading" } | { state: "ok"; data: T } | { state: "error" };

interface PlayerData {
  me: Me | null;
  meState: Load<Me>["state"];
  catalog: SkinDto[] | null;
  catalogState: Load<SkinDto[]>["state"];
  mySkins: MySkins | null;
  refreshMe(): Promise<Me>;
  refreshSkins(): Promise<void>;
}

const Ctx = createContext<PlayerData | null>(null);

export function usePlayerData(): PlayerData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayerData outside PlayerDataProvider");
  return ctx;
}

export function PlayerDataProvider({ children }: { children: ReactNode }) {
  const { api, status, session } = useAuth();
  const [me, setMe] = useState<Load<Me>>({ state: "idle" });
  const [catalog, setCatalog] = useState<Load<SkinDto[]>>({ state: "idle" });
  const [mySkins, setMySkins] = useState<MySkins | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const m = await api.me();
      setMe({ state: "ok", data: m });
      return m;
    } catch (e) {
      setMe((prev) => (prev.state === "ok" ? prev : { state: "error" }));
      throw e;
    }
  }, [api]);

  const refreshSkins = useCallback(async () => {
    const [items, mine] = await Promise.allSettled([api.skins(), session ? api.mySkins() : Promise.reject(new Error("no session"))]);
    if (items.status === "fulfilled") setCatalog({ state: "ok", data: items.value });
    else setCatalog((prev) => (prev.state === "ok" ? prev : { state: "error" }));
    if (mine.status === "fulfilled") setMySkins(mine.value);
  }, [api, session]);

  const playerId = session?.player.id;
  useEffect(() => {
    if (status !== "ready" || !playerId) return;
    // Both setState calls happen in promise callbacks (after the requests), never synchronously in the effect.
    void Promise.resolve().then(() => Promise.allSettled([refreshMe(), refreshSkins()]));
  }, [status, playerId, refreshMe, refreshSkins]);

  const value = useMemo<PlayerData>(
    () => ({
      me: me.state === "ok" ? me.data : null,
      meState: me.state,
      catalog: catalog.state === "ok" ? catalog.data : null,
      catalogState: catalog.state,
      mySkins,
      refreshMe,
      refreshSkins,
    }),
    [me, catalog, mySkins, refreshMe, refreshSkins],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Cheapest skin on sale, not sold out and not owned (result screen "next unlock"). */
export function nextUnlock(catalog: SkinDto[] | null, mySkins: MySkins | null): SkinDto | null | "allOwned" {
  if (!catalog || !mySkins) return null;
  const owned = new Set(mySkins.owned.map((o) => o.key));
  const candidates = catalog.filter((s) => s.onSale && !s.soldOut && !owned.has(s.key));
  if (candidates.length === 0) return catalog.some((s) => s.onSale && !owned.has(s.key)) ? null : "allOwned";
  return candidates.reduce((a, b) => (b.price < a.price || (b.price === a.price && b.sortOrder < a.sortOrder) ? b : a));
}
