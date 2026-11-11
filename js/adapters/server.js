// Invio al servizio aziendale (gestionale/server.py), lo stesso che pubblica l'app.
// Accesso con utente e password una sola volta: il server restituisce un token personale
// conservato sul telefono. Se il telefono viene perso, l'amministratore lo scollega dal gestionale.
(function () {
  const base = () => (window.APP_CONFIG.server && window.APP_CONFIG.server.api) || "../api";
  const accesso = () => (IF.impostazioni && IF.impostazioni.accesso) || null;

  async function chiama(metodo, percorso, { corpo, grezzo, tipo, ok404, senzaToken } = {}) {
    if ((IF.impostazioni && IF.impostazioni.simulaOffline) || !navigator.onLine) throw new IF.ErroreRete("Nessuna connessione");
    const intestazioni = {};
    const a = accesso();
    if (a && !senzaToken) intestazioni.Authorization = "Bearer " + a.token;
    if (corpo !== undefined) intestazioni["Content-Type"] = grezzo ? (tipo || "application/octet-stream") : "application/json";
    let r;
    try {
      r = await fetch(`${base()}/${percorso}`, {
        method: metodo, headers: intestazioni, cache: "no-store",
        body: corpo === undefined ? undefined : (grezzo ? corpo : JSON.stringify(corpo))
      });
    } catch (e) {
      throw new IF.ErroreRete("Server non raggiungibile: controlla la rete e la VPN");
    }
    let d = {};
    try { d = await r.json(); } catch (e) {}
    if (r.status === 404 && ok404) return null;
    // risposta che non viene dal servizio (nessun messaggio JSON): sul sito manca ancora l'archivio delle schede.
    // Non e' un errore della scheda: resta in coda sul telefono e parte quando l'archivio sara' attivo.
    if ((r.status === 404 || r.status === 405 || r.status === 501) && !d.errore) throw new IF.ErroreRete("Archivio delle schede non ancora attivo sul server: le schede restano sul telefono");
    if (r.status === 401) throw new IF.ErroreAccesso(senzaToken ? (d.errore || "Accesso non riuscito") : "Accesso scaduto: entra di nuovo dalle Impostazioni");
    if (r.status === 429) throw new IF.ErroreAccesso(d.errore || "Troppi tentativi: riprova più tardi");
    if (r.status >= 500 || r.status === 502 || r.status === 503 || r.status === 504) throw new IF.ErroreRete(`Server non disponibile (${r.status})`);
    if (!r.ok) throw new IF.ErroreScheda(d.errore || `Rifiutata dal server (${r.status})`);
    return d;
  }

  const Server = {
    nome: "server",
    descrizione: "Le schede vanno al server aziendale (serve la VPN attiva quando si invia). Senza rete restano in coda sul telefono.",
    async init() {},
    haAccesso() { return !!accesso(); },
    utente() { const a = accesso(); return a ? { nome: a.nome, username: a.username } : null; },
    async accedi() { location.hash = "#impostazioni"; },

    // Accesso con utente e password: il token resta sul telefono
    async entra(username, password) {
      const dispositivo = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "Telefono";
      const r = await chiama("POST", "accesso", { corpo: { username, password, tipo: "app", dispositivo: `App – ${dispositivo}` }, senzaToken: true });
      IF.impostazioni.accesso = { token: r.token, nome: r.nome, username: r.username, ruolo: r.ruolo };
      return r;
    },
    // Collegamento con il QR di attivazione mostrato in sede (codice monouso, senza password)
    async attiva(codice) {
      const dispositivo = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "Telefono";
      const r = await chiama("POST", "app/attiva", { corpo: { codice, dispositivo: `App – ${dispositivo}` }, senzaToken: true });
      IF.impostazioni.accesso = { token: r.token, nome: r.nome, username: r.username, ruolo: r.ruolo };
      return r;
    },
    async esci() {
      try { await chiama("POST", "uscita"); } catch (e) {}
      delete IF.impostazioni.accesso;
    },

    async inviaScheda(scheda) {
      await chiama("PUT", `app/schede/${scheda.id}`, { corpo: {
        versione: scheda.versione, fiera: scheda.fiera || "", compilatrice: scheda.compilatrice || "",
        intervistaIl: scheda.intervistaIl, dati: scheda.dati, versioneScheda: IF.schema.versione
      } });
      return { remoteId: scheda.id };
    },

    async caricaAllegato(scheda, allegato) {
      await chiama("PUT", `app/schede/${scheda.id}/allegati/${encodeURIComponent(allegato.nome)}`,
        { corpo: allegato.blob, grezzo: true, tipo: allegato.mime });
      return { remoteUrl: null };
    },

    // Dati e allegati sono arrivati: il server importa la scheda nel gestionale
    async confermaInvio(scheda) {
      await chiama("POST", `app/schede/${scheda.id}/completa`, { corpo: { versione: scheda.versione } });
    },

    async rimuoviAllegato(scheda, nomeFile) {
      await chiama("DELETE", `app/schede/${scheda.id}/allegati/${encodeURIComponent(nomeFile)}`);
    },

    verificaSempre: true,
    async verificaImport(schede) {
      const codici = schede.filter((x) => !x.esempio).map((x) => x.id).slice(0, 100);
      if (!codici.length) return [];
      const r = await chiama("POST", "app/stato", { corpo: { codici } });
      return schede.filter((s) => r.schede && r.schede[s.id]).map((s) => {
        const f = r.schede[s.id];
        return { id: s.id, importata: f.importata === true && Number(f.versione) === s.versioneInviata, sunto: f.sunto || null };
      });
    }
  };

  window.IF = window.IF || {};
  window.IF.adapters = window.IF.adapters || {};
  window.IF.adapters.server = Server;
})();
