#!/usr/bin/env bash
# Builds the player site (React app/ + Unity WebGL build) into one folder to publish (SS-16).
#
#   scripts/build-site.sh --unity <Unity project>/Builds/Web [--out dist-site] [--base /bombkicker-web/] [--allow-dirty]
#                         [--local-api <origin>]
#
# --unity        Builds/Web of the Unity commit to ship (WebBuild.BuildWeb output: Build/ + StreamingAssets/).
#                The Unity commit is read from the git repo that contains this folder.
# --out          output folder (default: dist-site/ in this repo, gitignored). Emptied first.
# --base         URL path the site is served from (default /bombkicker-web/ = GitHub Pages, D10).
#                Unity's PlayerPrefs folder depends on the page URL, so production must keep /bombkicker-web/.
# --allow-dirty  build even if this repo or the Unity repo has uncommitted changes (local tests only;
#                version.json then says dirty: true). A publish build must be clean.
# --local-api    LOCAL TEST BUILD, never published (SEC-014). <origin> = the local API the page talks to:
#                http://localhost:8787 (or 127.0.0.1) for this Mac (rehearsal), http://<mac LAN ip>:8787 for the iPhone LAN preview.
#                The CSP then also allows http://localhost:8787, http://127.0.0.1:8787 and <origin>, and
#                version.json says "local": true. Default output: dist-local/. deploy-commit.sh refuses such a build.
#                Without --local-api the build is a production build: the CSP allows only the production API, and
#                the script refuses VITE_API_URL / BK_CSP_LOCAL_API in the environment and checks the output with
#                deploy-commit.sh --check.
#
# Output: index.html + assets/ (Vite), skins/, game/Build + game/StreamingAssets (Unity, unchanged:
# gzip + decompression fallback, so GitHub Pages needs no Content-Encoding header), version.json, .nojekyll.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
unity_dir="" out="" base="/bombkicker-web/" allow_dirty=0 local_api=

die() { echo "build-site: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --unity) unity_dir="${2:-}"; shift 2 ;;
    --out) out="${2:-}"; shift 2 ;;
    --base) base="${2:-}"; shift 2 ;;
    --allow-dirty) allow_dirty=1; shift ;;
    --local-api) local_api="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

