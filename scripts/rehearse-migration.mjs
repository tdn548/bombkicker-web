// Account migration rehearsal for D10 = A (same URL), SS-16. Runs real HTTP servers, no request routing:
//   A. the current production page (a commit whose root is the old Unity-only build) at http://localhost:<port>/bombkicker-web/
//      -> Unity creates BK_DEVICE_ID and logs in as a guest (player id from the POST /v1/auth/guest answer)
//   B. same browser profile, same port and path, now the new site (a deploy commit or build-site.sh output)
//      -> React adopts Unity's legacy device id; GET /v1/me must return the same player id
//   C. (unless --no-offline) offline 1v1 bots match in the new site -> result -> back to the menu
//
//   node scripts/rehearse-migration.mjs --old <folder> --new <folder> [--port 8000] [--api http://localhost:8787]
//        [--out <screenshot dir>] [--no-offline] [--headed]
// Needs: app/node_modules (npm ci in app/) with Playwright's Chromium, and a local bombkicker-api on :8787 whose
// CORS_ORIGINS has http://localhost:<port> (Unity and React send localhost pages to localhost:8787).
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
const api = opt("api", "http://localhost:8787");
const outDir = opt("out", path.join(os.tmpdir(), "bk-rehearsal"));
const offline = !args.includes("--no-offline");
if (!oldDir || !newDir) {
  console.error("usage: node scripts/rehearse-migration.mjs --old <folder> --new <folder> [--port 8000]");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const url = `http://localhost:${port}/bombkicker-web/`;
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
  await page.addInitScript(() => { window.__BK_BRIDGE_LOG__ = []; });
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
