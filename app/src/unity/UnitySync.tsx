// Keeps Unity in step with React: init once Unity is ready and the player is known, then setToken / setLang /
// setEquippedSkin / setCatalog when those change (plan bridge table). PlayProvider also refetches the catalog and sends
// setCatalog itself right before every start (BUG-SS18-002); sentCatalog() keeps the two from sending the same array.
import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n/I18nProvider";
import { usePlayerData } from "../state/PlayerData";
import type { Lang } from "./bridge";
import { useUnity } from "./UnityHost";

export function UnitySync() {
  const { boot, send, sentCatalog } = useUnity();
  const { session } = useAuth();
  const { lang } = useI18n();
  const { me, meState, catalog, catalogState } = usePlayerData();
  const sent = useRef<{ token: string; lang: Lang; equipped: string | null } | null>(null);

  const settled = (s: string) => s === "ok" || s === "error";
  const ready = boot.state === "ready" && session !== null && settled(meState) && settled(catalogState);
  const equippedKey = me?.equippedSkin ?? null;
  const equippedDto = equippedKey && catalog ? (catalog.find((s) => s.key === equippedKey) ?? null) : null;

  useEffect(() => {
    if (!ready || !session) return;
    const last = sent.current;
    if (!last) {
      send({
        type: "init",
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        player: { id: session.player.id, displayName: session.player.displayName },
        equippedSkin: equippedDto,
        catalog: catalog ?? [],
        lang,
      });
      sent.current = { token: session.accessToken, lang, equipped: equippedDto?.key ?? null };
      return;
    }
    if (last.token !== session.accessToken) {
      send({ type: "setToken", accessToken: session.accessToken, expiresAt: session.expiresAt });
      last.token = session.accessToken;
    }
    if (last.lang !== lang) {
      send({ type: "setLang", lang });
      last.lang = lang;
    }
    if (catalog && sentCatalog() !== catalog) send({ type: "setCatalog", catalog });
    if (equippedDto && last.equipped !== equippedDto.key) {
      send({ type: "setEquippedSkin", skin: equippedDto });
      last.equipped = equippedDto.key;
    }
  }, [ready, session, lang, catalog, equippedDto, send, sentCatalog]);

  return null;
}
