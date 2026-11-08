// Main menu (wireframe A): top bar (points, name -> profile, W/L), equipped skin idle preview, Unity load state,
// Shop / Leaderboard / Play Offline / Play Online.
import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { findBundled, bundledSheetUrl } from "../../skins/bundled";
import { SkinSprite, type SpriteSource } from "../../skins/SkinSprite";
import { usePlayerData } from "../../state/PlayerData";
import { Button } from "../../ui/Button";
import { usePlayGate } from "../play/usePlayGate";
import { UnityLoadStatus } from "./UnityLoadStatus";

export function TopBar() {
  const { t } = useI18n();
  const { status, retry } = useAuth();
  const { me } = usePlayerData();
  if (!me) {
    return (
      <header className="topbar" aria-live="polite">
        {status === "error" ? (
          <>
            <span className="topbar__msg" role="alert">
              {t("menu.accountError")}
            </span>
            <Button variant="secondary" onClick={retry}>
              {t("common.retry")}
            </Button>
          </>
        ) : (
          <span className="topbar__msg">{t("menu.loadingAccount")}</span>
        )}
      </header>
    );
  }
  return (
    <header className="topbar">
      <span className="topbar__points" data-testid="points">
        {t("menu.points", { points: me.points })}
      </span>
      <Link to="/profile" className="topbar__name" aria-label={t("menu.profileLink", { name: me.displayName })} data-testid="player-name">
        {me.displayName}
      </Link>
      <span className="topbar__record" title={t("menu.recordLabel")} data-testid="record">
        {t("menu.record", { wins: me.stats.wins, losses: me.stats.losses })}
      </span>
    </header>
  );
}

function EquippedPreview() {
  const { t } = useI18n();
  const { me, catalog } = usePlayerData();
  const key = me?.equippedSkin ?? "human";
  const dto = catalog?.find((s) => s.key === key);
  const bundled = findBundled(key) ?? findBundled("human");
  const source: SpriteSource | null = dto
    ? { key: dto.key, name: dto.name, sheet: dto.sheet }
    : bundled
      ? { key: bundled.key, name: bundled.name, sheet: { url: bundledSheetUrl(bundled.key), width: bundled.width, height: bundled.height, layout: bundled.layout } }
      : null;
  if (!source) return null;
  return (
    <figure className="preview" data-testid="equipped-preview">
      <SkinSprite skin={source} anim="idle" scale={5} ring={1} label={t("menu.equipped", { name: source.name })} />
      <figcaption>{t("menu.equipped", { name: source.name })}</figcaption>
    </figure>
  );
}

export function MainMenu() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const gate = usePlayGate();
  const { refreshMe } = usePlayerData();
  const { status } = useAuth();
  // ux-spec 3.1: after a result timeout, the menu refetches /v1/me when it opens (cheap, so always).
  useEffect(() => {
    if (status === "ready") refreshMe().catch(() => undefined);
  }, [status, refreshMe]);

  return (
    <main className="menu">
      <TopBar />
      <h1 className="menu__title">{t("app.title")}</h1>
      <EquippedPreview />
      <UnityLoadStatus />
      <nav className="menu__buttons" aria-label={t("app.title")}>
        <Link to="/shop" className="btn btn--secondary">
          {t("menu.shop")}
        </Link>
        <Link to="/leaderboard" className="btn btn--secondary">
          {t("menu.leaderboard")}
        </Link>
        <Button variant="primary" off={gate.off} aria-describedby={gate.helper ? "play-helper" : undefined} onClick={() => navigate("/play/offline")} data-testid="menu-offline">
          {t("menu.playOffline")}
        </Button>
        <Button variant="primary" off={gate.off} aria-describedby={gate.helper ? "play-helper" : undefined} onClick={() => navigate("/play/online")} data-testid="menu-online">
          {t("menu.playOnline")}
        </Button>
      </nav>
      {gate.off && gate.helper ? (
        <p id="play-helper" className="helper menu__helper">
          {gate.helper}
        </p>
      ) : null}
    </main>
  );
}
