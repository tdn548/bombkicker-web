// BUG-SS18-003: Esc closes the online error dialog like Close (ux-spec 8.3 "Esc closes sheets and dialogs", 9.3).
// Mock Unity room codes: BBBBBB answers SERVERS_FULL, AAAAAA ROOM_NOT_FOUND (src/unity/mockUnity.ts).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../App";
import { createMockApi } from "../../api/mock";
import { createGatedHistory } from "../../router/gatedHistory";

function setup() {
  const api = createMockApi(localStorage, 0);
  render(<App history={createGatedHistory("hash", "/", "/")} apiUrl="http://mock.local" fetchImpl={api.fetch} mockUnity />);
}
const sentInit = () => (window.__BK_BRIDGE_LOG__ ?? []).filter((e) => e.dir === "R->U" && (e.msg as { type: string }).type === "init");
async function loaded() {
  await waitFor(() => expect(screen.getByTestId("points")).toBeTruthy());
  await waitFor(() => expect(sentInit()).toHaveLength(1));
}

describe("online error dialog (BUG-SS18-003)", () => {
  beforeEach(() => {
    window.__BK_BRIDGE_LOG__ = [];
    window.__BK_MOCK__ = { loadMs: 50, matchMs: 100, recordDelayMs: 50 };
    window.history.replaceState(null, "", "/");
  });

  it("Esc closes the busy dialog and leaves the Play Online screen usable", async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByTestId("menu-online"));
    await waitFor(() => expect(screen.getByTestId("join-room").getAttribute("aria-disabled")).not.toBeNull());
    fireEvent.change(screen.getByTestId("room-code"), { target: { value: "BBBBBB" } });
    await waitFor(() => expect(screen.getByTestId("join-room").getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByTestId("join-room"));
    await waitFor(() => expect(screen.getByTestId("online-error").getAttribute("data-code")).toBe("SERVERS_FULL"), { timeout: 5000 });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("searching-overlay")).toBeNull());
    expect(screen.getByTestId("quick-match")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("quick-match").getAttribute("aria-disabled")).toBeNull());
  });

  it("other keys do not close it", async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByTestId("menu-online"));
    fireEvent.change(screen.getByTestId("room-code"), { target: { value: "AAAAAA" } });
    await waitFor(() => expect(screen.getByTestId("join-room").getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByTestId("join-room"));
    await waitFor(() => expect(screen.getByTestId("online-error").getAttribute("data-code")).toBe("ROOM_NOT_FOUND"), { timeout: 5000 });
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByTestId("online-error")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("searching-overlay")).toBeNull());
  });
});
