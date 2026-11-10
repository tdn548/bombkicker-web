import { describe, expect, it } from "vitest";
import { applyStatus, mapOnlineError, overlayView, startState } from "./onlineFlow";

describe("Searching overlay states (ux-spec 9.2)", () => {
  it("quick match: searching -> starting -> waiting -> loading", () => {
    let s = startState({ kind: "quick", mode: "1v1" });
    expect(overlayView(s)).toMatchObject({ title: "online.searching", buttons: ["cancel"], cancelNote: false });
    s = applyStatus(s, { type: "status", phase: "starting" });
    expect(overlayView(s)).toMatchObject({ title: "online.starting", body: "online.startingBody" });
    s = applyStatus(s, { type: "status", phase: "waiting", humans: 1, capacity: 2, seconds: 20 });
    expect(overlayView(s)).toMatchObject({ title: "online.quickWaiting", body: "online.quickWaitingBody", countdown: true, buttons: ["cancel"] });
    s = applyStatus(s, { type: "status", phase: "loading" });
    expect(overlayView(s)).toMatchObject({ title: "online.loading", buttons: [] });
  });

  it("create room: creating, then the code from status.roomCode with copy and leave", () => {
    let s = startState({ kind: "createRoom", mode: "2v2" });
    expect(overlayView(s)).toMatchObject({ title: "online.creating", buttons: ["cancel"], cancelNote: true });
    s = applyStatus(s, { type: "status", phase: "starting", roomCode: "K7M2QX", mode: "2v2" });
    expect(s.roomCode).toBe("K7M2QX");
    expect(overlayView(s)).toMatchObject({ title: "online.roomReady", body: "online.roomReadyBody", buttons: ["copy", "leaveRoom"] });
    s = applyStatus(s, { type: "status", phase: "waiting", roomCode: "K7M2QX", humans: 1, capacity: 4, seconds: 90 });
    expect(overlayView(s)).toMatchObject({ title: "online.roomWaiting", buttons: ["copy", "leaveRoom"], countdown: true });
    // the code stays even if a later status omits it
    s = applyStatus(s, { type: "status", phase: "connecting" });
    expect(s.roomCode).toBe("K7M2QX");
    expect(overlayView(s)).toMatchObject({ title: "online.connecting", codeLine: true, buttons: ["copy", "leaveRoom"] });
  });

  it("join room: joining with the typed code, then the room lobby", () => {
    let s = startState({ kind: "joinRoom", roomCode: "K7M2QX" });
    expect(overlayView(s)).toMatchObject({ title: "online.joining", buttons: ["cancel"] });
    s = applyStatus(s, { type: "status", phase: "waiting", roomCode: "K7M2QX", humans: 2, capacity: 4, seconds: 50 });
    expect(overlayView(s)).toMatchObject({ title: "online.roomWaiting" });
  });

  it("relay room (D5b): waiting without seconds shows the friends copy, no countdown", () => {
    let s = startState({ kind: "createRoom", mode: "1v1" });
    s = applyStatus(s, { type: "status", phase: "searching", mode: "1v1" });
    expect(overlayView(s)).toMatchObject({ title: "online.creating", buttons: ["cancel"] });
    s = applyStatus(s, { type: "status", phase: "waiting", roomCode: "K7M2QX", mode: "1v1", humans: 1, capacity: 2 });
    expect(overlayView(s)).toEqual({
      title: "online.roomWaiting",
      body: "online.roomWaitingFriendsBody",
      codeLine: false,
      buttons: ["copy", "leaveRoom"],
      cancelNote: true,
      countdown: false,
    });
    s = applyStatus(s, { type: "status", phase: "loading", roomCode: "K7M2QX" });
    expect(overlayView(s)).toMatchObject({ title: "online.loading", buttons: [] });
    let j = startState({ kind: "joinRoom", roomCode: "K7M2QX" });
    j = applyStatus(j, { type: "status", phase: "connecting", roomCode: "K7M2QX" });
    expect(overlayView(j)).toMatchObject({ title: "online.connecting", codeLine: true, buttons: ["cancel"] });
    j = applyStatus(j, { type: "status", phase: "waiting", roomCode: "K7M2QX", humans: 2, capacity: 4 });
    expect(overlayView(j)).toMatchObject({ title: "online.roomWaiting", body: "online.roomWaitingFriendsBody", countdown: false });
  });

  it("an error status opens the error with the mapped copy", () => {
    const s = applyStatus(startState({ kind: "joinRoom", roomCode: "K7M2QX" }), { type: "status", phase: "error", code: "ROOM_FULL" });
    expect(s.error).toEqual({ code: "ROOM_FULL", key: "err.room.full", actions: ["close"] });
  });
});

describe("online errors (ux-spec 9.3)", () => {
  it.each([
    ["SERVERS_FULL", "err.online.busy", ["retry", "playOffline"]],
    ["SERVER_START_FAILED", "err.online.startFailed", ["retry", "close"]],
    ["MODE_UNAVAILABLE", "err.online.mode", ["close"]],
    ["ROOM_NOT_FOUND", "err.room.notFound", ["editCode", "close"]],
    ["ROOM_FULL", "err.room.full", ["close"]],
    ["SERVER_GONE", "err.room.started", ["close"]],
    ["ROOM_STARTED", "err.room.started", ["close"]],
    ["ROOM_CLOSED", "err.room.closed", ["close"]],
    ["HOST_LEFT", "err.room.hostLeft", ["close"]],
    ["RELAY_UNAVAILABLE", "err.room.relay", ["retry", "close"]],
    ["MODE_MISMATCH", "err.room.mode", ["close"]],
    ["SOMETHING_NEW", "err.online.network", ["retry", "close"]],
  ])("%s -> %s", (code, key, actions) => {
    expect(mapOnlineError(code)).toMatchObject({ key, actions });
  });
  it("maps the server's disconnect reasons", () => {
    expect(mapOnlineError(undefined, "Game version mismatch, reload the game").key).toBe("err.online.version");
    expect(mapOnlineError("DISCONNECTED", "Server busy, try again soon").key).toBe("err.online.busy");
    expect(mapOnlineError(undefined).key).toBe("err.online.network");
  });
});
