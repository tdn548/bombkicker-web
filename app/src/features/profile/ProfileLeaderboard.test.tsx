// Leaderboard (own row pinned, 1v1/2v2) and profile (name change from suggestions, owned x/N, points history,
// language -> setLang) through the app with the mock API.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../App";
import { createMockApi } from "../../api/mock";
import { createGatedHistory } from "../../router/gatedHistory";

const DEVICE = "bk-0123456789abcdef0123456789abcdef";
const sent = (type: string) => (window.__BK_BRIDGE_LOG__ ?? []).filter((e) => e.dir === "R->U" && (e.msg as { type: string }).type === type);

function setup(route: string) {
  const api = createMockApi(localStorage, 0);
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    urls.push(String(input));
    return api.fetch(input, init);
  };
  render(<App history={createGatedHistory("hash", route, "/")} apiUrl="http://mock.local" fetchImpl={fetchImpl} mockUnity />);
  return { urls };
}

describe("Leaderboard", () => {
  beforeEach(() => {
    window.__BK_BRIDGE_LOG__ = [];
    window.__BK_MOCK__ = { loadMs: 20 };
    localStorage.setItem("bk_device_id", DEVICE);
  });
  it("1v1 then 2v2; the own row is pinned (no rank under 3 matches)", async () => {
    const { urls } = setup("/leaderboard");
    await waitFor(() => expect(screen.getAllByTestId("lb-row")).toHaveLength(8));
    expect(urls.some((u) => u.includes("/v1/leaderboard?mode=1v1"))).toBe(true);
    expect(screen.getByTestId("lb-pinned-unranked").textContent).toBe("Chưa có hạng: chơi thêm 3 trận online với người thật để có hạng.");
    fireEvent.click(screen.getByRole("radio", { name: "2v2" }));
    await waitFor(() => expect(urls.some((u) => u.includes("/v1/leaderboard?mode=2v2"))).toBe(true));
    expect(localStorage.getItem("bk_lb_mode")).toBe("2v2");
  });
  it("ranked: the pinned row shows the rank from `me`", async () => {
    const p = { id: "11111111-1111-4111-8111-111111111111", deviceId: DEVICE, displayName: "Tiny Fox 7", points: 60, wins: 2, losses: 1, draws: 0, equipped: "human", owned: [] };
    localStorage.setItem("bk_mock_db", JSON.stringify({ players: [p] }));
    setup("/leaderboard");
    await waitFor(() => expect(screen.getByTestId("lb-pinned-rank").textContent).toBe("Hạng 24"));
    expect(within(screen.getByTestId("lb-pinned")).getByText("Tỉ lệ thắng: 67%")).toBeTruthy();
  });
});

describe("Profile", () => {
  beforeEach(() => {
    window.__BK_BRIDGE_LOG__ = [];
    window.__BK_MOCK__ = { loadMs: 20 };
    localStorage.setItem("bk_device_id", DEVICE);
  });
  it("owned x/N, starter row in the history, name change from the suggestions", async () => {
    setup("/profile");
    await waitFor(() => expect(screen.getByTestId("profile-owned").textContent).toBe("Skin đã có: 1/6"));
    await waitFor(() => expect(within(screen.getByTestId("points-history")).getByText("Điểm khởi đầu")).toBeTruthy());
    expect(within(screen.getByTestId("points-history")).getByText("+60 điểm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("name-change"));
    const radios = await screen.findAllByRole("radio", { name: /Brave Tiger|Lucky Panda|Quick Otter|Sunny Whale|Jolly Koala/ });
    expect(radios).toHaveLength(5);
    fireEvent.click(radios[1]);
    const picked = (radios[1] as HTMLInputElement).value;
    fireEvent.click(screen.getByTestId("name-save"));
    await waitFor(() => expect(screen.getByTestId("profile-name").textContent).toBe(picked));
    expect(screen.getByTestId("toast").textContent).toBe(`Đã đổi tên thành ${picked}.`);
  });
  it("language switch -> English copy and setLang to Unity", async () => {
    setup("/profile");
    await waitFor(() => expect(sent("init")).toHaveLength(1));
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    await waitFor(() => expect(sent("setLang")).toHaveLength(1));
    expect(sent("setLang")[0].msg).toMatchObject({ lang: "en" });
    expect(screen.getByText("Points history")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });
});
