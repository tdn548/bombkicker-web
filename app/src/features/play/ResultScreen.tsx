// Result screen (wireframe J, ux-spec 3): headline from the result at once, points line from the real delta once
// /v1/me shows the match (polled by PlayProvider).
import { useEffect, useRef } from "react";
import { Navigate, useNavigate } from "react-router";
import { useI18n } from "../../i18n/I18nProvider";
import { nextUnlock, usePlayerData } from "../../state/PlayerData";
import { Button } from "../../ui/Button";
import { usePlay } from "./PlayProvider";
import { headlineKey, pointsLineKey, timeoutKey } from "./resultLogic";
import { usePlayGate } from "./usePlayGate";

export function ResultScreen() {
  const { t } = useI18n();
  const play = usePlay();
  const navigate = useNavigate();
  const gate = usePlayGate();
  const { me, catalog, mySkins } = usePlayerData();
  const headRef = useRef<HTMLHeadingElement>(null);
  const stage = play.stage;
  useEffect(() => {
    headRef.current?.focus();
  }, []);
  if (stage.stage !== "result") return <Navigate to="/" replace />;
  const r = stage.result;
  const offline = r.origin.type === "offline";
  const opponent = r.origin.type === "offline" ? r.origin.settings.opponent : null;
  const p = r.points;

  let pointsLine: string;
  if (p.state === "none") pointsLine = t("result.offline");
  else if (p.state === "saving") pointsLine = t("result.saving");
  else if (p.state === "timeout") pointsLine = t(timeoutKey(r.result));
  else pointsLine = t(pointsLineKey(p.delta, r.result), { delta: p.delta });

  const total = p.state === "done" ? p.total : (me?.points ?? null);
  const next = !offline ? nextUnlock(catalog, mySkins) : null;
  let nextLine: string | null = null;
  if (next === "allOwned") nextLine = t("result.allOwned");
  else if (next && total !== null) nextLine = total >= next.price ? t("result.nextReady", { name: next.name }) : t("result.next", { need: next.price - total, name: next.name });

  const again = () => {
    const o = r.origin;
    if (o.type === "offline") {
      play.startOffline(o.settings);
      navigate("/play/offline");
    } else if (o.start.kind === "quick") {
      play.startOnline(o.start);
      navigate("/play/online");
    } else {
      // A rematch is a new room: back to the Play Online room panel.
      play.closeResult();
      navigate("/play/online");
    }
  };

  return (
    <main className="page result" data-testid="result" data-result={r.result} data-points-state={p.state}>
      <div className="result__card">
        <div aria-live="polite">
          <h1 ref={headRef} tabIndex={-1} className={`result__headline result__headline--${r.result}`}>
            {t(headlineKey(r.result, offline, opponent))}
          </h1>
          <p className="result__points" data-testid="points-line" data-delta={p.state === "done" ? p.delta : undefined}>
            {p.state === "saving" ? <span className="spinner spinner--inline" aria-hidden="true" /> : null}
            {pointsLine}
          </p>
          {r.result === "left" && !offline ? <p className="result__note">{t("result.leftNote")}</p> : null}
        </div>
        {!offline && total !== null && p.state !== "saving" ? <p className="result__total">{t("result.total", { points: total })}</p> : null}
        {nextLine && p.state !== "saving" ? <p className="result__next">{nextLine}</p> : null}
        <div className="result__buttons">
          <Button
            onClick={() => {
              play.closeResult();
              navigate("/");
            }}
            data-testid="result-menu"
          >
            {t("result.menu")}
          </Button>
          <Button variant="secondary" off={gate.off} onClick={again} data-testid="result-again">
            {t("result.again")}
          </Button>
        </div>
      </div>
    </main>
  );
}
