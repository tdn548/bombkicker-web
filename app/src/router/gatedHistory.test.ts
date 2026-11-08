import { beforeEach, describe, expect, it } from "vitest";
import { captureBootRoute, createGatedHistory } from "./gatedHistory";

describe("gated hash history (SS-1 fix)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/bombkicker-web/");
  });

  it("captureBootRoute removes the hash route from the URL and returns it", () => {
    window.history.replaceState(null, "", "/bombkicker-web/?utm=x#/shop?skin=pig");
    expect(captureBootRoute("hash", "/bombkicker-web/")).toBe("/shop?skin=pig");
    expect(window.location.href).toBe("http://localhost:3000/bombkicker-web/?utm=x");
  });

  it("no hash -> '/' and the URL is untouched", () => {
    expect(captureBootRoute("hash", "/bombkicker-web/")).toBe("/");
    expect(window.location.pathname).toBe("/bombkicker-web/");
  });

  it("navigation before unlock never writes the URL; unlock writes the current route", () => {
    const h = createGatedHistory("hash", "/shop", "/bombkicker-web/");
    const seen: string[] = [];
    h.listen(({ location }) => seen.push(location.pathname));
    expect(h.location.pathname).toBe("/shop");
    h.push("/play/online");
    h.push("/result");
    h.go(-1);
    expect(window.location.hash).toBe("");
    expect(h.createHref("/play/offline")).toBe("#/play/offline");
    h.unlock();
    expect(window.location.hash).toBe("#/play/online");
    expect(h.location.pathname).toBe("/play/online");
    h.push("/profile");
    expect(window.location.hash).toBe("#/profile");
    expect(seen).toEqual(["/play/online", "/result", "/play/online", "/profile"]);
  });

  it("unlock at '/' leaves the URL clean", () => {
    const h = createGatedHistory("hash", "/", "/bombkicker-web/");
    h.unlock();
    h.unlock();
    expect(window.location.href).toBe("http://localhost:3000/bombkicker-web/");
    expect(h.unlocked).toBe(true);
  });
});
