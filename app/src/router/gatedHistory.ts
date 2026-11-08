// Router history that keeps the route out of the address bar until Unity has started.
//
// SS-1 finding: Unity WebGL stores PlayerPrefs (and the old BK_DEVICE_ID) in IndexedDB under md5(document.URL cut at
// the last "/"). A "#/shop" route, or a "/bombkicker-web/shop" path, moves that folder, so Unity would not see the old
// device id. So:
//   1. before the Unity loader runs, captureBootRoute() removes the route from the URL and remembers it;
//   2. until unlock() the router runs on an in-memory history (navigation works, the URL does not change);
//   3. unlock() (Unity "ready", or Unity failed so it reads nothing) writes the current route into the URL and
//      switches to the real hash or browser history.
import {
  UNSAFE_createBrowserHistory as createBrowserHistory,
  UNSAFE_createHashHistory as createHashHistory,
  UNSAFE_createMemoryHistory as createMemoryHistory,
  createPath,
  type To,
} from "react-router";

type History = Omit<ReturnType<typeof createMemoryHistory>, "index">;
type Listener = Parameters<History["listen"]>[0];

export type RouterMode = "hash" | "browser";

export interface GatedHistory {
  readonly action: History["action"];
  readonly location: History["location"];
  createHref(to: To): string;
  createURL(to: To): URL;
  encodeLocation(to: To): ReturnType<History["encodeLocation"]>;
  push(to: To, state?: unknown): void;
  replace(to: To, state?: unknown): void;
  go(delta: number): void;
  listen(listener: Listener): () => void;
  /** Write the route into the URL and use the real history from now on. Safe to call more than once. */
  unlock(): void;
  readonly unlocked: boolean;
}

/**
 * Take the route out of the current URL (call before the Unity loader starts) and return it as a router path.
 * hash mode: "#/shop?x=1" -> "/shop?x=1". browser mode: "<basename>/shop" -> "/shop".
 */
export function captureBootRoute(mode: RouterMode, basename: string, win: Window = window): string {
  const loc = win.location;
  if (mode === "hash") {
    const raw = loc.hash.replace(/^#/, "");
    if (loc.hash) win.history.replaceState(win.history.state, "", loc.pathname + loc.search);
    return normalizePath(raw);
  }
  const base = basename.replace(/\/+$/, "");
  const rest = loc.pathname.startsWith(base) ? loc.pathname.slice(base.length) : loc.pathname;
  const route = normalizePath(rest + loc.search + loc.hash);
  if (route !== "/") win.history.replaceState(win.history.state, "", `${base}/`);
  return route;
}

function normalizePath(raw: string): string {
  if (!raw || raw === "/") return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function createGatedHistory(
  mode: RouterMode,
  initialRoute: string,
  basename: string,
  win: Window = window,
): GatedHistory {
  // Browser mode: the router passes paths that already include the basename, so the memory history holds full paths.
  const base = basename.replace(/\/+$/, "");
  const first = mode === "hash" ? initialRoute : `${base}${initialRoute === "/" ? "/" : initialRoute}`;
  let inner: History = createMemoryHistory({ initialEntries: [first], v5Compat: true });
  let unlocked = false;
  const listeners = new Set<Listener>();
  const forward: Listener = (update) => listeners.forEach((l) => l(update));
  let detach = inner.listen(forward);

  const href = (to: To) => {
    const path = typeof to === "string" ? to : createPath(to);
    return mode === "hash" ? `#${path}` : path;
  };

  return {
    get action() {
      return inner.action;
    },
    get location() {
      return inner.location;
    },
    get unlocked() {
      return unlocked;
    },
    createHref: (to) => (unlocked ? inner.createHref(to) : href(to)),
    createURL: (to) => inner.createURL(to),
    encodeLocation: (to) => inner.encodeLocation(to),
    push: (to, state) => inner.push(to, state),
    replace: (to, state) => inner.replace(to, state),
    go: (delta) => inner.go(delta),
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      const path = createPath(inner.location);
      const loc = win.location;
      if (mode === "hash") {
        if (path !== "/") win.history.replaceState(null, "", `${loc.pathname}${loc.search}#${path}`);
      } else {
        win.history.replaceState(null, "", path);
      }
      detach();
      inner = mode === "hash" ? createHashHistory({ window: win, v5Compat: true }) : createBrowserHistory({ window: win, v5Compat: true });
      detach = inner.listen(forward);
    },
  };
}
