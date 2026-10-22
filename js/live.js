// Live cache bovenop Firestore. In plaats van bij elk scherm alles opnieuw bij de server op te halen,
// luistert de app één keer per collectie/query (onSnapshot). Daarna komen alleen wijzigingen binnen, en
// door de offline cache (IndexedDB) kan een scherm na het herstarten meteen tekenen uit wat er al is.
//
// Eerste keer op dit apparaat: wachten op de server (een lege/halve cache is geen antwoord). Daarna: de cache
// mag meteen; de server werkt op de achtergrond bij. Komt er dan echt iets nieuws binnen, dan krijgt de app
// een seintje (setLiveChangeHandler) om het scherm stil te verversen.
//
// Opgezet met injectie (createLive({ onSnapshot })), zodat de logica zonder Firestore te testen is.

const SYNC_KEY = 'ms-live-synced';
const OFFLINE_WAIT = 6000;

export function createLive({ onSnapshot, storage = (typeof localStorage !== 'undefined' ? localStorage : null), wait = OFFLINE_WAIT }) {
  const entries = new Map();
  let handler = null;
  let pending = new Set();
  let timer = null;

  const syncedSet = () => { try { return new Set(JSON.parse(storage.getItem(SYNC_KEY) || '[]')); } catch { return new Set(); } };
  let synced = storage ? syncedSet() : new Set();
  const markSynced = (key) => {
    if (synced.has(key)) return;
    synced.add(key);
    try { storage && storage.setItem(SYNC_KEY, JSON.stringify([...synced].slice(-300))); } catch { /* niet erg */ }
  };

  const notify = (key) => {
    pending.add(key);
    clearTimeout(timer);
    timer = setTimeout(() => { const keys = [...pending]; pending = new Set(); if (handler) handler(keys); }, 700);
  };

  function listen(key, ref, isDoc) {
    let e = entries.get(key);
    if (e) return e.ready.then(() => e.snap);
    e = { snap: null, sig: null };
    entries.set(key, e);
    e.ready = new Promise((resolve, reject) => {
      let done = false; let t = null;
      const finish = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
      e.unsub = onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
        const fromCache = snap.metadata.fromCache;
        const before = e.sig;
        e.snap = snap;
        e.sig = isDoc ? (snap.exists() ? JSON.stringify(snap.data()).length + ':' + (snap.data().updatedAt || '') : 'none') : null;
        if (!fromCache) markSynced(key);
        if (!done) {
          if (!fromCache || synced.has(key)) finish();
          else if (!t) t = setTimeout(finish, wait); // offline en nog nooit gesynchroniseerd: na even wachten toch de cache
          return;
        }
        if (snap.metadata.hasPendingWrites) return; // eigen schrijfactie: het scherm ververst zichzelf al
        const changed = isDoc ? before !== e.sig : snap.docChanges().length > 0;
        if (changed && !fromCache) notify(key);
      }, (err) => {
        entries.delete(key);
        if (!done) { done = true; clearTimeout(t); reject(err); }
      });
    });
    return e.ready.then(() => e.snap);
  }

  return {
    docs: (key, ref) => listen(key, ref, false).then((s) => s.docs),
    doc: (key, ref) => listen(key, ref, true),
    setHandler: (fn) => { handler = fn; },
    stopAll: () => { entries.forEach((e) => e.unsub && e.unsub()); entries.clear(); },
    size: () => entries.size,
  };
}
