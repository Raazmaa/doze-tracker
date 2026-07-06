/* Service worker for Dose Tracker.
 * Lets notifications fire from showNotification() (works while the app is
 * backgrounded) and, where the browser supports it, from Periodic Background
 * Sync (best-effort checks even when the app is fully closed).
 */

const DB_NAME = 'tracker-db';
const DB_STORE = 'kv';
const PAIN_INTERVAL_MS = 4 * 60 * 60 * 1000;
const VITC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LABELS = { advil: 'Advil', tylenol: 'Tylenol', vitc: 'Vitamin C' };

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(DB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function otherDrug(d) { return d === 'advil' ? 'tylenol' : 'advil'; }

async function checkDoses() {
  const notifyEnabled = await idbGet('notifyEnabled');
  if (!notifyEnabled) return;

  const data = (await idbGet('data')) || { doseLog: [], vitcLog: [] };
  const state = (await idbGet('notifyState')) || { lastNotifiedPain: null, lastNotifiedVitc: null };
  const now = Date.now();
  let changed = false;

  const lastPain = data.doseLog && data.doseLog.length ? data.doseLog[data.doseLog.length - 1] : null;
  if (lastPain) {
    const due = lastPain.time + PAIN_INTERVAL_MS;
    if (now >= due && state.lastNotifiedPain !== due) {
      await self.registration.showNotification('Time for your next dose', {
        body: `${LABELS[otherDrug(lastPain.drug)]} is due now.`,
        tag: 'pain-dose',
      });
      state.lastNotifiedPain = due;
      changed = true;
    }
  }

  const lastVitc = data.vitcLog && data.vitcLog.length ? data.vitcLog[data.vitcLog.length - 1] : null;
  if (lastVitc) {
    const due = lastVitc.time + VITC_INTERVAL_MS;
    if (now >= due && state.lastNotifiedVitc !== due) {
      await self.registration.showNotification('Vitamin C reminder', {
        body: 'Your daily Vitamin C is due.',
        tag: 'vitc-dose',
      });
      state.lastNotifiedVitc = due;
      changed = true;
    }
  }

  if (changed) await idbSet('notifyState', state);
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-doses') {
    event.waitUntil(checkDoses());
  }
});

// Fallback trigger some browsers use for one-off background sync.
self.addEventListener('sync', (event) => {
  if (event.tag === 'check-doses-once') {
    event.waitUntil(checkDoses());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
