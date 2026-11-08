# BombKicker player site (React)

Source of the player site (SS-13 shell and play flow; SS-14 adds shop, leaderboard, profile). Plan and contract:
`BombKicker/docs/skin-shop-plan.md`; copy and states: `BombKicker/.agents/tasks/skin-shop/ux-spec.md`.
The files in the repo root (`../index.html`, `../Build`) are the live GitHub Pages build and are not touched here.

## Commands

| | |
|---|---|
| `npm run dev:mock` | mock API + mock Unity at `http://localhost:5180/bombkicker-web/` (no other services) |
| `npm run dev` | real API (`<page host>:8787`, or `VITE_API_URL`) and the Unity build in `public/game/` |
| `npm run build` / `npm run lint` / `npm run typecheck` / `npm test` | build, eslint, tsc, vitest |
| `npx playwright test` | mock suite: desktop Chromium, desktop WebKit, iPhone 15 WebKit; screenshots to `BombKicker/.agents/tasks/skin-shop/react-shell/` (`SHOT_DIR`) |
| `BK_E2E_REAL=1 npx playwright test` | real suite (below) |

Mock knobs for tests and manual checks: `window.__BK_MOCK__` (see `src/unity/mockUnity.ts`); room codes `AAAAAA`, `FFFFFF`,
`GGGGGG`, `BBBBBB` give `ROOM_NOT_FOUND`, `ROOM_FULL`, `SERVER_GONE`, `SERVERS_FULL`.

## Real suite setup

1. Unity WebGL build (`WebBuild.BuildWeb`, embedded mode from SS-8): copy `Builds/Web/Build` and `Builds/Web/StreamingAssets`
   to `public/game/` (gitignored), then `BK_CSP_LOCAL_API=1 npm run build` (CSP below; a plain build allows only the
   production API, so the page could not reach the local API).
2. bombkicker-api (branch `skin-shop`): own database, `npm run db:migrate`, `npm run db:seed-skins`, `npm run admin:build`,
   `npx wrangler dev --port 8787 --var CORS_ORIGINS:http://localhost:8010`.
   Unity sends local pages to `<page host>:8787`. If :8787 is taken, run the API on another port and set
   `BK_E2E_API=http://127.0.0.1:<port>`: the tests then forward every `localhost:8787` request there (Chromium only for
   Unity's POSTs; Playwright's WebKit drops routed XHR bodies, so the WebKit quick match is skipped in that mode).
3. Quick match: a local 1v1 dedicated server (`DevE2EBuild.BuildMacDev`) where `QUICKMATCH_1V1_HOST/PORT` point:
   `DEDICATED_SERVER=1 MATCH_MODE=1v1 PORT=<port> API_URL=http://127.0.0.1:<api port> SERVER_SECRET=… JOIN_SECRET=…
   BK_DEV_FORCE_END_AFTER=30 BombKicker -batchmode -nographics -dedicatedServer` (same secrets as the API's `.dev.vars`).
4. `BK_E2E_REAL=1 [BK_E2E_API=…] npx playwright test`.

## Shop suite (SS-14)
- Mock: `npx playwright test e2e/shop.mock.spec.ts` (all screens and every purchase error; knobs `purchaseErrors`,
  `equipErrors`, `purchaseDelayMs` in `src/api/mock.ts`). Screenshots go to `BombKicker/.agents/tasks/skin-shop/react-shop/`
  (`SHOP_SHOT_DIR`).
- Real: bombkicker-api `skin-shop-admin` with `ADMIN_DEV_BYPASS=true`, its own DB migrated and `npm run db:seed-skins`,
  wrangler dev on :8787 with `CORS_ORIGINS` = the preview origin (:8010), Unity build in `public/game/`, `BK_CSP_LOCAL_API=1 npm run build`,
  then `BK_E2E_REAL=1 npx playwright test e2e/shop.real.spec.ts`. The tests create their own skins through the admin API
  (`race-*` stock 1, `tint-*` with the magenta sheet in `e2e/fixtures/`) and set them INACTIVE afterwards. Logins are
  paced 6.5 s apart (guest login limit: 10 per 60 s per IP).

## Security (SS-7 recheck)

- CSP: `vite build` adds `<meta http-equiv="Content-Security-Policy">` to `index.html` (`src/csp.ts`; GitHub Pages cannot
  send headers, D10). `script-src 'self' blob: 'wasm-unsafe-eval'` and `worker-src 'self' blob:` are what the Unity loader
  needs (blob: framework script, blob: gzip worker, wasm); `connect-src` / `img-src` allow `'self'` and the production
  API only, and `connect-src` also the Edgegap game servers `wss://*.pr.edgegap.net:*` (Unity's WebSocket, dynamic port).
  Local builds: `BK_CSP_LOCAL_API=1` adds `http://localhost:8787` and `http://127.0.0.1:8787`, plus `ws://`/`wss://` to
  localhost and 127.0.0.1 (any port, local game servers); `VITE_API_URL` adds its origin (use `http://<LAN IP>:8787`
  for phone tests), and with `BK_CSP_LOCAL_API=1` ws/wss to its host if that host is local or on the LAN. `npm run dev` has no policy (hot reload uses inline scripts).
  `e2e/csp.real.spec.ts` and `e2e/security.mock.spec.ts` fail on any violation.
- Inside a frame the app does not start (`src/frameGuard.ts`): a `<meta>` CSP cannot carry `frame-ancestors`.
- `?mock=1` works on the dev server only (`isMockMode` in `src/config.ts`).
- Never render API text as HTML: skin names and display names are admin- or player-written.

## Notes

- Router: `ROUTER_MODE` in `src/config.ts` ("hash" for GitHub Pages, D10). The route stays out of the URL until Unity's
  `ready` (`src/router/gatedHistory.ts`): Unity's PlayerPrefs folder depends on the URL up to the last `/` (SS-1).
- Device id: `bk_device_id`; a first visit waits for Unity's `ready` and adopts `legacyDeviceId`. If Unity fails on a
  first visit, no id is created (the old account could still be found after a reload).
- Bridge: `src/unity/bridge.ts` (protocol v1). Messages to Unity wait for `ready`.
