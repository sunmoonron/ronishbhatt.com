// pow-worker.js, NIP-13 mining off the main thread. Receives an unsigned
// event (with pubkey) plus a nonce stride, returns it with a nonce tag and
// matching id. It keeps the event's created_at as given (nostr-tools'
// minePow would overwrite it, undoing NIP-59's randomised wrap timestamps).
importScripts('/vendor/nostr-tools-2.25.2.bundle.js');
self.onmessage = ({ data: { event, bits, start = 1, step = 1 } }) => {
  try {
    const { getEventHash, nip13 } = NostrTools;
    const tag = ['nonce', '0', String(bits)];
    event.tags = (event.tags || []).filter(t => t[0] !== 'nonce').concat([tag]);
    let best = 0, tried = 0;
    for (let n = start; ; n += step) {
      tag[1] = String(n);
      event.id = getEventHash(event);
      const b = nip13.getPow(event.id); if (b > best) best = b;
      if (b >= bits) break;
      if (++tried % 2048 === 0) self.postMessage({ progress: 2048, best });
    }
    self.postMessage({ event, progress: tried % 2048 });
  } catch (e) { self.postMessage({ error: String(e && e.message || e) }); }
};
