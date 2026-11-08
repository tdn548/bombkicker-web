// Result screen rules (plan "Result screen (J)", ux-spec 3). Pure code, tested in resultLogic.test.ts.
import type { Me } from "../../api/types";
import type { MessageKey } from "../../i18n/vi";
import type { MatchResult, Opponent } from "../../unity/bridge";

export interface Before {
  points: number;
  matchesPlayed: number;
}

export type PollOutcome = { state: "done"; delta: number; me: Me } | { state: "timeout" };

export const POLL_INTERVAL_MS = 1000;
export const POLL_TIMEOUT_MS = 10000;

/**
 * Poll GET /v1/me every second for up to 10 s until matchesPlayed grows, then delta = points after - points before
 * (this also shows floored losses correctly). Failed polls are skipped, not fatal.
 */
export async function pollForResult(
  before: Before,
  fetchMe: () => Promise<Me>,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<PollOutcome> {
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
  const timeout = opts.timeoutMs ?? POLL_TIMEOUT_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  for (;;) {
    if (opts.signal?.aborted) return { state: "timeout" };
    try {
      const me = await fetchMe();
      if (me.stats.matchesPlayed > before.matchesPlayed) return { state: "done", delta: me.points - before.points, me };
    } catch {
      // keep polling
    }
    if (now() - start + interval > timeout) return { state: "timeout" };
    await sleep(interval);
  }
}

export function headlineKey(result: MatchResult, offline: boolean, opponent: Opponent | null): MessageKey {
  if (offline && opponent === "local") {
    if (result === "win") return "result.local.team1";
    if (result === "loss") return "result.local.team2";
  }
  return `result.${result}` as MessageKey;
}

/** Points line from the real delta (ux-spec 3.2); never "-0". */
export function pointsLineKey(delta: number, result: MatchResult): MessageKey {
  if (delta > 0) return "result.plus";
  if (delta <= -10) return "result.minus";
  if (delta < 0) return "result.minusFloor";
  return result === "draw" ? "result.drawPoints" : "result.noLoss";
}

/** Timeout copy: after a leave the match is still running with a bot, so the -10 comes later (D16). */
export function timeoutKey(result: MatchResult): MessageKey {
  return result === "left" ? "result.leftPending" : "result.savingLater";
}
