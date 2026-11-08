// Integration: the whole app with the mock API and the mock Unity (fast knobs).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { createMockApi } from "./api/mock";
import { createGatedHistory } from "./router/gatedHistory";

const LEGACY = "bk-f77dc74e0123456789abcdef01234567";

function setup() {
  const api = createMockApi(localStorage, 0);
  const history = createGatedHistory("hash", "/", "/");
  render(<App history={history} apiUrl="http://mock.local" fetchImpl={api.fetch} mockUnity />);
  return { api, history };
}

const log = () => window.__BK_BRIDGE_LOG__ ?? [];
const sent = (type: string) => log().filter((e) => e.dir === "R->U" && (e.msg as { type: string }).type === type);

describe("App with mock Unity", () => {
  beforeEach(() => {
    window.__BK_BRIDGE_LOG__ = [];
    window.__BK_MOCK__ = { loadMs: 50, matchMs: 100, recordDelayMs: 50 };
    window.history.replaceState(null, "", "/");
  });

  it("first visit waits for ready, adopts legacyDeviceId, sends init with lang vi", async () => {
    window.__BK_MOCK__ = { ...window.__BK_MOCK__, legacyDeviceId: LEGACY };
    setup();
    expect(screen.getByText("Đang tải tài khoản…")).toBeTruthy();
    expect(localStorage.getItem("bk_device_id")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("points").textContent).toBe("60 điểm"));
    expect(localStorage.getItem("bk_device_id")).toBe(LEGACY);
    await waitFor(() => expect(sent("init")).toHaveLength(1));
    const init = sent("init")[0].msg as Record<string, unknown>;
    expect(init).toMatchObject({ type: "init", v: 1, accessToken: "…", lang: "vi", player: { displayName: expect.any(String) } });
    expect((init.equippedSkin as { key: string }).key).toBe("human");
    expect((init.catalog as unknown[]).length).toBe(6);
  });

  it("Unity authExpired -> re-login -> setToken, then the search goes on", async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId("points")).toBeTruthy());
    window.__BK_MOCK__ = { ...window.__BK_MOCK__, authExpiredOnStart: true };
    fireEvent.click(screen.getByTestId("menu-online"));
    await waitFor(() => expect(screen.getByTestId("quick-match").getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByTestId("quick-match"));
    await waitFor(() => expect(sent("setToken")).toHaveLength(1), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId("searching-overlay")).toBeTruthy());
  });

  it("offline match: start -> Unity shown -> result (no points) -> menu", async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId("points")).toBeTruthy());
    fireEvent.click(screen.getByTestId("menu-offline"));
    await waitFor(() => expect(screen.getByTestId("start-offline").getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByTestId("start-offline"));
    // the start waits for the catalog refetch (BUG-SS18-002), so it is not sent synchronously any more
    await waitFor(() => expect(sent("startOffline")[0]?.msg).toMatchObject({ mode: "1v1", opponent: "bots", map: 1 }));
    await waitFor(() => expect(screen.getByTestId("unity-layer").className).toContain("visible"));
    await waitFor(() => expect(screen.getByTestId("result")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId("unity-layer").className).not.toContain("visible");
    expect(screen.getByTestId("points-line").textContent).toBe("Trận offline không tính điểm.");
    act(() => fireEvent.click(screen.getByTestId("result-menu")));
    await waitFor(() => expect(screen.getByTestId("equipped-preview")).toBeTruthy());
  });

  it("quick match win: result shows +20 from the polled /v1/me (Unity answering synchronously)", async () => {
    window.__BK_MOCK__ = { ...window.__BK_MOCK__, syncStatus: true };
    setup();
    await waitFor(() => expect(screen.getByTestId("points").textContent).toBe("60 điểm"));
    fireEvent.click(screen.getByTestId("menu-online"));
    await waitFor(() => expect(screen.getByTestId("quick-match").getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByTestId("quick-match"));
    await waitFor(() => expect(screen.getByTestId("searching-overlay")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("result")).toBeTruthy(), { timeout: 12000 });
    await waitFor(() => expect(screen.getByTestId("points-line").textContent).toBe("+20 điểm"), { timeout: 5000 });
    expect(screen.getByText("Tổng: 80 điểm")).toBeTruthy();
  }, 20000);
});
