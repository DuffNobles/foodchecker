// On-device storage. Results (small text) live in localStorage; photos live in IndexedDB (too big for localStorage).
// Nothing here leaves the phone.
const KEY = 'fc_saved';
const DB = 'fc_photos';

export function getSaved() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function addSaved(record) {
  const list = getSaved();
  list.unshift(record);
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function updateSaved(id, patch) {
  const list = getSaved().map((r) => (r.id === id ? { ...r, ...patch } : r));
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function removeSaved(id) {
  localStorage.setItem(KEY, JSON.stringify(getSaved().filter((r) => r.id !== id)));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    const req = fn(tx.objectStore('photos'));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export const savePhoto = (id, blob) => withStore('readwrite', (s) => s.put(blob, id));
export const getPhoto = (id) => withStore('readonly', (s) => s.get(id));
export const deletePhoto = (id) => withStore('readwrite', (s) => s.delete(id));

// Shrink a photo for storage: longest side 800 px, JPEG. Takes any image URL (an object URL here).
export function thumbnail(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('no blob'))), 'image/jpeg', 0.8);
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = url;
  });
}

// Ask Safari not to clear this site's data. Not a guarantee.
export function keepStorage() {
  try { navigator.storage?.persist?.(); } catch { /* ignore */ }
}

// Low-confidence results show as a range, the same way the result screen does.
export function showValue(v, confidence) {
  if (v == null) return 'Not available';
  return confidence === 'low' ? `${Math.round(v * 0.65)}–${Math.round(v * 1.35)}` : String(Math.round(v));
}
