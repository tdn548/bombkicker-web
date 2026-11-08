// Shop (wireframes B-F): tabs All / Owned / rarity, card grid, detail panel on the right (desktop) or a bottom sheet
// (phone, < 768 px), the action button, dialogs D/E/F and the equip toasts.
// Data: /v1/me, /v1/me/skins, /v1/skins from PlayerData (refetched when the shop opens and after every purchase or
// equip; UnitySync then sends setCatalog / setEquippedSkin to Unity).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import type { SkinDto } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { usePlayerData } from "../../state/PlayerData";
import { Button } from "../../ui/Button";
import { Page } from "../../ui/Page";
import { ToastView, useToast } from "../../ui/Toast";
import { PHONE_QUERY, useMediaQuery } from "../../ui/useMediaQuery";
import { ActionButton } from "./ActionButton";
import { BottomSheet } from "./BottomSheet";
import { BuyDialog } from "./BuyDialog";
import { actionView, filterTab, ownedSet, rarityTabs, visibleSkins, type ShopTab } from "./shopLogic";
import { DetailFacts, DetailHeader, SkinDetail, SkinPreview } from "./SkinDetail";
import { SkinCard } from "./SkinCard";
import { UnlockedDialog } from "./UnlockedDialog";

/** Equip error -> toast copy (ux-spec 2.5 equip table; 429 from SS-7). */
function equipErrorKey(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "NOT_OWNED") return "err.equip.notOwned" as const;
    if (e.code === "SKIN_NOT_FOUND") return "err.equip.notFound" as const;
    if (e.code === "RATE_LIMITED") return "err.equip.rateLimited" as const;
  }
  return "err.equip.network" as const;
}

