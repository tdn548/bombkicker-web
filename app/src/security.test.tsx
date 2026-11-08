// SS-7 recheck: CSP builder, mock switch, frame guard, bridge log summary, and API text rendered as text.
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { createMockApi } from "./api/mock";
import { isMockMode } from "./config";
import { LOCAL_API_ORIGINS, PRODUCTION_API_URL, apiOrigins, buildCsp, cspMetaTag, gameServerSources, originOf } from "./csp";
import { isFramed, renderFramedNotice } from "./frameGuard";
import { createGatedHistory } from "./router/gatedHistory";
import { ignoredSummary, parseFromUnity } from "./unity/bridge";

describe("CSP (src/csp.ts)", () => {
  it("published build: production API only, Unity loader sources, no unsafe-inline / unsafe-eval", () => {
    const p = buildCsp(apiOrigins({}), gameServerSources({}));
    expect(p).toContain("script-src 'self' blob: 'wasm-unsafe-eval'");
    expect(p).toContain("worker-src 'self' blob:");
    // BUG-SS18-001: Unity's WebSocket to the Edgegap game server (wss://<id>.pr.edgegap.net:<dynamic port>)
    expect(p).toContain(`connect-src 'self' ${PRODUCTION_API_URL} wss://*.pr.edgegap.net:*;`);
    expect(p).toContain(`img-src 'self' data: blob: ${PRODUCTION_API_URL};`);
    expect(p).toContain("style-src 'self';");
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("base-uri 'none'");
    expect(p).not.toMatch(/'unsafe-inline'|'unsafe-eval'|localhost|127\.0\.0\.1|ws:/);
    // the only wildcards are the Edgegap subdomain and its port
    expect(p.replace("wss://*.pr.edgegap.net:*", "")).not.toContain("*");
    expect(buildCsp(apiOrigins({}))).toBe(p); // the default game servers are the production ones
  });
  it("game server WebSockets: Edgegap always; local hosts only for a local build (BK_CSP_LOCAL_API=1)", () => {
    expect(gameServerSources({})).toEqual(["wss://*.pr.edgegap.net:*"]);
    expect(gameServerSources({ BK_CSP_LOCAL_API: "true" })).toEqual(["wss://*.pr.edgegap.net:*"]);
    // VITE_API_URL alone (a dev .env.local) adds no WebSocket source
    expect(gameServerSources({ VITE_API_URL: "http://192.168.1.20:8787" })).toEqual(["wss://*.pr.edgegap.net:*"]);
    const local = ["wss://*.pr.edgegap.net:*", "ws://localhost:*", "wss://localhost:*", "ws://127.0.0.1:*", "wss://127.0.0.1:*"];
    expect(gameServerSources({ BK_CSP_LOCAL_API: "1" })).toEqual(local);
    expect(gameServerSources({ BK_CSP_LOCAL_API: "1", VITE_API_URL: "http://192.168.1.20:8787" })).toEqual([...local, "ws://192.168.1.20:*", "wss://192.168.1.20:*"]);
    expect(gameServerSources({ BK_CSP_LOCAL_API: "1", VITE_API_URL: "http://localhost:8787" })).toEqual(local);
    // a public or bad API host never gets a WebSocket source
    for (const other of ["https://api.example", "http://8.8.8.8:8787", "*", "javascript:alert(1)", "https://a.example; connect-src *"]) {
      expect(gameServerSources({ BK_CSP_LOCAL_API: "1", VITE_API_URL: other })).toEqual(local);
    }
    const p = buildCsp(apiOrigins({ BK_CSP_LOCAL_API: "1" }), gameServerSources({ BK_CSP_LOCAL_API: "1" }));
    expect(p).toContain(`connect-src 'self' ${PRODUCTION_API_URL} ${LOCAL_API_ORIGINS.join(" ")} ${local.join(" ")};`);
    expect(p).toContain(`img-src 'self' data: blob: ${PRODUCTION_API_URL} ${LOCAL_API_ORIGINS.join(" ")};`);
  });
  it("local test builds add only what is asked for", () => {
    expect(apiOrigins({ BK_CSP_LOCAL_API: "1" })).toEqual([PRODUCTION_API_URL, ...LOCAL_API_ORIGINS]);
    expect(apiOrigins({ BK_CSP_LOCAL_API: "true" })).toEqual([PRODUCTION_API_URL]);
    expect(apiOrigins({ VITE_API_URL: "http://192.168.1.20:8787/" })).toEqual([PRODUCTION_API_URL, "http://192.168.1.20:8787"]);
  });
  it("a bad VITE_API_URL cannot widen the policy", () => {
    for (const bad of ["*", "javascript:alert(1)", "data:text/html,x", "https://a.example; script-src *", "not a url", ""]) {
      expect(originOf(bad)).toBeNull();
      expect(apiOrigins({ VITE_API_URL: bad })).toEqual([PRODUCTION_API_URL]);
    }
    // a path or query is cut to the origin
    expect(originOf("https://api.example/x?y=';script-src *")).toBe("https://api.example");
  });
  it("meta tag escapes quotes", () => {
    expect(cspMetaTag(`a "b" & c`)).toBe('<meta http-equiv="Content-Security-Policy" content="a &quot;b&quot; &amp; c" />');
  });
});

