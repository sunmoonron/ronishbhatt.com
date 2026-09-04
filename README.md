# ronishbhatt.com

The page is a 22-line HTML template; the content is signed Nostr events.

- `public/index.html`: the template. `tools/bake.mjs` fills it: pre-rendered body, the stylesheet (itself an event), an index of the baked event ids, an import map with integrity hashes, CSP and SRI hashes.
- `public/js/boot.js`: the only script a visitor runs (no libraries). Asks the relays for the site key's events; anything the bake did not know about, a chat message, an unlock or a paper preview hands off to the full app.
- `public/js/app.js` + `store.js`, `ui.js`, `chat.js`, `owner.js`, `pow-worker.js`: the full app, loaded on demand. `ui.js` renders both in the browser and in Node (the bake).
- `public/vendor/`: pinned upstream builds under content-hashed names (immutable; never edit in place, add a file and repoint `tools/bake.mjs`). See `VERSIONS.txt`.
- `public/site.json`: the full snapshot the app fetches on demand (signed events from the relay plus unsigned drafts for blocks not published yet).
- everything else in `public/`: the archive of one-page experiments that survived the 2026-09 cut.

Events, all by the site key (the key the personal relay admits and the console trusts):

| kind | what |
|------|------|
| 0 | header: name, about, picture |
| 30078 `d=ronishbhatt.com` | layout: section order, footer links, chat on/off |
| 30078 `d=ronishbhatt.com/css` | the stylesheet |
| 30023 `t=ronishbhatt.com` + `t=section|project|writing` | the blocks, Markdown (HTML allowed) |
| 1 | notes (optional section) |
| 5 | deletions |
| 1059 | chat: NIP-17 gift wraps to the site key (16-bit PoW), owner replies (20-bit) |

## Work on it

```bash
tools/dev.sh          # two local relays with the real write policy + bake + static server on :8788, throwaway site key in .dev/key.json
tools/local.sh        # the real page from this machine against the real relays (no Cloudflare in the code path)
./deploy.sh           # bake from the live relay, rsync public/ to the box
tools/build-plant.sh  # rebuild the Plant a Thought demo from its template
```

The nginx side (real 404s, cache headers) and the relay write policy live in `../dell-nix` (`modules/website.nix`, `modules/strfry-node.nix`, `modules/relays.nix`).
