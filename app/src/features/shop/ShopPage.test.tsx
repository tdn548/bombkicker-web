// Shop through the whole app (mock API + mock Unity): buy -> unlocked -> equip -> setEquippedSkin / setCatalog,
// the idempotency key across retries and dialog re-opens, disabled button + helper, error dialogs.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../App";
import { createMockApi } from "../../api/mock";
import { createGatedHistory } from "../../router/gatedHistory";

const DEVICE = "bk-0123456789abcdef0123456789abcdef";

function setup() {
  const api = createMockApi(localStorage, 0);
  const purchases: { idempotencyKey: string; expectedPrice: number }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/shop/purchases")) purchases.push(JSON.parse(String(init?.body)) as never);
    return api.fetch(input, init);
  };
  const history = createGatedHistory("hash", "/shop", "/");
  render(<App history={history} apiUrl="http://mock.local" fetchImpl={fetchImpl} mockUnity />);
  return { purchases };
}
const sent = (type: string) => (window.__BK_BRIDGE_LOG__ ?? []).filter((e) => e.dir === "R->U" && (e.msg as { type: string }).type === type);
function seedPlayer(points: number) {
  const p = { id: "11111111-1111-4111-8111-111111111111", deviceId: DEVICE, displayName: "Tiny Fox 7", points, wins: 0, losses: 0, draws: 0, equipped: "human", owned: [] };
  localStorage.setItem("bk_mock_db", JSON.stringify({ players: [p] }));
}
const action = () => screen.getByTestId("shop-action");
const knobs = (k: Record<string, unknown>) => (window.__BK_MOCK__ = { ...window.__BK_MOCK__, ...k });

