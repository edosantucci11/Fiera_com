// Modalita' dimostrazione: simula il punto di raccolta sul dispositivo stesso.
// Serve a provare l'app (coda, assenza di rete, conferme, import in sede) senza server.
(function () {
  const CHIAVE = "if-demo-remoto";
  const SECONDI_IMPORT_SIMULATO = 20; // dopo quanto la "sede" importa una scheda ricevuta
  const SECONDI_SUNTO_SIMULATO = 40;  // dopo quanto arriva il sunto breve delle note vocali
  const SUNTO_SIMULATO = "Sunto di prova (dimostrazione): con il collegamento attivo qui arriva, preparato in sede, il sunto breve della nota vocale.";
  let memoria = {};

  function leggi() {
    try { return JSON.parse(localStorage.getItem(CHIAVE) || "{}"); } catch (e) { return memoria; }
  }
  function scrivi(r) {
    try { localStorage.setItem(CHIAVE, JSON.stringify(r)); } catch (e) { memoria = r; }
  }
  async function rete() {
    await IF.sleep(350 + Math.random() * 500);
    if (IF.impostazioni.simulaOffline || !navigator.onLine) throw new IF.ErroreRete("Nessuna connessione (simulata)");
  }

  const Demo = {
    nome: "demo",
    descrizione: "Dimostrazione: i dati restano su questo dispositivo e l'invio è simulato.",
    async init() {},
    haAccesso() { return true; },
    utente() { return null; },
    async accedi() {},
    async esci() {},

    async inviaScheda(scheda) {
      await rete();
      const r = leggi();
      const campi = IF.campiRemoti(scheda, IF.schema, "Allegati fiera");
      const esistente = r[scheda.id];
      r[scheda.id] = { remoteId: esistente ? esistente.remoteId : "D-" + (Object.keys(r).length + 1),
        campi, ricevutaIl: new Date().toISOString(), importata: false, allegati: esistente ? esistente.allegati : [] };
      scrivi(r);
      return { remoteId: r[scheda.id].remoteId };
    },

    async caricaAllegato(scheda, allegato) {
      await rete();
      await IF.sleep(Math.min(2000, allegato.dimensione / 400)); // tempo proporzionale alla dimensione
      const r = leggi();
      if (r[scheda.id]) {
        r[scheda.id].allegati = [...new Set([...(r[scheda.id].allegati || []), allegato.nome])];
        scrivi(r);
      }
      return { remoteUrl: `demo://Allegati fiera/${scheda.id}/${allegato.nome}` };
    },

    async confermaInvio(scheda) {
      await rete();
      const r = leggi();
      if (r[scheda.id]) { r[scheda.id].invioCompleto = scheda.versione; scrivi(r); }
    },

    async rimuoviAllegato(scheda, nomeFile) {
      await rete();
      const r = leggi();
      if (r[scheda.id]) { r[scheda.id].allegati = (r[scheda.id].allegati || []).filter((n) => n !== nomeFile); scrivi(r); }
    },

    // Simula la sede: una scheda ricevuta da piu' di N secondi risulta importata e, se ha note vocali,
    // poco dopo arriva il sunto breve. Il testo e' un segnaposto: in dimostrazione nessuna AI ascolta l'audio.
    async verificaImport(schede) {
      await rete();
      const r = leggi();
      const adesso = Date.now();
      const esiti = [];
      for (const s of schede) {
        const rem = r[s.id];
        if (!rem) continue;
        const ricevuta = new Date(rem.ricevutaIl).getTime();
        if (!rem.importata && adesso - ricevuta > SECONDI_IMPORT_SIMULATO * 1000) rem.importata = true;
        const conAudio = (rem.allegati || []).some((n) => n.startsWith("nota-vocale"));
        if (rem.importata && conAudio && adesso - ricevuta > SECONDI_SUNTO_SIMULATO * 1000
            && (!rem.sunto || rem.sunto.versione !== rem.campi.Versione)) {
          rem.sunto = { testo: SUNTO_SIMULATO, versione: rem.campi.Versione, il: new Date().toISOString() };
        }
        esiti.push({ id: s.id, importata: rem.importata && rem.campi.Versione === s.versioneInviata, sunto: rem.sunto || null });
      }
      scrivi(r);
      return esiti;
    }
  };

  window.IF = window.IF || {};
  window.IF.adapters = window.IF.adapters || {};
  window.IF.adapters.demo = Demo;
})();
