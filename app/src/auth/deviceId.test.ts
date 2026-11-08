import { describe, expect, it } from "vitest";
import { decideDeviceId, isValidDeviceId, newDeviceId, readStoredSession } from "./deviceId";

const LEGACY = "bk-f77dc74e0123456789abcdef01234567";
const STORED = "bk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("device id rules", () => {
  it("new ids use Unity's format: bk- + 32 hex", () => {
    const id = newDeviceId();
    expect(id).toMatch(/^bk-[0-9a-f]{32}$/);
    expect(newDeviceId((b) => b.fill(255))).toBe("bk-" + "ff".repeat(16));
  });

  it("validates like the API: 8-128 printable ASCII without spaces", () => {
    expect(isValidDeviceId("abcdefgh")).toBe(true);
    expect(isValidDeviceId("abc")).toBe(false);
    expect(isValidDeviceId("has space1")).toBe(false);
    expect(isValidDeviceId("x".repeat(129))).toBe(false);
    expect(isValidDeviceId("ñññññññññ")).toBe(false);
    expect(isValidDeviceId(null)).toBe(false);
  });

  it("first visit waits for Unity's ready", () => {
    expect(decideDeviceId(null, { state: "loading" })).toEqual({ action: "wait" });
  });

  it("adopts a valid legacyDeviceId from ready", () => {
    expect(decideDeviceId(null, { state: "ready", legacyDeviceId: LEGACY })).toEqual({ action: "adopt", id: LEGACY });
  });

  it("creates a new id when ready has no (valid) legacy id", () => {
    expect(decideDeviceId(null, { state: "ready", legacyDeviceId: null }, () => "bk-new-0000000000")).toEqual({ action: "create", id: "bk-new-0000000000" });
    expect(decideDeviceId(null, { state: "ready", legacyDeviceId: "bad id" }, () => "bk-new-0000000000").action).toBe("create");
  });

  it("never overwrites a stored id, not even with a later legacy id, and does not wait for Unity", () => {
    expect(decideDeviceId(STORED, { state: "loading" })).toEqual({ action: "use", id: STORED });
    expect(decideDeviceId(STORED, { state: "ready", legacyDeviceId: LEGACY })).toEqual({ action: "use", id: STORED });
  });

  it("keeps waiting on a first visit when Unity failed (no new id that would orphan the old account)", () => {
    expect(decideDeviceId(null, { state: "failed" })).toEqual({ action: "wait" });
  });

  it("treats an invalid stored id as missing", () => {
    expect(decideDeviceId("short", { state: "loading" })).toEqual({ action: "wait" });
  });
});

describe("stored session", () => {
  const now = Date.parse("2026-11-08T00:00:00Z");
  const good = { deviceId: STORED, accessToken: "tok", expiresAt: "2026-11-20T00:00:00Z", player: { id: "p", displayName: "N" } };
  it("reuses an unexpired token for the same device id", () => {
    expect(readStoredSession(JSON.stringify(good), STORED, now)).toEqual(good);
  });
  it("ignores other device ids, expired or nearly expired tokens and junk", () => {
    expect(readStoredSession(JSON.stringify(good), LEGACY, now)).toBeNull();
    expect(readStoredSession(JSON.stringify({ ...good, expiresAt: "2026-11-08T00:01:00Z" }), STORED, now)).toBeNull();
    expect(readStoredSession("{", STORED, now)).toBeNull();
    expect(readStoredSession(null, STORED, now)).toBeNull();
  });
});
