/*
 * تخزين محلي بالكامل:
 * - مسودة تلقائية صغيرة في localStorage لاستئناف العمل.
 * - أرشيف اختياري للمسودات في IndexedDB، مع بديل localStorage عند تعذّر IndexedDB.
 * لا يوجد أي اتصال بخادم أو خدمة خارجية.
 */
(function () {
  'use strict';

  const cfg = window.LAUNDRY_CONFIG;
  const keys = cfg.storageKeys;
  const DB_NAME = cfg.dbName;
  const DB_VERSION = cfg.dbVersion;
  const STORE = cfg.dbStore;

  let dbPromise = null;

  function safeParse(value, fallback) {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function openDatabase() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('IndexedDB timeout'));
        }
      }, 2500);

      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        clearTimeout(timer);
        settled = true;
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };

      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };

      request.onerror = () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(request.error || new Error('IndexedDB open failed'));
        }
      };

      request.onblocked = () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error('IndexedDB blocked'));
        }
      };
    });

    return dbPromise.catch((error) => {
      dbPromise = null;
      throw error;
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Request failed'));
    });
  }

  async function idbPut(record) {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    await transactionDone(tx);
  }

  async function idbList() {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readonly');
    const records = await requestResult(tx.objectStore(STORE).getAll());
    await transactionDone(tx);
    return records
      .map((record) => ({
        id: record.id,
        formNumber: record.formNumber,
        date: record.date,
        shift: record.shift,
        department: record.department,
        updatedAt: record.updatedAt,
        createdAt: record.createdAt
      }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function idbGet(id) {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readonly');
    const record = await requestResult(tx.objectStore(STORE).get(id));
    await transactionDone(tx);
    return record || null;
  }

  async function idbDelete(id) {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await transactionDone(tx);
  }

  function readFallbackArchive() {
    try {
      const value = safeParse(localStorage.getItem(keys.fallbackArchive), []);
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  function writeFallbackArchive(records) {
    localStorage.setItem(keys.fallbackArchive, JSON.stringify(records));
  }

  function fallbackPut(record) {
    const records = readFallbackArchive().filter((item) => item.id !== record.id);
    records.push(record);
    records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    writeFallbackArchive(records.slice(0, 40));
  }

  async function putForm(form) {
    const record = {
      ...form,
      schemaVersion: cfg.schemaVersion,
      updatedAt: new Date().toISOString()
    };

    try {
      await idbPut(record);
      return { ok: true, mode: 'indexeddb', record };
    } catch (error) {
      try {
        fallbackPut(record);
        return { ok: true, mode: 'localstorage', record };
      } catch (fallbackError) {
        return { ok: false, error: fallbackError };
      }
    }
  }

  async function listForms() {
    try {
      return await idbList();
    } catch (error) {
      return readFallbackArchive()
        .map((record) => ({
          id: record.id,
          formNumber: record.formNumber,
          date: record.date,
          shift: record.shift,
          department: record.department,
          updatedAt: record.updatedAt,
          createdAt: record.createdAt
        }))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }
  }

  async function getForm(id) {
    try {
      return await idbGet(id);
    } catch (error) {
      return readFallbackArchive().find((record) => record.id === id) || null;
    }
  }

  async function deleteForm(id) {
    let idbDeleted = false;
    try {
      await idbDelete(id);
      idbDeleted = true;
    } catch (error) {
      idbDeleted = false;
    }
    try {
      writeFallbackArchive(readFallbackArchive().filter((item) => item.id !== id));
    } catch (error) {
      if (!idbDeleted) return { ok: false };
    }
    return { ok: true };
  }

  function saveCurrentDraft(snapshot) {
    try {
      localStorage.setItem(keys.currentDraft, JSON.stringify({
        savedAt: new Date().toISOString(),
        state: snapshot
      }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function getCurrentDraft() {
    try {
      const value = safeParse(localStorage.getItem(keys.currentDraft), null);
      if (!value || !value.state || !value.savedAt) return null;
      return value;
    } catch (error) {
      return null;
    }
  }

  function clearCurrentDraft() {
    try {
      localStorage.removeItem(keys.currentDraft);
    } catch (error) {
      /* التخزين قد يكون معطلًا؛ لا نعطل الواجهة. */
    }
  }

  function nextSerial(year) {
    const prefix = cfg.formPrefix;
    let data = null;
    try {
      data = safeParse(localStorage.getItem(keys.serial), null);
    } catch (error) {
      data = null;
    }
    if (!data || data.year !== year || !Number.isInteger(data.seq)) {
      data = { year, seq: 0 };
    }
    data.seq += 1;
    try {
      localStorage.setItem(keys.serial, JSON.stringify(data));
    } catch (error) {
      /* يبقى الرقم صالحًا للجلسة الحالية. */
    }
    return `${prefix}-${year}-${String(data.seq).padStart(3, '0')}`;
  }

  window.LaundryStorage = Object.freeze({
    putForm,
    listForms,
    getForm,
    deleteForm,
    saveCurrentDraft,
    getCurrentDraft,
    clearCurrentDraft,
    nextSerial
  });
})();