export function ShopPage() {
  const { t } = useI18n();
  const { api } = useAuth();
  const { me, mySkins, catalog, catalogState, refreshMe, refreshSkins, refreshAll, setEquippedLocal } = usePlayerData();
  const phone = useMediaQuery(PHONE_QUERY);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState<ShopTab>("all");
  const [equipPending, setEquipPending] = useState<string | null>(null);
  const [buy, setBuy] = useState<{ skin: SkinDto; n: number } | null>(null);
  const [unlocked, setUnlocked] = useState<{ skin: SkinDto; points: number | null } | null>(null);
  const { toast, show } = useToast();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const opens = useRef(0);

  // The shop always shows fresh stock and prices.
  useEffect(() => {
    void refreshSkins();
  }, [refreshSkins]);

  const owned = useMemo(() => ownedSet(mySkins), [mySkins]);
  const equippedKey = mySkins?.equipped ?? me?.equippedSkin ?? null;
  const visible = useMemo(() => (catalog ? visibleSkins(catalog, owned) : []), [catalog, owned]);
  const shown = useMemo(() => filterTab(visible, tab, owned), [visible, tab, owned]);
  const tabs: ShopTab[] = ["all", "owned", ...rarityTabs(visible)];
  const loaded = !!me && !!mySkins && !!catalog;

  // Selected skin: ?skin=<key>. It is looked up in the whole catalog, so a skin that just went off sale stays open
  // (button row 6) until the player closes it. Desktop shows the equipped skin when nothing is picked.
  const selectedKey = params.get("skin");
  const fromUrl = selectedKey && catalog ? (catalog.find((s) => s.key === selectedKey) ?? null) : null;
  const desktopFallback = !phone && catalog ? (catalog.find((s) => s.key === equippedKey) ?? visible[0] ?? null) : null;
  const selected = fromUrl ?? (phone ? null : desktopFallback);

  const view = actionView({
    loaded,
    skin: selected,
    owned: !!selected && owned.has(selected.key),
    equipped: !!selected && selected.key === equippedKey,
    equipPending: !!selected && equipPending === selected.key,
    points: me?.points ?? 0,
  });

  const open = (key: string) => {
    if (phone) navigate({ search: `?skin=${encodeURIComponent(key)}` }, { state: { sheet: true } });
    else navigate({ search: `?skin=${encodeURIComponent(key)}` }, { replace: true });
  };
  const closeSheet = useCallback(() => {
    if ((location.state as { sheet?: boolean } | null)?.sheet) navigate(-1);
    else navigate({ search: "" }, { replace: true });
  }, [location.state, navigate]);

  // A sheet for a skin that left the catalog (SKIN_NOT_FOUND) closes itself.
  useEffect(() => {
    if (phone && selectedKey && catalog && !fromUrl && !buy) closeSheet();
  }, [phone, selectedKey, catalog, fromUrl, buy, closeSheet]);

  const equip = async (skin: SkinDto) => {
    setEquipPending(skin.key);
    try {
      const r = await api.equip(skin.key);
      setEquippedLocal(r.equipped);
      show(t("shop.equip.done", { name: skin.name }));
    } catch (e) {
      show(t(equipErrorKey(e)), "alert");
    } finally {
      setEquipPending(null);
      await refreshAll();
    }
  };

  const refetch = (what: ("me" | "skins")[]) => {
    if (what.includes("me")) void refreshMe().catch(() => undefined);
    if (what.includes("skins")) void refreshSkins();
  };

  const startBuy = (skin: SkinDto) => {
    opens.current += 1;
    setBuy({ skin, n: opens.current });
  };

  const detailFor = (skin: SkinDto) => (
    <SkinDetail
      key={skin.key}
      skin={skin}
      view={view}
      headingId={headingId}
      onBuy={() => startBuy(skin)}
      onEquip={() => void equip(skin)}
    />
  );

  let content;
  if (!catalog && catalogState === "error") {
    content = (
      <div className="card" role="alert">
        <p>{t("err.shop.load")}</p>
        <Button variant="secondary" onClick={() => void refreshSkins()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  } else if (!catalog) {
    content = <p aria-live="polite">{t("shop.loading")}</p>;
  } else {
    content = (
      <div className="shop">
        <div className="shop__main">
          <div role="tablist" aria-label={t("shop.tabs")} className="shop-tabs">
            {tabs.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`shop-tabs__tab ${tab === k ? "shop-tabs__tab--on" : ""}`}
                onClick={() => setTab(k)}
                data-testid={`shop-tab-${k}`}
              >
                {k === "all" ? t("shop.tab.all") : k === "owned" ? t("shop.tab.owned") : t(`rarity.${k}`)}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="note">{t("shop.empty")}</p>
          ) : (
            <ul className="skin-grid" data-testid="skin-grid">
              {shown.map((s) => (
                <SkinCard
                  key={s.key}
                  ref={(el) => {
                    if (el) cardRefs.current.set(s.key, el);
                    else cardRefs.current.delete(s.key);
                  }}
                  skin={s}
                  owned={owned.has(s.key)}
                  equipped={s.key === equippedKey}
                  selected={selected?.key === s.key}
                  onOpen={() => open(s.key)}
                />
              ))}
            </ul>
          )}
        </div>
        {!phone && selected ? (
          <aside className="shop__detail" aria-labelledby={headingId}>
            {detailFor(selected)}
          </aside>
        ) : null}
      </div>
    );
  }

  return (
    <Page title={t("menu.shop")} className="shop-page">
      {me ? (
        <p className="shop__points" data-testid="shop-points">
          {t("shop.yourPoints", { points: me.points })}
        </p>
      ) : null}
      {content}
      {phone && selected ? (
        <BottomSheet
          labelledBy={headingId}
          initialFocus={headingRef}
          focusKey={selected.key}
          returnFocus={() => cardRefs.current.get(selected.key) ?? null}
          onClose={closeSheet}
          header={(close, handle) => (
            <>
              {handle}
              <DetailHeader skin={selected} headingId={headingId} headingRef={headingRef} extra={close} />
            </>
          )}
          body={
            <div className="detail" data-testid="skin-detail" data-skin={selected.key}>
              <SkinPreview key={selected.key} skin={selected} />
              <DetailFacts skin={selected} />
            </div>
          }
          footer={<ActionButton view={view} onBuy={() => startBuy(selected)} onEquip={() => void equip(selected)} />}
        />
      ) : null}
      {buy && me ? (
        <BuyDialog
          key={buy.n}
          skin={buy.skin}
          points={me.points}
          api={api}
          onClose={() => setBuy(null)}
          onRefetch={refetch}
          onEquip={() => void equip(buy.skin)}
          onUnlocked={(points) => {
            const skin = buy.skin;
            setBuy(null);
            setUnlocked({ skin, points });
            void refreshAll();
          }}
        />
      ) : null}
      {unlocked ? (
        <UnlockedDialog
          skin={unlocked.skin}
          points={unlocked.points}
          onClose={() => setUnlocked(null)}
          onEquip={() => {
            const skin = unlocked.skin;
            setUnlocked(null);
            void equip(skin);
          }}
        />
      ) : null}
      <ToastView toast={toast} />
    </Page>
  );
}
