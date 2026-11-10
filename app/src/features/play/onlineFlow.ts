// Play Online state (ux-spec 9.2, 9.3): what the Searching overlay shows, driven by the bridge status messages.
// Pure code, tested in onlineFlow.test.ts.
import type { Mode } from "../../api/types";
import type { MessageKey } from "../../i18n/vi";
import type { StatusMessage } from "../../unity/bridge";

export type OnlineStart = { kind: "quick"; mode: Mode } | { kind: "createRoom"; mode: Mode } | { kind: "joinRoom"; roomCode: string };

export interface OnlineState {
  start: OnlineStart;
  status: StatusMessage | null;
  /** First room code seen (rooms send it from the first status on). */
  roomCode: string | null;
  mode: Mode | null;
  error: OnlineError | null;
}

export type OnlineErrorAction = "retry" | "playOffline" | "close" | "editCode" | "reload";

export interface OnlineError {
  code: string;
  key: MessageKey;
  actions: OnlineErrorAction[];
}

export function startState(start: OnlineStart): OnlineState {
  return {
    start,
    status: null,
    roomCode: start.kind === "joinRoom" ? start.roomCode : null,
    mode: start.kind === "joinRoom" ? null : start.mode,
    error: null,
  };
}

export function applyStatus(state: OnlineState, status: StatusMessage): OnlineState {
  const next: OnlineState = {
    ...state,
    status,
    roomCode: state.roomCode ?? status.roomCode ?? null,
    mode: status.mode ?? state.mode,
  };
  if (status.phase === "error") next.error = mapOnlineError(status.code, status.message);
  return next;
}

/** ux-spec 9.3. Unknown codes fall back to the network copy (the Unity message is logged, not shown). */
export function mapOnlineError(code: string | undefined, message?: string): OnlineError {
  const c = code ?? "";
  const msg = (message ?? "").toLowerCase();
  if (c === "VERSION_MISMATCH" || msg.includes("version mismatch")) return { code: c || "VERSION_MISMATCH", key: "err.online.version", actions: ["reload"] };
  if (c === "SERVERS_FULL" || msg.includes("server busy")) return { code: c || "SERVERS_FULL", key: "err.online.busy", actions: ["retry", "playOffline"] };
  switch (c) {
    case "SERVER_START_FAILED":
      return { code: c, key: "err.online.startFailed", actions: ["retry", "close"] };
    case "MODE_UNAVAILABLE":
      return { code: c, key: "err.online.mode", actions: ["close"] };
    case "ROOM_NOT_FOUND":
      return { code: c, key: "err.room.notFound", actions: ["editCode", "close"] };
    case "ROOM_FULL":
      return { code: c, key: "err.room.full", actions: ["close"] };
    case "SERVER_GONE":
    case "ROOM_STARTED":
      return { code: c, key: "err.room.started", actions: ["close"] };
    // Relay rooms (D5b): codes from the API (MODE_MISMATCH) and from Unity (ROOM_CLOSED, HOST_LEFT, RELAY_UNAVAILABLE)
    case "ROOM_CLOSED":
      return { code: c, key: "err.room.closed", actions: ["close"] };
    case "HOST_LEFT":
      return { code: c, key: "err.room.hostLeft", actions: ["close"] };
    case "RELAY_UNAVAILABLE":
      return { code: c, key: "err.room.relay", actions: ["retry", "close"] };
    case "MODE_MISMATCH":
      return { code: c, key: "err.room.mode", actions: ["close"] };
    default:
      return { code: c || "UNKNOWN", key: "err.online.network", actions: ["retry", "close"] };
  }
}

export type OverlayButton = "cancel" | "leaveRoom" | "copy";

export interface OverlayView {
  title: MessageKey;
  body: MessageKey | null;
  /** Room code line shown in addition to the body (connecting in a room). */
  codeLine: boolean;
  buttons: OverlayButton[];
  /** "No points lost" note under the Leave button (rooms only). */
  cancelNote: boolean;
  /** Countdown shown in the body ({seconds}). */
  countdown: boolean;
}

const isRoom = (s: OnlineState) => s.start.kind !== "quick";

/** ux-spec 9.2 state table. */
export function overlayView(state: OnlineState): OverlayView {
  const phase = state.status?.phase ?? null;
  const room = isRoom(state);
  const hasCode = room && state.roomCode !== null;
  const roomButtons: OverlayButton[] = ["copy", "leaveRoom"];
  const base = { codeLine: false, cancelNote: room, countdown: false };

  if (phase === "loading") return { ...base, title: "online.loading", body: null, buttons: [], cancelNote: false, codeLine: hasCode };
  if (phase === "waiting") {
    // Relay rooms have no bots, so no countdown: the room starts when it is full.
    if (room && hasCode && state.status?.seconds === undefined) return { ...base, title: "online.roomWaiting", body: "online.roomWaitingFriendsBody", buttons: roomButtons };
    if (room && hasCode) return { ...base, title: "online.roomWaiting", body: "online.roomWaitingBody", buttons: roomButtons, countdown: true };
    return { ...base, title: "online.quickWaiting", body: "online.quickWaitingBody", buttons: ["cancel"], countdown: true };
  }
  if (phase === "connecting") return { ...base, title: "online.connecting", body: null, codeLine: hasCode, buttons: hasCode && state.start.kind === "createRoom" ? roomButtons : ["cancel"] };

  if (state.start.kind === "createRoom") {
    if (hasCode) return { ...base, title: "online.roomReady", body: "online.roomReadyBody", buttons: roomButtons };
    if (phase === "starting") return { ...base, title: "online.starting", body: "online.startingBody", buttons: ["cancel"] };
    return { ...base, title: "online.creating", body: null, buttons: ["cancel"] };
  }
  if (phase === "starting") return { ...base, title: "online.starting", body: "online.startingBody", codeLine: hasCode, buttons: ["cancel"] };
  if (state.start.kind === "joinRoom") return { ...base, title: "online.joining", body: null, buttons: ["cancel"] };
  return { ...base, title: "online.searching", body: null, buttons: ["cancel"] };
}
