# BombKicker (Web)
Play: https://tdn548.github.io/bombkicker-web/
Online 2v2 / 1v1 Bomberman-style game where you kick bombs at the other team.
Made with Unity 6, Netcode for GameObjects and Unity Relay/Lobby. Runs in desktop
and mobile browsers (touch controls, rotate to landscape).

This repository holds the published site at its root (GitHub Pages serves `main`, folder `/`) and the source of the
React player site in `app/` (see `app/README.md`). The Unity game source is private; only its WebGL build is published.

## Layout

| Path | What |
|---|---|
| `index.html`, `assets/`, `skins/`, `game/Build`, `game/StreamingAssets`, `version.json`, `.nojekyll` | published site (written only by `scripts/deploy-commit.sh`) |
| `app/` | React source (Vite). Never published as a page (Pages serves its files, but nothing links to them) |
| `scripts/` | `build-site.sh`, `deploy-commit.sh`, `serve-site.sh`, `rehearse-migration.mjs` |

`version.json` on the live site tells which React and Unity commits are live:
`curl -s https://tdn548.github.io/bombkicker-web/version.json`.

## Runbook

Hosting is GitHub Pages at the same URL (skin-shop plan D10 = A). Pages settings stay as they are (branch `main`,
folder `/`, legacy build with `.nojekyll`). Same URL means Unity's old PlayerPrefs (`BK_DEVICE_ID`) are still readable,
so old players keep their account with no transfer code (D2 = later). `CORS_ORIGINS` of the Worker stays
`https://tdn548.github.io`.

### 1. Build

Needs: Node 24+, `npm ci` once in `app/`, and a Unity WebGL build made by `WebBuild.BuildWeb` (gzip + decompression
fallback, `Builds/Web`) **from the same Unity commit as the Edgegap server image** (skin-shop plan, Rollout step 5).

```sh
# Unity build in its own worktree (never kill another Unity process; if batchmode is busy, wait and retry)
git -C ~/Unity/BombKicker worktree add ../BombKicker-release <unity-commit>
/Applications/Unity/Hub/Editor/6000.3.10f1/Unity.app/Contents/MacOS/Unity -batchmode -quit \
  -projectPath ~/Unity/BombKicker-release -executeMethod WebBuild.BuildWeb -logFile ~/Unity/BombKicker-release/webbuild.log

# Site build (this repo, clean checkout)
scripts/build-site.sh --unity ~/Unity/BombKicker-release/Builds/Web      # -> dist-site/
scripts/serve-site.sh dist-site                                           # check http://localhost:8000/bombkicker-web/
```

`build-site.sh` refuses a dirty repo. Opening the Unity project rewrites `.vscode/settings.json` and
`Assets/MyGame/Art/Fonts/PixelifySans SDF.asset` (TextMeshPro import side effect). If `git -C <unity worktree> diff
--stat` shows only those, add `--allow-dirty`; `version.json` then lists the changed files.

Checks done by the script: the four Unity files exist, the `.unityweb` files are gzip (decompression fallback, so
Pages needs no `Content-Encoding` header), no Brotli files. It writes `version.json` (React commit, Unity commit, dirty
flags, build times) and `.nojekyll`.

### 2. Publish (OWNER)

Once only, before the first React deploy: put the source on `main`. This does not change the live game (the root
build stays the same).

```sh
cd ~/Unity/bombkicker-web                 # checkout of main
git fetch origin && git status            # must be clean, on main, equal to origin/main
git merge --ff-only deploy-pipeline
git push origin main
```

Every deploy:

```sh
cd ~/Unity/bombkicker-web                 # on main, clean, up to date
scripts/build-site.sh --unity <unity worktree>/Builds/Web
scripts/deploy-commit.sh --site dist-site # commit "Deploy: React <sha> + Unity <sha>", not pushed
git show --stat HEAD                      # only root site files changed; app/, scripts/, README.md untouched
git rev-parse --short HEAD~1              # write this down: the commit to roll back to
git push origin main                      # PUBLISH (see the ordering rule below first)
gh run list -R tdn548/bombkicker-web -L 1 # "pages build and deployment" must end with success (1-2 min)
curl -s https://tdn548.github.io/bombkicker-web/version.json
```

GitHub Pages sends `Cache-Control: max-age=600`: a returning player can get the old page for up to 10 minutes. Tell
players to close and reopen the tab (hard refresh).

#### Ordering rule for the skin-shop release (SS-11, skin-shop plan Rollout step 5)

