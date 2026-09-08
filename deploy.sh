#!/usr/bin/env bash
# Deploy ronishbhatt.com: refresh the signed snapshot from the relay, then one
# rsync to the box. No rebuild — nginx serves the directory as is.
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --silent --no-audit --no-fund
node tools/bake.mjs || echo "bake failed — deploying with the previous snapshot"
rsync -az --delete --exclude .DS_Store public/ "${SITE_HOST:?set SITE_HOST=user@host}":/var/www/ronishbhatt.com/
echo "deployed → https://ronishbhatt.com"
