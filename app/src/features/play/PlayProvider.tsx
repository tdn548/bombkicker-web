// One play session at a time: Play Offline / Play Online -> Unity -> result screen. Owns when the Unity canvas is
// visible. UI only displays state and sends bridge messages; the game and the API own the match and the points.
// Before every start the catalog is refetched and sent to Unity (BUG-SS18-002): Unity draws a ticket skin key only if
// it is in its catalog, so an open tab must learn about skins and sheet versions the admin added since it loaded.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { Me, Mode } from "../../api/types";
import { usePlayerData } from "../../state/PlayerData";
import type { MatchKind, MatchResult, OfflineMap, Opponent, ToUnity } from "../../unity/bridge";
import { useUnity } from "../../unity/UnityHost";
import { applyStatus, mapOnlineError, startState, type OnlineStart, type OnlineState } from "./onlineFlow";
import { pollForResult, type Before } from "./resultLogic";

/**
 * Longest wait for the GET /v1/skins refetch before a start. A failed or slow refetch never blocks play: the start
 * goes out with the catalog Unity already has (a late answer still reaches Unity through UnitySync).
 */
export const CATALOG_REFRESH_TIMEOUT_MS = 3000;
export interface OfflineSettings {
  mode: Mode;
  opponent: Opponent;
  map: OfflineMap;
}

export type Origin = { type: "online"; start: OnlineStart } | { type: "offline"; settings: OfflineSettings };

export interface ResultState {
  kind: MatchKind;
  mode: Mode;
  result: MatchResult;
  recorded: boolean;
  origin: Origin;
  points: { state: "saving" } | { state: "done"; delta: number; total: number } | { state: "timeout" } | { state: "none" };
}

type Stage =
  | { stage: "idle" }
  | { stage: "online"; online: OnlineState }
  | { stage: "offline"; settings: OfflineSettings }
  | { stage: "result"; result: ResultState };

interface Play {
  stage: Stage;
  /** A start may be sent now (Unity ready and idle, nothing running). */
  canStart: boolean;
  startOnline(start: OnlineStart): void;
  startOffline(settings: OfflineSettings): void;
  cancelOnline(): void;
  /** Close an error in the overlay; returns to the idle Play Online screen. */
  dismissError(): void;
  retryOnline(): void;
  closeResult(): void;
}

const Ctx = createContext<Play | null>(null);

export function usePlay(): Play {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlay outside PlayProvider");
  return ctx;
}

