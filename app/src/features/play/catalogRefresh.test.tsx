// BUG-SS18-002: every start refetches GET /v1/skins and sends setCatalog to Unity before the start message, so an open
// tab draws skins and sheet versions the admin added after it loaded. A failed or hanging refetch never blocks play.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../App";
import { createMockApi } from "../../api/mock";
import type { SkinDto } from "../../api/types";
import { createGatedHistory } from "../../router/gatedHistory";
import { CATALOG_REFRESH_TIMEOUT_MS } from "./PlayProvider";

type SkinsMode = "normal" | "changed" | "fail" | "hang";
const NEW_VERSION = "a0d174663ac84b1e";

function setup() {
  const api = createMockApi(localStorage, 0);
  const io = { mode: "normal" as SkinsMode, skinsCalls: 0 };
  // The admin's changes, seen through GET /v1/skins: a new skin and a new sheet version of an existing one.
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url, "http://mock.local").pathname !== "/v1/skins") return api.fetch(input, init);
    io.skinsCalls++;
    if (io.mode === "fail") throw new TypeError("Failed to fetch");
    if (io.mode === "hang") return new Promise<Response>(() => undefined);
    const res = await api.fetch(input, init);
    if (io.mode === "normal") return res;
    const body = (await res.json()) as { items: SkinDto[] };
    const [first, ...rest] = body.items;
    const items = [
      { ...first, sheet: { ...first.sheet, version: NEW_VERSION } },
      ...rest,
      { ...rest[0], key: "qa-frog", name: "QA Frog", isDefault: false, sortOrder: 99 },
    ];
    return new Response(JSON.stringify({ items }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const history = createGatedHistory("hash", "/", "/");
  render(<App history={history} apiUrl="http://mock.local" fetchImpl={fetchImpl} mockUnity />);
  return { io, firstKey: () => (sentMsgs("init")[0]?.catalog as SkinDto[])[0].key };
}

const log = () => window.__BK_BRIDGE_LOG__ ?? [];
type Msg = Record<string, unknown> & { type: string };
const toUnity = (): Msg[] => log().filter((e) => e.dir === "R->U").map((e) => e.msg as Msg);
const sentMsgs = (type: string) => toUnity().filter((m) => m.type === type);
/** The setCatalog sent after `afterIndex` and before the first start message after it. */
function catalogBeforeStart(startType: "startOffline" | "startOnline", afterIndex: number): { catalog: SkinDto[] | null; startIndex: number } {
  const msgs = toUnity();
  const startIndex = msgs.findIndex((m, i) => i >= afterIndex && m.type === startType);
  const between = msgs.slice(afterIndex, startIndex).filter((m) => m.type === "setCatalog");
  return { catalog: between.length ? (between[between.length - 1].catalog as SkinDto[]) : null, startIndex };
}

async function loaded() {
  await waitFor(() => expect(screen.getByTestId("points")).toBeTruthy());
  await waitFor(() => expect(sentMsgs("init")).toHaveLength(1));
}

describe("catalog refetch before every start (BUG-SS18-002)", () => {
  beforeEach(() => {
    window.__BK_BRIDGE_LOG__ = [];
    window.__BK_MOCK__ = { loadMs: 50, matchMs: 100, recordDelayMs: 50 };
    window.history.replaceState(null, "", "/");
  });

  it("offline: the new skin and the new sheet version reach Unity before startOffline, without a reload", async () => {
    const { io, firstKey } = setup();
    await loaded();
    const init = sentMsgs("init")[0].catalog as SkinDto[];
    expect(init.some((s) => s.key === "qa-frog")).toBe(false);
    io.mode = "changed"; // admin creates qa-frog and uploads a new sheet while this tab sits on the menu
    fireEvent.click(screen.getByTestId("menu-offline"));
    await waitFor(() => expect(screen.getByTestId("start-offline").getAttribute("aria-disabled")).toBeNull());
    const mark = toUnity().length;
    const callsBefore = io.skinsCalls;
    fireEvent.click(screen.getByTestId("start-offline"));
    await waitFor(() => expect(sentMsgs("startOffline")).toHaveLength(1));
    expect(io.skinsCalls).toBe(callsBefore + 1);
    const { catalog } = catalogBeforeStart("startOffline", mark);
    expect(catalog?.some((s) => s.key === "qa-frog")).toBe(true);
    expect(catalog?.find((s) => s.key === firstKey())?.sheet.version).toBe(NEW_VERSION);
    await waitFor(() => expect(screen.getByTestId("result")).toBeTruthy(), { timeout: 3000 });
  });

  it("online quick match and play again: each start refetches and sends setCatalog first", async () => {
    window.__BK_MOCK__ = { ...window.__BK_MOCK__, syncStatus: true };
    const { io } = setup();
    await loaded();
    io.mode = "changed";
    fireEvent.click(screen.getByTestId("menu-online"));
    await waitFor(() => expect(screen.getByTestId("quick-match").getAttribute("aria-disabled")).toBeNull());
    let mark = toUnity().length;
    fireEvent.click(screen.getByTestId("quick-match"));
    await waitFor(() => expect(sentMsgs("startOnline")).toHaveLength(1));
    let before = catalogBeforeStart("startOnline", mark);
    expect(before.catalog?.some((s) => s.key === "qa-frog")).toBe(true);
    await waitFor(() => expect(screen.getByTestId("result")).toBeTruthy(), { timeout: 12000 });
    // "Play again" from the result screen: a new fetch, a new setCatalog before the second startOnline
    const calls = io.skinsCalls;
    mark = toUnity().length;
    fireEvent.click(screen.getByTestId("result-again"));
    await waitFor(() => expect(sentMsgs("startOnline")).toHaveLength(2), { timeout: 5000 });
    expect(io.skinsCalls).toBeGreaterThan(calls);
    before = catalogBeforeStart("startOnline", mark);
    expect(before.catalog?.some((s) => s.key === "qa-frog")).toBe(true);
  }, 25000);

  it("a failed refetch does not block the start (Unity keeps its catalog)", async () => {
    const { io } = setup();
    await loaded();
    io.mode = "fail";
    fireEvent.click(screen.getByTestId("menu-offline"));
    await waitFor(() => expect(screen.getByTestId("start-offline").getAttribute("aria-disabled")).toBeNull());
    const mark = toUnity().length;
    fireEvent.click(screen.getByTestId("start-offline"));
    await waitFor(() => expect(sentMsgs("startOffline")).toHaveLength(1));
    expect(catalogBeforeStart("startOffline", mark).catalog).toBeNull();
  });

  it(`a hanging refetch starts anyway after ${CATALOG_REFRESH_TIMEOUT_MS} ms`, async () => {
    const { io } = setup();
    await loaded();
    io.mode = "hang";
    fireEvent.click(screen.getByTestId("menu-online"));
    await waitFor(() => expect(screen.getByTestId("quick-match").getAttribute("aria-disabled")).toBeNull());
    const t0 = Date.now();
    fireEvent.click(screen.getByTestId("quick-match"));
    await waitFor(() => expect(sentMsgs("startOnline")).toHaveLength(1), { timeout: CATALOG_REFRESH_TIMEOUT_MS + 3000 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(CATALOG_REFRESH_TIMEOUT_MS - 50);
  }, 15000);

  it("an unchanged refetch is not sent twice (UnitySync skips the array PlayProvider already sent)", async () => {
    const { io } = setup();
    await loaded();
    io.mode = "normal";
    fireEvent.click(screen.getByTestId("menu-offline"));
    await waitFor(() => expect(screen.getByTestId("start-offline").getAttribute("aria-disabled")).toBeNull());
    const mark = toUnity().length;
    fireEvent.click(screen.getByTestId("start-offline"));
    await waitFor(() => expect(sentMsgs("startOffline")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 200)); // let UnitySync's effect run on the new catalog state
    const startIndex = toUnity().findIndex((m, i) => i >= mark && m.type === "startOffline");
    const catalogs = toUnity().slice(mark, startIndex + 1).filter((m) => m.type === "setCatalog");
    expect(catalogs).toHaveLength(1);
    expect(toUnity().slice(startIndex).filter((m) => m.type === "setCatalog")).toHaveLength(0);
  });
});
