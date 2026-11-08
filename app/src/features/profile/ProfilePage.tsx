// Profile: name change from the API's suggestions (PATCH /v1/me accepts generator names only), W/L/D, points,
// owned skins x/N, points history (GET /v1/me/points, newest first, "Show more" pages), language switch (UnitySync
// sends setLang to Unity).
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { LedgerItem } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { usePlayerData } from "../../state/PlayerData";
import { Button } from "../../ui/Button";
import { Page } from "../../ui/Page";
import { Segmented } from "../../ui/Segmented";
import { ToastView, useToast } from "../../ui/Toast";
import { ownedSet, visibleSkins } from "../shop/shopLogic";

function NameChange() {
  const { t } = useI18n();
  const { api } = useAuth();
  const { me, setMeLocal } = usePlayerData();
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<"names" | "save" | null>(null);
  const [error, setError] = useState<"names" | "save" | null>(null);
  const { toast, show } = useToast();
  const labelId = useId();

  const loadNames = useCallback(async () => {
    setBusy("names");
    setError(null);
    try {
      const n = await api.nameSuggestions();
      setNames(n);
      setPick(n[0] ?? null);
    } catch {
      setError("names");
    } finally {
      setBusy(null);
    }
  }, [api]);

  const save = async () => {
    if (!pick) return;
    setBusy("save");
    setError(null);
    try {
      const m = await api.setDisplayName(pick);
      setMeLocal(m);
      setOpen(false);
      setNames(null);
      show(t("profile.nameSaved", { name: m.displayName }));
    } catch {
      setError("save");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="namechange">
      {!open ? (
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
            void loadNames();
          }}
          data-testid="name-change"
        >
          {t("profile.changeName")}
        </Button>
      ) : (
        <div className="field" data-testid="name-picker">
          <div id={labelId} className="field__label">
            {t("profile.pickName")}
          </div>
          <p className="note">{t("profile.pickNameNote")}</p>
          {names ? (
            <div role="radiogroup" aria-labelledby={labelId} className="name-options">
              {names.map((n) => (
                <label key={n} className={`name-option ${pick === n ? "name-option--on" : ""}`}>
                  <input type="radio" name="display-name" value={n} checked={pick === n} onChange={() => setPick(n)} />
                  <span>{n}</span>
                </label>
              ))}
            </div>
          ) : busy === "names" ? (
            <p aria-live="polite">
              <span className="spinner spinner--inline" aria-hidden="true" />
            </p>
          ) : null}
          {error ? (
            <p className="helper helper--warn" role="alert">
              {t(error === "names" ? "err.profile.names" : "err.profile.save")}
            </p>
          ) : null}
          <div className="dialog__buttons">
            <Button variant="primary" off={!pick || busy !== null || pick === me?.displayName} onClick={() => void save()} data-testid="name-save">
              {busy === "save" ? t("profile.saving") : t("profile.save")}
            </Button>
            <Button variant="secondary" off={busy !== null} onClick={() => void loadNames()} data-testid="name-more">
              {t("profile.moreNames")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setNames(null);
                setError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      <ToastView toast={toast} />
    </div>
  );
}

function PointsHistory() {
  const { t, lang } = useI18n();
  const { api } = useAuth();
  const { me, catalog } = usePlayerData();
  const [items, setItems] = useState<LedgerItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const balance = me?.points;

  const loadPage = useCallback(
    async (from: string | null) => {
      setState("loading");
      try {
        const p = await api.pointsHistory(from);
        setItems((prev) => (from && prev ? [...prev, ...p.items] : p.items));
        setCursor(p.nextCursor);
        setState("ok");
      } catch {
        setState("error");
      }
    },
    [api],
  );

  // First page on open, and again when the balance changes (a purchase or a match while the page is open).
  useEffect(() => {
    if (balance === undefined) return;
    void Promise.resolve().then(() => loadPage(null));
  }, [balance, loadPage]);

  const date = useMemo(() => new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-US", { dateStyle: "short", timeStyle: "short" }), [lang]);
  const skinName = (key: string | null) => (key ? (catalog?.find((s) => s.key === key)?.name ?? key) : "");

  return (
    <section className="card" aria-labelledby="history-title">
      <h2 id="history-title" className="card__title">
        {t("profile.history")}
      </h2>
      {items && items.length === 0 ? <p className="note">{t("profile.historyEmpty")}</p> : null}
      {items && items.length > 0 ? (
        <ol className="history" data-testid="points-history">
          {items.map((it, i) => (
            <li key={`${it.createdAt}-${i}`} className="history__row" data-reason={it.reason}>
              <span className="history__what">{t(`reason.${it.reason}`, { skin: skinName(it.skinKey) })}</span>
              <span className={`history__delta ${it.delta > 0 ? "history__delta--plus" : ""}`}>
                {it.delta > 0
                  ? t("profile.deltaPlus", { delta: it.delta })
                  : it.delta < 0
                    ? t("profile.deltaMinus", { delta: it.delta })
                    : t("profile.deltaZero")}
              </span>
              <span className="history__after">{t("profile.balanceAfter", { points: it.balanceAfter })}</span>
              <time className="history__time" dateTime={it.createdAt}>
                {date.format(new Date(it.createdAt))}
              </time>
            </li>
          ))}
        </ol>
      ) : null}
      {state === "loading" ? <span className="spinner spinner--inline" aria-hidden="true" /> : null}
      {state === "error" ? (
        <div role="alert" className="history__error">
          <p>{t("err.profile.history")}</p>
          <Button variant="secondary" onClick={() => void loadPage(items ? cursor : null)}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {state === "ok" && cursor ? (
        <Button variant="secondary" onClick={() => void loadPage(cursor)} data-testid="history-more">
          {t("profile.historyMore")}
        </Button>
      ) : null}
    </section>
  );
}

export function ProfilePage() {
  const { t, lang, setLang } = useI18n();
  const { me, mySkins, catalog } = usePlayerData();
  const owned = useMemo(() => ownedSet(mySkins), [mySkins]);
  // N = the skins the shop shows this player (on sale, or owned).
  const total = catalog ? visibleSkins(catalog, owned).length : null;
  const ownedCount = catalog ? visibleSkins(catalog, owned).filter((s) => owned.has(s.key)).length : null;
  return (
    <Page title={t("profile.title")}>
      {me ? (
        <section className="card">
          <h2 className="card__title" data-testid="profile-name">
            {me.displayName}
          </h2>
          <NameChange />
          <p data-testid="profile-points">{t("menu.points", { points: me.points })}</p>
          <p data-testid="profile-stats">{t("profile.stats", { wins: me.stats.wins, losses: me.stats.losses, draws: me.stats.draws })}</p>
          {total !== null && ownedCount !== null && mySkins ? <p data-testid="profile-owned">{t("profile.owned", { owned: ownedCount, total })}</p> : null}
        </section>
      ) : (
        <p>{t("menu.loadingAccount")}</p>
      )}
      <Segmented
        name="lang"
        label={t("profile.language")}
        value={lang}
        onChange={setLang}
        options={[
          { value: "vi", label: t("profile.lang.vi") },
          { value: "en", label: t("profile.lang.en") },
        ]}
      />
      {me ? <PointsHistory /> : null}
    </Page>
  );
}
