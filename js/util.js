// Funzioni comuni: codici univoci, errori tipizzati, formattazione, mappatura dei campi.
(function () {
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Errore di rete: la scheda resta in coda e il ciclo si ferma (riprova piu' tardi).
  class ErroreRete extends Error { constructor(m) { super(m || "Rete non disponibile"); this.tipo = "rete"; } }
  // Accesso scaduto o mancante: serve un nuovo login, il ciclo si ferma.
  class ErroreAccesso extends Error { constructor(m) { super(m || "Accesso richiesto"); this.tipo = "accesso"; } }
  // Errore sulla singola scheda (dati rifiutati): si registra e si passa alla successiva.
  class ErroreScheda extends Error { constructor(m) { super(m); this.tipo = "scheda"; } }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function codiceBreve(id) { return (id || "").slice(0, 8).toUpperCase(); }

  // Formattatori creati una volta sola: toLocaleString ne crea uno nuovo a ogni chiamata ed e' lento
  const FMT_DATA_ORA = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const FMT_ORA = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
  const FMT_GIORNO = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });
  function dataOra(iso) {
    if (!iso) return "";
    return FMT_DATA_ORA.format(new Date(iso));
  }
  function ora(iso) {
    if (!iso) return "";
    return FMT_ORA.format(new Date(iso));
  }
  function giornoLungo(d) { return FMT_GIORNO.format(d); }
  function dimensione(byte) {
    if (byte < 1024) return `${byte} B`;
    if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} KB`;
    return `${(byte / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  }

  function tuttiICampi(schema) {
    return schema.sezioni.flatMap((s) => s.campi);
  }

  // Un campo con "dipendeDa" e' visibile solo se l'altro campo ha il valore indicato
  function campoVisibile(c, dati) {
    if (!c.dipendeDa) return true;
    const v = dati[c.dipendeDa.campo];
    return Array.isArray(v) ? v.includes(c.dipendeDa.valore) : v === c.dipendeDa.valore;
  }

  // Priorita' (campo con stile "priorita", es. Giudizio A–D): la prima opzione e' la piu' alta.
  function priorita(dati, schema) {
    const c = tuttiICampi(schema).find((x) => x.stile === "priorita");
    if (!c) return null;
    const i = c.opzioni.indexOf(dati[c.id]);
    if (i < 0) return { livello: 0, sigla: "", etichetta: `${c.etichetta} non assegnato`, campo: c };
    const sigla = (dati[c.id].match(/^[A-Z0-9]{1,2}(?=\s|$)/) || [String.fromCharCode(65 + i)])[0];
    return { livello: Math.min(i + 1, 4), sigla, etichetta: `${c.etichetta}: ${dati[c.id]}`, campo: c };
  }

  // Livello (campo con stile "livello", es. interesse): tacche piene = opzioni totali - posizione.
  function livello(dati, schema) {
    const c = tuttiICampi(schema).find((x) => x.stile === "livello");
    if (!c) return null;
    const i = c.opzioni.indexOf(dati[c.id]);
    return { pieni: i < 0 ? 0 : c.opzioni.length - i, totale: c.opzioni.length, valore: i < 0 ? "" : dati[c.id], campo: c };
  }

  // Quanti campi visibili sono compilati (per la barra di avanzamento della scheda)
  function completamento(dati, schema) {
    let totale = 0, compilati = 0;
    for (const c of tuttiICampi(schema)) {
      if (!campoVisibile(c, dati) || c.nota) continue; // le note di sezione sono facoltative: non contano
      totale++;
      const v = dati[c.id];
      if (Array.isArray(v) ? v.length : (v !== undefined && v !== null && String(v).trim() !== "" && v !== false)) compilati++;
    }
    return { compilati, totale, percento: totale ? Math.round((compilati / totale) * 100) : 0 };
  }

  function titoloScheda(scheda, schema) {
    const parti = (schema.titoloScheda || [])
      .map((id) => (scheda.dati[id] || "").toString().trim())
      .filter(Boolean);
    return parti.length ? parti.join(" – ") : "Intervista senza nome";
  }

  // Campi "piatti" della scheda (colonne di sistema + campi dello schema), usati dalla modalita' dimostrazione.
  function campiRemoti(scheda, schema, cartellaAllegati) {
    const f = {
      Title: titoloScheda(scheda, schema),
      CodiceScheda: scheda.id,
      Versione: scheda.versione,
      Fiera: scheda.fiera || "",
      Compilatrice: scheda.compilatrice || "",
      DataIntervista: scheda.intervistaIl,
      DataInvio: new Date().toISOString(),
      Importata: false,
      CartellaAllegati: cartellaAllegati ? `${cartellaAllegati}/${scheda.id}` : scheda.id
    };
    for (const c of tuttiICampi(schema)) {
      const v = scheda.dati[c.id];
      if (c.tipo === "sino") f[c.sp] = !!v;
      else if (c.tipo === "sceltamultipla") {
        f[`${c.sp}@odata.type`] = "Collection(Edm.String)";
        f[c.sp] = Array.isArray(v) ? v : [];
      } else f[c.sp] = v == null ? "" : String(v);
    }
    return f;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Piccolo sistema di eventi tra motore di invio e interfaccia.
  const eventi = {
    _m: new Map(),
    on(nome, f) { if (!this._m.has(nome)) this._m.set(nome, new Set()); this._m.get(nome).add(f); },
    emit(nome, dato) { for (const f of this._m.get(nome) || []) { try { f(dato); } catch (e) { console.error(e); } } }
  };

  window.IF = window.IF || {};
  Object.assign(window.IF, {
    eventi,
    uuid, ErroreRete, ErroreAccesso, ErroreScheda, sleep,
    codiceBreve, dataOra, ora, giornoLungo, dimensione, tuttiICampi, campoVisibile, priorita, livello, completamento, titoloScheda, campiRemoti, escapeHtml
  });
})();