export function PlayProvider({ children }: { children: ReactNode }) {
  const unity = useUnity();
  const { boot, idle, send, sentCatalog, subscribe, setVisible } = unity;
  const { me, refreshMe, refreshSkins } = usePlayerData();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>({ stage: "idle" });
  const stageRef = useRef(stage);
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  // Update the ref at once too: Unity messages can arrive before the next render.
  const go = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);
  // A start waiting for Unity's returnedToMenu (retry or play again right after a match).
  const pending = useRef<ToUnity | null>(null);
  // True once the current session's start message reached Unity. A returnedToMenu before that belongs to the previous
  // session (e.g. the reply to a cancel) and must not end the new one.
  const startDelivered = useRef(false);
  const pollAbort = useRef<AbortController | null>(null);
  // Points and matchesPlayed before the current online match. A ref, not state: Unity can answer startOnline
  // synchronously inside sendMessage, before React has re-rendered.
  const beforeRef = useRef<Before | null>(null);
  // Bumped by every start and cancel: a start still waiting for its refetches is dropped once a newer one exists.
  const sessionRef = useRef(0);

  const ready = boot.state === "ready";
  const canStart = ready && (stage.stage === "idle" || stage.stage === "result");

  const idleRef = useRef(idle);
  const dispatch = useCallback(
    (msg: ToUnity) => {
      if (idleRef.current) {
        idleRef.current = false;
        startDelivered.current = true;
        send(msg);
      } else pending.current = msg;
    },
    [send],
  );
  useEffect(() => {
    idleRef.current = idle;
    if (idle && pending.current) {
      const msg = pending.current;
      pending.current = null;
      idleRef.current = false;
      startDelivered.current = true;
      send(msg);
    }
  }, [idle, send]);

  const snapshot = useCallback(async (): Promise<Before | null> => {
    // Points and matchesPlayed before the match (plan "Result screen (J)"); fresh if possible.
    const fresh = await Promise.race([refreshMe().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    const m: Me | null = fresh ?? me;
    return m ? { points: m.points, matchesPlayed: m.stats.matchesPlayed } : null;
  }, [me, refreshMe]);

  const syncCatalog = useCallback(async () => {
    // BUG-SS18-002: fresh catalog to Unity before the start message (sendMessage keeps the order).
    const fresh = await Promise.race([
      refreshSkins().catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), CATALOG_REFRESH_TIMEOUT_MS)),
    ]);
    if (fresh && sentCatalog() !== fresh) send({ type: "setCatalog", catalog: fresh });
  }, [refreshSkins, send, sentCatalog]);

  const startOnline = useCallback(
    (start: OnlineStart) => {
      if (!ready) return;
      const session = ++sessionRef.current;
      pollAbort.current?.abort();
      startDelivered.current = false;
      beforeRef.current = null;
      const next: Stage = { stage: "online", online: startState(start) };
      go(next);
      void Promise.all([snapshot(), syncCatalog()]).then(([before]) => {
        if (sessionRef.current !== session || stageRef.current.stage !== "online") return;
        beforeRef.current = before;
        const msg: ToUnity =
          start.kind === "joinRoom"
            ? { type: "startOnline", kind: "joinRoom", roomCode: start.roomCode }
            : { type: "startOnline", kind: start.kind, mode: start.mode };
        dispatch(msg);
      });
    },
    [ready, snapshot, syncCatalog, dispatch, go],
  );

  const startOffline = useCallback(
    (settings: OfflineSettings) => {
      if (!ready) return;
      const session = ++sessionRef.current;
      pollAbort.current?.abort();
      startDelivered.current = false;
      const next: Stage = { stage: "offline", settings };
      go(next);
      void syncCatalog().then(() => {
        if (sessionRef.current !== session || stageRef.current.stage !== "offline") return;
        setVisible(true);
        dispatch({ type: "startOffline", mode: settings.mode, opponent: settings.opponent, map: settings.map });
      });
    },
    [ready, syncCatalog, setVisible, dispatch, go],
  );

  const cancelOnline = useCallback(() => {
    if (stageRef.current.stage !== "online") return;
    sessionRef.current++;
    pending.current = null;
    if (startDelivered.current) send({ type: "cancelOnline" });
    startDelivered.current = false;
    setVisible(false);
    go({ stage: "idle" });
  }, [send, setVisible, go]);

  const dismissError = useCallback(() => {
    setVisible(false);
    go({ stage: "idle" });
  }, [setVisible, go]);

  const retryOnline = useCallback(() => {
    const s = stageRef.current;
    if (s.stage === "online") startOnline(s.online.start);
  }, [startOnline]);

  const closeResult = useCallback(() => {
    pollAbort.current?.abort();
    go({ stage: "idle" });
  }, [go]);

  // Unity -> React during a session.
  useEffect(
    () =>
      subscribe((msg) => {
        const s = stageRef.current;
        // Messages from before this session's start reached Unity (e.g. the returnedToMenu answering a cancel).
        if (!startDelivered.current && (msg.type === "status" || msg.type === "matchEnded" || msg.type === "returnedToMenu")) return;
        if (msg.type === "status" && s.stage === "online") {
          const next: Stage = { stage: "online", online: applyStatus(s.online, msg) };
          go(next);
          if (msg.phase === "inMatch") setVisible(true);
          if (msg.phase === "error") setVisible(false);
          return;
        }
        if (msg.type === "error" && s.stage === "online") {
          console.warn("[play] Unity error during online start", msg.code, msg.message);
          const next: Stage = { stage: "online", online: { ...s.online, error: mapOnlineError(msg.code, msg.message) } };
          go(next);
          setVisible(false);
          return;
        }
        if (msg.type === "matchEnded" && (s.stage === "online" || s.stage === "offline")) {
          setVisible(false);
          const origin: Origin = s.stage === "online" ? { type: "online", start: s.online.start } : { type: "offline", settings: s.settings };
          const before = s.stage === "online" ? beforeRef.current : null;
          const result: ResultState = {
            kind: msg.kind,
            mode: msg.mode,
            result: msg.result,
            recorded: msg.recorded,
            origin,
            points: msg.recorded ? (before ? { state: "saving" } : { state: "timeout" }) : { state: "none" },
          };
          const next: Stage = { stage: "result", result };
          go(next);
          navigate("/result");
          // Back on React screens: show skins the admin changed during the match (recorded matches refetch after the poll).
          if (!(msg.recorded && before)) refreshSkins().catch(() => undefined);
          if (msg.recorded && before) {
            const ctrl = new AbortController();
            pollAbort.current = ctrl;
            void pollForResult(before, refreshMe, { signal: ctrl.signal }).then((out) => {
              if (ctrl.signal.aborted) return;
              setStage((cur) =>
                cur.stage === "result" && cur.result === result
                  ? {
                      stage: "result",
                      result: {
                        ...result,
                        points: out.state === "done" ? { state: "done", delta: out.delta, total: out.me.points } : { state: "timeout" },
                      },
                    }
                  : cur,
              );
              if (out.state === "done") refreshSkins().catch(() => undefined);
            });
          }
          return;
        }
        if (msg.type === "returnedToMenu" && s.stage === "online") {
          // Unity left the search on its own (e.g. after an error it already reported): keep an error on screen.
          if (!s.online.error) {
            setVisible(false);
            go({ stage: "idle" });
          }
        }
        if (msg.type === "returnedToMenu" && s.stage === "offline") {
          setVisible(false);
          go({ stage: "idle" });
        }
      }),
    [subscribe, setVisible, navigate, refreshMe, refreshSkins, go],
  );

  useEffect(() => () => pollAbort.current?.abort(), []);

  const value = useMemo<Play>(
    () => ({ stage, canStart, startOnline, startOffline, cancelOnline, dismissError, retryOnline, closeResult }),
    [stage, canStart, startOnline, startOffline, cancelOnline, dismissError, retryOnline, closeResult],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
