// IndexedDB: dipakai bersama oleh service worker dan halaman Library
// (keduanya berjalan di origin chrome-extension:// yang sama).
const DB_NAME = 'adstash';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('ads')) {
        const ads = db.createObjectStore('ads', { keyPath: 'id' });
        ads.createIndex('savedAt', 'savedAt');
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaksi dibatalkan'));
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function uid(prefix = '') {
  const rnd = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Date.now().toString(36) + Array.from(rnd, b => b.toString(16).padStart(2, '0')).join('');
}

/** Simpan iklan beserta blob-blobnya dalam satu transaksi. blobs: [{id, blob}] */
export async function saveAdWithBlobs(ad, blobs = []) {
  const db = await openDB();
  const tx = db.transaction(['ads', 'blobs'], 'readwrite');
  for (const b of blobs) tx.objectStore('blobs').put(b);
  tx.objectStore('ads').put(ad);
  await done(tx);
  return ad;
}

export async function putAd(ad) {
  const db = await openDB();
  const tx = db.transaction('ads', 'readwrite');
  tx.objectStore('ads').put(ad);
  await done(tx);
  return ad;
}

export async function getAd(id) {
  const db = await openDB();
  return reqP(db.transaction('ads').objectStore('ads').get(id));
}

export async function getAllAds() {
  const db = await openDB();
  const ads = await reqP(db.transaction('ads').objectStore('ads').getAll());
  return ads.sort((a, b) => b.savedAt - a.savedAt);
}

export async function countAds() {
  const db = await openDB();
  return reqP(db.transaction('ads').objectStore('ads').count());
}

export async function getBlob(id) {
  if (!id) return null;
  const db = await openDB();
  const rec = await reqP(db.transaction('blobs').objectStore('blobs').get(id));
  return rec ? rec.blob : null;
}

export async function putBlob(id, blob) {
  const db = await openDB();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put({ id, blob });
  await done(tx);
  return id;
}

export async function deleteBlobs(ids) {
  if (!ids || !ids.length) return;
  const db = await openDB();
  const tx = db.transaction('blobs', 'readwrite');
  for (const id of ids) tx.objectStore('blobs').delete(id);
  await done(tx);
}

export function blobIdsOf(ad) {
  const ids = new Set();
  if (ad.thumbId) ids.add(ad.thumbId);
  for (const m of ad.media || []) {
    if (m.id && !m.missing) ids.add(m.id);
    if (m.posterId) ids.add(m.posterId);
  }
  return [...ids];
}

export async function deleteAd(id) {
  const ad = await getAd(id);
  if (!ad) return;
  const db = await openDB();
  const tx = db.transaction(['ads', 'blobs'], 'readwrite');
  for (const bid of blobIdsOf(ad)) tx.objectStore('blobs').delete(bid);
  tx.objectStore('ads').delete(id);
  await done(tx);
}

export async function storageEstimate() {
  try {
    const est = await navigator.storage.estimate();
    return est.usage || 0;
  } catch {
    return 0;
  }
}
