// Entry. Runs before the Unity loader: sets the embedded flag and takes the route out of the URL (SS-1).
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getMockApi } from "./api/mockSingleton";
import { API_URL, ROUTER_MODE, USE_MOCK } from "./config";
import { captureBootRoute, createGatedHistory } from "./router/gatedHistory";
import { isFramed, renderFramedNotice } from "./frameGuard";
import "./styles.css";

declare global {
  interface Window {
    __BK_EMBED__?: { v: number };
  }
}

// Unity reads this through BK_IsEmbedded at boot (plan "React <-> Unity bridge").
window.__BK_EMBED__ = { v: 1 };

const rootEl = document.getElementById("root")!;
if (isFramed(window)) {
  // Clickjacking guard (frameGuard.ts): no app inside a frame.
  renderFramedNotice(rootEl, location.href);
  throw new Error("BombKicker does not run inside a frame");
}

const basename = ROUTER_MODE === "browser" ? import.meta.env.BASE_URL : undefined;
const route = captureBootRoute(ROUTER_MODE, import.meta.env.BASE_URL);
const history = createGatedHistory(ROUTER_MODE, route, import.meta.env.BASE_URL);

const fetchImpl: typeof fetch = USE_MOCK ? getMockApi().fetch : (input, init) => fetch(input, init);

createRoot(rootEl).render(
  <App history={history} basename={basename?.replace(/\/+$/, "")} apiUrl={USE_MOCK ? "http://mock.local" : API_URL} fetchImpl={fetchImpl} mockUnity={USE_MOCK} />,
);
