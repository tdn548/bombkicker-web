// Mock of the Unity side of the bridge (SS-8 is built in parallel). Speaks protocol v1 like WebBridge.cs:
// ready -> init/setToken -> startOffline/startOnline -> status phases -> matchEnded -> returnedToMenu.
// Test knobs on window.__BK_MOCK__ (all optional):
//   loadMs (1200), legacyDeviceId (null), result ("win"), matchMs (2500), recordDelayMs (1200),
//   failLoad (false), authExpiredOnStart (false), noRecord (false: online result never reaches the API),
//   syncStatus (true: answer startOnline with a status inside sendMessage, like the real Unity),
//   hostLeftAfterMs (rooms: the host leaves this long after inMatch -> status error HOST_LEFT, no matchEnded),
//   purchaseErrors / equipErrors / purchaseDelayMs (mock API, see src/api/mock.ts)
// Room codes for errors: AAAAAA ROOM_NOT_FOUND, FFFFFF ROOM_FULL, GGGGGG ROOM_STARTED, BBBBBB SERVERS_FULL,
// CCCCCC ROOM_CLOSED, RRRRRR RELAY_UNAVAILABLE.
// Rooms run on Unity Relay (D5b): waiting has no bot countdown (no seconds), the room starts when it is full.
import { createElement, useEffect, useState } from "react";
import { getMockApi } from "../api/mockSingleton";
import type { FromUnity, MatchKind, MatchResult } from "./bridge";

export interface MockKnobs {
  loadMs?: number;
  legacyDeviceId?: string | null;
  result?: MatchResult;
  matchMs?: number;
  recordDelayMs?: number;
  failLoad?: boolean;
  authExpiredOnStart?: boolean;
  noRecord?: boolean;
  syncStatus?: boolean;
  hostLeftAfterMs?: number;
  /** Mock API shop knobs (src/api/mock.ts): queues of error codes, one per request. */
  purchaseErrors?: string[];
  equipErrors?: string[];
  purchaseDelayMs?: number;
}

declare global {
  interface Window {
    __BK_MOCK__?: MockKnobs;
    /** Bridge log for tests: every message both ways (tokens redacted). */
    __BK_BRIDGE_LOG__?: { dir: "R->U" | "U->R"; msg: unknown }[];
  }
}

const knobs = (): MockKnobs => (typeof window !== "undefined" ? (window.__BK_MOCK__ ?? {}) : {});

type Scene = { kind: "idle" } | { kind: "match"; label: string; end: (r: MatchResult) => void };

export interface MockUnity {
  receive(json: string): void;
  start(io: { emit: (json: string) => void; progress: (p: number) => void }): () => void;
  onScene(listener: (s: Scene) => void): () => void;
}

const ROOM_ERRORS: Record<string, string> = {
  AAAAAA: "ROOM_NOT_FOUND",
  FFFFFF: "ROOM_FULL",
  GGGGGG: "ROOM_STARTED",
  BBBBBB: "SERVERS_FULL",
  CCCCCC: "ROOM_CLOSED",
  RRRRRR: "RELAY_UNAVAILABLE",
};

