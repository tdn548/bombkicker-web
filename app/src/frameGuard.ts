// Clickjacking guard (SS-7 recheck, SEC-012). GitHub Pages cannot send X-Frame-Options and a <meta> CSP cannot carry
// frame-ancestors, so the site checks for a frame itself: inside a frame the app does not start (no login, no Unity,
// no Buy button to click through an invisible frame). A sandboxed frame without scripts never runs the app at all.

/** True when this window is not the top window (also when the top window cannot be read). */
export function isFramed(win: Pick<Window, "self" | "top">): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/** Replaces the root's content with a link that opens the site in its own tab. Text only, no HTML parsing. */
export function renderFramedNotice(root: HTMLElement, href: string): void {
  const p = document.createElement("p");
  p.className = "framed-notice";
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = "Mở BombKicker trong tab riêng / Open BombKicker in its own tab";
  p.append(a);
  root.replaceChildren(p);
}
