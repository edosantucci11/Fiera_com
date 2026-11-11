// Motore di invio: svuota la coda verso il punto di raccolta, prima i dati poi gli allegati,
// e verifica quali schede risultano importate in sede.
// Stati di una scheda: bozza -> in_coda -> inviata -> importata
(function () {
  let inCorso = false;
  let ciclo = 0;
  let timer = null;
  const ascoltatori = new Set();

  const stato = {
    connessione: navigator.onLine ? "online" : "offline", // online | offline | accesso
    ultimoInvio: null,
    messaggio: "",
    inCorso: false
  };

  function notifica() { for (const f of ascoltatori) { try { f({ ...stato }); } catch (e) {} } }

  function adapter() { return IF.adapter; }

  async function eseguiCiclo() {
    if (inCorso) return;
    const a = adapter();
    if (!a) return;
    if (!a.haAccesso()) { stato.connessione = "accesso"; stato.messaggio = "Entra con il tuo utente (Impostazioni) per inviare"; notifica(); return; }

    inCorso = true; stato.inCorso = true; notifica();
    ciclo++;
    try {
      const schede = await IF.DB.tutteLeSchede();
      const coda = schede.filter((s) => s.stato === "in_coda")
        .sort((x, y) => (x.inCodaIl || "").localeCompare(y.inCodaIl || ""));

      // Dopo ogni attesa di rete la scheda si rilegge: le correzioni fatte nel frattempo (versione piu' alta)
      // restano e partono al giro successivo; una scheda eliminata nel frattempo non ricompare.
      const segnaErrore = async (id, e) => {
        await IF.DB.aggiornaScheda(id, (x) => { x.ultimoErrore = e.message; x.tentativi = (x.tentativi || 0) + 1; });
        IF.eventi.emit("scheda", id);
      };

      // 1) Dati di tutte le schede in coda (leggeri, arrivano subito anche con segnale debole)
      for (const s of coda) {
        if (s.datiInviatiVersione === s.versione) continue;
        try {
          const r = await a.inviaScheda(s);
          await IF.DB.aggiornaScheda(s.id, (x) => {
            x.remoteId = r.remoteId;
            if (!(x.datiInviatiVersione > s.versione)) x.datiInviatiVersione = s.versione; // la versione davvero inviata
            x.ultimoErrore = null;
          });
          IF.eventi.emit("scheda", s.id);
        } catch (e) {
          if (e.tipo === "rete" || e.tipo === "accesso") throw e;
          await segnaErrore(s.id, e);
        }
      }

      // 2) Allegati e rimozioni, poi conferma finale della scheda
      for (const { id } of coda) {
        const s = await IF.DB.scheda(id);
        if (!s || s.stato !== "in_coda" || s.datiInviatiVersione !== s.versione) continue; // dati non ancora arrivati
        try {
          for (const nome of [...(s.allegatiDaRimuovere || [])]) {
            await a.rimuoviAllegato(s, nome);
            await IF.DB.aggiornaScheda(id, (x) => { x.allegatiDaRimuovere = (x.allegatiDaRimuovere || []).filter((n) => n !== nome); });
          }
          for (const al of (await IF.DB.allegatiDi(id)).filter((x) => !x.caricato)) {
            const ancora = (await IF.DB.allegatiDi(id)).find((x) => x.id === al.id);
            if (!ancora || ancora.caricato) continue; // tolto (o gia' inviato) nel frattempo
            const r = await a.caricaAllegato(s, ancora);
            const dopo = (await IF.DB.allegatiDi(id)).find((x) => x.id === al.id);
            if (dopo) {
              dopo.caricato = true; dopo.remoteUrl = r.remoteUrl || null;
              await IF.DB.salvaAllegato(dopo);
            } else {
              // tolto mentre saliva: arrivato in sede, va tolto anche li' (la scheda ha gia' una versione nuova)
              await IF.DB.aggiornaScheda(id, (x) => { x.allegatiDaRimuovere = [...new Set([...(x.allegatiDaRimuovere || []), al.nome])]; });
            }
            IF.eventi.emit("scheda", id);
          }
          // Dati e allegati arrivati: lo si dichiara al punto di raccolta, cosi' la sede importa
          // la scheda solo quando e' completa (mai senza gli allegati ancora in viaggio)
          if (a.confermaInvio) await a.confermaInvio(s);
          // Ricevuta completa: dati + allegati, se nel frattempo la scheda non e' cambiata
          const adesso = new Date().toISOString();
          const fatta = await IF.DB.aggiornaScheda(id, (x) => {
            if (x.versione !== s.versione || x.stato !== "in_coda" || (x.allegatiDaRimuovere || []).length) return;
            x.stato = "inviata"; x.versioneInviata = s.versione; x.inviataIl = adesso; x.ultimoErrore = null;
          });
          if (fatta && fatta.stato === "inviata") stato.ultimoInvio = adesso;
          IF.eventi.emit("scheda", id);
        } catch (e) {
          if (e.tipo === "rete" || e.tipo === "accesso") throw e;
          await segnaErrore(id, e);
        }
      }

      // 3) Verifica in sede (non a ogni ciclo, per non sovraccaricare): import e sunto breve delle note vocali
      if (coda.length || a.verificaSempre || ciclo % (APP_CONFIG.sync.verificaImportOgni || 3) === 1) {
        const daControllare = [];
        for (const s of await IF.DB.tutteLeSchede()) {
          if (s.stato === "inviata" || (await attendeSunto(s))) daControllare.push(s);
        }
        if (daControllare.length) {
          for (const esito of await a.verificaImport(daControllare)) {
            const attuale = await IF.DB.scheda(esito.id);
            if (!attuale) continue;
            let cambiata = false;
            if (esito.importata && attuale.stato === "inviata") {
              attuale.stato = "importata"; attuale.importataIl = new Date().toISOString(); cambiata = true;
            }
            const nuovo = esito.sunto && esito.sunto.testo
              && (!attuale.sunto || attuale.sunto.testo !== esito.sunto.testo || attuale.sunto.versione !== esito.sunto.versione);
            if (nuovo) { attuale.sunto = { ...esito.sunto, ricevutoIl: new Date().toISOString() }; cambiata = true; }
            if (cambiata) {
              await IF.DB.salvaScheda(attuale); IF.eventi.emit("scheda", attuale.id);
              if (nuovo) IF.eventi.emit("sunto", attuale.id);
            }
          }
        }
      }

      // 4) Pulizia: cancella dal telefono le schede importate da piu' di N giorni
      await pulizia(false);

      stato.connessione = "online"; stato.messaggio = "";
    } catch (e) {
      if (e.tipo === "accesso") { stato.connessione = "accesso"; stato.messaggio = e.message; }
      else { stato.connessione = "offline"; stato.messaggio = e.message || "Rete non disponibile"; }
    } finally {
      inCorso = false; stato.inCorso = false;
      IF.eventi.emit("lista");
      notifica();
    }
  }

  // Una scheda arrivata in sede con note vocali aspetta il sunto breve per qualche ora dopo l'invio
  // (o quello aggiornato, se la scheda e' stata reinviata dopo modifiche).
  async function attendeSunto(s) {
    if (s.stato !== "importata" || !s.inviataIl) return false;
    if (Date.now() - new Date(s.inviataIl).getTime() > (APP_CONFIG.sync.oreAttesaSunto || 12) * 3600000) return false;
    if (s.sunto && s.sunto.versione >= s.versioneInviata) return false;
    return (await IF.DB.allegatiDi(s.id)).some((x) => x.tipo === "audio");
  }

  async function pulizia(tutte) {
    const giorni = APP_CONFIG.pulizia.giorniDopoImport;
    if (!tutte && !giorni) return 0;
    const limite = Date.now() - (giorni || 0) * 86400000;
    let n = 0;
    for (const s of await IF.DB.tutteLeSchede()) {
      if (s.stato !== "importata") continue;
      if (tutte || new Date(s.importataIl).getTime() < limite) { await IF.DB.eliminaScheda(s.id); n++; }
    }
    if (n) IF.eventi.emit("lista");
    return n;
  }

  const Sync = {
    stato: () => ({ ...stato }),
    ascolta(f) { ascoltatori.add(f); return () => ascoltatori.delete(f); },
    async adesso() { await eseguiCiclo(); },
    pulizia,
    avvia() {
      window.addEventListener("online", () => { stato.connessione = "online"; notifica(); eseguiCiclo(); });
      window.addEventListener("offline", () => { stato.connessione = "offline"; stato.messaggio = "Rete non disponibile"; notifica(); });
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") eseguiCiclo(); });
      clearInterval(timer);
      timer = setInterval(eseguiCiclo, (APP_CONFIG.sync.intervalloSecondi || 30) * 1000);
      eseguiCiclo();
    }
  };

  window.IF = window.IF || {};
  window.IF.Sync = Sync;
})();
