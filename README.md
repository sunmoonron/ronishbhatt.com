# ronishbhatt.com

The page is an empty shell; the content is signed Nostr events.

- `public/index.html` — shell + CSS, the site key and relay list in `<meta>` tags, a baked snapshot of signed events.
- `public/js/v2/` — `store.js` (relay pool, verification, cache, snapshot), `ui.js`, `chat.js` (NIP-17), `owner.js` (editor, console), `app.js`, `pow-worker.js`.
- `public/vendor/` — pinned upstream builds: nostr-tools, htm+preact, marked, DOMPurify. See `VERSIONS.txt`.
- `public/site.json` — the snapshot: signed events from the relay plus unsigned drafts for blocks not published yet.
- everything else in `public/` — the archive of one-page experiments, unchanged (`/directory.html` lists them).

Events, all by the site key (the same key the personal relay admits and the console trusts):

| kind | what |
|------|------|
| 0 | header: name, about, picture |
| 30078 `d=ronishbhatt.com` | layout: section order, accent, footer links, chat on/off |
| 30023 `t=ronishbhatt.com` + `t=section|project|writing` | the blocks, Markdown |
| 1 | notes (optional section) |
| 5 | deletions |
| 1059 | chat: NIP-17 gift wraps to the site key (16-bit PoW), owner replies (20-bit) |

Load order in the browser: baked snapshot → localStorage → `wss://relay.ronishbhatt.com` → public backups; newest replaceable wins; every signature verified.

## Work on it

```bash
tools/dev.sh          # two local relays with the real write policy + a static server on :8788, throwaway site key in .dev/key.json
./deploy.sh           # bake the snapshot from the live relay, rsync public/ to the box
```

The nginx side (real 404s, redirects, cache headers) and the relay write policy live in `../dell-nix` (`modules/website.nix`, `modules/strfry-node.nix`, `modules/relays.nix`).
