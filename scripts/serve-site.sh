#!/usr/bin/env bash
# Serves a site folder locally under the GitHub Pages path, like https://tdn548.github.io/bombkicker-web/ (SS-16).
#
#   scripts/serve-site.sh <folder> [--port 8000] [--base /bombkicker-web/]
#
# <folder>: build-site.sh output, or a bombkicker-web checkout (its root is what Pages serves).
# Listens on all interfaces, so a phone on the same Wi-Fi can open http://<mac LAN ip>:<port><base>.
# Headers copy GitHub Pages: Cache-Control max-age=600, no Content-Encoding (Unity's decompression fallback
# unpacks the .unityweb files). Unity and React send local and LAN pages to the API at <page host>:8787.
#
# Local mode (SEC-014): a site whose index.html has the CSP must be a build-site.sh --local-api build
# (version.json "local": true), else the CSP blocks every call to <page host>:8787. Such a site is refused here.
# Sites without a CSP (the old Unity-only page, a bombkicker-web checkout from before the React CSP) are served as is.
set -euo pipefail
die() { echo "serve-site: $*" >&2; exit 1; }
dir="" port=8000 base="/bombkicker-web/"
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="${2:-}"; shift 2 ;;
    --base) base="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) dir="$1"; shift ;;
  esac
done
[ -n "$dir" ] && [ -f "$dir/index.html" ] || die "give a folder with index.html (got '${dir}')"
case "$base" in /*/) ;; *) die "--base must start and end with /" ;; esac
dir="$(cd "$dir" && pwd)"
local_api=""
if grep -qi 'http-equiv="Content-Security-Policy"' "$dir/index.html"; then
  [ -f "$dir/version.json" ] && grep -Eq '"local"[[:space:]]*:[[:space:]]*true' "$dir/version.json" \
    || die "$dir is a production build: its CSP allows only the production API, so every call to the local API
(<page host>:8787) would be blocked. Build a local test site instead:
  scripts/build-site.sh --unity <Builds/Web> --local-api http://localhost:8787        # this Mac
  scripts/build-site.sh --unity <Builds/Web> --local-api http://<mac LAN ip>:8787     # iPhone on the Wi-Fi"
  local_api="$(sed -n 's/.*"localApi": *"\([^"]*\)".*/\1/p' "$dir/version.json")"
fi
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root$(dirname "${base%/}")"
ln -s "$dir" "$root${base%/}"
lan="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo "serve-site: $dir"
[ -n "$local_api" ] && echo "  local test build, API $local_api (CSP allows it, localhost:8787 and 127.0.0.1:8787, ws/wss game servers on those hosts)"
echo "  http://localhost:$port$base"
if [ -n "$lan" ]; then
  case "$local_api" in
    ""|"http://$lan:8787") echo "  http://$lan:$port$base  (phone on the same Wi-Fi)" ;;
    http://localhost:*|http://127.0.0.1:*) echo "  (no LAN URL: this build allows only localhost; for the iPhone build with --local-api http://$lan:8787)" ;;
    *) echo "  http://$lan:$port$base  WARNING: this build was made for $local_api, not this Mac's $lan:8787" ;;
  esac
fi
python3 - "$root" "$port" <<'PY'
import functools, http.server, sys
root, port = sys.argv[1], int(sys.argv[2])
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "application/javascript", ".wasm": "application/wasm", ".unityweb": "application/vnd.unity",
                      ".json": "application/json", ".map": "application/json"}
    def end_headers(self):
        self.send_header("Cache-Control", "max-age=600")
        super().end_headers()
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))
http.server.ThreadingHTTPServer(("0.0.0.0", port), functools.partial(Handler, directory=root)).serve_forever()
PY
