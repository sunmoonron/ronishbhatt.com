// pow-worker.js — NIP-13 mining off the main thread. Receives an unsigned
// event (with pubkey), returns it with a nonce tag and matching id. It keeps
// the event's created_at as given (nostr-tools' minePow would overwrite it,
// which would undo NIP-59's randomised gift-wrap timestamps).
importScripts('/vendor/nostr-tools-2.25.2.bundle.js');
self.onmessage = ({ data: { id, event, bits } }) => {
  try {
    const { getEventHash, nip13 } = NostrTools;
    const tag = ['nonce', '0', String(bits)];
    event.tags = (event.tags || []).filter(t => t[0] !== 'nonce').concat([tag]);
    for (let n = 1; ; n++) {
      tag[1] = String(n);
      event.id = getEventHash(event);
      if (nip13.getPow(event.id) >= bits) break;
    }
    self.postMessage({ id, event });
  } catch (e) { self.postMessage({ id, error: String(e && e.message || e) }); }
};