async function openSkin(key: string) {
  await waitFor(() => expect(screen.getByTestId(`skin-card-${key}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`skin-card-${key}`));
  await waitFor(() => expect(screen.getByTestId("skin-detail").getAttribute("data-skin")).toBe(key));
  await waitFor(() => expect(action().getAttribute("data-kind")).not.toBe("skeleton"));
}

describe("ShopPage", () => {
  beforeEach(() => {
    window.__BK_BRIDGE_LOG__ = [];
    window.__BK_MOCK__ = { loadMs: 20, matchMs: 100, recordDelayMs: 20 };
    localStorage.setItem("bk_device_id", DEVICE);
  });

  it("grid shows In use / price / sold out / limited stock; rarity tabs filter", async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId("skin-card-human")).toBeTruthy());
    expect(screen.getByTestId("skin-card-human").getAttribute("data-state")).toBe("inUse");
    expect(within(screen.getByTestId("skin-card-pig")).getByText("60 điểm")).toBeTruthy();
    expect(within(screen.getByTestId("skin-card-pig")).getByText("Chưa mở")).toBeTruthy();
    expect(within(screen.getByTestId("skin-card-pig-star")).getByText("Hết hàng")).toBeTruthy();
    expect(within(screen.getByTestId("skin-card-goblin-king")).getByText("Còn 3/10")).toBeTruthy();
    fireEvent.click(screen.getByTestId("shop-tab-legendary"));
    expect(screen.queryByTestId("skin-card-pig")).toBeNull();
    expect(screen.getByTestId("skin-card-goblin-king")).toBeTruthy();
    fireEvent.click(screen.getByTestId("shop-tab-owned"));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("too few points: Buy is aria-disabled with the need helper, pressing it opens nothing", async () => {
    setup();
    await openSkin("skeleton");
    expect(action().getAttribute("aria-disabled")).toBe("true");
    expect(action().textContent).toBe("Mua · 160 điểm");
    const helper = screen.getByText("Cần thêm 100 điểm, khoảng 5 trận thắng (thắng = +20).");
    expect(action().getAttribute("aria-describedby")).toContain(helper.id);
    fireEvent.click(action());
    expect(screen.queryByTestId("buy-dialog")).toBeNull();
  });

  it("buy -> D (price, balance) -> E -> Equip now -> PATCH, setEquippedSkin, refetch + setCatalog", async () => {
    setup();
    // Unity is ready and has its init, so the equip below has to arrive as setEquippedSkin
    await waitFor(() => expect(sent("init")).toHaveLength(1));
    expect((sent("init")[0].msg as { equippedSkin: { key: string } }).equippedSkin.key).toBe("human");
    await openSkin("pig");
    fireEvent.click(action());
    const d = await screen.findByTestId("buy-dialog");
    expect(within(d).getByText("Mua Pig?")).toBeTruthy();
    expect(within(d).getByText("Giá: 60 điểm")).toBeTruthy();
    expect(within(d).getByText("Điểm của bạn: 60 → 0")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("buy-cancel")));
    const catalogsBefore = sent("setCatalog").length;
    fireEvent.click(screen.getByTestId("buy-confirm"));
    const e = await screen.findByTestId("unlocked-dialog");
    expect(within(e).getByText("Đã mở khóa Pig!")).toBeTruthy();
    expect(within(e).getByText("Bạn còn 0 điểm.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("unlocked-equip"));
    await waitFor(() => expect(screen.getByTestId("toast").textContent).toContain("Đã trang bị Pig."));
    await waitFor(() => expect(action().textContent).toBe("Đang dùng"));
    await waitFor(() => expect(sent("setEquippedSkin").map((m) => (m.msg as { skin: { key: string } }).skin.key)).toContain("pig"));
    await waitFor(() => expect(sent("setCatalog").length).toBeGreaterThan(catalogsBefore));
    expect(screen.getByTestId("shop-points").textContent).toBe("Bạn có 0 điểm");
  });

  it("network error: retry reuses the key; closing and opening D again makes a new key", async () => {
    const { purchases } = setup();
    await openSkin("goblin");
    knobs({ purchaseErrors: ["network", "network"] });
    fireEvent.click(action());
    fireEvent.click(await screen.findByTestId("buy-confirm"));
    await waitFor(() => expect(screen.getByTestId("buy-error").getAttribute("data-error")).toBe("network"));
    expect(screen.getByTestId("buy-error").textContent).toContain("Lỗi mạng. Bạn chưa bị trừ điểm.");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("buy-err-retry"));
    await waitFor(() => expect(purchases).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId("buy-error").getAttribute("data-error")).toBe("network"));
    expect(purchases[1].idempotencyKey).toBe(purchases[0].idempotencyKey);
    fireEvent.click(screen.getByTestId("buy-err-cancel"));
    await waitFor(() => expect(screen.queryByTestId("buy-dialog")).toBeNull());
    fireEvent.click(action());
    fireEvent.click(await screen.findByTestId("buy-confirm"));
    await screen.findByTestId("unlocked-dialog");
    expect(purchases).toHaveLength(3);
    expect(purchases[2].idempotencyKey).not.toBe(purchases[0].idempotencyKey);
  });

  it("answer lost after the purchase committed -> check finds it owned -> E, charged once", async () => {
    const { purchases } = setup();
    await openSkin("goblin");
    knobs({ purchaseErrors: ["networkCommitted"] });
    fireEvent.click(action());
    fireEvent.click(await screen.findByTestId("buy-confirm"));
    await screen.findByTestId("unlocked-dialog");
    expect(purchases).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId("shop-points").textContent).toBe("Bạn có 0 điểm"));
  });

  it("network down (check fails too) -> networkUnknown, Try again with the same key succeeds once", async () => {
    const { purchases } = setup();
    await openSkin("pig");
    knobs({ purchaseErrors: ["networkDown"] });
    fireEvent.click(action());
    fireEvent.click(await screen.findByTestId("buy-confirm"));
    await waitFor(() => expect(screen.getByTestId("buy-error").getAttribute("data-error")).toBe("networkUnknown"));
    fireEvent.click(screen.getByTestId("buy-err-retry"));
    await screen.findByTestId("unlocked-dialog");
    expect(purchases.map((p) => p.idempotencyKey)).toEqual([purchases[0].idempotencyKey, purchases[0].idempotencyKey]);
  });

  it.each([
    ["SOLD_OUT", "Vừa hết hàng, có người mua bản cuối trước bạn. Bạn chưa bị trừ điểm.", "buy-err-close"],
    ["NOT_ON_SALE", "Skin này không còn bán nữa. Bạn chưa bị trừ điểm.", "buy-err-close"],
    ["SKIN_NOT_FOUND", "Không tìm thấy skin này. Có thể nó vừa bị gỡ. Bạn chưa bị trừ điểm.", "buy-err-close"],
    ["ALREADY_OWNED", "Bạn đã có skin này rồi.", "buy-err-equip"],
    ["NOT_ENOUGH_POINTS", "Chưa đủ điểm: bạn có 60, cần 60. Bạn chưa bị trừ điểm.", "buy-err-close"],
    ["RATE_LIMITED", "Bạn bấm nhanh quá. Chờ khoảng 1 phút rồi thử lại. Bạn chưa bị trừ điểm.", "buy-err-retry"],
    ["IDEMPOTENCY_KEY_REUSED", "Có lỗi, bạn chưa bị trừ điểm. Hãy thử lại.", "buy-err-close"],
    ["PRICE_CHANGED", "Giá vừa đổi thành 80 điểm. Bạn có 60 điểm nên chưa mua được. Bạn chưa bị trừ điểm.", "buy-err-close"],
  ])("%s -> dialog F copy and primary button", async (code, text, primary) => {
    setup();
    await openSkin("pig");
    knobs({ purchaseErrors: [code] });
    fireEvent.click(action());
    fireEvent.click(await screen.findByTestId("buy-confirm"));
    await waitFor(() => expect(screen.getByTestId("buy-error").textContent).toContain(text));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(primary)));
  });

  it("PRICE_CHANGED within budget: Buy for the new price keeps the key and sends the new expectedPrice", async () => {
    // the mock answers expectedPrice + 20, so the player needs more than the starter 60 points
    seedPlayer(200);
    const { purchases } = setup();
    await openSkin("goblin");
    knobs({ purchaseErrors: ["PRICE_CHANGED"] });
    fireEvent.click(action());
    fireEvent.click(await screen.findByTestId("buy-confirm"));
    await waitFor(() => expect(screen.getByTestId("buy-error").getAttribute("data-error")).toBe("priceChanged"));
    expect(screen.getByTestId("buy-err-buyAtPrice").textContent).toBe("Mua với giá 80");
    fireEvent.click(screen.getByTestId("buy-err-buyAtPrice"));
    await waitFor(() => expect(purchases).toHaveLength(2));
    expect(purchases[1]).toMatchObject({ idempotencyKey: purchases[0].idempotencyKey, expectedPrice: 80 });
  });

  it("while buying nothing in D is clickable and Esc does nothing", async () => {
    setup();
    await openSkin("pig");
    knobs({ purchaseDelayMs: 300 });
    fireEvent.click(action());
    fireEvent.click(await screen.findByTestId("buy-confirm"));
    await waitFor(() => expect(screen.getByTestId("buy-confirm").textContent).toBe("Đang mua…"));
    expect(screen.getByTestId("buy-cancel").getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("buy-cancel"));
    expect(screen.getByTestId("buy-dialog")).toBeTruthy();
    await screen.findByTestId("unlocked-dialog");
  });

  it("equip error NOT_OWNED -> alert toast, button re-rendered from refetched data", async () => {
    setup();
    await openSkin("human");
    expect(action().textContent).toBe("Đang dùng");
    // buy goblin, then make the equip fail
    await openSkin("goblin");
    fireEvent.click(action());
    fireEvent.click(await screen.findByTestId("buy-confirm"));
    await screen.findByTestId("unlocked-dialog");
    fireEvent.click(screen.getByTestId("unlocked-later"));
    await waitFor(() => expect(action().textContent).toBe("Trang bị"));
    knobs({ equipErrors: ["NOT_OWNED"] });
    fireEvent.click(action());
    await waitFor(() => expect(screen.getByTestId("toast-alert").textContent).toContain("Bạn không còn sở hữu skin này."));
    await waitFor(() => expect(action().textContent).toBe("Trang bị"));
  });
});