# --- API mode (SEC-014): production, or a local test build that must never be published ---
# Local API origin: http://<host>:8787 (Unity's ApiConfig always uses <page host>:8787 for local pages), host =
# localhost, 127.0.0.1 or a private LAN IPv4 (10.x, 172.16-31.x, 192.168.x; same rule as config.ts isLocalHost).
is_local_origin() {
  local o="$1" host a b
  [[ "$o" =~ ^http://([a-z0-9.]+):8787$ ]] || return 1
  host="${BASH_REMATCH[1]}"
  [ "$host" = localhost ] || [ "$host" = 127.0.0.1 ] && return 0
  [[ "$host" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
  a="${BASH_REMATCH[1]}" b="${BASH_REMATCH[2]}"
  [ "$a" -eq 10 ] || { [ "$a" -eq 192 ] && [ "$b" -eq 168 ]; } || { [ "$a" -eq 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ]; }
}
if [ -n "$local_api" ]; then
  is_local_origin "$local_api" || die "--local-api must be http://<localhost, 127.0.0.1 or private LAN ip>:8787 with no path (got '$local_api')"
  # BK_CSP_LOCAL_API=1: the CSP allows localhost:8787 and 127.0.0.1:8787 (Unity and React use <page host>:8787).
  # VITE_API_URL only for a LAN origin: React then calls that origin and the CSP allows it. For localhost it stays unset,
  # so React follows the page host (localhost or 127.0.0.1) exactly like Unity does.
  export BK_CSP_LOCAL_API=1
  case "$local_api" in http://localhost:*|http://127.0.0.1:*) unset VITE_API_URL ;; *) export VITE_API_URL="$local_api" ;; esac
  [ -n "$out" ] || out="$repo/dist-local"
else
  [ -z "${VITE_API_URL:-}" ] || die "VITE_API_URL is set in the environment: a production build must use the production API (unset it, or use --local-api for a local test build)"
  [ -z "${BK_CSP_LOCAL_API:-}" ] || die "BK_CSP_LOCAL_API is set in the environment: a production build must not allow local origins (unset it, or use --local-api)"
  [ -n "$out" ] || out="$repo/dist-site"
fi

[ -n "$unity_dir" ] || die "--unity <path to Builds/Web> is required"
[ -d "$unity_dir" ] || die "Unity build folder not found: $unity_dir"
unity_dir="$(cd "$unity_dir" && pwd)"
case "$base" in /*/) ;; *) die "--base must start and end with / (got $base)" ;; esac
mkdir -p "$out"
out="$(cd "$out" && pwd)"
case "$out" in "$repo"|"$repo/app"|"$repo/app/"*|/) die "refusing to use $out as the output folder" ;; esac

# --- Unity build checks: the files the React loader asks for (app/src/config.ts UNITY_BUILD) ---
for f in Build/Web.loader.js Build/Web.data.unityweb Build/Web.framework.js.unityweb Build/Web.wasm.unityweb; do
  [ -s "$unity_dir/$f" ] || die "missing $unity_dir/$f (run WebBuild.BuildWeb in that Unity commit)"
done
[ -d "$unity_dir/StreamingAssets" ] || die "missing $unity_dir/StreamingAssets"
# Gzip + decompression fallback (Assets/Editor/WebBuild.cs): .unityweb files that start with the gzip magic 1f8b.
for f in "$unity_dir"/Build/*.unityweb; do
  [ "$(head -c 2 "$f" | od -An -tx1 | tr -d ' \n')" = "1f8b" ] || die "$f is not gzip; build with WebBuild.BuildWeb (gzip + decompression fallback)"
done
ls "$unity_dir"/Build/*.br >/dev/null 2>&1 && die "Brotli files in $unity_dir/Build: GitHub Pages cannot serve them"

# --- Provenance ---
git_info() { # <dir> -> "commit dirty" for the repo containing <dir>
  local dir="$1" commit dirty
  commit="$(git -C "$dir" rev-parse HEAD 2>/dev/null)" || { echo "unknown false"; return; }
  if [ -n "$(git -C "$dir" status --porcelain --untracked-files=no 2>/dev/null)" ]; then dirty=true; else dirty=false; fi
  echo "$commit $dirty"
}
read -r react_commit react_dirty < <(git_info "$repo")
read -r unity_commit unity_dirty < <(git_info "$unity_dir")
[ "$unity_commit" != "unknown" ] || die "$unity_dir is not inside a git repo, so the Unity commit is unknown"
unity_changes="$(git -C "$unity_dir" diff --name-only HEAD || true)"
if [ "$allow_dirty" -eq 0 ]; then
  [ "$react_dirty" = false ] || die "bombkicker-web has uncommitted changes (commit them, or --allow-dirty for a local test)"
  [ "$unity_dirty" = false ] || die "Unity repo has uncommitted changes:
$unity_changes
Build from a clean worktree, or --allow-dirty for a local test"
fi
unity_built_at="$(date -u -r "$unity_dir/Build/Web.wasm.unityweb" +%Y-%m-%dT%H:%M:%SZ)"

# --- React build ---
cd "$repo/app"
[ -d node_modules ] || npm ci --no-audit --no-fund
npx tsc -b
# app/public/game (local dev copy, gitignored) must not leak into the output: it is replaced below.
npx vite build --base "$base" --outDir "$out" --emptyOutDir

# --- Unity build into game/ ---
rm -rf "$out/game"
mkdir -p "$out/game"
cp -R "$unity_dir/Build" "$out/game/Build"
cp -R "$unity_dir/StreamingAssets" "$out/game/StreamingAssets"
find "$out" -name .DS_Store -delete

# GitHub Pages: skip Jekyll (it would hide files and folders starting with _).
: > "$out/.nojekyll"

json_list() { # newline list -> JSON array of strings
  local first=1 line
  printf '['
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    [ $first -eq 1 ] || printf ', '
    printf '"%s"' "$(printf '%s' "$line" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    first=0
  done
  printf ']'
}
cat > "$out/version.json" <<EOF
{
  "react": { "commit": "$react_commit", "branch": "$(git -C "$repo" rev-parse --abbrev-ref HEAD)", "dirty": $react_dirty },
  "unity": { "commit": "$unity_commit", "dirty": $unity_dirty, "changedFiles": $(printf '%s\n' "$unity_changes" | json_list), "builtAt": "$unity_built_at" },
  "base": "$base",
  "local": $([ -n "$local_api" ] && echo true || echo false),
  "localApi": $([ -n "$local_api" ] && printf '"%s"' "$local_api" || echo null),
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

if [ -n "$local_api" ]; then
  echo "build-site: LOCAL TEST BUILD (API $local_api). Never publish it; deploy-commit.sh refuses it."
else
  # Same check deploy-commit.sh runs before publishing (CSP present, no local origins, not local): fail here, not later.
  "$repo/scripts/deploy-commit.sh" --check --site "$out"
fi
echo "build-site: done -> $out"
echo "  react $react_commit (dirty: $react_dirty)"
echo "  unity $unity_commit (dirty: $unity_dirty)"
du -sh "$out" | awk '{print "  size " $1}'
