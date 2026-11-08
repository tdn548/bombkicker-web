import { describe, expect, it, vi } from "vitest";
import { AuthStore } from "./authStore";
import { DEVICE_ID_KEY, TOKEN_KEY } from "./deviceId";

const LEGACY = "bk-f77dc74e0123456789abcdef01234567";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeApi() {
  let n = 0;
  const logins: string[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/v1/auth/guest")) {
      const { deviceId } = JSON.parse(init.body as string) as { deviceId: string };
      logins.push(deviceId);
      n++;
      return json(200, { accessToken: `tok${n}`, expiresAt: "2099-01-01T00:00:00.000Z", player: { id: "p1", displayName: "Blue Rocket 42" } });
    }
    const auth = (init.headers as Record<string, string>).Authorization;
    if (auth === "Bearer expired") return json(401, { error: { code: "UNAUTHORIZED", message: "expired" } });
    return json(200, { id: "p1" });
  });
  return { fetch: fetchMock as unknown as typeof fetch, logins, fetchMock };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("AuthStore", () => {
  it("first visit: waits for Unity, adopts legacyDeviceId once, logs in, stores token", async () => {
    const api = fakeApi();
    const store = new AuthStore({ baseUrl: "", fetch: api.fetch, storage: localStorage });
    store.start();
    store.onUnityBoot({ state: "loading" });
    expect(store.getSnapshot()).toMatchObject({ status: "waitingUnity", deviceId: null });
    expect(api.logins).toEqual([]);
    store.onUnityBoot({ state: "ready", legacyDeviceId: LEGACY });
    await flush();
    expect(api.logins).toEqual([LEGACY]);
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(LEGACY);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", deviceIdSource: "adopted", session: { accessToken: "tok1" } });
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY)!)).toMatchObject({ deviceId: LEGACY, accessToken: "tok1" });
    // a later ready with another legacy id changes nothing
    store.onUnityBoot({ state: "ready", legacyDeviceId: "bk-99999999999999999999999999999999" });
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(LEGACY);
  });

  it("first visit without a legacy id creates bk- + 32 hex", async () => {
    const api = fakeApi();
    const store = new AuthStore({ baseUrl: "", fetch: api.fetch, storage: localStorage });
    store.onUnityBoot({ state: "ready", legacyDeviceId: null });
    await flush();
    expect(api.logins[0]).toMatch(/^bk-[0-9a-f]{32}$/);
    expect(store.getSnapshot().deviceIdSource).toBe("created");
  });

  it("return visit: logs in with the stored id without waiting for Unity; reuses an unexpired stored token", async () => {
    localStorage.setItem(DEVICE_ID_KEY, LEGACY);
    const api = fakeApi();
    const store = new AuthStore({ baseUrl: "", fetch: api.fetch, storage: localStorage });
    store.start();
    await flush();
    expect(api.logins).toEqual([LEGACY]);
    const again = new AuthStore({ baseUrl: "", fetch: api.fetch, storage: localStorage });
    again.start();
    expect(again.getSnapshot()).toMatchObject({ status: "ready", session: { accessToken: "tok1" } });
    expect(api.logins).toHaveLength(1);
  });

  it("re-login on 401 (stale stored token) and parallel relogins share one request", async () => {
    localStorage.setItem(DEVICE_ID_KEY, LEGACY);
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ deviceId: LEGACY, accessToken: "expired", expiresAt: "2099-01-01T00:00:00Z", player: { id: "p1", displayName: "N" } }));
    const api = fakeApi();
    const store = new AuthStore({ baseUrl: "", fetch: api.fetch, storage: localStorage });
    store.start();
    expect(store.getSnapshot().session?.accessToken).toBe("expired");
    await Promise.all([store.api.me(), store.api.me(), store.relogin()]);
    expect(api.logins).toHaveLength(1);
    expect(store.getSnapshot().session?.accessToken).toBe("tok1");
  });

  it("Unity authExpired path: relogin gives a new token", async () => {
    localStorage.setItem(DEVICE_ID_KEY, LEGACY);
    const api = fakeApi();
    const store = new AuthStore({ baseUrl: "", fetch: api.fetch, storage: localStorage });
    store.start();
    await flush();
    await expect(store.relogin()).resolves.toBe("tok2");
  });

  it("a failed first login shows the error state; retry recovers", async () => {
    localStorage.setItem(DEVICE_ID_KEY, LEGACY);
    let fail = true;
    const f = vi.fn(async () =>
      fail ? Promise.reject(new TypeError("offline")) : json(200, { accessToken: "t", expiresAt: "2099-01-01T00:00:00Z", player: { id: "p", displayName: "N" } }),
    );
    const store = new AuthStore({ baseUrl: "", fetch: f as unknown as typeof fetch, storage: localStorage });
    store.start();
    await flush();
    expect(store.getSnapshot().status).toBe("error");
    fail = false;
    store.retry();
    await flush();
    expect(store.getSnapshot().status).toBe("ready");
  });
});
