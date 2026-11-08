#!/usr/bin/env bash
# Serves a site folder locally under the GitHub Pages path, like https://tdn548.github.io/bombkicker-web/ (SS-16).
#
#   scripts/serve-site.sh <folder> [--port 8000] [--base /bombkicker-web/]
#
# <folder>: build-site.sh output, or a bombkicker-web checkout (its root is what Pages serves).
# Listens on all interfaces, so a phone on the same Wi-Fi can open http://<mac LAN ip>:<port><base>.
# Headers copy GitHub Pages: Cache-Control max-age=600, no Content-Encoding (Unity's decompression fallback
# unpacks the .unityweb files). Unity and React send local and LAN pages to the API at <page host>:8787.
set -euo pipefail
die() { echo "serve-site: $*" >&2; exit 1; }
dir="" port=8000 base="/bombkicker-web/"
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="${2:-}"; shift 2 ;;
    --base) base="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) dir="$1"; shift ;;
  esac
done
[ -n "$dir" ] && [ -f "$dir/index.html" ] || die "give a folder with index.html (got '${dir}')"
case "$base" in /*/) ;; *) die "--base must start and end with /" ;; esac
dir="$(cd "$dir" && pwd)"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root$(dirname "${base%/}")"
ln -s "$dir" "$root${base%/}"
lan="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo "serve-site: $dir"
echo "  http://localhost:$port$base"
[ -n "$lan" ] && echo "  http://$lan:$port$base  (phone on the same Wi-Fi)"
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
