// Unity load state on the main menu (ux-spec 6.4).
import { useI18n } from "../../i18n/I18nProvider";
import { Button } from "../../ui/Button";
import { useUnity } from "../../unity/UnityHost";

/** pct = floor(progress * 100), capped at 99 until ready, so the bar never sits at 100 % while Unity starts. */
export function loadPercent(progress: number): number {
  return Math.min(99, Math.max(0, Math.floor(progress * 100)));
}

export function UnityLoadStatus() {
  const { t } = useI18n();
  const { boot, progress, isLoaded, slow } = useUnity();
  if (boot.state === "ready") return null;
  if (boot.state === "failed") {
    return (
      <div className="load load--failed" role="alert">
        <p>{t("menu.failed")}</p>
        <Button variant="secondary" onClick={() => location.reload()}>
          {t("common.reload")}
        </Button>
      </div>
    );
  }
  const pct = loadPercent(progress);
  return (
    <div className="load" aria-live="polite">
      <p className="load__text">{isLoaded ? t("menu.starting") : t("menu.loading", { pct })}</p>
      <div className="load__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("menu.loading", { pct })}>
        <div className="load__fill" style={{ width: `${isLoaded ? 99 : pct}%` }} />
      </div>
      {slow ? <p className="load__slow">{t("menu.slow")}</p> : null}
    </div>
  );
}
