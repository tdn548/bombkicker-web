// Unity WebGL host: mounted once at app start, kept mounted between matches, hidden unless a match is on screen.
// Plan "React app structure": hide with visibility (never display: none; a 0x0 canvas breaks Unity's resize and
// WebGL context). Messages to Unity wait in a BridgeQueue until Unity's "ready".
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Unity, useUnityContext } from "react-unity-webgl";
import { UNITY_BUILD, UNITY_MAX_DPR } from "../config";
import type { UnityBoot } from "../auth/deviceId";
import { BRIDGE_EVENT, BRIDGE_METHOD, BRIDGE_OBJECT, BridgeQueue, ignoredSummary, parseFromUnity, redact, type FromUnity, type ToUnity } from "./bridge";
import { MockUnityStage, createMockUnity, type MockUnity } from "./mockUnity";

/** "slow" copy appears after this long without ready (ux-spec 6.4). */
export const SLOW_LOAD_MS = 20000;

export interface UnityApi {
  boot: UnityBoot;
  /** 0-1 from the loader. */
  progress: number;
  isLoaded: boolean;
  slow: boolean;
  /** Unity is idle (no match, no search): Play buttons may send a start message. */
  idle: boolean;
  visible: boolean;
  setVisible(visible: boolean): void;
  send(msg: ToUnity): void;
  /** Subscribe to parsed Unity messages; returns the unsubscribe function. */
  subscribe(handler: (msg: FromUnity) => void): () => void;
}

const UnityCtx = createContext<UnityApi | null>(null);

export function useUnity(): UnityApi {
  const ctx = useContext(UnityCtx);
  if (!ctx) throw new Error("useUnity outside UnityHost");
  return ctx;
}

/** Shared state machine of both hosts (real Unity and the mock). */
function useHostState(deliver: (json: string) => void) {
  const [boot, setBoot] = useState<UnityBoot>({ state: "loading" });
  const [idle, setIdle] = useState(true);
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  const handlers = useRef(new Set<(msg: FromUnity) => void>());
  const [queue] = useState(() => new BridgeQueue());
  useEffect(() => {
    queue.connect((json, msg) => {
      if (import.meta.env.DEV) console.debug("[bridge] R->U", redact(msg));
      window.__BK_BRIDGE_LOG__?.push({ dir: "R->U", msg: JSON.parse(redact(msg)) as unknown });
      deliver(json);
    });
  }, [queue, deliver]);

  useEffect(() => {
    if (boot.state !== "loading") return;
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(t);
  }, [boot.state]);

  const receive = useCallback(
    (json: unknown) => {
      const msg = parseFromUnity(json);
      if (!msg) {
        console.warn("[bridge] ignored Unity message", ignoredSummary(json));
        return;
      }
      window.__BK_BRIDGE_LOG__?.push({ dir: "U->R", msg: msg.type === "ready" ? { ...msg, legacyDeviceId: msg.legacyDeviceId ? "(set)" : null } : msg });
      if (import.meta.env.DEV) console.debug("[bridge] U->R", msg.type === "ready" ? { ...msg, legacyDeviceId: msg.legacyDeviceId ? "(set)" : null } : msg);
      if (msg.type === "ready") {
        setBoot((b) => (b.state === "ready" ? b : { state: "ready", legacyDeviceId: msg.legacyDeviceId }));
        queue.markReady();
      } else if (msg.type === "returnedToMenu") {
        setIdle(true);
      } else if (msg.type === "error" && !queue.isReady) {
        setBoot({ state: "failed" });
      }
      handlers.current.forEach((h) => h(msg));
    },
    [queue],
  );

  const send = useCallback(
    (msg: ToUnity) => {
      if (msg.type === "startOffline" || msg.type === "startOnline") setIdle(false);
      queue.send(msg);
    },
    [queue],
  );

  const subscribe = useCallback((h: (msg: FromUnity) => void) => {
    handlers.current.add(h);
    return () => {
      handlers.current.delete(h);
    };
  }, []);

  return { boot, setBoot, idle, visible, setVisible, slow, receive, send, subscribe };
}

function RealUnityHost({ children }: { children: ReactNode }) {
  const ctx = useUnityContext(UNITY_BUILD);
  const { sendMessage, addEventListener, removeEventListener } = ctx;
  const deliver = useCallback((json: string) => sendMessage(BRIDGE_OBJECT, BRIDGE_METHOD, json), [sendMessage]);
  const host = useHostState(deliver);
  const { receive, setBoot, boot } = host;

  useEffect(() => {
    const h = (...args: unknown[]) => {
      receive(args[0]);
      return undefined;
    };
    addEventListener(BRIDGE_EVENT, h);
    return () => removeEventListener(BRIDGE_EVENT, h);
  }, [addEventListener, removeEventListener, receive]);

  // Loader failures: initialisationError from createUnityInstance, or the loader <script> itself failed (404, offline).
  useEffect(() => {
    if (ctx.initialisationError) setBoot({ state: "failed" });
  }, [ctx.initialisationError, setBoot]);
  useEffect(() => {
    if (boot.state !== "loading") return;
    const t = setInterval(() => {
      const s = document.querySelector(`script[src="${UNITY_BUILD.loaderUrl}"]`);
      if (s?.getAttribute("data-status") === "error") setBoot({ state: "failed" });
    }, 1000);
    return () => clearInterval(t);
  }, [boot.state, setBoot]);

  const api = useApi(host, ctx.loadingProgression, ctx.isLoaded);
  const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, UNITY_MAX_DPR);

  return (
    <UnityCtx.Provider value={api}>
      <div className={host.visible ? "unity-layer unity-layer--visible" : "unity-layer"} aria-hidden={!host.visible} data-testid="unity-layer">
        <Unity unityProvider={ctx.unityProvider} devicePixelRatio={dpr} className="unity-canvas" tabIndex={-1} id="unity-canvas" />
      </div>
      {children}
    </UnityCtx.Provider>
  );
}

function useApi(host: ReturnType<typeof useHostState>, progress: number, isLoaded: boolean): UnityApi {
  const { boot, idle, visible, setVisible, slow, send, subscribe } = host;
  return useMemo(
    () => ({ boot, progress, isLoaded, slow: slow && boot.state === "loading", idle, visible, setVisible, send, subscribe }),
    [boot, progress, isLoaded, slow, idle, visible, setVisible, send, subscribe],
  );
}

function MockUnityHost({ children }: { children: ReactNode }) {
  const mockRef = useRef<MockUnity | null>(null);
  const deliver = useCallback((json: string) => mockRef.current?.receive(json), []);
  const host = useHostState(deliver);
  const [progress, setProgress] = useState(0);
  const { receive } = host;
  const [mock] = useState(() => createMockUnity());
  useEffect(() => {
    mockRef.current = mock;
    return mock.start({ emit: receive, progress: setProgress });
  }, [mock, receive]);
  const api = useApi(host, progress, progress >= 1);
  return (
    <UnityCtx.Provider value={api}>
      <div className={host.visible ? "unity-layer unity-layer--visible" : "unity-layer"} aria-hidden={!host.visible} data-testid="unity-layer">
        <MockUnityStage mock={mock} />
      </div>
      {children}
    </UnityCtx.Provider>
  );
}

export function UnityHost({ mock, children }: { mock: boolean; children: ReactNode }) {
  return mock ? <MockUnityHost>{children}</MockUnityHost> : <RealUnityHost>{children}</RealUnityHost>;
}
