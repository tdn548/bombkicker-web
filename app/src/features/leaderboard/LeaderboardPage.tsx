// Leaderboard (wireframe G): 1v1 / 2v2, top 20 from GET /v1/leaderboard, and the player's own row pinned at the
// bottom of the list (the API's `me`, whose rank may be beyond the top 20, or null under 3 matches).
import { useEffect, useState } from "react";
import type { Leaderboard, Mode } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { Button } from "../../ui/Button";
import { Page } from "../../ui/Page";
import { Segmented } from "../../ui/Segmented";

/** The API's minimum all-human matches for a rank. */
export const MIN_RANKED_MATCHES = 3;
const MODE_KEY = "bk_lb_mode";

type Load = { state: "loading" } | { state: "ok"; data: Leaderboard } | { state: "error" };

export function LeaderboardPage() {
  const { t } = useI18n();
  const { api, session } = useAuth();
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) === "2v2" ? "2v2" : "1v1"));
  const [load, setLoad] = useState<Record<Mode, Load>>({ "1v1": { state: "loading" }, "2v2": { state: "loading" } });
  const [attempt, setAttempt] = useState(0);
  const setMode = (m: Mode) => {
    localStorage.setItem(MODE_KEY, m);
    setModeState(m);
  };
  const ready = !!session;

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    api.leaderboard(mode).then(
      (data) => alive && setLoad((p) => ({ ...p, [mode]: { state: "ok", data } })),
      () => alive && setLoad((p) => ({ ...p, [mode]: { state: "error" } })),
    );
    return () => {
      alive = false;
    };
  }, [api, mode, ready, attempt]);

  const cur = load[mode];
  const pct = (r: number) => t("lb.percent", { pct: Math.round(r * 100) });
  const myId = session?.player.id;

  let body;
  if (cur.state === "error") {
    body = (
      <div className="card" role="alert">
        <p>{t("err.lb.load")}</p>
        <Button
          variant="secondary"
          onClick={() => {
            setLoad((p) => ({ ...p, [mode]: { state: "loading" } }));
            setAttempt((a) => a + 1);
          }}
        >
          {t("common.retry")}
        </Button>
      </div>
    );
  } else if (cur.state === "loading") {
    body = <p aria-live="polite">{t("lb.loading")}</p>;
  } else {
    const { items, me } = cur.data;
    const need = Math.max(1, MIN_RANKED_MATCHES - (me?.matchesPlayed ?? 0));
    body = (
      <div className="lb">
        {items.length === 0 ? <p className="note">{t("lb.empty")}</p> : null}
        <table className="lb__table" data-testid="lb-table">
          <thead>
            <tr>
              <th scope="col">{t("lb.rank")}</th>
              <th scope="col">{t("lb.name")}</th>
              <th scope="col">{t("lb.wins")}</th>
              <th scope="col" className="lb__col-played">
                {t("lb.played")}
              </th>
              <th scope="col">{t("lb.winRate")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const mine = r.playerId === myId;
              return (
                <tr key={r.playerId} className={mine ? "lb__row lb__row--me" : "lb__row"} data-testid={mine ? "lb-row-me" : "lb-row"} aria-current={mine || undefined}>
                  <td>{r.rank}</td>
                  <td className="lb__name">
                    {r.displayName}
                    {mine ? <strong> {t("lb.you")}</strong> : null}
                  </td>
                  <td>{r.wins}</td>
                  <td className="lb__col-played">{r.matchesPlayed}</td>
                  <td>{pct(r.winRate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* Own row, always visible (sticky at the bottom of the screen). */}
        <div className="lb__pinned" data-testid="lb-pinned" aria-live="polite">
          <span className="lb__pinned-who">{t("lb.me")}</span>
          {me && me.rank !== null ? (
            <>
              <span data-testid="lb-pinned-rank">{t("lb.meRank", { rank: me.rank })}</span>
              <span>
                {t("lb.wins")}: {me.wins}
              </span>
              <span className="lb__col-played">
                {t("lb.played")}: {me.matchesPlayed}
              </span>
              <span>
                {t("lb.winRate")}: {pct(me.winRate)}
              </span>
            </>
          ) : (
            <span data-testid="lb-pinned-unranked">{t(need === 1 ? "lb.meUnranked.one" : "lb.meUnranked.many", { need })}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <Page title={t("menu.leaderboard")} className="lb-page">
      <Segmented
        name="lb-mode"
        label={t("lb.mode")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "1v1", label: "1v1" },
          { value: "2v2", label: "2v2" },
        ]}
      />
      <p className="note">{t("lb.note")}</p>
      {body}
    </Page>
  );
}
