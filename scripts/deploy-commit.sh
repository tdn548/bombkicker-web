#!/usr/bin/env bash
# Makes the deploy commit on the GitHub Pages branch (main, root; Pages settings unchanged, D10 = A). It does NOT push.
#
#   scripts/deploy-commit.sh --site <folder from build-site.sh>     publish a new build
#   scripts/deploy-commit.sh --rollback-to <deploy commit>          put back the site of an earlier deploy commit
#   scripts/deploy-commit.sh --check --site <folder>                dry run: only the publish check below, no git
#   options: --repo <bombkicker-web checkout> (default: the repo of the current directory)
#            --branch <name> (default main: the branch GitHub Pages serves)
#
# The repo root holds the published site next to the source. A deploy replaces every top-level entry except the
# source paths in KEEP below, so Pages keeps serving / of main. Then push with: git push origin main
#
# Publish check (SEC-014), before anything in the repo changes. Refused:
#   - version.json says "local": true or has a localApi (build-site.sh --local-api: a local test build)
#   - --site: index.html has no Content-Security-Policy meta, or its connect-src lacks the production API or the
#     Edgegap game servers (wss://*.pr.edgegap.net:*, BUG-SS18-001: without it online play cannot connect)
#   - the policy names an http: or ws: source, localhost, 127.x, 0.0.0.0, [::1], *.local or a private / link-local IPv4
# A rollback runs the same check, but may restore a site without a CSP (the Unity-only page, before the React site).
set -euo pipefail

KEEP=(.git .gitignore README.md app scripts)

die() { echo "deploy-commit: $*" >&2; exit 1; }
PRODUCTION_API="https://bombkicker-api-production.tdn548.workers.dev"   # app/src/csp.ts PRODUCTION_API_URL
GAME_SERVERS='wss://\*\.pr\.edgegap\.net:\*'                              # app/src/csp.ts PRODUCTION_GAME_SERVERS (as a regex)
site="" rollback="" repo="" branch="main" check_only=0
while [ $# -gt 0 ]; do
  case "$1" in
    --site) site="${2:-}"; shift 2 ;;
    --rollback-to) rollback="${2:-}"; shift 2 ;;
    --repo) repo="${2:-}"; shift 2 ;;
    --branch) branch="${2:-}"; shift 2 ;;
    --check) check_only=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done
if { [ -n "$site" ] && [ -n "$rollback" ]; } || { [ -z "$site" ] && [ -z "$rollback" ]; }; then
  die "give exactly one of --site <folder> or --rollback-to <commit>"
fi
[ "$check_only" -eq 0 ] || [ -n "$site" ] || die "--check needs --site <folder>"

# publish_check <site dir> <require csp: 1|0>  (SEC-014; see the header)
publish_check() {
  local dir="$1" require_csp="$2" policy bad
  if [ -f "$dir/version.json" ]; then
    grep -Eq '"local"[[:space:]]*:[[:space:]]*true' "$dir/version.json" \
      && die "REFUSED: version.json says \"local\": true. This is a local test build (build-site.sh --local-api), never publish it. Build again without --local-api."
    grep -Eq '"localApi"[[:space:]]*:[[:space:]]*"' "$dir/version.json" \
      && die "REFUSED: version.json names a localApi: a local test build, never publish it"
  fi
  # Content of <meta http-equiv="Content-Security-Policy" content="...">, one line (Vite writes it on one line).
  policy="$(tr '\n' ' ' < "$dir/index.html" | grep -Eio '<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>' | head -n 1 \
    | sed -E 's/.*content="([^"]*)".*/\1/' || true)"
  if [ -z "$policy" ]; then
    [ "$require_csp" -eq 1 ] && die "REFUSED: index.html has no Content-Security-Policy meta (build with react-security merged, SEC-008/SEC-014)"
    echo "deploy-commit: note: this site has no CSP meta (a site from before the React CSP)" >&2
    return 0
  fi
  bad="$(printf '%s\n' "$policy" | tr ' ;' '\n\n' | grep -Ei \
    '^http:|^ws:|localhost|(^|[/.])127\.[0-9]|0\.0\.0\.0|\[::1\]|\.local([:/]|$)|(^|//)10\.[0-9]+\.|(^|//)192\.168\.|(^|//)172\.(1[6-9]|2[0-9]|3[01])\.|(^|//)169\.254\.' \
    | sort -u | tr '\n' ' ' || true)"
  [ -z "$bad" ] || die "REFUSED: the CSP in index.html allows local origins: $bad(a local test build, never publish it)"
  if [ "$require_csp" -eq 1 ]; then
    printf '%s\n' "$policy" | tr ';' '\n' | grep -Eq "^[[:space:]]*connect-src( [^ ]+)* $PRODUCTION_API( |\$)" \
      || die "REFUSED: the CSP connect-src does not allow the production API $PRODUCTION_API"
    printf '%s\n' "$policy" | tr ';' '\n' | grep -Eq "^[[:space:]]*connect-src( [^ ]+)* $GAME_SERVERS( |\$)" \
      || die "REFUSED: the CSP connect-src does not allow the game servers wss://*.pr.edgegap.net:* (online play would be blocked, BUG-SS18-001)"
  fi
  return 0
}

if [ "$check_only" -eq 1 ]; then
  [ -f "$site/index.html" ] || die "no index.html in $site"
  publish_check "$site" 1
  echo "deploy-commit: check passed: $site is a production build (CSP present, production API and Edgegap game servers only, not local)"
  exit 0
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
  publish_check "$site" 0
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
  publish_check "$site" 1
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
