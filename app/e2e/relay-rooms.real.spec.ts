// Relay rooms end to end (D5b, relay-rooms run): two browser contexts = two players, the dev Unity build
// (WebBuild.BuildWebDev, BK_DEV_HOOKS) in public/game, the local bombkicker-api with ADMIN_DEV_BYPASS (admin API for the
// checks) and the real Unity Relay. Chromium only: Playwright's WebKit drops routed XHR bodies (README), and the input
// bug and the CSP have their own WebKit tests.
//   a) A (pig) creates a 1v1 room, B (goblin) joins by the code A sees; each side gets the other's API skin; the host page
//      has ?devForceEnd=35 (team 2 eliminated 35 s after the match starts) -> exactly one relay match, A +20, B -10
//   b) admin revokes B's goblin; in a new room B starts with the default skin
//   c) same room: B leaves mid-match (Esc, Right, Enter = "Rời trận") after the 30 s minimum -> recorded, B disconnected, loss
//   d) new room: A (host) leaves mid-match -> B sees HOST_LEFT, no match recorded, the room is closed
// Needs: BK_E2E_REAL=1, BK_E2E_API (API not on :8787) or the API on :8787, BK_CSP_LOCAL_API=1 npm run build.
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { bridgeLog } from "./helpers";

const API = process.env.BK_E2E_API ?? "http://localhost:8787";
const ADMIN = { "X-Requested-With": "bombkicker-admin" };
const UNITY_READY = 180_000;

type Player = { page: Page; logs: string[]; id: string; token: string };

