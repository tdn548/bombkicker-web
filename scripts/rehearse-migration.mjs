// Account migration rehearsal for D10 = A (same URL), SS-16. Runs real HTTP servers, no request routing:
//   A. the current production page (a commit whose root is the old Unity-only build) at http://localhost:<port>/bombkicker-web/
//      -> Unity creates BK_DEVICE_ID and logs in as a guest (player id from the POST /v1/auth/guest answer)
//   B. same browser profile, same port and path, now the new site (a deploy commit or build-site.sh output)
//      -> React adopts Unity's legacy device id; GET /v1/me must return the same player id
//   C. (unless --no-offline) offline 1v1 bots match in the new site -> result -> back to the menu
//   During B and C every CSP violation (securitypolicyviolation event or console report) fails the run.
//
//   node scripts/rehearse-migration.mjs --old <folder> --new <folder> [--port 8000] [--host localhost] [--api http://<host>:8787]
//        [--out <screenshot dir>] [--no-offline] [--headed]
// Needs: app/node_modules (npm ci in app/) with Playwright's Chromium, and a local bombkicker-api on :8787 whose
// CORS_ORIGINS has http://localhost:<port> (Unity and React send localhost pages to localhost:8787).
// --new must be a local test build (SEC-014): scripts/build-site.sh --unity <Builds/Web> --local-api http://localhost:8787
// (a production build's CSP blocks the local API). A site without a CSP is accepted, with a note.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.join(here, "../app/package.json"));
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const oldDir = opt("old");
const newDir = opt("new");
const port = Number(opt("port", "8000"));
const host = opt("host", "localhost"); // 127.0.0.1 if another server holds [::1]:<port>
const api = opt("api", `http://${host}:8787`);
const outDir = opt("out", path.join(os.tmpdir(), "bk-rehearsal"));
const offline = !args.includes("--no-offline");
if (!oldDir || !newDir) {
  console.error("usage: node scripts/rehearse-migration.mjs --old <folder> --new <folder> [--port 8000]");
  process.exit(2);
}
// SEC-014: the new site's CSP must allow the API this rehearsal uses, so it must be a --local-api build.
{
  const html = fs.readFileSync(path.join(newDir, "index.html"), "utf8");
  const csp = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i.exec(html)?.[1] ?? null;
  const vf = path.join(newDir, "version.json");
  const v = fs.existsSync(vf) ? JSON.parse(fs.readFileSync(vf, "utf8")) : {};
  if (csp === null) console.warn(`note: ${newDir} has no CSP meta (built before react-security?)`);
  else if (v.local !== true) {
    console.error(`${newDir} is a production build (version.json local != true): its CSP blocks ${api}.\n` +
      `Build it with: scripts/build-site.sh --unity <Builds/Web> --local-api ${api}`);
    process.exit(2);
  } else if (!csp.split(";").find((d) => d.trim().startsWith("connect-src"))?.split(/\s+/).includes(new URL(api).origin)) {
    console.error(`${newDir} CSP connect-src does not allow ${api} (built with --local-api ${v.localApi})`);
    process.exit(2);
  }
}
fs.mkdirSync(outDir, { recursive: true });
const url = `http://${host}:${port}/bombkicker-web/`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const result = { url, api, old: path.resolve(oldDir), new: path.resolve(newDir), startedAt: new Date().toISOString() };

