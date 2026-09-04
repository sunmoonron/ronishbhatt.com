#!/usr/bin/env bash
# Local playground: two throwaway relays running the real write policy, a
# static server, and a copy of public/ pointed at them under a throwaway key.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d tools/node_modules ] || (cd tools && npm install --silent --no-audit --no-fund)
mkdir -p .dev
[ -f .dev/key.json ] || (cd tools && node --input-type=module -e "
  import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'; import { nsecEncode } from 'nostr-tools/nip19';
  const sk = generateSecretKey(); console.log(JSON.stringify({ nsec: nsecEncode(sk), pub: getPublicKey(sk) }));" > ../.dev/key.json)
PUB=$(node -pe 'require("./.dev/key.json").pub')
rsync -a --delete --exclude 'projects/data' --exclude 'nostrface' --exclude '*.pdf' --exclude 'demos/plant-a-thought.html' public/ .dev/public/
sed -i '' -e "s/content=\"0bfcddd3[0-9a-f]*\"/content=\"$PUB\"/" \
  -e 's#content="wss://relay.ronishbhatt.com"#content="ws://127.0.0.1:7777"#' \
  -e 's#content="wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net"#content="ws://127.0.0.1:7778"#' \
  -e "s#connect-src 'self' [^;]*;#connect-src 'self' ws://127.0.0.1:7777 ws://127.0.0.1:7778;#" .dev/public/index.html
echo "dev site key: $(cat .dev/key.json)"
trap 'kill 0' EXIT
(cd tools && OWNER=$PUB PORT=7777 node dev-relay.mjs) &
(cd tools && OWNER=$PUB PORT=7778 node dev-relay.mjs) &
python3 -m http.server 8788 --bind 127.0.0.1 --directory .dev/public