async function routeApi(page: Page) {
  if (API === "http://localhost:8787") return;
  await page.route(/^http:\/\/localhost:8787\//, async (route) => {
    const url = route.request().url().replace(/^http:\/\/localhost:8787/, API);
    try {
      const body = route.request().postDataBuffer();
      await route.fulfill({ response: await route.fetch(body ? { url, postData: body } : { url }) });
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
}

// POST /v1/auth/guest allows 10 logins per 60 s per IP: keep new players 6.5 s apart.
let lastLogin = 0;
async function paceLogin() {
  const wait = lastLogin + 6500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastLogin = Date.now();
}

async function openPlayer(context: BrowserContext, query = ""): Promise<Player> {
  await paceLogin();
  const page = await context.newPage();
  const logs: string[] = [];
  page.on("console", (m) => {
    const t = m.text().split("\n")[0]!.trim(); // Unity adds a line break (and sometimes a stack) after the message
    if (/^\[(Relay|Skin|Embedded)\]/.test(t)) logs.push(t);
  });
  await page.addInitScript(() => {
    window.__BK_BRIDGE_LOG__ = [];
  });
  await routeApi(page);
  await page.goto(`./${query}#/play/online`);
  await expect(page.getByTestId("create-room")).not.toHaveAttribute("aria-disabled", { timeout: UNITY_READY });
  const token = await page.evaluate(() => (JSON.parse(localStorage.getItem("bk_token") ?? "{}") as { accessToken?: string }).accessToken ?? "");
  const me = await page.request.get(`${API}/v1/me`, { headers: { Authorization: `Bearer ${token}` } });
  const id = ((await me.json()) as { id: string }).id;
  return { page, logs, id, token };
}

async function buyAndEquip(request: APIRequestContext, p: Player, skin: string) {
  const auth = { Authorization: `Bearer ${p.token}` };
  const buy = await request.post(`${API}/v1/shop/purchases`, { headers: auth, data: { skinKey: skin, expectedPrice: 60, idempotencyKey: crypto.randomUUID() } });
  expect(buy.status(), await buy.text()).toBe(201);
  const eq = await request.patch(`${API}/v1/me/equipped-skin`, { headers: auth, data: { skinKey: skin } });
  expect(eq.status(), await eq.text()).toBe(200);
  return ((await buy.json()) as { purchaseId: string }).purchaseId;
}

/** A creates a 1v1 room, B joins with the code shown in A's overlay; both reach the match. Returns the code. */
async function playRoom(a: Player, b: Player) {
  await a.page.getByTestId("create-room").click();
  const display = a.page.getByTestId("room-code-display").first();
  await expect(display).toHaveText(/^[A-HJKMNP-Z2-9]{6}$/, { timeout: 60_000 });
  const code = (await display.textContent())!.trim();
  await expect(b.page.getByTestId("join-room")).toBeVisible();
  await b.page.getByTestId("room-code").fill(code);
  await b.page.getByTestId("join-room").click();
  await expect(a.page.getByTestId("unity-layer")).toHaveClass(/visible/, { timeout: 90_000 });
  await expect(b.page.getByTestId("unity-layer")).toHaveClass(/visible/, { timeout: 90_000 });
  await expect.poll(() => a.logs.some((l) => l.includes("[Relay] Match") && l.includes("began")), { timeout: 30_000 }).toBe(true);
  return code;
}

/** Unity's own "Rời trận?" dialog: Esc opens it, Right selects Leave, Enter confirms. */
async function leaveMatch(p: Player) {
  await p.page.keyboard.press("Escape");
  await p.page.waitForTimeout(400);
  await p.page.keyboard.press("ArrowRight");
  await p.page.waitForTimeout(200);
  await p.page.keyboard.press("Enter");
}

async function relayMatches(request: APIRequestContext) {
  const r = await request.get(`${API}/admin/api/matches?kind=relay&limit=50`, { headers: ADMIN });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { items: { matchId: string; kind: string; durationMs: number; participants: { playerId: string; result: string; disconnected: boolean; team: number }[] }[] }).items;
}

async function points(request: APIRequestContext, id: string) {
  const r = await request.get(`${API}/admin/api/players/${id}`, { headers: ADMIN });
  return ((await r.json()) as { points: number }).points;
}

const matchIdOf = (logs: string[]) => {
  const line = [...logs].reverse().find((l) => /\[Relay\] Match [0-9a-f-]{36} began/.test(l));
  return line ? /([0-9a-f-]{36})/.exec(line)![1] : null;
};

test("relay rooms: create, join by code, API skins, result once, revoke, joiner leave = loss, host leave = no result", async ({ browser, request }, info) => {
  test.skip(info.project.name !== "real-chromium", "Chromium only (WebKit drops routed XHR bodies)");
  test.setTimeout(900_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ids: Record<string, string> = {};
  const players: Record<string, Player> = {};
  try {
    // ---------- a) ----------
    const a = (players.a = await openPlayer(ctxA, "?devForceEnd=35"));
    const b = (players.b = await openPlayer(ctxB));
    await buyAndEquip(request, a, "pig");
    const goblin = await buyAndEquip(request, b, "goblin");
    // B spent its starter points on goblin: give it some so its losses show (a loss is floored at 0)
    const adjust = await request.post(`${API}/admin/api/players/${b.id}/points`, { headers: ADMIN, data: { delta: 100, reason: "e2e: room losses visible" } });
    expect(adjust.status(), await adjust.text()).toBe(200);
    const before = await relayMatches(request);
    const [a0, b0] = [await points(request, a.id), await points(request, b.id)];
    await playRoom(a, b);
    // the host writes PlayerNetSync.skinKey from /start; each side renders the other's API skin
    await expect.poll(() => a.logs.includes("[Relay] Player4 skin goblin")).toBe(true);
    expect(a.logs).toContain("[Relay] Player1 skin pig");
    await expect.poll(() => a.logs.includes("[Skin] Player4 -> goblin"), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => b.logs.includes("[Skin] Player1 -> pig"), { timeout: 15_000 }).toBe(true);
    ids.a = matchIdOf(a.logs)!;
    await expect(a.page.getByTestId("result")).toBeVisible({ timeout: 120_000 });
    await expect(b.page.getByTestId("result")).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await relayMatches(request)).length, { timeout: 30_000 }).toBe(before.length + 1);
    const recorded = (await relayMatches(request)).filter((m) => m.matchId === ids.a);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.durationMs).toBeGreaterThanOrEqual(30_000);
    expect(recorded[0]!.participants.map((p) => [p.playerId, p.team, p.result]).sort()).toEqual(
      [[a.id, 1, "win"], [b.id, 2, "loss"]].sort(),
    );
    expect(await points(request, a.id)).toBe(a0 + 20);
    expect(await points(request, b.id)).toBe(b0 - 10);
    await expect(a.page.getByTestId("points-line")).toHaveAttribute("data-delta", "20", { timeout: 20_000 });
    await expect(b.page.getByTestId("points-line")).toHaveAttribute("data-delta", "-10", { timeout: 20_000 });
    await a.page.close();

    // ---------- b) + c) ----------
    const revoke = await request.post(`${API}/admin/api/purchases/${goblin}/revoke`, { headers: ADMIN, data: { reason: "e2e revoke", returnToStock: false } });
    expect(revoke.status(), await revoke.text()).toBe(200);
    const a2 = (players.a2 = await openPlayer(ctxA));
    expect(a2.id).toBe(a.id);
    await b.page.getByTestId("result-menu").click();
    await b.page.getByTestId("menu-online").click();
    b.logs.length = 0;
    const b1 = await points(request, b.id);
    await playRoom(a2, b);
    await expect.poll(() => a2.logs.some((l) => l.startsWith("[Relay] Player4 skin "))).toBe(true);
    expect(a2.logs).toContain("[Relay] Player4 skin human");
    expect(a2.logs).not.toContain("[Relay] Player4 skin goblin");
    ids.c = matchIdOf(a2.logs)!;
    await b.page.waitForTimeout(36_000); // past the 30 s minimum (server clock from /start)
    await leaveMatch(b);
    await expect(b.page.getByTestId("result")).toBeVisible({ timeout: 30_000 });
    await expect(a2.page.getByTestId("result")).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await relayMatches(request)).some((m) => m.matchId === ids.c), { timeout: 30_000 }).toBe(true);
    const left = (await relayMatches(request)).find((m) => m.matchId === ids.c)!;
    expect(left.participants.find((p) => p.playerId === b.id)).toMatchObject({ result: "loss", disconnected: true });
    expect(left.participants.find((p) => p.playerId === a.id)).toMatchObject({ result: "win", disconnected: false });
    expect(await points(request, b.id)).toBe(b1 - 10);

    // ---------- d) ----------
    await a2.page.getByTestId("result-menu").click();
    await a2.page.getByTestId("menu-online").click();
    await b.page.getByTestId("result-menu").click();
    await b.page.getByTestId("menu-online").click();
    const countBefore = (await relayMatches(request)).length;
    const [a3, b3] = [await points(request, a.id), await points(request, b.id)];
    const codeD = await playRoom(a2, b);
    ids.d = matchIdOf(a2.logs)!;
    await a2.page.waitForTimeout(8_000);
    await leaveMatch(a2);
    await expect(b.page.getByTestId("online-error")).toHaveAttribute("data-code", "HOST_LEFT", { timeout: 30_000 });
    await expect(b.page.getByTestId("online-error")).toHaveText("Chủ phòng đã rời trận. Trận này không tính điểm.");
    expect((await bridgeLog(b.page)).filter((e) => e.msg.type === "matchEnded").length).toBe(2); // a) and c) only
    await b.page.waitForTimeout(10_000);
    expect((await relayMatches(request)).length).toBe(countBefore);
    expect([await points(request, a.id), await points(request, b.id)]).toEqual([a3, b3]);
    // the host's leave closed the room: its code no longer joins
    const rejoin = await request.post(`${API}/v1/relay-rooms/join`, { headers: { Authorization: `Bearer ${b.token}` }, data: { roomCode: codeD } });
    expect(rejoin.status()).toBe(404);
    console.log(`relay e2e: match a ${ids.a}, match c ${ids.c}, match d ${ids.d} (not recorded)`);
  } finally {
    for (const [k, p] of Object.entries(players)) console.log(`--- ${k} Unity log (last 40):\n${p.logs.slice(-40).join("\n")}`);
    await ctxA.close();
    await ctxB.close();
  }
});
