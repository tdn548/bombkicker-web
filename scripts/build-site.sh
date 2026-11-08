#!/usr/bin/env bash
# Builds the player site (React app/ + Unity WebGL build) into one folder to publish (SS-16).
#
#   scripts/build-site.sh --unity <Unity project>/Builds/Web [--out dist-site] [--base /bombkicker-web/] [--allow-dirty]
#
# --unity        Builds/Web of the Unity commit to ship (WebBuild.BuildWeb output: Build/ + StreamingAssets/).
#                The Unity commit is read from the git repo that contains this folder.
# --out          output folder (default: dist-site/ in this repo, gitignored). Emptied first.
# --base         URL path the site is served from (default /bombkicker-web/ = GitHub Pages, D10).
#                Unity's PlayerPrefs folder depends on the page URL, so production must keep /bombkicker-web/.
# --allow-dirty  build even if this repo or the Unity repo has uncommitted changes (local tests only;
#                version.json then says dirty: true). A publish build must be clean.
#
# Output: index.html + assets/ (Vite), skins/, game/Build + game/StreamingAssets (Unity, unchanged:
# gzip + decompression fallback, so GitHub Pages needs no Content-Encoding header), version.json, .nojekyll.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
unity_dir="" out="$repo/dist-site" base="/bombkicker-web/" allow_dirty=0

die() { echo "build-site: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --unity) unity_dir="${2:-}"; shift 2 ;;
    --out) out="${2:-}"; shift 2 ;;
    --base) base="${2:-}"; shift 2 ;;
    --allow-dirty) allow_dirty=1; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

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
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "build-site: done -> $out"
echo "  react $react_commit (dirty: $react_dirty)"
echo "  unity $unity_commit (dirty: $unity_dirty)"
du -sh "$out" | awk '{print "  size " $1}'
