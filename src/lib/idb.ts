// A tiny promise wrapper around one IndexedDB key/value store, for the
// offline board snapshots and the outbox. Every call fails soft: when
// IndexedDB is unavailable (private mode, old browser) reads return
// undefined and writes do nothing, and the app works online as before.

const DB_NAME = "kanbun-offline";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab deleting the database (logout) must not be blocked by us.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, mode);
          const request = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(request.result);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      })
  );
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return run<T>("readonly", (store) => store.get(key) as IDBRequest<T>);
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  await run("readwrite", (store) => store.put(value, key));
}

export async function idbDelete(key: string): Promise<void> {
  await run("readwrite", (store) => store.delete(key));
}

export async function idbKeys(): Promise<string[]> {
  const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
  return (keys ?? []).map(String);
}

/** Removes everything stored offline (logout). */
export async function idbClear(): Promise<void> {
  await run("readwrite", (store) => store.clear());
}
