#!/usr/bin/env bash
# Run the real page from this machine against the real relays — no Cloudflare
# in the code path. Bake, then serve public/ on 127.0.0.1:8789; open it,
# unlock, edit. (The console iframe needs the box, so use dash.html's own
# saved-copy trick for that.)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install --silent --no-audit --no-fund
node tools/bake.mjs
python3 -m http.server 8789 --bind 127.0.0.1 --directory public
