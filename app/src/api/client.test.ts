import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, NETWORK_ERROR } from "./client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("api client", () => {
  it("sends the bearer token and parses JSON", async () => {
    const fetchMock = vi.fn(async () => json(200, { id: "p" }));
    const api = createApiClient({ baseUrl: "http://api", fetch: fetchMock as typeof fetch, getToken: () => "T1", relogin: async () => "T2" });
    await expect(api.me()).resolves.toEqual({ id: "p" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api/v1/me");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer T1");
  });

  it("re-logins once on 401 and retries with the new token", async () => {
    let token = "OLD";
    const seen: string[] = [];
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      seen.push(auth);
      return auth === "Bearer NEW" ? json(200, { ok: true }) : json(401, { error: { code: "UNAUTHORIZED", message: "expired" } });
    });
    const relogin = vi.fn(async () => {
      token = "NEW";
      return token;
    });
    const api = createApiClient({ baseUrl: "", fetch: fetchMock as unknown as typeof fetch, getToken: () => token, relogin });
    await expect(api.request("/v1/me")).resolves.toEqual({ ok: true });
    expect(relogin).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["Bearer OLD", "Bearer NEW"]);
  });

  it("gives up after one re-login (no loop)", async () => {
    const fetchMock = vi.fn(async () => json(401, { error: { code: "UNAUTHORIZED", message: "no" } }));
    const relogin = vi.fn(async () => "X");
    const api = createApiClient({ baseUrl: "", fetch: fetchMock as typeof fetch, getToken: () => "T", relogin });
    await expect(api.me()).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(relogin).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not send a token or re-login for guest login", async () => {
    const fetchMock = vi.fn(async () => json(429, { error: { code: "RATE_LIMITED", message: "slow down" } }));
    const relogin = vi.fn(async () => "X");
    const api = createApiClient({ baseUrl: "", fetch: fetchMock as typeof fetch, getToken: () => "T", relogin });
    await expect(api.guestLogin("bk-xxxxxxxx")).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(relogin).not.toHaveBeenCalled();
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.body).toBe('{"deviceId":"bk-xxxxxxxx"}');
  });

  it("maps a failed fetch to a NETWORK error with status 0", async () => {
    const api = createApiClient({ baseUrl: "", fetch: (async () => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch, getToken: () => "T", relogin: async () => "T" });
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: NETWORK_ERROR });
  });

  it("logs in first when there is no token yet", async () => {
    const fetchMock = vi.fn(async () => json(200, {}));
    const relogin = vi.fn(async () => "FRESH");
    const api = createApiClient({ baseUrl: "", fetch: fetchMock as typeof fetch, getToken: () => null, relogin });
    await api.me();
    expect(relogin).toHaveBeenCalledTimes(1);
    expect(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe("Bearer FRESH");
  });
});
