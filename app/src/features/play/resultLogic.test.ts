import { describe, expect, it } from "vitest";
import type { Me } from "../../api/types";
import { headlineKey, pointsLineKey, pollForResult, timeoutKey } from "./resultLogic";

const me = (points: number, matchesPlayed: number): Me => ({
  id: "p",
  displayName: "N",
  stats: { matchesPlayed, wins: 0, losses: 0, draws: 0, winRate: 0 },
  points,
  equippedSkin: "human",
});

/** Virtual clock: sleep advances time instantly. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), get t() { return t; } };
}

describe("pollForResult", () => {
  it("returns points after - points before once matchesPlayed grows", async () => {
    const c = clock();
    const answers = [me(60, 3), me(60, 3), me(80, 4)];
    let calls = 0;
    const out = await pollForResult({ points: 60, matchesPlayed: 3 }, async () => answers[Math.min(calls++, 2)], c);
    expect(out).toMatchObject({ state: "done", delta: 20 });
    expect(calls).toBe(3);
    expect(c.t).toBe(2000);
  });

  it("shows a floored loss as the real delta (-4)", async () => {
    const out = await pollForResult({ points: 4, matchesPlayed: 0 }, async () => me(0, 1), clock());
    expect(out).toMatchObject({ state: "done", delta: -4 });
  });

  it("times out after 10 s of polling every second (11 polls at 0..10 s)", async () => {
    const c = clock();
    let calls = 0;
    const out = await pollForResult({ points: 60, matchesPlayed: 3 }, async () => (calls++, me(60, 3)), c);
    expect(out).toEqual({ state: "timeout" });
    expect(calls).toBe(11);
    expect(c.t).toBe(10000);
  });

  it("keeps polling through failed requests", async () => {
    let calls = 0;
    const out = await pollForResult(
      { points: 60, matchesPlayed: 3 },
      async () => {
        calls++;
        if (calls < 3) throw new Error("network");
        return me(50, 4);
      },
      clock(),
    );
    expect(out).toMatchObject({ state: "done", delta: -10 });
  });

  it("stops when aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await pollForResult({ points: 0, matchesPlayed: 0 }, async () => me(0, 0), { ...clock(), signal: ctrl.signal })).toEqual({ state: "timeout" });
  });
});

describe("result copy keys (ux-spec 3.2)", () => {
  it("points line from the real delta", () => {
    expect(pointsLineKey(20, "win")).toBe("result.plus");
    expect(pointsLineKey(-10, "loss")).toBe("result.minus");
    expect(pointsLineKey(-4, "loss")).toBe("result.minusFloor");
    expect(pointsLineKey(0, "loss")).toBe("result.noLoss");
    expect(pointsLineKey(0, "left")).toBe("result.noLoss");
    expect(pointsLineKey(0, "draw")).toBe("result.drawPoints");
  });
  it("headline, with team wording for same-keyboard games", () => {
    expect(headlineKey("win", false, null)).toBe("result.win");
    expect(headlineKey("left", false, null)).toBe("result.left");
    expect(headlineKey("win", true, "local")).toBe("result.local.team1");
    expect(headlineKey("loss", true, "local")).toBe("result.local.team2");
    expect(headlineKey("draw", true, "local")).toBe("result.draw");
    expect(headlineKey("loss", true, "bots")).toBe("result.loss");
  });
  it("timeout after a leave says the -10 comes when the match ends (D16)", () => {
    expect(timeoutKey("left")).toBe("result.leftPending");
    expect(timeoutKey("win")).toBe("result.savingLater");
  });
});
