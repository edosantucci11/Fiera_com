// Archivio locale sul telefono (IndexedDB). Se IndexedDB non e' disponibile
// (es. finestra privata), usa un archivio in memoria e lo segnala all'interfaccia.
(function () {
  const NOME_DB = "interviste-fiera";
  const VERSIONE_DB = 1;
  let dbPromise = null;
  let memoria = null; // fallback

  function apri() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(NOME_DB, VERSIONE_DB);
      } catch (e) {
        attivaMemoria(); resolve(null); return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("schede")) db.createObjectStore("schede", { keyPath: "id" });
        if (!db.objectStoreNames.contains("allegati")) {
          const s = db.createObjectStore("allegati", { keyPath: "id" });
          s.createIndex("schedaId", "schedaId", { unique: false });
        }
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "k" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { attivaMemoria(); resolve(null); };
      req.onblocked = () => { attivaMemoria(); resolve(null); };
    });
    return dbPromise;
  }

  function attivaMemoria() {
    if (!memoria) memoria = { schede: new Map(), allegati: new Map(), kv: new Map() };
  }

  function rp(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function store(nome, modo) {
    const db = await apri();
    if (!db) return null;
    return db.transaction(nome, modo).objectStore(nome);
  }

  const DB = {
    async inMemoria() { await apri(); return !!memoria; },

    async tutteLeSchede() {
      const s = await store("schede", "readonly");
      if (!s) return [...memoria.schede.values()];
      return rp(s.getAll());
    },
    async scheda(id) {
      const s = await store("schede", "readonly");
      if (!s) return memoria.schede.get(id) || null;
      return (await rp(s.get(id))) || null;
    },
    async salvaScheda(scheda) {
      const s = await store("schede", "readwrite");
      if (!s) { memoria.schede.set(scheda.id, structuredClone(scheda)); return; }
      await rp(s.put(scheda));
    },
    // Rilegge la scheda e la modifica nella stessa transazione: chi invia non sovrascrive mai
    // le correzioni fatte nel frattempo. Ritorna la scheda aggiornata, o null se non esiste piu'.
    async aggiornaScheda(id, modifica) {
      const s = await store("schede", "readwrite");
      if (!s) {
        const x = memoria.schede.get(id);
        if (!x) return null;
        modifica(x); return structuredClone(x);
      }
      return new Promise((ok, ko) => {
        const r = s.get(id);
        r.onerror = () => ko(r.error);
        r.onsuccess = () => {
          const x = r.result;
          if (!x) { ok(null); return; }
          modifica(x);
          const w = s.put(x);
          w.onerror = () => ko(w.error);
          w.onsuccess = () => ok(x);
        };
      });
    },
    async eliminaScheda(id) {
      const allegati = await DB.allegatiDi(id);
      for (const a of allegati) await DB.eliminaAllegato(a.id);
      const s = await store("schede", "readwrite");
      if (!s) { memoria.schede.delete(id); return; }
      await rp(s.delete(id));
    },

    async allegatiDi(schedaId) {
      const s = await store("allegati", "readonly");
      if (!s) return [...memoria.allegati.values()].filter((a) => a.schedaId === schedaId);
      return rp(s.index("schedaId").getAll(schedaId));
    },
    async tuttiGliAllegati() {
      const s = await store("allegati", "readonly");
      if (!s) return [...memoria.allegati.values()];
      return rp(s.getAll());
    },
    async salvaAllegato(allegato) {
      const s = await store("allegati", "readwrite");
      if (!s) { memoria.allegati.set(allegato.id, allegato); return; }
      await rp(s.put(allegato));
    },
    async eliminaAllegato(id) {
      const s = await store("allegati", "readwrite");
      if (!s) { memoria.allegati.delete(id); return; }
      await rp(s.delete(id));
    },

    async leggi(k, predefinito) {
      const s = await store("kv", "readonly");
      if (!s) return memoria.kv.has(k) ? memoria.kv.get(k) : predefinito;
      const r = await rp(s.get(k));
      return r ? r.v : predefinito;
    },
    async scrivi(k, v) {
      const s = await store("kv", "readwrite");
      if (!s) { memoria.kv.set(k, v); return; }
      await rp(s.put({ k, v }));
    }
  };

  window.IF = window.IF || {};
  window.IF.DB = DB;
})();