function serve(dir) {
  const p = spawn("bash", [path.join(here, "serve-site.sh"), dir, "--port", String(port)], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  p.stderr.on("data", () => {});
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 10_000);
    const poll = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) { clearTimeout(t); resolve(p); return; }
      } catch { /* not up yet */ }
      setTimeout(poll, 200);
    };
    poll();
  });
}
function stop(p) {
  try { process.kill(-p.pid, "SIGTERM"); } catch { /* gone */ }
  return new Promise((r) => setTimeout(r, 500));
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bk-rehearsal-profile-"));
const ctx = await chromium.launchPersistentContext(profile, { headless: !args.includes("--headed"), viewport: { width: 1280, height: 720 } });
let server;
let exit = 0;
try {
  // ---- A. current production page ----
  server = await serve(oldDir);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  let oldLogin = null;
  page.on("response", async (r) => {
    if (r.url() === `${api}/v1/auth/guest` && r.request().method() === "POST" && r.ok()) {
      const body = JSON.parse(r.request().postDataBuffer()?.toString("utf8") || "{}");
      const json = await r.json().catch(() => ({}));
      if (!oldLogin) oldLogin = { deviceId: body.deviceId, playerId: json.player?.id, displayName: json.player?.displayName };
    }
  });
  log("A: open the current production page", url);
  const tA = Date.now();
  await page.goto(url);
  while (!oldLogin && Date.now() - tA < 180_000) await page.waitForTimeout(500);
  if (!oldLogin) throw new Error("A: the old build never logged in (is the API on :8787 and CORS_ORIGINS set?)");
  log(`A: old build logged in after ${((Date.now() - tA) / 1000).toFixed(1)} s`, oldLogin);
  await page.waitForTimeout(4000); // PlayerPrefs.Save -> IndexedDB (/idbfs)
  // Unity's XHR body is not visible to Playwright, so read BK_DEVICE_ID from the PlayerPrefs file Unity wrote (SS-1 §2).
  const prefs = await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open("/idbfs");
    open.onerror = () => resolve([]);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("FILE_DATA")) return resolve([]);
      const out = [];
      const cur = db.transaction("FILE_DATA").objectStore("FILE_DATA").openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(out);
        if (String(c.key).endsWith("/PlayerPrefs") && c.value?.contents) {
          const text = Array.from(c.value.contents, (b) => String.fromCharCode(b)).join("");
          out.push({ key: String(c.key), deviceIds: text.match(/bk-[0-9a-f]{32}/g) ?? [] });
        }
        c.continue();
      };
    };
  }));
  result.old_build_playerprefs = prefs;
  oldLogin.deviceId ??= prefs.flatMap((p) => p.deviceIds)[0];
  await page.screenshot({ path: path.join(outDir, "A-old-production-build.png") });
  result.old_build = oldLogin;
  page.removeAllListeners("response");
  await page.goto("about:blank");
  await stop(server);

  // ---- B. new site at the same URL ----
  server = await serve(newDir);
  // A returning player after GitHub Pages' max-age=600 has passed: HTTP cache gone, IndexedDB and localStorage kept.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache");
  // Reported to Node (exposeFunction survives navigations), so B and C are both covered.
  const cspEvents = [];
  await page.exposeFunction("__bkCspViolation", (v) => cspEvents.push(v));
  await page.addInitScript(() => {
    window.__BK_BRIDGE_LOG__ = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__bkCspViolation({ directive: e.effectiveDirective, blocked: e.blockedURI, source: e.sourceFile }));
  });
  const cspConsole = [];
  page.on("console", (m) => { if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) cspConsole.push(m.text().slice(0, 300)); });
  const newLogins = [];
  let me = null;
  page.on("response", async (r) => {
    if (r.url() === `${api}/v1/auth/guest` && r.request().method() === "POST") newLogins.push(JSON.parse(r.request().postDataBuffer()?.toString("utf8") || "{}").deviceId);
    if (r.url() === `${api}/v1/me` && r.request().method() === "GET" && r.ok() && !me) me = await r.json().catch(() => null);
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  log("B: open the new site at the same URL");
  const tB = Date.now();
  await page.goto(url);
  const version = await (await fetch(`${url}version.json`)).json();
  result.new_site_version = version;
  result.csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? null);
  await page.getByTestId("menu-offline").waitFor({ timeout: 180_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="menu-offline"]')?.getAttribute("aria-disabled") !== "true", null, { timeout: 180_000 });
  while (!me && Date.now() - tB < 30_000) await page.waitForTimeout(250);
  const ready = (await page.evaluate(() => window.__BK_BRIDGE_LOG__ ?? [])).find((e) => e.dir === "U->R" && e.msg.type === "ready");
  const stored = await page.evaluate(() => localStorage.getItem("bk_device_id"));
  await page.screenshot({ path: path.join(outDir, "B-new-site-menu.png") });
  result.new_site = {
    secondsToMenu: Number(((Date.now() - tB) / 1000).toFixed(1)),
    unityReadyLegacyDeviceId: ready?.msg.legacyDeviceId ?? null,
    storedDeviceId: stored,
    guestLoginDeviceIds: newLogins,
    me: me && { id: me.id, displayName: me.displayName, points: me.points },
    pageErrors: errors,
  };
  const same = me?.id === oldLogin.playerId && stored === oldLogin.deviceId && newLogins.every((d) => d === oldLogin.deviceId);
  result.adopted = same;
  log(`B: menu ready after ${result.new_site.secondsToMenu} s; /v1/me id ${me?.id} vs old ${oldLogin.playerId} -> ${same ? "SAME PLAYER" : "DIFFERENT"}`);
  if (!same) exit = 1;

  // ---- C. offline match in the new site ----
  if (offline) {
    log("C: offline 1v1 bots match");
    await page.goto(`${url}#/play/offline`);
    const start = page.getByTestId("start-offline");
    await page.waitForFunction(() => document.querySelector('[data-testid="start-offline"]')?.getAttribute("aria-disabled") !== "true", null, { timeout: 60_000 });
    await start.click();
    await page.waitForTimeout(8000);
    await page.screenshot({ path: path.join(outDir, "C-offline-in-match.png") });
    const tC = Date.now();
    await page.getByTestId("result").waitFor({ timeout: 360_000 });
    const line = await page.getByTestId("points-line").textContent();
    await page.screenshot({ path: path.join(outDir, "C-offline-result.png") });
    const bridge = await page.evaluate(() => window.__BK_BRIDGE_LOG__ ?? []);
    const ended = bridge.find((e) => e.msg.type === "matchEnded")?.msg;
    await page.waitForFunction(() => (window.__BK_BRIDGE_LOG__ ?? []).some((e) => e.msg.type === "returnedToMenu"), null, { timeout: 30_000 });
    await page.getByTestId("result-menu").click();
    await page.getByTestId("equipped-preview").waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.join(outDir, "C-back-to-menu.png") });
    result.offline = { matchSeconds: Number(((Date.now() - tC) / 1000 + 8).toFixed(0)), matchEnded: ended, pointsLine: line, backToMenu: true };
    log("C: offline match ended", ended, line);
    if (ended?.kind !== "offline" || ended?.recorded !== false) exit = 1;
  }
  await page.waitForTimeout(1000); // let a last report arrive
  result.cspViolations = { events: cspEvents, console: cspConsole, count: cspEvents.length + cspConsole.length };
  log(`CSP violations: ${result.cspViolations.count}`);
  if (result.cspViolations.count > 0) exit = 1;
} catch (e) {
  result.error = String(e?.stack ?? e);
  console.error(e);
  exit = 1;
} finally {
  await ctx.close().catch(() => {});
  if (server) await stop(server);
  fs.rmSync(profile, { recursive: true, force: true });
}
result.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(outDir, "rehearsal.json"), JSON.stringify(result, null, 2) + "\n");
log(`result -> ${path.join(outDir, "rehearsal.json")} (${exit === 0 ? "PASS" : "FAIL"})`);
process.exit(exit);
