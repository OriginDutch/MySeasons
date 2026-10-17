// Firebase-initialisatie. De config hieronder is NIET geheim: Firebase-webconfig
// is bedoeld om publiek te zijn. Je data wordt beschermd door de security rules
// (zie firestore.rules), niet door deze waarden geheim te houden.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
  getDocFromServer,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyA0bzB8FAghggKkidNlE_0VjdG7QfqIF5c',
  authDomain: 'myseasons-c1dd9.firebaseapp.com',
  projectId: 'myseasons-c1dd9',
  storageBucket: 'myseasons-c1dd9.firebasestorage.app',
  messagingSenderId: '1020884324543',
  appId: '1:1020884324543:web:979c3d84148f8b5fc9360a',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Offline cache in IndexedDB, gedeeld tussen meerdere tabbladen.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (err) {
    // Sommige omgevingen (geblokkeerde popups, bepaalde PWA-modi) staan geen popup toe.
    if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
      return signInWithRedirect(auth, provider);
    }
    throw err;
  }
}

export function completeRedirectSignIn() {
  return getRedirectResult(auth).catch(() => null);
}

export function signOutUser() {
  return signOut(auth);
}

/**
 * Test of Firestore bereikbaar is en of de security rules dit account toelaten.
 * Geeft { ok: true } of { ok: false, reason: 'rules' | 'offline' | 'unknown', message }.
 */
export async function testConnection(uid, timeoutMs = 8000) {
  const ref = doc(db, 'system', 'ping');
  const work = (async () => {
    await setDoc(ref, { at: serverTimestamp(), by: uid });
    await getDocFromServer(ref);
    return { ok: true };
  })();
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve({ ok: false, reason: 'offline', message: 'Geen reactie van de server.' }), timeoutMs),
  );
  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    if (err && err.code === 'permission-denied') {
      return { ok: false, reason: 'rules', message: 'De security rules laten dit account (nog) niet toe.' };
    }
    if (err && err.code === 'unavailable') {
      return { ok: false, reason: 'offline', message: 'Je bent offline.' };
    }
    return { ok: false, reason: 'unknown', message: (err && err.message) || 'Onbekende fout.' };
  }
}
