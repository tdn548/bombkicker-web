#!/usr/bin/env bash
# Tests the SEC-014 publish guard: deploy-commit.sh refuses local test builds, build-site.sh and serve-site.sh keep
# local and production modes apart. Fast (no Unity, no Vite build): fake site folders with the real CSP from
# app/src/csp.ts, and a throwaway git repo for the deploy and rollback cases. Nothing is pushed.
#
#   scripts/test-publish-guard.sh        exit 0 = all cases passed
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
pass=0 fail=0
ok() { echo "  ok   $1"; pass=$((pass + 1)); }
ko() { echo "  FAIL $1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/       /'; fail=$((fail + 1)); }

# expect <0|1: should it pass> <name> <command...>; a refusal must also print REFUSED or a clear error.
expect() {
  local want="$1" name="$2" out code; shift 2
  out="$("$@" 2>&1)"; code=$?
  if [ "$want" -eq 0 ] && [ $code -eq 0 ]; then ok "$name"
  elif [ "$want" -eq 1 ] && [ $code -ne 0 ]; then ok "$name -> $(printf '%s' "$out" | grep -m1 -E 'REFUSED|build-site:|serve-site:|deploy-commit:' | cut -c1-110)"
  else ko "$name (exit $code)" "$out"; fi
}

# The real policies, from the same code the Vite build uses.
csp() { (cd "$repo" && node --input-type=module -e "
import { apiOrigins, buildCsp, cspMetaTag, gameServerSources } from './app/src/csp.ts';
const env = JSON.parse(process.argv[1]);
console.log(cspMetaTag(buildCsp(apiOrigins(env), gameServerSources(env))));" "$1"); }
prod_meta="$(csp '{}')" || { echo "cannot load app/src/csp.ts with node"; exit 1; }
local_meta="$(csp '{"BK_CSP_LOCAL_API":"1"}')"
lan_meta="$(csp '{"BK_CSP_LOCAL_API":"1","VITE_API_URL":"http://192.168.1.20:8787"}')"   # what build-site.sh --local-api <LAN> sets

# site <dir> <meta or ""> <local: true|false> [localApi]
site() {
  local d="$tmp/$1" la="null"; mkdir -p "$d/game/Build"
  [ -n "${4:-}" ] && la="\"$4\""
  printf '<!doctype html>\n<html><head>\n<meta charset="UTF-8" />\n    %s\n<title>BombKicker</title></head><body></body></html>\n' "$2" > "$d/index.html"
  printf '{\n  "react": { "commit": "1111111aaaaaaa", "branch": "t", "dirty": false },\n  "unity": { "commit": "2222222bbbbbbb", "dirty": false, "changedFiles": [], "builtAt": "x" },\n  "base": "/bombkicker-web/",\n  "local": %s,\n  "localApi": %s,\n  "builtAt": "x"\n}\n' "$3" "$la" > "$d/version.json"
  echo "loader $1" > "$d/game/Build/Web.loader.js"; : > "$d/.nojekyll"
  echo "$d"
}
prod="$(site prod "$prod_meta" false)"
loc="$(site local "$local_meta" true http://localhost:8787)"
lan="$(site lan "$lan_meta" true http://192.168.1.20:8787)"
# Hand-edited or mislabelled builds: version.json says production, the CSP says otherwise.
mis_local="$(site mislabel-localhost "$local_meta" false)"
mis_lan="$(site mislabel-lan "$lan_meta" false)"
mis_10="$(site mislabel-10 "${prod_meta/connect-src \'self\'/connect-src \'self\' https://10.0.0.5:8443}" false)"
mis_v6="$(site mislabel-v6 "${prod_meta/connect-src \'self\'/connect-src \'self\' http://[::1]:8787}" false)"
mis_mdns="$(site mislabel-mdns "${prod_meta/connect-src \'self\'/connect-src \'self\' https://macbook.local:8787}" false)"
# BUG-SS18-001: a game server WebSocket to a local host (the local build's ws/wss sources), version.json not local.
mis_ws127="$(site mislabel-ws127 "${prod_meta/connect-src \'self\'/connect-src \'self\' ws://127.0.0.1:*}" false)"
mis_wss_lan="$(site mislabel-wss-lan "${prod_meta/connect-src \'self\'/connect-src \'self\' wss://192.168.1.20:*}" false)"
mis_ws_localhost="$(site mislabel-ws-localhost "${prod_meta/connect-src \'self\'/connect-src \'self\' wss://localhost:7900}" false)"
mis_ws_public="$(site mislabel-ws-public "${prod_meta/connect-src \'self\'/connect-src \'self\' ws://game.example:*}" false)"
no_edgegap="$(site no-edgegap "${prod_meta/ wss:\/\/\*.pr.edgegap.net:\*/}" false)"
# Relay rooms (D5b): the Unity Relay server WebSocket and the lobby service must stay in connect-src
no_relay="$(site no-unity-relay "${prod_meta/ wss:\/\/\*.relay.uf.unity3d.com:\*/}" false)"
no_lobby="$(site no-unity-lobby "${prod_meta/ https:\/\/lobby.services.api.unity.com/}" false)"
nocsp="$(site no-csp "" false)"
noprod="$(site no-prod-api "${prod_meta//https:\/\/bombkicker-api-production.tdn548.workers.dev/https://example.com}" false)"
localflag="$(site local-flag-only "$prod_meta" true)"

case "$prod_meta" in *"wss://*.pr.edgegap.net:*"*) ok "production policy allows wss://*.pr.edgegap.net:*" ;; *) ko "production policy lacks the Edgegap game servers" "$prod_meta" ;; esac
case "$prod_meta" in *"https://player-auth.services.api.unity.com https://lobby.services.api.unity.com https://relay-allocations.services.api.unity.com wss://wire.unity3d.com wss://*.relay.uf.unity3d.com:*"*) ok "production policy allows the Unity Services and Unity Relay sources" ;; *) ko "production policy lacks the Unity sources" "$prod_meta" ;; esac
case "$prod_meta" in *ws://*|*127.0.0.1*|*localhost*) ko "production policy names a local or ws: source" "$prod_meta" ;; *) ok "production policy has no local or ws: source" ;; esac
case "$local_meta" in *"ws://127.0.0.1:* wss://127.0.0.1:*"*) ok "local policy allows ws/wss to 127.0.0.1 (any port)" ;; *) ko "local policy lacks 127.0.0.1 game servers" "$local_meta" ;; esac
case "$lan_meta" in *"ws://192.168.1.20:* wss://192.168.1.20:*"*) ok "LAN policy allows ws/wss to the LAN host" ;; *) ko "LAN policy lacks the LAN game server" "$lan_meta" ;; esac
D="$here/deploy-commit.sh"
echo "deploy-commit.sh --check (dry run)"
expect 0 "production build passes"                       "$D" --check --site "$prod"
expect 1 "local build (localhost) refused"               "$D" --check --site "$loc"
expect 1 "local build (LAN ip) refused"                  "$D" --check --site "$lan"
expect 1 "version.json local:true, production CSP"       "$D" --check --site "$localflag"
expect 1 "CSP with localhost, version.json not local"    "$D" --check --site "$mis_local"
expect 1 "CSP with 192.168.x, version.json not local"    "$D" --check --site "$mis_lan"
expect 1 "CSP with https://10.x"                         "$D" --check --site "$mis_10"
expect 1 "CSP with [::1]"                                "$D" --check --site "$mis_v6"
expect 1 "CSP with *.local"                              "$D" --check --site "$mis_mdns"
expect 1 "CSP with ws://127.0.0.1:* (game server)"      "$D" --check --site "$mis_ws127"
expect 1 "CSP with wss://192.168.x:* (game server)"      "$D" --check --site "$mis_wss_lan"
expect 1 "CSP with wss://localhost (game server)"        "$D" --check --site "$mis_ws_localhost"
expect 1 "CSP with a plain ws:// source"                 "$D" --check --site "$mis_ws_public"
expect 1 "connect-src without the Edgegap game servers"  "$D" --check --site "$no_edgegap"
expect 1 "connect-src without Unity Relay"               "$D" --check --site "$no_relay"
expect 1 "connect-src without the Unity lobby service"   "$D" --check --site "$no_lobby"
expect 1 "no CSP meta"                                   "$D" --check --site "$nocsp"
expect 1 "connect-src without the production API"        "$D" --check --site "$noprod"

echo "deploy-commit.sh on a throwaway Pages repo"
r="$tmp/pages"; mkdir -p "$r" && git -C "$r" init -q -b main
git -C "$r" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
mkdir -p "$r/app" "$r/scripts" && echo src > "$r/app/x" && echo src > "$r/scripts/x" && echo readme > "$r/README.md"
git -C "$r" add -A && git -C "$r" -c user.email=t@t -c user.name=t commit -q -m source
# A local build committed by hand (not through deploy-commit), to test the rollback check.
cp -R "$loc"/. "$r"/ && git -C "$r" add -A && git -C "$r" -c user.email=t@t -c user.name=t commit -q -m "local build by hand"
bad_commit="$(git -C "$r" rev-parse HEAD)"
head0="$bad_commit"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
expect 1 "--site local build refused"                    "$D" --repo "$r" --site "$loc"
expect 1 "--site LAN build refused"                      "$D" --repo "$r" --site "$lan"
if [ "$(git -C "$r" rev-parse HEAD)" = "$head0" ] && [ -z "$(git -C "$r" status --porcelain)" ]; then ok "refusals left the repo untouched (no commit, clean tree)"
else ko "refusals changed the repo" "$(git -C "$r" status --short; git -C "$r" log --oneline -3)"; fi
expect 0 "--site production build commits"               "$D" --repo "$r" --site "$prod"
if git -C "$r" show HEAD:version.json | grep -q '"local": false' && [ "$(git -C "$r" rev-parse HEAD~1)" = "$head0" ]; then ok "deploy commit holds the production build"
else ko "deploy commit content"; fi
head1="$(git -C "$r" rev-parse HEAD)"
expect 1 "--rollback-to a commit holding a local build"  "$D" --repo "$r" --rollback-to "$bad_commit"
[ "$(git -C "$r" rev-parse HEAD)" = "$head1" ] && ok "rollback refusal made no commit" || ko "rollback refusal made a commit"
# A rollback to the Unity-only page (no CSP, no version.json) must still work.
git -C "$r" checkout -q -b unity-only "$head0~2" 2>/dev/null
echo '<html><head><meta charset="utf-8"></head></html>' > "$r/index.html" && mkdir -p "$r/Build" && echo b > "$r/Build/x"
git -C "$r" add -A && git -C "$r" commit -q -m "old unity page" && old_page="$(git -C "$r" rev-parse HEAD)"
git -C "$r" checkout -q main
expect 0 "--rollback-to the Unity-only page (no CSP) allowed" "$D" --repo "$r" --rollback-to "$old_page"

echo "build-site.sh mode switches (they fail before any build)"
B="$here/build-site.sh"
expect 1 "--local-api with a public ip"                  "$B" --unity /nonexistent --local-api http://8.8.8.8:8787
expect 1 "--local-api https production URL"              "$B" --unity /nonexistent --local-api https://bombkicker-api-production.tdn548.workers.dev
expect 1 "--local-api with another port"                 "$B" --unity /nonexistent --local-api http://localhost:9000
expect 1 "--local-api with a path"                       "$B" --unity /nonexistent --local-api http://192.168.1.20:8787/v1
expect 1 "production build with VITE_API_URL set"        env VITE_API_URL=http://localhost:8787 "$B" --unity /nonexistent
expect 1 "production build with BK_CSP_LOCAL_API set"    env BK_CSP_LOCAL_API=1 "$B" --unity /nonexistent
out="$("$B" --unity /nonexistent --local-api http://192.168.1.20:8787 2>&1)"
case "$out" in *"Unity build folder not found"*) ok "--local-api http://192.168.1.20:8787 accepted (stops later at --unity)" ;; *) ko "LAN origin not accepted" "$out" ;; esac

echo "serve-site.sh"
expect 1 "refuses a production-CSP build"                "$here/serve-site.sh" "$prod" --port 0

echo
echo "publish guard: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
