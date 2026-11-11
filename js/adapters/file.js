// Modalita' "file": nessun server. Le schede restano sul telefono; la sera si esporta un file (JSON con
// schede, note vocali e foto) e lo si passa in sede, dove il gestionale sul condiviso lo importa.
(function () {
  const PassaggioFile = {
    nome: "file",
    descrizione: "Nessun invio in rete: le schede restano su questo telefono. La sera premi «Esporta» e passa il file in sede (sul condiviso, per email o Teams): il gestionale lo importa.",
    async init() {},
    // account del gestionale a cui il telefono è collegato (QR del profilo, pagina Utenti): resta salvato sul telefono
    haAccesso() { return !!(IF.impostazioni.account && IF.impostazioni.account.id); },
    utente() { const a = IF.impostazioni.account; return a && a.id ? { nome: a.nome, username: a.username } : null; },
    async accedi() {},
    async esci() {}
  };

  // Prepara il file da passare in sede. tutte=false: solo le schede pronte (da esportare); tutte=true: anche quelle
  // gia' esportate (le bozze mai: non sono complete). In sede l'import tiene la versione piu' recente di ogni scheda.
  // ids (facoltativo): solo le schede scelte nell'elenco
  async function prepara({ tutte, ids }, avanzamento) {
    const S = IF.schema, CFG = window.APP_CONFIG;
    const scelte = Array.isArray(ids) ? new Set(ids) : null;
    const schede = (await IF.DB.tutteLeSchede()).filter((s) => !s.esempio && (!scelte || scelte.has(s.id))
      && (s.stato === "in_coda" || (tutte && (s.stato === "inviata" || s.stato === "importata"))))
      .sort((a, b) => (a.intervistaIl || "").localeCompare(b.intervistaIl || ""));
    const allegati = [];
    for (const s of schede) allegati.push(...(await IF.DB.allegatiDi(s.id)));
    const totale = allegati.reduce((n, a) => n + (a.dimensione || 0), 0) || 1;
    let fatto = 0;
    const base64 = (blob) => new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(",")[1] || "");
      r.onerror = () => ko(new Error("Allegato non leggibile sul telefono"));
      r.readAsDataURL(blob);
    });
    const imp = IF.impostazioni;
    const acc = imp.account;
    if (!acc || !acc.id || !acc.chiave) throw new Error("Telefono non collegato: inquadra prima il QR del tuo account (Impostazioni › Account)");
    const testa = {
      formato: "interviste-fiera-esportazione", versioneFormato: 1,
      app: CFG.nomeApp, versioneApp: CFG.versioneApp, versioneScheda: S.versione,
      esportatoIl: new Date().toISOString(), dispositivo: imp.dispositivo || "",
      compilatrice: acc.nome || imp.compilatrice || "", fiera: imp.fiera || "", tutte: !!tutte,
      // il gestionale importa solo i file dei telefoni collegati a un account attivo
      account: { id: acc.id, username: acc.username, nome: acc.nome }, chiave: acc.chiave
    };
    // il file si compone a pezzi: con molte note vocali una sola stringa enorme peserebbe troppo sul telefono
    const pezzi = [JSON.stringify(testa).slice(0, -1), ',"schede":', JSON.stringify(schede.map((s) => ({
      id: s.id, versione: s.versione, stato: s.stato, fiera: s.fiera || "", compilatrice: s.compilatrice || "",
      intervistaIl: s.intervistaIl, creataIl: s.creataIl, modificataIl: s.modificataIl, dati: s.dati
    }))), ',"allegati":['];
    let primo = true;
    for (const a of allegati) {
      const meta = { id: a.id, schedaId: a.schedaId, tipo: a.tipo, nome: a.nome, mime: a.mime, dimensione: a.dimensione, creatoIl: a.creatoIl };
      const b64 = await base64(a.blob);
      pezzi.push((primo ? "" : ",") + JSON.stringify(meta).slice(0, -1) + ',"base64":"', b64, '"}');
      primo = false;
      fatto += a.dimensione || 0;
      if (avanzamento) avanzamento(fatto / totale);
    }
    pezzi.push("]}");
    const pulito = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 30);
    const d = new Date(), due = (n) => String(n).padStart(2, "0");
    const nome = ["interviste", pulito(imp.compilatrice) || "telefono", pulito(imp.fiera),
      `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}-${due(d.getHours())}${due(d.getMinutes())}`].filter(Boolean).join("_") + ".json";
    const file = new File(pezzi, nome, { type: "application/json" });
    return { file, schede: schede.map((s) => ({ id: s.id, versione: s.versione })), nAllegati: allegati.length };
  }

  // Dopo l'esportazione: le schede risultano «esportate» (se nel frattempo sono cambiate restano da esportare)
  async function segnaEsportate(elenco) {
    const adesso = new Date().toISOString();
    for (const { id, versione } of elenco) {
      await IF.DB.aggiornaScheda(id, (x) => {
        if (x.versione !== versione || x.stato === "bozza") return;
        x.stato = "inviata"; x.versioneInviata = versione; x.datiInviatiVersione = versione; x.inviataIl = adesso; x.ultimoErrore = null;
      });
    }
    await IF.DB.scrivi("ultima-esportazione", adesso);
    IF.eventi.emit("lista");
  }

  window.IF = window.IF || {};
  window.IF.adapters = window.IF.adapters || {};
  window.IF.adapters.file = PassaggioFile;
  window.IF.Esporta = { prepara, segnaEsportate };
})();