export function createMockUnity(): MockUnity {
  let emitJson: (json: string) => void = () => {};
  let token: string | null = null;
  // Player 1's skin in an offline match (setEquippedSkin, like SkinSelection.Equipped in Unity).
  let equipped = "human";
  let timers: ReturnType<typeof setTimeout>[] = [];
  let sceneListeners: ((s: Scene) => void)[] = [];
  let waitingForToken: (() => void) | null = null;

  const emit = (msg: FromUnity) => {
    emitJson(JSON.stringify({ ...msg, v: 1 }));
  };
  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const setScene = (s: Scene) => sceneListeners.forEach((l) => l(s));
  const toMenu = () => {
    setScene({ kind: "idle" });
    emit({ type: "returnedToMenu" });
  };

  const playMatch = (kind: MatchKind, mode: "1v1" | "2v2", label: string) => {
    let over = false;
    const end = (result: MatchResult) => {
      if (over) return;
      over = true;
      clear();
      const recorded = kind !== "offline";
      if (recorded && token && !knobs().noRecord) {
        const t = token;
        // The game server posts the match after the end (a leaver's match ends later, with a bot in the slot).
        const r = result === "left" ? "loss" : result;
        setTimeout(() => getMockApi().recordMatch(t, r), knobs().recordDelayMs ?? 1200);
      }
      emit({ type: "matchEnded", kind, mode, result, recorded });
      setTimeout(toMenu, 300);
    };
    setScene({ kind: "match", label, end });
    later(knobs().matchMs ?? 2500, () => end(knobs().result ?? "win"));
  };

  const withToken = (fn: () => void) => {
    if (knobs().authExpiredOnStart && !waitingForToken) {
      waitingForToken = fn;
      emit({ type: "authExpired" });
      return;
    }
    fn();
  };

  const online = (kind: "quick" | "createRoom" | "joinRoom", mode: "1v1" | "2v2", roomCode?: string) => {
    const capacity = mode === "1v1" ? 2 : 4;
    const matchKind: MatchKind = kind === "quick" ? "online" : "room";
    if (kind === "joinRoom" && roomCode && ROOM_ERRORS[roomCode]) {
      later(500, () => {
        emit({ type: "status", phase: "error", code: ROOM_ERRORS[roomCode], message: "mock error", roomCode });
        later(100, toMenu);
      });
      return;
    }
    const code = kind === "createRoom" ? "K7M2QX" : roomCode;
    const room = code ? { roomCode: code } : {};
    const fill = kind === "quick" ? 5000 : 8000;
    if (kind === "quick") {
      later(300, () => emit({ type: "status", phase: "searching", mode }));
      later(700, () => emit({ type: "status", phase: "starting", mode }));
      later(1500, () => emit({ type: "status", phase: "connecting", mode }));
      later(2000, () => emit({ type: "status", phase: "waiting", mode, humans: 1, capacity, seconds: 3 }));
    } else {
      // Relay room: API + Relay session (searching), connect to the host, wait until full (no seconds), start.
      later(300, () => emit({ type: "status", phase: "searching", mode, ...(kind === "joinRoom" ? room : {}) }));
      if (kind === "joinRoom") later(1200, () => emit({ type: "status", phase: "connecting", mode, ...room }));
      later(2000, () => emit({ type: "status", phase: "waiting", mode, humans: kind === "joinRoom" ? 2 : 1, capacity, ...room }));
      later(fill - 2000, () => emit({ type: "status", phase: "waiting", mode, humans: capacity, capacity, ...room }));
    }
    later(fill, () => emit({ type: "status", phase: "loading", mode, ...room }));
    later(fill + 700, () => {
      emit({ type: "status", phase: "inMatch", mode, ...room });
      playMatch(matchKind, mode, `${kind} ${mode}${code ? ` room ${code}` : ""}`);
      const hostLeft = knobs().hostLeftAfterMs;
      if (kind !== "quick" && hostLeft !== undefined) {
        later(hostLeft, () => {
          clear();
          emit({ type: "status", phase: "error", code: "HOST_LEFT", message: "mock host left", mode, ...room });
          later(100, toMenu);
        });
      }
    });
  };

  return {
    receive(json) {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(json) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (msg.type) {
        case "setEquippedSkin":
          equipped = String((msg.skin as { key?: string } | null)?.key ?? equipped);
          break;
        case "init":
        case "setToken":
          if (msg.type === "init") equipped = String((msg.equippedSkin as { key?: string } | null)?.key ?? "human");
          token = String(msg.accessToken);
          if (msg.type === "setToken" && waitingForToken) {
            const fn = waitingForToken;
            waitingForToken = null;
            window.__BK_MOCK__ = { ...knobs(), authExpiredOnStart: false };
            fn();
          }
          break;
        case "startOffline":
          later(400, () => playMatch("offline", msg.mode as "1v1" | "2v2", `offline ${String(msg.mode)} ${String(msg.opponent)} map ${String(msg.map)}, Player 1 skin ${equipped}`));
          break;
        case "startOnline": {
          const kind = msg.kind as "quick" | "createRoom" | "joinRoom";
          // The real Unity can answer inside sendMessage, before React re-renders (found in the SS-13 real run).
          if (knobs().syncStatus) emit({ type: "status", phase: "searching" });
          withToken(() => online(kind, (msg.mode as "1v1" | "2v2") ?? "1v1", msg.roomCode as string | undefined));
          break;
        }
        case "cancelOnline":
          clear();
          later(200, toMenu);
          break;
        default:
          break;
      }
    },
    start(io) {
      emitJson = io.emit;
      const total = knobs().loadMs ?? 1200;
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        later((total * i) / steps, () => {
          if (knobs().failLoad && i === steps / 2) {
            emit({ type: "error", code: "LOAD_FAILED", message: "mock load failure" });
            clear();
            return;
          }
          io.progress(i / steps);
        });
      }
      later(total + 400, () => emit({ type: "ready", buildVersion: "mock", legacyDeviceId: knobs().legacyDeviceId ?? null }));
      return () => {
        clear();
        emitJson = () => {};
      };
    },
    onScene(listener) {
      sceneListeners.push(listener);
      return () => {
        sceneListeners = sceneListeners.filter((l) => l !== listener);
      };
    },
  };
}

/** What the mock "canvas" shows: a stand-in for the match with buttons to end it. */
export function MockUnityStage({ mock }: { mock: MockUnity }) {
  const [scene, setScene] = useState<Scene>({ kind: "idle" });
  useEffect(() => mock.onScene(setScene), [mock]);
  if (scene.kind === "idle") return createElement("div", { className: "mock-unity" }, "Mock Unity (idle)");
  const btn = (r: MatchResult, label: string) =>
    createElement("button", { key: r, type: "button", className: "btn", onClick: () => scene.end(r) }, label);
  return createElement(
    "div",
    { className: "mock-unity", "data-testid": "mock-match" },
    createElement("p", null, `Mock Unity match: ${scene.label}`),
    createElement("div", { className: "mock-unity__buttons" }, btn("win", "Win"), btn("loss", "Lose"), btn("draw", "Draw"), btn("left", "Leave")),
  );
}
