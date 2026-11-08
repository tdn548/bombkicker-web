#!/usr/bin/env bash
# Makes the deploy commit on the GitHub Pages branch (main, root; Pages settings unchanged, D10 = A). It does NOT push.
#
#   scripts/deploy-commit.sh --site <folder from build-site.sh>     publish a new build
#   scripts/deploy-commit.sh --rollback-to <deploy commit>          put back the site of an earlier deploy commit
#   options: --repo <bombkicker-web checkout> (default: the repo of the current directory)
#            --branch <name> (default main: the branch GitHub Pages serves)
#
# The repo root holds the published site next to the source. A deploy replaces every top-level entry except the
# source paths in KEEP below, so Pages keeps serving / of main. Then push with: git push origin main
set -euo pipefail

KEEP=(.git .gitignore README.md app scripts)

die() { echo "deploy-commit: $*" >&2; exit 1; }
site="" rollback="" repo="" branch="main"
while [ $# -gt 0 ]; do
  case "$1" in
    --site) site="${2:-}"; shift 2 ;;
    --rollback-to) rollback="${2:-}"; shift 2 ;;
    --repo) repo="${2:-}"; shift 2 ;;
    --branch) branch="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done
if { [ -n "$site" ] && [ -n "$rollback" ]; } || { [ -z "$site" ] && [ -z "$rollback" ]; }; then
  die "give exactly one of --site <folder> or --rollback-to <commit>"
fi

repo="$(git -C "${repo:-.}" rev-parse --show-toplevel)" || die "not a git repo: ${repo:-.}"
cd "$repo"
current="$(git rev-parse --abbrev-ref HEAD)"
[ "$current" = "$branch" ] || die "checked out branch is '$current', expected '$branch' (the Pages branch)"
[ -z "$(git status --porcelain)" ] || die "working tree of $repo is not clean"

is_kept() { local n="$1" k; for k in "${KEEP[@]}"; do [ "$n" = "$k" ] && return 0; done; return 1; }

tmp=""
cleanup() { [ -n "$tmp" ] && rm -rf "$tmp"; return 0; }
trap cleanup EXIT

if [ -n "$rollback" ]; then
  target="$(git rev-parse --verify "$rollback^{commit}")" || die "unknown commit $rollback"
  tmp="$(mktemp -d)"
  git archive "$target" | tar -x -C "$tmp"
  for k in "${KEEP[@]}"; do rm -rf "${tmp:?}/$k"; done
  site="$tmp"
  [ -f "$site/index.html" ] || die "$rollback has no index.html at the root: not a deploy commit"
  if [ -f "$site/version.json" ]; then
    what="$(sed -n 's/.*"react": { "commit": "\([0-9a-f]\{7\}\).*/React \1/p' "$site/version.json") $(sed -n 's/.*"unity": { "commit": "\([0-9a-f]\{7\}\).*/Unity \1/p' "$site/version.json")"
  else
    what="Unity-only page, before the React site"
  fi
  msg="Rollback: site of $(git rev-parse --short "$target") ($what)"
else
  [ -d "$site" ] || die "site folder not found: $site"
  site="$(cd "$site" && pwd)"
  [ -f "$site/index.html" ] && [ -f "$site/version.json" ] && [ -f "$site/game/Build/Web.loader.js" ] \
    || die "$site does not look like build-site.sh output (index.html, version.json, game/Build)"
  grep -q '"dirty": true' "$site/version.json" && echo "deploy-commit: WARNING version.json says a repo was dirty at build time" >&2
  react="$(sed -n 's/.*"react": { "commit": "\([0-9a-f]\{7\}\).*/\1/p' "$site/version.json")"
  unity="$(sed -n 's/.*"unity": { "commit": "\([0-9a-f]\{7\}\).*/\1/p' "$site/version.json")"
  msg="Deploy: React $react + Unity $unity"
fi

for entry in "$site"/* "$site"/.[!.]*; do
  [ -e "$entry" ] || continue
  is_kept "$(basename "$entry")" && die "site contains $(basename "$entry"), which is a source path kept in the repo"
done

# Remove the old published files (tracked top-level entries outside KEEP), then copy the new site in.
while IFS= read -r -d '' name; do
  is_kept "$name" || git rm -r -q -- "$name"
done < <(git ls-tree -z --name-only HEAD)
cp -R "$site"/. "$repo"/
git add -A -- .
for k in "${KEEP[@]}"; do
  [ "$k" = .git ] || git diff --cached --quiet -- "$k" 2>/dev/null || die "a kept source path changed: $k"
done
git diff --cached --quiet && die "nothing changed: the site is already published"
git commit -q -m "$msg"
echo "deploy-commit: $(git log --oneline -1)"
echo "  previous deploy (for rollback): $(git rev-parse --short HEAD~1)"
echo "  not pushed. Publish with: git -C \"$repo\" push origin $branch"
