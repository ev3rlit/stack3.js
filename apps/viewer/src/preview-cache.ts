import type { Reply, Source } from './reconstruct.worker';
import { DIRECTIONS, parseLayout } from '@stack3/core';

export type PreviewResult = Extract<Reply, { result: unknown }>;
export const CACHE_VERSION = 'stack3-preview-5';

const fileHashes = new WeakMap<Blob, Promise<string>>();
let nextId = 0;
function fileHash(file: Blob) {
  let hash = fileHashes.get(file);
  if (hash) return hash;
  hash = crypto.subtle
    ? file.arrayBuffer().then(bytes => crypto.subtle.digest('SHA-256', bytes))
        .then(bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''))
    : Promise.resolve('session:' + nextId++);
  fileHashes.set(file, hash);
  return hash;
}

export async function sourceHash(source: Source) {
  if ('parts' in source) return JSON.stringify(await Promise.all(source.parts.map(async part =>
    [parseLayout(part.layout), part.size ?? null, await fileHash(part.atlas)])));
  if ('atlas' in source) return JSON.stringify([parseLayout(source.layout), await fileHash(source.atlas)]);
  return JSON.stringify(await Promise.all(DIRECTIONS.map(direction => {
    const file = source.files[direction];
    return file ? fileHash(file) : null;
  })));
}

type Record = { key: string; value: PreviewResult; savedAt: number };
const memory = new Map<string, PreviewResult>();
let database: Promise<IDBDatabase | null> | undefined;

function openDatabase() {
  return database ??= new Promise(resolve => {
    try {
      const request = indexedDB.open(CACHE_VERSION, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('results', { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

export function remember(key: string, value: PreviewResult) {
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > 4) memory.delete(memory.keys().next().value!);
}

export async function findPreview(key: string, persistent: boolean) {
  const value = memory.get(key);
  if (value) {
    remember(key, value);
    return { value, origin: 'Memory cache' } as const;
  }
  if (!persistent || !crypto.subtle) return null;
  const db = await openDatabase();
  if (!db) return null;
  return new Promise<{ value: PreviewResult; origin: 'Disk cache' } | null>(resolve => {
    const request = db.transaction('results').objectStore('results').get(key);
    request.onsuccess = () => {
      const entry = request.result as Record | undefined;
      if (entry) remember(key, entry.value);
      resolve(entry ? { value: entry.value, origin: 'Disk cache' } : null);
    };
    request.onerror = () => resolve(null);
  }).catch(() => null);
}

export async function savePreview(key: string, value: PreviewResult, persistent: boolean) {
  remember(key, value);
  if (!persistent || !crypto.subtle) return;
  const db = await openDatabase();
  if (!db) return;
  try {
    const transaction = db.transaction('results', 'readwrite');
    const store = transaction.objectStore('results');
    store.put({ key, value, savedAt: Date.now() } satisfies Record);
    let count = 0;
    const request = store.index('savedAt').openKeyCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (++count > 12) store.delete(cursor.primaryKey);
      cursor.continue();
    };
  } catch {
    // Rendering can continue with the session cache when browser storage is unavailable.
  }
}

export async function clearPreviews() {
  memory.clear();
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('results', 'readwrite');
    transaction.objectStore('results').clear();
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}
