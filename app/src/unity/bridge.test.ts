import { describe, expect, it, vi } from "vitest";
import { BridgeQueue, encodeToUnity, isValidRoomCode, normalizeRoomCodeInput, parseFromUnity, redact, type ToUnity } from "./bridge";

describe("encodeToUnity", () => {
  it("puts type and v first and keeps the fields", () => {
    expect(encodeToUnity({ type: "startOffline", mode: "1v1", opponent: "bots", map: "random" })).toBe(
      '{"type":"startOffline","v":1,"mode":"1v1","opponent":"bots","map":"random"}',
    );
    expect(encodeToUnity({ type: "cancelOnline" })).toBe('{"type":"cancelOnline","v":1}');
    expect(JSON.parse(encodeToUnity({ type: "startOnline", kind: "joinRoom", roomCode: "K7M2QX" }))).toEqual({
      type: "startOnline",
      v: 1,
      kind: "joinRoom",
      roomCode: "K7M2QX",
    });
  });

  it("init carries lang, player, equipped skin and catalog", () => {
    const msg = JSON.parse(
      encodeToUnity({ type: "init", accessToken: "t", expiresAt: "2026-11-22T00:00:00Z", player: { id: "p", displayName: "N" }, equippedSkin: null, catalog: [], lang: "vi" }),
    );
    expect(msg).toEqual({ type: "init", v: 1, accessToken: "t", expiresAt: "2026-11-22T00:00:00Z", player: { id: "p", displayName: "N" }, equippedSkin: null, catalog: [], lang: "vi" });
  });

  it("redact hides the token", () => {
    expect(redact({ type: "setToken", accessToken: "secret.jwt", expiresAt: "x" })).not.toContain("secret");
  });
});

describe("parseFromUnity", () => {
  it("parses every Unity -> React type", () => {
    expect(parseFromUnity('{"type":"ready","v":1,"buildVersion":"abc","legacyDeviceId":"bk-0123456789abcdef0123456789abcdef"}')).toEqual({
      type: "ready",
      buildVersion: "abc",
      legacyDeviceId: "bk-0123456789abcdef0123456789abcdef",
    });
    expect(parseFromUnity('{"type":"ready","v":1,"buildVersion":"abc","legacyDeviceId":null}')).toEqual({ type: "ready", buildVersion: "abc", legacyDeviceId: null });
    expect(parseFromUnity('{"type":"status","v":1,"phase":"waiting","roomCode":"K7M2QX","mode":"2v2","humans":1,"capacity":4,"seconds":90}')).toEqual({
      type: "status",
      phase: "waiting",
      roomCode: "K7M2QX",
      mode: "2v2",
      humans: 1,
      capacity: 4,
      seconds: 90,
    });
    expect(parseFromUnity('{"type":"status","v":1,"phase":"error","code":"ROOM_FULL","message":"Room is full"}')).toEqual({
      type: "status",
      phase: "error",
      code: "ROOM_FULL",
      message: "Room is full",
    });
    expect(parseFromUnity('{"type":"matchEnded","v":1,"kind":"room","mode":"1v1","result":"left","recorded":true}')).toEqual({
      type: "matchEnded",
      kind: "room",
      mode: "1v1",
      result: "left",
      recorded: true,
    });
    expect(parseFromUnity('{"type":"returnedToMenu","v":1}')).toEqual({ type: "returnedToMenu" });
    expect(parseFromUnity('{"type":"authExpired","v":1}')).toEqual({ type: "authExpired" });
    expect(parseFromUnity('{"type":"error","v":1,"code":"BUSY","message":"x"}')).toEqual({ type: "error", code: "BUSY", message: "x" });
  });

  it("ignores bad JSON, unknown types, other versions and missing required fields", () => {
    for (const bad of ["", "nope", "[]", "null", '{"v":1}', '{"type":"dance","v":1}', '{"type":"ready","v":2}', '{"type":"status","v":1,"phase":"flying"}', '{"type":"matchEnded","v":1,"kind":"online","mode":"1v1"}']) {
      expect(parseFromUnity(bad), bad).toBeNull();
    }
    expect(parseFromUnity(42)).toBeNull();
  });

  it("drops optional fields with the wrong type", () => {
    expect(parseFromUnity('{"type":"status","phase":"waiting","humans":"1","seconds":-1,"mode":"3v3"}')).toEqual({ type: "status", phase: "waiting" });
  });
});

describe("BridgeQueue", () => {
  it("holds messages until ready, then delivers them in order", () => {
    const deliver = vi.fn();
    const q = new BridgeQueue(deliver);
    const init: ToUnity = { type: "init", accessToken: "a", expiresAt: "e", player: { id: "p", displayName: "n" }, equippedSkin: null, catalog: [], lang: "vi" };
    q.send(init);
    q.send({ type: "setLang", lang: "en" });
    expect(deliver).not.toHaveBeenCalled();
    q.markReady();
    expect(deliver.mock.calls.map((c) => (c[1] as ToUnity).type)).toEqual(["init", "setLang"]);
    q.send({ type: "cancelOnline" });
    expect(deliver).toHaveBeenLastCalledWith('{"type":"cancelOnline","v":1}', { type: "cancelOnline" });
  });

  it("keeps only the newest state message of a kind while waiting", () => {
    const deliver = vi.fn();
    const q = new BridgeQueue(deliver);
    q.send({ type: "setToken", accessToken: "old", expiresAt: "1" });
    q.send({ type: "setToken", accessToken: "new", expiresAt: "2" });
    expect(q.pending).toHaveLength(1);
    q.markReady();
    q.markReady();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(JSON.parse(deliver.mock.calls[0][0] as string).accessToken).toBe("new");
  });
});

describe("room code input", () => {
  it("uppercases, strips spaces and dashes, caps at 6", () => {
    expect(normalizeRoomCodeInput(" k7m-2qx ")).toEqual({ code: "K7M2QX", badChar: false });
    expect(normalizeRoomCodeInput("abcdefgh")).toEqual({ code: "ABCDEF", badChar: false });
  });
  it("flags I, L, O, 0 and 1", () => {
    for (const c of ["i", "L", "o", "0", "1"]) expect(normalizeRoomCodeInput(`AB${c}`).badChar, c).toBe(true);
  });
  it("accepts only 6 characters from the alphabet", () => {
    expect(isValidRoomCode("K7M2QX")).toBe(true);
    expect(isValidRoomCode("K7M2Q")).toBe(false);
    expect(isValidRoomCode("K7M2Q0")).toBe(false);
    expect(isValidRoomCode("k7m2qx")).toBe(false);
  });
});