describe("mock switch (SEC-011)", () => {
  it("?mock works on the dev server only; a published build ignores it", () => {
    expect(isMockMode("production", false, "?mock=1")).toBe(false);
    expect(isMockMode("production", false, "?mock")).toBe(false);
    expect(isMockMode("development", true, "?mock=1")).toBe(true);
    expect(isMockMode("development", true, "")).toBe(false);
    expect(isMockMode("mock", false, "")).toBe(true);
  });
});

describe("frame guard (SEC-012)", () => {
  it("framed when self is not top, or top cannot be read", () => {
    const w = {} as Window;
    expect(isFramed({ self: w, top: w } as unknown as Window)).toBe(false);
    expect(isFramed({ self: w, top: {} as Window } as unknown as Window)).toBe(true);
    const throwing = Object.defineProperty({ self: w }, "top", { get: () => { throw new Error("cross-origin"); } });
    expect(isFramed(throwing as unknown as Window)).toBe(true);
  });
  it("notice is a plain link to the site in a new tab", () => {
    const root = document.createElement("div");
    root.innerHTML = "<span>app</span>";
    renderFramedNotice(root, "https://tdn548.github.io/bombkicker-web/#/shop");
    const a = root.querySelector("a")!;
    expect(root.children).toHaveLength(1);
    expect(a.getAttribute("href")).toBe("https://tdn548.github.io/bombkicker-web/#/shop");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
  });
});

describe("bridge log summary", () => {
  it("never prints the message body (a ready with the wrong version carries the legacy device id)", () => {
    const json = JSON.stringify({ type: "ready", v: 9, legacyDeviceId: "bk-f77dc74e0123456789abcdef01234567" });
    expect(parseFromUnity(json)).toBeNull();
    const s = ignoredSummary(json);
    expect(s).toBe(`type=ready length=${json.length}`);
    expect(s).not.toContain("bk-f77");
    expect(ignoredSummary("{not json")).toBe("type=bad JSON length=9");
    expect(ignoredSummary(42)).toBe("non-string number");
    expect(ignoredSummary(JSON.stringify({ type: "x".repeat(100) }))).toContain(`type=${"x".repeat(32)} `);
  });
});

describe("API text is rendered as text", () => {
  it("an HTML skin name and display name show as literal text, no element is created", async () => {
    const DEVICE = "bk-0123456789abcdef0123456789abcdef";
    const EVIL = '<img src=x onerror="window.__pwned=1">';
    localStorage.setItem("bk_device_id", DEVICE);
    localStorage.setItem(
      "bk_mock_db",
      JSON.stringify({ players: [{ id: "11111111-1111-4111-8111-111111111111", deviceId: DEVICE, displayName: EVIL, points: 60, wins: 0, losses: 0, draws: 0, equipped: "human", owned: [] }] }),
    );
    window.__BK_MOCK__ = { loadMs: 20 };
    const api = createMockApi(localStorage, 0);
    const fetchImpl: typeof fetch = async (input, init) => {
      const res = await api.fetch(input, init);
      if (!String(input).endsWith("/v1/skins")) return res;
      const body = (await res.json()) as { items: { key: string; name: string }[] };
      for (const s of body.items) if (s.key === "pig") s.name = EVIL;
      return new Response(JSON.stringify(body), { status: res.status, headers: { "Content-Type": "application/json" } });
    };
    render(<App history={createGatedHistory("hash", "/shop", "/")} apiUrl="http://mock.local" fetchImpl={fetchImpl} mockUnity />);
    await waitFor(() => expect(screen.getByTestId("skin-card-pig").textContent).toContain(EVIL));
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });
  it("an HTML display name shows as literal text in the menu", async () => {
    const DEVICE = "bk-0123456789abcdef0123456789abcdef";
    const EVIL = '<b id="pwn">x</b>';
    localStorage.setItem("bk_device_id", DEVICE);
    localStorage.setItem(
      "bk_mock_db",
      JSON.stringify({ players: [{ id: "11111111-1111-4111-8111-111111111111", deviceId: DEVICE, displayName: EVIL, points: 60, wins: 0, losses: 0, draws: 0, equipped: "human", owned: [] }] }),
    );
    window.__BK_MOCK__ = { loadMs: 20 };
    const api = createMockApi(localStorage, 0);
    render(<App history={createGatedHistory("hash", "/", "/")} apiUrl="http://mock.local" fetchImpl={api.fetch} mockUnity />);
    await waitFor(() => expect(screen.getByTestId("player-name").textContent).toBe(EVIL));
    expect(document.getElementById("pwn")).toBeNull();
  });
});