The new web build carries Unity net layout `nv: 2`. A v3 server rejects old pages ("Game version mismatch, reload the
game"), but a v2 server cannot reject a new page, and that player desyncs. So the web build must not be published
while any v2 deployment can still take players:

1. In bombkicker-api (release commit): set `EDGEGAP_VERSION = "v3"` under `[env.production.vars]` in `wrangler.toml`,
   then `npx wrangler deploy --env production`. Write down the time: `date -u +%Y-%m-%dT%H:%M:%SZ` -> `T0`.
2. Wait **at least 200 s** after `T0` (the Worker stops routing to a lobby at `idle_expired` = 200 s; the server's own
   lobby limit is 180 s).
3. Check on Neon that no deployment from before `T0` can still take a player (must return 0 rows):

   ```sh
   psql "$NEON_DATABASE_URL" -c "SELECT id, mode, state, created_at FROM game_servers
     WHERE created_at < '<T0>' AND state IN ('requesting','starting','ready') ORDER BY created_at;"
   ```

   If rows come back, wait and run it again. v2 deployments in `in_match` may keep running (they only take back their
   own old players).
4. Only now `git push origin main` (the deploy commit above). Between step 1 and step 4 online play is down for
   everyone (old pages are rejected by v3 servers), so prepare the deploy commit before step 1 and keep the gap to a
   few minutes.

### 3. Roll back (OWNER)

Any earlier commit of `main` holds the site that was live then. Roll back with a new commit (no force push):

```sh
cd ~/Unity/bombkicker-web                 # on main, clean, up to date
scripts/deploy-commit.sh --rollback-to <previous deploy commit>   # e.g. the HEAD~1 written down at publish time
git show --stat HEAD
git push origin main
```

For the skin-shop release the order is the reverse of publishing: **first** the web rollback above (push, Pages
success), **then** `EDGEGAP_VERSION = "v2"` + `npx wrangler deploy --env production`. Players still on the new page
desync on v2 servers until they reload, so tell them to hard-refresh. The Worker tables stay (additive).

Rollback was rehearsed (SS-16): `--rollback-to` the commit before the first React deploy gives a root identical to
`2a4e80f` (same git trees for `index.html`, `Build`, `StreamingAssets`, `TemplateData`, `.nojekyll`).

## Account migration rehearsal

```sh
git -C ~/Unity/bombkicker-web archive <live commit> | tar -x -C /tmp/bk-old   # the live site
node scripts/rehearse-migration.mjs --old /tmp/bk-old --new dist-site --out <screenshot dir>
```

Needs a local bombkicker-api on :8787 with `CORS_ORIGINS` containing `http://localhost:8000`. It opens the old site at
`http://localhost:8000/bombkicker-web/` in a fresh Chromium profile (Unity creates `BK_DEVICE_ID` and logs in), then the
new site at the same URL in the same profile (HTTP cache cleared, IndexedDB kept, like a player coming back), checks
that `GET /v1/me` returns the same player id, then plays an offline bots match. Result in `<out>/rehearsal.json`.

## Preview on the iPhone (D17: iPhone only, no staging)

Unity and React pick the API from the page host: localhost or a LAN address -> `<page host>:8787` (local API),
anything else -> production API. Choose the preview by where it is served.

### A. LAN URL, local API (nothing is published)

```sh
# bombkicker-api checkout with its own DB, listening on the LAN:
npx wrangler dev --port 8787 --ip 0.0.0.0 --var "CORS_ORIGINS:http://localhost:8000,http://<mac ip>:8000"
# this repo:
scripts/serve-site.sh dist-site           # prints http://<mac ip>:8000/bombkicker-web/
```

iPhone on the same Wi-Fi, Safari: `http://<mac ip>:8000/bombkicker-web/` (`ipconfig getifaddr en0` gives the IP;
allow incoming connections for python3 and workerd if macOS asks). Known limit: plain `http://` on a LAN address is not
a secure context, so `crypto.randomUUID` is missing and **Buy fails** (`app/src/features/shop/purchaseFlow.ts`);
login, menu, equip, leaderboard and offline play work. Online needs a local dedicated server (`app/README.md`).

### B. Second GitHub Pages repo, production API

`https://tdn548.github.io/bombkicker-web-preview/` is the same origin as the live site, so `CORS_ORIGINS` needs no
change, and it is https (Buy works). It uses a different path, so it does not touch live players' saved data; it
creates its own guest account in production. Usable only after the production Worker has the shop routes (Rollout
step 4; today `GET /v1/skins` answers 404). Do not play online from it while production runs `EDGEGAP_VERSION = "v2"`
(the preview has `nv: 2` and would desync).

```sh
gh repo create tdn548/bombkicker-web-preview --public
scripts/build-site.sh --unity <unity worktree>/Builds/Web --out dist-preview --base /bombkicker-web-preview/
cd dist-preview && git init -b main && git add -A && git commit -m "Preview: $(sed -n 's/.*"react": { "commit": "\(.......\).*/React \1/p' version.json)"
git remote add origin https://github.com/tdn548/bombkicker-web-preview && git push -u origin main
gh api -X POST repos/tdn548/bombkicker-web-preview/pages -f "source[branch]=main" -f "source[path]=/"
```

Update: run the same `build-site.sh` line again (Vite empties `dist-preview` but keeps its `.git`), then
`cd dist-preview && git add -A && git commit -m "Preview update" && git push`. Delete when done:
`gh repo delete tdn548/bombkicker-web-preview`.
