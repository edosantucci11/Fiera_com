// Interfaccia dell'app: elenco schede, compilazione, impostazioni.
(function () {
  const S = window.SCHEDA_SCHEMA;
  const CFG = window.APP_CONFIG;
  // modalita' "file": niente rete, la sera si esporta un file da passare in sede (vedi js/adapters/file.js)
  const FILE = CFG.modalita === "file";
  const { DB, escapeHtml: h } = IF;
  IF.schema = S;
  IF.impostazioni = { fiera: "", compilatrice: "", simulaOffline: false };

  const vista = document.getElementById("vista");
  const barra = document.getElementById("barra");
  let erroreConfig = null;
  let archivioInMemoria = false;
  let pulisciVista = null; // funzione di uscita della vista corrente (es. stop registrazione)

  const LOGO = "icons/assut-europe.png";
  const ETICHETTE_STATO = FILE
    ? { bozza: "Bozza", in_coda: "Da esportare", inviata: "Esportata", importata: "Importata" }
    : { bozza: "Bozza", in_coda: "In coda", inviata: "Inviata", importata: "Importata" };

  // ---------- Avvio ----------
  async function avvio() {
    archivioInMemoria = await DB.inMemoria();
    Object.assign(IF.impostazioni, await DB.leggi("impostazioni", {}));

    const a = IF.adapters[CFG.modalita];
    try {
      if (!a) throw new Error(`Modalità sconosciuta in config.js: ${CFG.modalita}`);
      await a.init();
      IF.adapter = a;
      const u = a.utente();
      if (u) { IF.impostazioni.compilatrice = u.nome; await salvaImpostazioni(); }
    } catch (e) {
      erroreConfig = e.message;
      IF.adapter = null;
    }

    if (CFG.modalita === "demo" && !(await DB.leggi("demo-esempi-v2", false))) await creaEsempi();
    if (FILE && !IF.impostazioni.dispositivo) { IF.impostazioni.dispositivo = IF.uuid(); await salvaImpostazioni(); }

    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    IF.eventi.on("lista", () => { if (vistaCorrente() === "lista") disegnaElenco(); aggiornaStrisciaInvio(); aggiornaTabbar(); });
    IF.eventi.on("scheda", (id) => { if (location.hash === `#scheda/${id}`) aggiornaStatoEditor(id); });
    IF.eventi.on("sunto", async (id) => {
      const s = await DB.scheda(id);
      if (s) avviso(`Arrivato il sunto: ${IF.titoloScheda(s, S)}`, "ok");
    });
    IF.Sync.ascolta(() => aggiornaStrisciaInvio());
    // Aperta dal QR (…/#attiva=codice, oppure …/#collega=codice del QR dell'account): il codice si toglie subito dall'indirizzo
    const codice = codiceAttivazione(location.hash) || codiceAttivazione(location.search);
    const conto = FILE ? codiceAccount(location.hash) : null;
    if (codice || conto) { try { history.replaceState(null, "", location.href.split("#")[0].split("?")[0]); } catch (e) { location.hash = ""; } }
    if (conto) await collegaAccount(conto);
    window.addEventListener("hashchange", async () => {
      // QR dell'account aperto mentre l'app è già aperta (stessa pagina, cambia solo la parte dopo #)
      const nuovo = FILE ? codiceAccount(location.hash) : null;
      if (nuovo) { try { history.replaceState(null, "", location.href.split("#")[0] + "#lista"); } catch (e) {} await collegaAccount(nuovo); }
      disegna();
    });
    disegna();
    if (IF.adapter && !FILE) IF.Sync.avvia();
    if (FILE) promemoriaSerale();
    if (conto && !inApp()) setTimeout(() => guidaInstallazione(suIPhone()), 900);
    if (codice) {
      if (suIPhone() && !inApp()) guidaInstallazione(true); // il codice si usa poi dall'app installata
      else {
        if (await attivaTelefono(codice)) disegna();
        if (!inApp()) setTimeout(() => guidaInstallazione(false), 900);
      }
    }
  }

  async function salvaImpostazioni() { await DB.scrivi("impostazioni", IF.impostazioni); }

  // ---------- Installazione e attivazione con il QR mostrato in sede ----------
  const inApp = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const suIPhone = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let richiestaInstallazione = null; // Android/Chrome: permette di mostrare il pulsante "Installa"
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); richiestaInstallazione = e; });
  window.addEventListener("appinstalled", () => { richiestaInstallazione = null; });
  function codiceAttivazione(testo) {
    const m = String(testo || "").match(/[#&?]attiva=([A-Za-z0-9_-]{16,64})/);
    return m ? m[1] : null;
  }
  async function attivaTelefono(codice) {
    if (!IF.adapter || !IF.adapter.attiva) { avviso("Il QR di attivazione funziona solo con il server aziendale", "errore"); return false; }
    try {
      const r = await IF.adapter.attiva(codice);
      IF.impostazioni.compilatrice = r.nome;
      await salvaImpostazioni();
      avviso(`Benvenuta, ${r.nome.split(" ")[0]}: telefono collegato`, "ok");
      IF.Sync.adesso();
      return true;
    } catch (e) { avviso(e.message, "errore"); return false; }
  }
  // QR dell'account (versione sul condiviso): {v, i: id, u: utente, n: nome, k: chiave del telefono} in base64url
  function codiceAccount(testo) {
    const m = String(testo || "").match(/[#&?]collega=([A-Za-z0-9_-]{20,600})/);
    if (!m) return null;
    try {
      const t = m[1].replace(/-/g, "+").replace(/_/g, "/");
      const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(t), (c) => c.charCodeAt(0))));
      if (j.v !== 1 || !/^[A-Za-z0-9_-]{4,40}$/.test(j.i) || !/^[A-Za-z0-9_-]{16,60}$/.test(j.k) || !String(j.n || "").trim()) return null;
      return { id: j.i, username: String(j.u || "").slice(0, 40), nome: String(j.n).trim().slice(0, 120), chiave: j.k };
    } catch (e) { return null; }
  }
  async function collegaAccount(a) {
    const prima = IF.impostazioni.account;
    IF.impostazioni.account = { ...a, il: new Date().toISOString() };
    IF.impostazioni.compilatrice = a.nome;
    await salvaImpostazioni();
    avviso(prima && prima.id && prima.id !== a.id ? `Telefono collegato all'account di ${a.nome} (prima: ${prima.nome})`
      : `Benvenuta, ${a.nome.split(" ")[0]}: telefono collegato`, "ok");
    aggiornaStrisciaInvio(); aggiornaTabbar();
  }
  async function collegaDaScansione() {
    const testo = await IF.QR.apri("il QR del tuo account, nella pagina Utenti del gestionale");
    if (!testo) return false;
    const a = codiceAccount(testo);
    if (!a) { avviso("Questo non è il QR di un account: chiedi in sede il «QR del telefono» del tuo account", "errore"); return false; }
    await collegaAccount(a);
    return true;
  }
  async function attivaDaScansione() {
    const testo = await IF.QR.apri("il QR di attivazione mostrato in sede");
    if (!testo) return;
    const codice = codiceAttivazione(testo);
    if (!codice) { avviso("Questo non è un QR di attivazione: chiedi in sede il «QR di attivazione»", "errore"); return; }
    if (await attivaTelefono(codice)) { if (location.hash === "#lista") disegna(); else location.hash = "#lista"; }
  }
  // Su iPhone l'app aggiunta alla schermata Home tiene i dati separati da Safari: il collegamento si fa dall'icona
  function guidaInstallazione(dopoIPhone) {
    const iphone = suIPhone();
    const corpo = iphone ? `
        <h2>Aggiungi l'app alla schermata Home</h2>
        <ol class="passi-installa">
          <li>Tocca <strong>Condividi</strong> nella barra di Safari (il quadrato con la freccia verso l'alto).</li>
          <li>Scegli <strong>«Aggiungi alla schermata Home»</strong> e poi <strong>«Aggiungi»</strong>.</li>
          <li>Apri <strong>Interviste</strong> dall'icona${dopoIPhone ? `, tocca <strong>${FILE ? "«Inquadra il QR del tuo account»" : "«Attiva con il QR»"}</strong> e inquadra di nuovo lo stesso QR` : FILE ? " e imposta la fiera in Impostazioni" : " ed entra con il tuo utente"}.</li>
        </ol>
        ${dopoIPhone ? `<p class="nota">Su iPhone l'app sulla schermata Home tiene i suoi dati separati da Safari: per questo il collegamento si fa dall'icona.</p>` : ""}`
      : richiestaInstallazione ? `
        <h2>Installa l'app</h2>
        <p>Comparirà un'icona sulla schermata Home: l'app si apre a tutto schermo e funziona anche senza rete.</p>`
      : `
        <h2>Installa l'app</h2>
        <ol class="passi-installa">
          <li>Apri il menu del browser (i tre puntini <strong>⋮</strong> in alto a destra).</li>
          <li>Tocca <strong>«Installa app»</strong> oppure <strong>«Aggiungi a schermata Home»</strong>.</li>
          <li>Da quel momento apri <strong>Interviste</strong> dall'icona.</li>
        </ol>`;
    const { d, chiudi } = apriFoglio(`${corpo}
      <div class="dialogo-azioni"><button class="btn btn-secondario" type="button" id="instDopo">${iphone ? "Ho capito" : "Più tardi"}</button>
      ${!iphone && richiestaInstallazione ? `<button class="btn btn-primario" type="button" id="instSi">Installa</button>` : ""}</div>`);
    d.querySelector("#instDopo").onclick = chiudi;
    d.querySelector(".dialogo-velo").onclick = chiudi;
    const si = d.querySelector("#instSi");
    if (si) si.onclick = async () => { chiudi(); try { await richiestaInstallazione.prompt(); } catch (e) {} richiestaInstallazione = null; };
  }

  function vistaCorrente() {
    const x = location.hash;
    if (x.startsWith("#scheda/")) return "scheda";
    if (x === "#impostazioni") return "impostazioni";
    if (x === "#riepilogo") return "riepilogo";
    if (x === "#info" || x === "#info-rete") return "info";
    return "lista";
  }

  // Profondita' delle schermate: decide il verso della transizione (avanti / indietro)
  const PROFONDITA = { lista: 0, riepilogo: 0, info: 0, impostazioni: 0, scheda: 1 };
  let vistaPrecedente = null;
  let primoDisegno = true;   // primo disegno dopo l'apertura dell'app
  let inTransizione = false; // durante la transizione tra schermate niente animazioni interne (sarebbero invisibili e pesanti)

  function disegna() {
    const v = vistaCorrente();
    const verso = vistaPrecedente === null ? "" : PROFONDITA[v] > PROFONDITA[vistaPrecedente] ? "avanti"
      : PROFONDITA[v] < PROFONDITA[vistaPrecedente] ? "indietro" : "";
    vistaPrecedente = v;
    const esegui = async () => {
      if (pulisciVista) { pulisciVista(); pulisciVista = null; }
      window.scrollTo(0, 0);
      aggiornaTabbar();
      vista.dataset.v = daCollegare() ? "collega" : location.hash === "#info-rete" ? "info-rete" : v;
      if (daCollegare()) return vistaCollega();
      if (v === "scheda") return vistaScheda(decodeURIComponent(location.hash.slice(8)));
      if (v === "impostazioni") return vistaImpostazioni();
      if (v === "riepilogo") return vistaRiepilogo();
      if (v === "info") return vistaInfo(location.hash === "#info-rete" ? "rete" : "prezzi");
      return vistaElenco();
    };
    const movimentoRidotto = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Niente transizioni "fotografate" del browser (startViewTransition): catturare lo schermo con le barre in vetro
    // costava un fotogramma lungo a ogni cambio e congelava la barra in basso. Si anima solo il contenuto nuovo,
    // in composizione (transform e opacita'): da destra entrando in una scheda, da sinistra tornando, una breve
    // dissolvenza tra le sezioni della barra. Al primo avvio entrano i blocchi a cascata.
    const primo = primoDisegno;
    primoDisegno = false;
    if (primo || movimentoRidotto) { esegui(); return; }
    inTransizione = true; // niente cascate e conteggi animati durante il cambio: basta l'entrata del contenuto
    Promise.resolve(esegui()).catch(() => {}).then(() => {
      inTransizione = false;
      const classe = verso === "avanti" ? "entra-avanti" : verso === "indietro" ? "entra-indietro" : "cambio";
      vista.classList.remove("cambio", "entra-avanti", "entra-indietro");
      void vista.offsetWidth;
      vista.classList.add(classe);
    });
  }

  // ---------- Navigazione in basso: capsula flottante in vetro + pulsante "nuova intervista" ----------
  const TAB = [
    { id: "lista", href: "#lista", testo: "Interviste", icona: "lista" },
    { id: "riepilogo", href: "#riepilogo", testo: "Riepilogo", icona: "grafico" },
    { id: "info", href: "#info", testo: "Info", icona: "info" },
    { id: "impostazioni", href: "#impostazioni", testo: "Impostazioni", icona: "ingranaggio" }
  ];
  function costruisciTabbar() {
    const box = document.getElementById("tabbarInterno");
    if (box.dataset.pronta) return;
    box.dataset.pronta = "1";
    box.innerHTML = `
      <div class="capsula vetro" id="capsula">
        ${TAB.map((t) => `<a class="tab" href="${t.href}" data-tab="${t.id}">${icona(t.icona)}<span class="etichetta-tab">${t.testo}</span></a>`).join("")}
      </div>
      <button class="btn-crea vetro" id="btnCrea" type="button" aria-label="Nuova intervista" title="Nuova intervista">${icona("piu")}</button>`;
    document.getElementById("btnCrea").onclick = nuovaScheda;
    // la barra reagisce subito al tocco, prima che la nuova schermata sia pronta
    box.addEventListener("pointerdown", (e) => {
      const a = e.target.closest(".tab");
      if (a) segnaTab(a.dataset.tab);
    });
  }
  function segnaTab(id) {
    const indice = Math.max(0, TAB.findIndex((t) => t.id === id));
    const capsula = document.getElementById("capsula");
    if (capsula) capsula.style.setProperty("--indice", indice);
    document.querySelectorAll(".tab").forEach((a) => {
      if (a.dataset.tab === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  async function aggiornaTabbar() {
    const nav = document.getElementById("tabbar");
    const v = vistaCorrente();
    nav.hidden = v === "scheda" || daCollegare();
    if (nav.hidden) return;
    costruisciTabbar();
    segnaTab(v);
    const c = await conteggi();
    const lista = document.querySelector('.tab[data-tab="lista"]');
    const p = lista.querySelector(".pallino");
    if (c.in_coda > 0 && !p) lista.insertAdjacentHTML("beforeend", `<span class="pallino" aria-label="schede in attesa di invio"></span>`);
    if (!c.in_coda && p) p.remove();
  }

  // Scorrimento: barra in alto in vetro quando il contenuto le passa sotto, capsula ridotta scendendo
  let ultimoScroll = 0, scrollInAttesa = false;
  function aggiornaScroll() {
    scrollInAttesa = false;
    const y = window.scrollY, html = document.documentElement;
    const scorso = y > 8;
    if (scorso !== html.classList.contains("scorso")) html.classList.toggle("scorso", scorso);
    let ridotta = html.classList.contains("ridotta");
    if (y < 60 || y < ultimoScroll - 4) ridotta = false;
    else if (y > ultimoScroll + 4 && y > 120) ridotta = true;
    if (ridotta !== html.classList.contains("ridotta")) html.classList.toggle("ridotta", ridotta);
    ultimoScroll = y;
  }
  window.addEventListener("scroll", () => {
    if (!scrollInAttesa) { scrollInAttesa = true; requestAnimationFrame(aggiornaScroll); }
  }, { passive: true });

  // ---------- Animazioni di supporto ----------
  const movimentoRidotto = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function contaSu(el, fine) {
    if (!el) return;
    if (movimentoRidotto() || inTransizione || fine <= 0) { el.textContent = fine; return; }
    const inizio = performance.now(), durata = 700;
    const passo = (t) => {
      const k = Math.min(1, (t - inizio) / durata), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(fine * e);
      if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  // Le barre si scoprono da sinistra: si anima una copertura con transform (composito, nessun ricalcolo della pagina)
  function animaBarre(radice) {
    if (!radice || movimentoRidotto() || inTransizione) return;
    radice.querySelectorAll(".traccia").forEach((tr, i) => {
      tr.style.setProperty("--ritardo", `${Math.min(i, 8) * 40}ms`);
      tr.classList.remove("rivela"); void tr.offsetWidth; tr.classList.add("rivela");
    });
  }

  // Entrata a cascata dei blocchi indicati (solo all'apertura: tra schermate c'e' gia' la transizione)
  function cascata(elementi) {
    if (movimentoRidotto() || inTransizione) return;
    [...elementi].slice(0, 10).forEach((el, i) => { el.style.setProperty("--i", i); el.classList.add("entra"); });
  }

  function barraPrincipale() {
    barra.innerHTML = `
      <span class="targa-logo"><img src="${LOGO}" alt="Assut Europe – Suture chirurgiche" width="124" height="28"></span>
      ${IF.impostazioni.fiera ? `<span class="chip-fiera">${icona("luogo")}<span>${h(IF.impostazioni.fiera)}</span></span>` : ""}`;
  }

  // ---------- Versione sul condiviso: l'app si usa dopo aver inquadrato il QR del proprio account ----------
  const daCollegare = () => FILE && !!IF.adapter && !IF.adapter.haAccesso();
  function vistaCollega() {
    barraPrincipale();
    vista.innerHTML = `
      <header class="titolo-grande"><h1>Collega il telefono</h1></header>
      <section class="gruppo">
        <p>Per usare l'app inquadra il <strong>QR del tuo account</strong>. Te lo mostra in sede chi gestisce il gestionale (pagina Utenti).</p>
        <button class="btn btn-primario" type="button" id="btnCollega">${icona("qr")}<span>Inquadra il QR del tuo account</span></button>
        <p class="nota">Si fa una volta sola: il collegamento resta salvato su questo telefono. Il tuo nome viene messo da solo su ogni scheda.</p>
      </section>
      ${!inApp() ? `<section class="gruppo"><button class="btn btn-secondario" type="button" id="btnInstalla">Installa l'app sulla schermata Home</button></section>` : ""}`;
    document.getElementById("btnCollega").onclick = async () => { if (await collegaDaScansione()) disegna(); };
    const bin = document.getElementById("btnInstalla");
    if (bin) bin.onclick = () => guidaInstallazione(false);
  }

  // ---------- Esempi per la modalita' dimostrazione ----------
  async function creaEsempi() {
    const adesso = Date.now();
    const base = (minFa, dati, stato) => {
      const iso = new Date(adesso - minFa * 60000).toISOString();
      return {
        id: IF.uuid(), esempio: true, creataIl: iso, modificataIl: iso, intervistaIl: iso,
        fiera: "Fiera di prova", compilatrice: "Collega di prova", dati, stato,
        versione: 1, versioneInviata: stato === "importata" ? 1 : 0,
        datiInviatiVersione: stato === "importata" ? 1 : 0,
        inCodaIl: stato !== "bozza" ? iso : null,
        inviataIl: stato === "importata" ? iso : null,
        importataIl: stato === "importata" ? iso : null,
        allegatiDaRimuovere: []
      };
    };
    const esempi = [
      base(95, { nome: "Contatto di esempio", azienda: "Esempio Ospedale Nord", ruolo: "Responsabile acquisti", paese: "Germania",
        modalita: "Evento", nostra_fabbricazione: ["Suture", "Emostatico"], identificazione: ["Potenziale cliente"],
        interesse: "Interesse forte e concreto", giudizio: "A – Ottimo / alto potenziale",
        note_generali: "Scheda di esempio, già importata in sede.", azione_followup: "Inviare listino" }, "importata"),
      base(30, { nome: "Fornitore di esempio", azienda: "Esempio Componenti Srl", paese: "Italia",
        modalita: "Evento", identificazione: ["Fornitore"], interesse: "Interessato / curioso",
        note_generali: "Scheda di esempio rimasta in coda: parte appena apri l'app." }, "in_coda"),
      base(5, { nome: "", azienda: "Esempio Distribuzione SA", paese: "Spagna", modalita: "Evento", identificazione: ["Progetto"] }, "bozza")
    ];
    for (const e of esempi) await DB.salvaScheda(e);
    if (!IF.impostazioni.fiera) IF.impostazioni.fiera = "Fiera di prova";
    if (!IF.impostazioni.compilatrice) IF.impostazioni.compilatrice = "Collega di prova";
    await salvaImpostazioni();
    await DB.scrivi("demo-esempi-v2", true);
  }

  // ---------- Striscia di stato invio ----------
  async function conteggi() {
    const schede = await DB.tutteLeSchede();
    const c = { bozza: 0, in_coda: 0, inviata: 0, importata: 0, totale: schede.length };
    for (const s of schede) c[s.stato] = (c[s.stato] || 0) + 1;
    return c;
  }

  async function aggiornaStrisciaInvio() {
    const el = document.getElementById("strisciaInvio");
    if (!el) return;
    const st = IF.Sync.stato();
    const c = await conteggi();
    let classe, testo, dettaglio;
    if (FILE && IF.adapter) {
      const ultima = await DB.leggi("ultima-esportazione", null);
      if (c.in_coda) {
        classe = "attenzione"; testo = `${c.in_coda} da esportare`;
        dettaglio = "La sera premi «Esporta» e passa il file in sede";
      } else {
        classe = "ok"; testo = c.inviata ? "Tutto esportato" : "Nessuna scheda da esportare";
        dettaglio = ultima ? `Ultimo file alle ${IF.ora(ultima)} del ${IF.giornoLungo(new Date(ultima)).toLowerCase()}` : "Completa le interviste: la sera le esporti in un file";
      }
      el.className = `stato-invio ${classe}`;
      el.innerHTML = `<span class="spia" aria-hidden="true"></span>
        <span class="testo"><strong>${h(testo)}</strong><span>${h(dettaglio)}</span></span>
        ${c.in_coda ? `<button class="btn btn-piccolo" id="btnEsportaOra" type="button">Esporta</button>` : ""}`;
      const be = document.getElementById("btnEsportaOra");
      if (be) be.onclick = () => esportaPerSede(false);
      aggiornaAvanzamentoInvio(c);
      return;
    }
    if (!IF.adapter) {
      classe = "errore"; testo = "Invio non configurato"; dettaglio = erroreConfig || "";
    } else if (st.connessione === "accesso") {
      classe = "attenzione"; testo = "Accesso richiesto"; dettaglio = st.messaggio;
    } else if (st.inCorso) {
      classe = "invio"; testo = "Invio in corso…"; dettaglio = c.in_coda ? `${c.in_coda} in coda` : "";
    } else if (st.connessione === "offline") {
      classe = "offline"; testo = "Senza rete";
      dettaglio = c.in_coda ? (c.in_coda === 1 ? "1 scheda in coda, partirà da sola" : `${c.in_coda} schede in coda, partiranno da sole`) : "Puoi continuare a compilare";
    } else if (c.in_coda) {
      classe = "attenzione"; testo = `${c.in_coda} da inviare`; dettaglio = "Nuovo tentativo a breve";
    } else {
      classe = "ok"; testo = "Tutto inviato";
      const arrivate = c.inviata + c.importata;
      dettaglio = [arrivate ? `${arrivate === 1 ? "1 scheda arrivata" : `${arrivate} schede arrivate`} in sede` : "Le schede arrivano in sede da sole",
        st.ultimoInvio ? `ultimo invio alle ${IF.ora(st.ultimoInvio)}` : ""].filter(Boolean).join(" · ");
    }
    el.className = `stato-invio ${classe}`;
    el.innerHTML = `
      <span class="spia" aria-hidden="true"></span>
      <span class="testo"><strong>${h(testo)}</strong>${dettaglio ? `<span>${h(dettaglio)}</span>` : ""}</span>
      ${IF.adapter && st.connessione === "accesso" && IF.adapter.nome !== "demo"
        ? `<button class="btn btn-piccolo" id="btnAccedi" type="button">Accedi</button>`
        : IF.adapter && c.in_coda ? `<button class="btn btn-piccolo" id="btnInviaOra" type="button" ${st.inCorso ? "disabled" : ""}>Invia ora</button>` : ""}`;
    const b = document.getElementById("btnInviaOra");
    if (b) b.onclick = () => conCaricamento(b, "Invio…", () => IF.Sync.adesso());
    const acc = document.getElementById("btnAccedi");
    if (acc) acc.onclick = () => IF.adapter.accedi();
    aggiornaAvanzamentoInvio(c);
  }

  // Barra "arrivate in sede" nel riquadro principale
  function aggiornaAvanzamentoInvio(c) {
    const el = document.getElementById("avanzamentoInvio");
    if (!el) return;
    // la barra serve solo mentre qualcosa e' in viaggio; a lavoro finito basta la riga «Tutto inviato»
    const inViaggio = c.in_coda + c.inviata > 0;
    el.hidden = !inViaggio;
    el.closest(".hero")?.classList.toggle("senza-barra", !inViaggio);
    if (!inViaggio) return;
    const arrivate = c.inviata + c.importata;
    const pct = (n) => (c.totale ? (n / c.totale) * 100 : 0);
    const html = FILE ? `
      <div class="avanzamento-riga"><span>${c.inviata} di ${c.totale} esportate</span><span>${c.in_coda} da esportare</span></div>
      <div class="traccia" role="img" aria-label="${c.inviata} schede su ${c.totale} esportate">
        <span class="r-ok" style="width:${pct(c.inviata)}%"></span>
      </div>` : `
      <div class="avanzamento-riga"><span>${arrivate} di ${c.totale} arrivate in sede</span><span>${c.importata} importate</span></div>
      <div class="traccia" role="img" aria-label="${arrivate} schede su ${c.totale} arrivate in sede">
        <span class="r-ok" style="width:${pct(c.importata)}%"></span><span class="r-accento" style="width:${pct(c.inviata)}%"></span>
      </div>`;
    if (el.dataset.firma === html) return;
    el.innerHTML = html; el.dataset.firma = html;
  }

  // Pulsante con stato di caricamento durante un'operazione
  async function conCaricamento(btn, testo, fn) {
    const prima = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="rotella" aria-hidden="true"></span><span>${h(testo)}</span>`;
    try { await fn(); } finally { if (document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = prima; } }
  }

  // ---------- Vista: elenco ----------
  async function vistaElenco() {
    barraPrincipale();
    vista.innerHTML = `
      <header class="titolo-grande"><h1>Interviste</h1>${saluto()}</header>
      <section class="hero" aria-label="Oggi">
        <div class="hero-cifre"><span class="cifra-grande" id="numOggi">0</span><span id="testoOggi">interviste oggi</span></div>
        <div class="avanzamento" id="avanzamentoInvio"></div>
        <div class="stato-invio" id="strisciaInvio"></div>
      </section>
      ${archivioInMemoria ? `<p class="avviso errore">${icona("attenzione")}<span>Questo browser non permette di salvare in modo permanente. Non chiudere l'app finché le schede non risultano inviate.</span></p>` : ""}
      <div class="suggerimenti" id="suggerimenti"></div>
      <div id="elenco" class="pila-elenco"></div>
      ${IF.adapter && IF.adapter.nome === "demo" ? `<p class="avviso-demo">Modalità dimostrazione: i dati restano su questo dispositivo e l'invio è simulato. Le schede con l'etichetta «Esempio» servono solo a mostrare gli stati.</p>` : ""}
      <div class="spazio-tabbar"></div>`;
    cascata(vista.querySelectorAll(".titolo-grande, .hero"));
    await Promise.all([aggiornaStrisciaInvio(), disegnaElenco(true)]);
    animaBarre(document.getElementById("avanzamentoInvio"));
  }

  function saluto() {
    const nome = (IF.impostazioni.compilatrice || "").trim().split(/\s+/)[0];
    return nome ? `<p>Buon lavoro, ${h(nome)}</p>` : "";
  }

  // Giorno dell'intervista per i gruppi dell'elenco (con memoria: le stesse date ricorrono a ogni ridisegno)
  const memoGiorni = new Map();
  function giornoDi(iso) {
    const d = new Date(iso);
    const chiave = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const oggi = new Date(), ieri = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate() - 1);
    if (chiave === `${oggi.getFullYear()}-${oggi.getMonth()}-${oggi.getDate()}`) return "Oggi";
    if (chiave === `${ieri.getFullYear()}-${ieri.getMonth()}-${ieri.getDate()}`) return "Ieri";
    if (!memoGiorni.has(chiave)) memoGiorni.set(chiave, IF.giornoLungo(d));
    return memoGiorni.get(chiave);
  }

  function prioritaHtml(dati, grande) {
    const p = IF.priorita(dati, S);
    if (!p) return "";
    return p.livello
      ? `<span class="priorita p${p.livello}${grande ? " grande" : ""}" role="img" aria-label="${h(p.etichetta)}">${h(p.sigla)}</span>`
      : `<span class="priorita vuota${grande ? " grande" : ""}" role="img" aria-label="${h(p.etichetta)}">–</span>`;
  }

  function taccheHtml(pieni, totale) {
    return `<span class="tacche" aria-hidden="true">${Array.from({ length: totale }, (_, i) => `<i class="${i < pieni ? "piena" : ""}"></i>`).join("")}</span>`;
  }

  function livelloHtml(dati) {
    const l = IF.livello(dati, S);
    if (!l || !l.pieni) return "";
    return `<span class="livello" title="${h(l.valore)}">${taccheHtml(l.pieni, l.totale)}<span>${h(l.valore.split("/")[0].trim())}</span></span>`;
  }

  function statoHtml(s) {
    const modificata = s.stato === "bozza" && s.versioneInviata > 0;
    if (s.ultimoErrore && s.stato === "in_coda") return `<span class="stato errore">${icona("attenzione")}Errore</span>`;
    if (modificata) return `<span class="stato modificata">${icona("orologio")}${FILE ? "Da riesportare" : "Da reinviare"}</span>`;
    const icone = { bozza: "matita", in_coda: "orologio", inviata: "spunta", importata: "doppiaspunta" };
    return `<span class="stato ${s.stato}">${icona(icone[s.stato])}${ETICHETTE_STATO[s.stato]}</span>`;
  }

  // Suggerimenti costruiti sui dati di chi usa l'app (al massimo due)
  function suggerimenti(schede) {
    const out = [];
    if (IF.adapter && IF.adapter.nome === "server" && !IF.adapter.haAccesso()) {
      out.push({ icona: "attenzione", classe: "errore", testo: "Entra con il tuo utente", sotto: "Serve una volta sola, poi le schede partono da sole", azione: "Entra", href: "#impostazioni" });
    }
    if (!IF.impostazioni.fiera || !IF.impostazioni.compilatrice) {
      out.push({ icona: "ingranaggio", testo: FILE ? "Imposta la fiera" : "Imposta fiera e nome", sotto: "Viene aggiunta a ogni nuova scheda", azione: "Imposta", href: "#impostazioni" });
    }
    const daEsportare = schede.filter((s) => s.stato === "in_coda" && !s.esempio).length;
    if (FILE && daEsportare && new Date().getHours() >= 17) {
      out.push({ icona: "orologio", classe: "attenzione", testo: `Esporta le interviste (${daEsportare})`, sotto: "Prepara il file e passalo in sede", azione: "Esporta", esporta: true });
    }
    const errata = schede.find((s) => s.ultimoErrore && s.stato === "in_coda");
    if (errata) out.push({ icona: "attenzione", classe: "errore", testo: `${errata.dati.azienda || "Una scheda"} non è partita`, sotto: errata.ultimoErrore, azione: "Apri", href: `#scheda/${errata.id}` });
    const bozze = schede.filter((s) => s.stato === "bozza" && !s.esempio).sort((a, b) => (a.modificataIl || "").localeCompare(b.modificataIl || ""));
    if (bozze.length) {
      const b = bozze[0], c = IF.completamento(b.dati, S);
      out.push({ icona: "matita", testo: `Completa la bozza${b.dati.azienda ? ` di ${b.dati.azienda}` : ""}`, sotto: `Compilata al ${c.percento}%${bozze.length > 1 ? ` · altre ${bozze.length - 1} bozze` : ""}`, azione: "Riprendi", href: `#scheda/${b.id}` });
    }
    const p = IF.tuttiICampi(S).find((x) => x.stile === "priorita");
    if (p) {
      const senza = schede.filter((s) => s.stato !== "bozza" && !s.dati[p.id]);
      if (senza.length) out.push({ icona: "scintilla", testo: `${senza.length} ${senza.length === 1 ? "intervista" : "interviste"} senza ${p.etichetta.toLowerCase()}`, sotto: "Assegnalo per vedere subito le priorità", azione: "Apri", href: `#scheda/${senza[0].id}` });
    }
    return out.slice(0, 2);
  }

  async function disegnaElenco(entrata) {
    const box = document.getElementById("elenco");
    if (!box) return;
    const schede = (await DB.tutteLeSchede()).sort((a, b) => (b.intervistaIl || "").localeCompare(a.intervistaIl || ""));
    const tutti = await DB.tuttiGliAllegati();
    const oggi = schede.filter((s) => giornoDi(s.intervistaIl) === "Oggi").length;
    const n = document.getElementById("numOggi");
    if (n) { if (entrata) contaSu(n, oggi); else n.textContent = oggi; }
    const t = document.getElementById("testoOggi"); if (t) t.textContent = oggi === 1 ? "intervista oggi" : "interviste oggi";
    const sg = document.getElementById("suggerimenti");
    if (sg) {
      sg.innerHTML = suggerimenti(schede).map((x) => `
      <a class="suggerimento-card ${x.classe || ""}" href="${x.href || "#lista"}"${x.esporta ? " data-esporta" : ""}>${icona(x.icona)}
        <span class="testo"><strong>${h(x.testo)}</strong><span>${h(x.sotto)}</span></span><span class="azione">${h(x.azione)}</span></a>`).join("");
      const se = sg.querySelector("[data-esporta]");
      if (se) se.onclick = (e) => { e.preventDefault(); esportaPerSede(false); };
    }
    if (!schede.length) {
      box.innerHTML = `<div class="vuoto"><strong>Nessuna intervista</strong><span>Tocca il pulsante + in basso per compilare la prima scheda. Funziona anche senza rete.</span></div>`;
      return;
    }
    const gruppi = new Map();
    for (const s of schede) { const g = giornoDi(s.intervistaIl); if (!gruppi.has(g)) gruppi.set(g, []); gruppi.get(g).push(s); }
    const colonna = IF.tuttiICampi(S).find((c) => c.colonna && c.stile !== "priorita" && c.stile !== "livello");
    const html = [...gruppi].map(([giorno, lista]) => `
      <section class="gruppo-giorno"><h2>${h(giorno)} · ${lista.length}</h2>
      <ul class="elenco">${lista.map((s) => {
        const nAll = tutti.filter((a) => a.schedaId === s.id).length;
        const valColonna = colonna ? s.dati[colonna.id] : "";
        const sotto = [s.dati.nome, Array.isArray(valColonna) ? valColonna.join(", ") : valColonna].filter(Boolean).join(" · ");
        return `<li><a class="riga" href="#scheda/${encodeURIComponent(s.id)}">
          ${prioritaHtml(s.dati)}
          <span class="riga-corpo">
            <span class="riga-titolo">${h(s.dati.azienda || "Azienda non indicata")}${s.esempio ? `<span class="tag-esempio">Esempio</span>` : ""}</span>
            <span class="riga-sotto">${h(sotto || "Contatto non indicato")}</span>
            <span class="riga-meta"><span>${IF.ora(s.intervistaIl)}</span>${livelloHtml(s.dati)}${nAll ? `<span>${nAll} ${nAll === 1 ? "allegato" : "allegati"}</span>` : ""}${s.sunto ? `<span class="meta-sunto">${icona("scintilla")}Sunto</span>` : ""}</span>
          </span>
          ${statoHtml(s)}
        </a></li>`;
      }).join("")}</ul></section>`).join("");
    if (!entrata && box.dataset.firma === html) return;
    box.innerHTML = html; box.dataset.firma = html;
    if (entrata) cascata([...(sg ? sg.children : []), ...box.querySelectorAll(".gruppo-giorno h2, .elenco li")].slice(0, 14));
  }

  async function nuovaScheda() {
    const adesso = new Date().toISOString();
    const s = {
      id: IF.uuid(), creataIl: adesso, modificataIl: adesso, intervistaIl: adesso,
      fiera: IF.impostazioni.fiera || "", compilatrice: IF.impostazioni.compilatrice || "",
      dati: {}, stato: "bozza", versione: 1, versioneInviata: 0, datiInviatiVersione: 0,
      remoteId: null, allegatiDaRimuovere: []
    };
    await DB.salvaScheda(s);
    location.hash = `#scheda/${s.id}`;
  }

  // ---------- Vista: scheda ----------
  async function vistaScheda(id) {
    const s = await DB.scheda(id);
    if (!s) {
      barra.innerHTML = `<a class="btn-indietro" href="#lista">${icona("indietro")}<span>Interviste</span></a>`;
      vista.innerHTML = `<div class="vuoto"><strong>Scheda non più sul telefono</strong><span>${FILE ? "È stata cancellata da questo telefono dopo l'esportazione." : "È stata importata in sede e poi cancellata dal dispositivo."}</span></div>`;
      return;
    }
    let scheda = s;
    let timerSalva = null;
    const urlOggetti = [];

    barra.innerHTML = `
      <a class="btn-indietro" href="#lista">${icona("indietro")}<span>Interviste</span></a>
      <span id="chipStato"></span>`;

    // Sezioni a fisarmonica: chiuse mostrano quanti campi sono compilati e le risposte date,
    // aperte una alla volta, cosi' la scheda non diventa una pagina lunghissima da scorrere.
    const conQr = S.sezioni.some((sez) => sez.scansioneQr);
    // pulsante «Note» della barra: la sezione Note (non le note in fondo alle singole sezioni)
    let sezNote = S.sezioni.findIndex((sez) => sez.id === "note");
    if (sezNote < 0) sezNote = S.sezioni.findIndex((sez) => sez.campi.some((c) => c.tipo === "testolungo" && !c.nota));
    const sezioni = S.sezioni.map((sez, i) => `
      <section class="sezione${sez.segnaposto ? " segnaposto" : ""}" data-sez="${i}">
        <button type="button" class="sezione-testa" id="sezT${i}" aria-expanded="false" aria-controls="sezC${i}">
          <span class="sezione-titolo">${h(sez.titolo)}</span>
          <span class="sezione-conta" id="sezN${i}"></span>
          <span class="sezione-riassunto" id="sezR${i}"></span>
          <span class="sezione-freccia" aria-hidden="true">${icona("giu")}</span>
        </button>
        <div class="sezione-corpo" id="sezC${i}" role="group" aria-labelledby="sezT${i}" hidden>
          ${sez.descrizione ? `<p class="sezione-nota">${h(sez.descrizione)}</p>` : ""}
          ${sez.scansioneQr ? `<div class="azioni-biglietto">
            <button type="button" class="btn btn-qr" data-qr>${icona("qr")}<span>QR del biglietto</span></button>
            <button type="button" class="btn btn-qr" id="btnFotoBiglietto">${icona("camera")}<span>Foto del biglietto</span></button>
          </div><input type="file" id="inBiglietto" accept="image/*" capture="environment" hidden>` : ""}
          <div class="campi">${i === 0 ? sez.campi.map((c) => campoHtml(c, scheda.dati[c.id])).join("") : ""}</div>
          ${i < S.sezioni.length - 1 ? `<button type="button" class="sezione-avanti" data-apri="${i + 1}"><span>Avanti: ${h(S.sezioni[i + 1].titolo)}</span>${icona("giu")}</button>` : ""}
        </div>
      </section>`).join("");

    vista.innerHTML = `
      <div class="testata-scheda">
        <div class="titolo-scheda"><span id="prioritaScheda"></span><h1 id="titoloScheda"></h1></div>
        <p class="meta-riga"><span class="codice" title="${h(scheda.id)}">${IF.codiceBreve(scheda.id)}</span><span>${h(scheda.fiera || "Fiera non indicata")}</span><span>${IF.dataOra(scheda.intervistaIl)}</span><span>${h(scheda.compilatrice || "")}</span></p>
        <div class="avanzamento" id="avanzamentoScheda"></div>
        <div id="avvisoScheda"></div>
        <div id="suntoScheda"></div>
        <div class="striscia-allegati">
          <div class="striscia-testa"><span id="contaAllegati">Nessun allegato</span>
            <label class="link-piccolo" for="inFotoGalleria">${icona("immagine")}<span>Dalla galleria</span></label></div>
          <div class="allegati" id="allegati"></div>
        </div>
        <nav class="indice-sezioni" aria-label="Sezioni della scheda">
          ${S.sezioni.map((sez, i) => `<button type="button" data-indice="${i}"><span>${h(sez.titolo)}</span><span class="sezione-conta" id="indN${i}"></span></button>`).join("")}
        </nav>
      </div>
      <form id="modulo" novalidate>
        ${sezioni}
        <input type="file" id="inFotoCamera" accept="image/*" capture="environment" hidden>
        <input type="file" id="inFotoGalleria" accept="image/*" multiple hidden>
        <input type="file" id="inAudio" accept="audio/*" hidden>
        <button type="button" class="link-pericolo" id="btnElimina">Elimina questa scheda dal telefono</button>
      </form>
      <div class="fab-spazio alto"></div>
      <div class="barra-azioni vetro forte dock" id="barraAzioni">
        <div class="strumenti" role="group" aria-label="Aggiungi alla scheda">
          <button class="strumento voce" type="button" id="btnVoce">${icona("microfono")}<span>Voce</span></button>
          <label class="strumento" for="inFotoCamera" id="btnFoto">${icona("camera")}<span>Foto</span></label>
          ${conQr ? `<button class="strumento" type="button" id="btnQr" data-qr aria-label="Leggi il QR del biglietto da visita">${icona("qr")}<span>QR</span></button>` : ""}
          ${sezNote >= 0 ? `<button class="strumento" type="button" id="btnNote">${icona("matita")}<span>Note</span></button>` : ""}
        </div>
        <div class="azione-dock" id="azioneDock"></div>
      </div>`;

    const modulo = document.getElementById("modulo");

    // Raccolta valori dal modulo
    function leggiModulo() {
      const dati = { ...scheda.dati };
      for (const c of IF.tuttiICampi(S)) {
        if (!modulo.querySelector(`.campo[data-id="${c.id}"]`)) continue; // sezione mai aperta: resta il valore salvato
        if (c.tipo === "scelta") {
          const sel = modulo.querySelector(`[data-campo="${c.id}"] .scelta[aria-pressed="true"]`);
          dati[c.id] = sel ? sel.dataset.valore : "";
        } else if (c.tipo === "sceltamultipla") {
          dati[c.id] = [...modulo.querySelectorAll(`[data-campo="${c.id}"] .scelta[aria-pressed="true"]`)].map((b) => b.dataset.valore);
        } else if (c.tipo === "sino") {
          dati[c.id] = !!(modulo.querySelector(`#c_${c.id}`) || {}).checked;
        } else {
          dati[c.id] = (modulo.querySelector(`#c_${c.id}`) || { value: "" }).value;
        }
      }
      // i campi che dipendono da un'altra risposta valgono solo se sono visibili
      for (const c of IF.tuttiICampi(S)) {
        if (!IF.campoVisibile(c, dati)) dati[c.id] = c.tipo === "sceltamultipla" ? [] : "";
      }
      return dati;
    }

    // Mostra o nasconde i campi condizionali (es. "Altro (specificare)")
    function aggiornaVisibilita() {
      const dati = leggiModulo();
      for (const c of IF.tuttiICampi(S)) {
        if (!c.dipendeDa) continue;
        const el = modulo.querySelector(`.campo[data-id="${c.id}"]`);
        if (el) el.hidden = !IF.campoVisibile(c, dati);
      }
    }

    // Salvataggio automatico: ogni modifica incrementa la versione;
    // una scheda gia' inviata torna "da reinviare".
    async function salva(motivo) {
      const dati = leggiModulo();
      const cambiata = JSON.stringify(dati) !== JSON.stringify(scheda.dati) || motivo === "allegati";
      if (!cambiata) return false;
      const attuale = await DB.scheda(scheda.id);
      if (!attuale) return false; // scheda eliminata nel frattempo
      attuale.dati = dati;
      attuale.versione = (attuale.versione || 1) + 1;
      attuale.modificataIl = new Date().toISOString();
      if (attuale.stato === "inviata" || attuale.stato === "importata") attuale.stato = "bozza";
      await DB.salvaScheda(attuale);
      scheda = attuale;
      aggiornaIntestazione();
      return true;
    }
    function salvaDopo() { clearTimeout(timerSalva); timerSalva = setTimeout(() => salva(), 400); }

    modulo.addEventListener("input", (e) => {
      if (e.target.matches("textarea")) adattaAltezza(e.target);
      const campo = e.target.closest(".campo");
      if (campo) campo.classList.remove("non-valido");
      salvaDopo();
    });
    modulo.addEventListener("change", salvaDopo);
    modulo.addEventListener("click", (e) => {
      const b = e.target.closest(".scelta");
      if (!b) return;
      const gruppo = b.closest("[data-campo]");
      const multipla = gruppo.dataset.tipo === "sceltamultipla";
      const premuto = b.getAttribute("aria-pressed") === "true";
      if (!multipla) gruppo.querySelectorAll(".scelta").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", premuto ? "false" : "true");
      if (!premuto) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
      gruppo.closest(".campo").classList.remove("non-valido");
      aggiornaVisibilita();
      salvaDopo();
    });
    modulo.addEventListener("submit", (e) => e.preventDefault());

    // ----- Fisarmonica delle sezioni -----
    // le sezioni chiuse si costruiscono la prima volta che servono (Contatto subito: QR e campi obbligatori)
    function preparaSezione(i) {
      const box = modulo.querySelector(`.sezione[data-sez="${i}"] .campi`);
      if (!box || box.dataset.pronta) return;
      box.dataset.pronta = "1";
      if (!box.children.length) box.innerHTML = S.sezioni[i].campi.map((c) => campoHtml(c, scheda.dati[c.id])).join("");
      aggiornaVisibilita();
    }
    function apriSezione(i, scorri = true) {
      preparaSezione(i);
      modulo.querySelectorAll(".sezione").forEach((el) => {
        const aperta = Number(el.dataset.sez) === i && !(el.classList.contains("aperta") && scorri === "alterna");
        el.classList.toggle("aperta", aperta);
        el.querySelector(".sezione-testa").setAttribute("aria-expanded", String(aperta));
        el.querySelector(".sezione-corpo").hidden = !aperta;
        const ind = vista.querySelector(`[data-indice="${el.dataset.sez}"]`);
        if (ind) ind.setAttribute("aria-current", String(aperta));
      });
      const el = modulo.querySelector(`.sezione[data-sez="${i}"]`);
      if (scorri && el && el.classList.contains("aperta")) {
        adattaAltezze([...el.querySelectorAll("textarea")]);
        requestAnimationFrame(() => scorriA(el));
      }
    }
    function aggiornaSezioni() {
      S.sezioni.forEach((sez, i) => {
        let tot = 0, fatti = 0; const parti = [];
        for (const c of sez.campi) {
          if (!IF.campoVisibile(c, scheda.dati)) continue;
          const v = scheda.dati[c.id];
          const pieno = Array.isArray(v) ? v.length : (v !== undefined && v !== null && String(v).trim() !== "" && v !== false);
          if (!c.nota) { tot++; if (pieno) fatti++; }
          if (!pieno) continue;
          parti.push(c.tipo === "sino" ? c.etichetta : Array.isArray(v) ? v.join(", ") : String(v));
        }
        const n = document.getElementById(`sezN${i}`), r = document.getElementById(`sezR${i}`);
        if (!n) return;
        for (const x of [n, document.getElementById(`indN${i}`)]) {
          if (!x) continue;
          x.textContent = `${fatti}/${tot}`;
          x.classList.toggle("completa", tot > 0 && fatti === tot);
          x.classList.toggle("vuota", fatti === 0);
        }
        r.textContent = parti.join(" · ");
      });
    }
    vista.querySelector(".indice-sezioni").addEventListener("click", (e) => {
      const b = e.target.closest("[data-indice]");
      if (b) apriSezione(Number(b.dataset.indice));
    });
    modulo.addEventListener("click", (e) => {
      const testa = e.target.closest(".sezione-testa");
      if (testa) { apriSezione(Number(testa.closest(".sezione").dataset.sez), "alterna"); return; }
      const avanti = e.target.closest(".sezione-avanti");
      if (avanti) apriSezione(Number(avanti.dataset.apri));
    });
    const nuova = IF.completamento(scheda.dati, S).compilati === 0;
    if (nuova) apriSezione(0, false);
    aggiornaSezioni();
    let modificataQui = false;
    modulo.addEventListener("input", () => { modificataQui = true; });
    modulo.addEventListener("click", (e) => { if (e.target.closest(".scelta")) modificataQui = true; });

    const btnNote = document.getElementById("btnNote");
    if (btnNote) btnNote.onclick = () => {
      apriSezione(sezNote);
      const t = modulo.querySelector(`.sezione[data-sez="${sezNote}"] textarea`);
      if (t) setTimeout(() => t.focus({ preventScroll: true }), 350);
    };
    adattaAltezze([...modulo.querySelectorAll("textarea")]);
    aggiornaVisibilita();

    function aggiornaIntestazione() {
      if (!modulo.isConnected) return;   // salvataggio finito dopo che si è già passati a un'altra schermata
      document.getElementById("titoloScheda").textContent = IF.titoloScheda(scheda, S);
      const ps = document.getElementById("prioritaScheda");
      const nuovaP = prioritaHtml(scheda.dati, true);
      if (ps.dataset.html !== nuovaP) {
        const prima = ps.dataset.html !== undefined;
        ps.innerHTML = nuovaP; ps.dataset.html = nuovaP;
        if (prima && ps.firstElementChild) ps.firstElementChild.classList.add("pop");
      }
      const chip = document.getElementById("chipStato");   // nella barra in alto: cambiando schermata sparisce prima del modulo
      if (chip) chip.innerHTML = statoHtml(scheda);
      aggiornaSezioni();
      const modificata = scheda.stato === "bozza" && scheda.versioneInviata > 0;
      const cmp = IF.completamento(scheda.dati, S);
      document.getElementById("avanzamentoScheda").innerHTML = `
        <div class="avanzamento-riga"><span>Compilazione</span><span>${cmp.compilati} di ${cmp.totale} campi</span></div>
        <div class="traccia" role="progressbar" aria-valuenow="${cmp.percento}" aria-valuemin="0" aria-valuemax="100" aria-label="Compilazione della scheda"><span class="r-accento" style="width:${cmp.percento}%"></span></div>`;

      const av = document.getElementById("avvisoScheda");
      let html = "";
      if (scheda.esempio) html += `<p class="avviso">${icona("info")}<span>Scheda di esempio della modalità dimostrazione.</span></p>`;
      if (scheda.ultimoErrore) html += `<p class="avviso errore">${icona("attenzione")}<span>Ultimo tentativo di invio non riuscito: ${h(scheda.ultimoErrore)}</span></p>`;
      if (FILE) {
        if (scheda.stato === "in_coda") html += `<p class="avviso attenzione">${icona("orologio")}<span>Pronta: entra nel prossimo file da esportare. Puoi ancora correggerla, verrà esportata l'ultima versione.</span></p>`;
        if (scheda.stato === "inviata") html += `<p class="avviso ok">${icona("spunta")}<span>Esportata alle ${IF.ora(scheda.inviataIl)}. Se la modifichi andrà esportata di nuovo.</span></p>`;
      } else {
      if (scheda.stato === "in_coda") html += `<p class="avviso attenzione">${icona("orologio")}<span>In coda: partirà da sola appena c'è rete. Puoi ancora correggerla, verrà inviata l'ultima versione.</span></p>`;
      if (scheda.stato === "inviata") html += `<p class="avviso ok">${icona("spunta")}<span>Arrivata in sede alle ${IF.ora(scheda.inviataIl)}. Se la modifichi andrà reinviata.</span></p>`;
      }
      if (scheda.stato === "importata") html += `<p class="avviso ok">${icona("doppiaspunta")}<span>Importata nel software in sede. Se la modifichi andrà reinviata e verrà aggiornata.</span></p>`;
      if (modificata) html += `<p class="avviso attenzione">${icona("matita")}<span>${FILE ? "Hai modificato una scheda già esportata: premi «Completa» per metterla nel prossimo file." : "Hai modificato una scheda già inviata: premi «Invia modifiche» per aggiornarla in sede."}</span></p>`;
      av.innerHTML = html;
      disegnaSunto();

      // Azione principale della barra in basso; gli strumenti (voce, foto, biglietto, note) restano fissi
      const ba = document.getElementById("azioneDock");
      if (FILE && scheda.stato === "in_coda") {
        ba.innerHTML = `<button class="btn btn-secondario" type="button" id="btnTorna">Fatto</button>`;
      } else if (FILE) {
        if (scheda.stato === "inviata" || scheda.stato === "importata") ba.innerHTML = `<button class="btn btn-secondario" type="button" id="btnTorna">Fatto</button>`;
        else { ba.innerHTML = `<button class="btn btn-primario" type="button" id="btnInvia">Completa</button>`; document.getElementById("btnInvia").onclick = invia; }
      } else if (scheda.stato === "in_coda") {
        ba.innerHTML = `<button class="btn btn-primario" type="button" id="btnOra" ${IF.adapter ? "" : "disabled"}>Invia ora</button>`;
        const bo = document.getElementById("btnOra");
        bo.onclick = () => conCaricamento(bo, "Invio…", async () => { await salva(); await IF.Sync.adesso(); });
      } else if (scheda.stato === "inviata" || scheda.stato === "importata") {
        ba.innerHTML = `<button class="btn btn-secondario" type="button" id="btnTorna">Fatto</button>`;
      } else {
        ba.innerHTML = `<button class="btn btn-primario" type="button" id="btnInvia">${modificata ? "Reinvia" : "Invia"}</button>`;
        document.getElementById("btnInvia").onclick = invia;
      }
      const t = document.getElementById("btnTorna");
      if (t) t.onclick = async () => { await salva(); location.hash = "#lista"; };
    }

    // Ricevuta dalla sede: sunto breve della nota vocale preparato con l'AI
    function disegnaSunto() {
      const box = document.getElementById("suntoScheda");
      const su = scheda.sunto;
      const html = su && su.testo ? `
        <section class="sunto-ricevuto" aria-label="Sunto dalla sede">
          <div class="sunto-testa">${icona("scintilla")}<strong>Sunto dalla sede</strong><span>${IF.dataOra(su.il || su.ricevutoIl)}</span></div>
          <p class="sunto-testo">${h(su.testo)}</p>
          ${scheda.versione > su.versione ? `<p class="sunto-nota">Riferito alla versione inviata prima delle ultime modifiche.</p>` : ""}
          <p class="sunto-nota">Preparato con l'AI dalla nota vocale, può contenere errori. Il riassunto completo è nel software in sede.</p>
        </section>` : "";
      if (box.dataset.html === html) return;
      const nuovo = box.dataset.html !== undefined && html;
      box.innerHTML = html; box.dataset.html = html;
      if (nuovo && box.firstElementChild) box.firstElementChild.classList.add("entra");
    }

    async function invia() {
      clearTimeout(timerSalva);
      await salva();
      // Controllo campi obbligatori
      let primo = null;
      for (const c of IF.tuttiICampi(S)) {
        if (!c.obbligatorio || !IF.campoVisibile(c, scheda.dati)) continue;
        const v = scheda.dati[c.id];
        const vuoto = v == null || v === "" || (Array.isArray(v) && !v.length);
        if (!vuoto) continue;
        const sezione = S.sezioni.findIndex((sz) => sz.campi.includes(c));
        if (sezione >= 0) preparaSezione(sezione);
        const el = modulo.querySelector(`.campo[data-id="${c.id}"]`);
        if (el) { el.classList.add("non-valido"); primo = primo || el; }
      }
      if (primo) {
        const sez = primo.closest(".sezione");
        if (sez && !sez.classList.contains("aperta")) apriSezione(Number(sez.dataset.sez), false);
        requestAnimationFrame(() => scorriA(primo, true));
        avviso("Compila i campi obbligatori evidenziati");
        return;
      }
      const attuale = await DB.scheda(scheda.id);
      attuale.stato = "in_coda";
      attuale.inCodaIl = new Date().toISOString();
      attuale.compilatrice = attuale.compilatrice || IF.impostazioni.compilatrice;
      attuale.fiera = attuale.fiera || IF.impostazioni.fiera;
      await DB.salvaScheda(attuale);
      if (FILE) { avviso("Scheda completa: la sera la esporti con «Esporta»"); location.hash = "#lista"; return; }
      avviso(navigator.onLine ? "Scheda in coda: invio in corso" : "Scheda in coda: partirà appena c'è rete");
      location.hash = "#lista";
      IF.Sync.adesso();
    }
    IF._aggiornaEditor = async (idAgg) => {
      if (idAgg !== scheda.id) return;
      const fresca = await DB.scheda(idAgg);
      if (!fresca) return;
      // mantieni i dati in compilazione, aggiorna solo lo stato di invio
      scheda = { ...fresca, dati: scheda.dati };
      aggiornaIntestazione();
      disegnaAllegati();
    };

    // ----- Allegati -----
    async function disegnaAllegati() {
      const box = document.getElementById("allegati");
      if (!box) return;
      urlOggetti.splice(0).forEach((u) => URL.revokeObjectURL(u));
      const allegati = (await DB.allegatiDi(scheda.id)).sort((a, b) => a.creatoIl.localeCompare(b.creatoIl));
      const conta = document.getElementById("contaAllegati");
      if (conta) {
        const n = (t) => allegati.filter((a) => a.tipo === t).length;
        const voci = [[n("audio"), "nota vocale", "note vocali"], [n("foto"), "foto", "foto"], [n("contatto"), "biglietto", "biglietti"]]
          .filter(([x]) => x).map(([x, s, p]) => `${x} ${x === 1 ? s : p}`);
        conta.textContent = voci.length ? voci.join(" · ") : "Nessun allegato";
      }
      if (!allegati.length) { box.innerHTML = ""; return; }
      box.innerHTML = allegati.map((a) => {
        const url = URL.createObjectURL(a.blob); urlOggetti.push(url);
        const anteprima = a.tipo === "foto"
          ? `<img src="${url}" alt="Foto allegata ${h(a.nome)}">`
          : a.tipo === "audio"
            ? `<audio controls preload="metadata" src="${url}"></audio>`
            : `<span class="allegato-file">${icona("qr")}<span>Biglietto (vCard)</span></span>`;
        return `<div class="allegato ${a.tipo}">
          ${anteprima}
          <div class="allegato-info"><span>${h(a.nome)}</span><span>${IF.dimensione(a.dimensione)}${a.caricato ? " · inviato" : ""}</span></div>
          <button type="button" class="btn-rimuovi" data-id="${h(a.id)}" aria-label="Rimuovi ${h(a.nome)}">${icona("x")}</button>
        </div>`;
      }).join("");
      box.querySelectorAll(".btn-rimuovi").forEach((b) => (b.onclick = () => rimuoviAllegato(b.dataset.id)));
    }

    async function aggiungiAllegato(blob, tipo, nome, mime) {
      const a = { id: IF.uuid(), schedaId: scheda.id, tipo, nome, mime, blob, dimensione: blob.size, caricato: false, creatoIl: new Date().toISOString() };
      await DB.salvaAllegato(a);
      // nuova versione della scheda: l'allegato partira' con il prossimo invio
      const attuale = await DB.scheda(scheda.id);
      if (!attuale) return;
      attuale.allegatiDaRimuovere = (attuale.allegatiDaRimuovere || []).filter((n) => n !== nome);
      attuale.versione = (attuale.versione || 1) + 1;
      attuale.modificataIl = new Date().toISOString();
      if (attuale.stato === "inviata" || attuale.stato === "importata") attuale.stato = "bozza";
      await DB.salvaScheda(attuale);
      if (!document.body.contains(modulo)) return; // la vista e' gia' stata chiusa (es. registrazione fermata uscendo)
      scheda = { ...attuale, dati: scheda.dati };
      aggiornaIntestazione();
      disegnaAllegati();
    }

    async function rimuoviAllegato(idAll) {
      const ok = await conferma("Rimuovere l'allegato?", "Verrà tolto dalla scheda. Se era già stato inviato, verrà tolto anche in sede al prossimo invio.", "Rimuovi");
      if (!ok) return;
      const all = (await DB.allegatiDi(scheda.id)).find((x) => x.id === idAll);
      if (!all) return;
      await DB.eliminaAllegato(idAll);
      const attuale = await DB.scheda(scheda.id);
      if (all.caricato) attuale.allegatiDaRimuovere = [...new Set([...(attuale.allegatiDaRimuovere || []), all.nome])];
      await DB.salvaScheda(attuale);
      scheda = { ...attuale, dati: scheda.dati };
      await salva("allegati");
      disegnaAllegati();
    }

    async function daFileFoto(input) {
      const files = [...input.files];
      input.value = "";
      for (const f of files) {
        try {
          const blob = await comprimiFoto(f);
          await aggiungiAllegato(blob, "foto", nomeFile("foto", "jpg"), "image/jpeg");
        } catch (e) {
          await aggiungiAllegato(f, "foto", nomeFile("foto", estensione(f, "jpg")), f.type || "image/jpeg");
        }
      }
    }
    document.getElementById("inFotoCamera").onchange = (e) => daFileFoto(e.target);
    document.getElementById("inFotoGalleria").onchange = (e) => daFileFoto(e.target);
    document.getElementById("inAudio").onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = "";
      if (f) await aggiungiAllegato(f, "audio", nomeFile("nota-vocale", estensione(f, "m4a")), f.type || "audio/mp4");
    };

    // Registrazione a segmenti: ogni parte (10 minuti) viene salvata appena chiusa e inviata da sola,
    // cosi' una registrazione lunga non si perde e non va reinviata tutta se cade la rete.
    // Se il microfono non e' disponibile si sceglie un file audio.
    let registrazione = null;
    let interrottaUscendo = false;
    const btnVoce = document.getElementById("btnVoce");
    const CA = CFG.audio || {};
    btnVoce.onclick = async () => {
      if (registrazione) { registrazione.ferma(); return; }
      if (!navigator.mediaDevices || !window.MediaRecorder) { document.getElementById("inAudio").click(); return; }
      let flusso;
      try {
        flusso = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        avviso("Microfono non disponibile: scegli un file audio");
        document.getElementById("inAudio").click();
        return;
      }
      const tipo = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
      const opzioni = { ...(tipo ? { mimeType: tipo } : {}), audioBitsPerSecond: CA.bitrate || 32000 };
      const radice = nomeFile("nota-vocale", "x").replace(/\.x$/, "");
      const r = { parte: 0, byteSalvati: 0, byteCorrenti: 0, inizio: Date.now(), avvisato: false, finito: false, rec: null, timerParte: null, timerUi: null, blocco: null };
      registrazione = r;
      try { if (navigator.wakeLock) r.blocco = await navigator.wakeLock.request("screen"); } catch (e) {} // schermo acceso durante la registrazione

      function chiudi() {
        clearInterval(r.timerUi); clearTimeout(r.timerParte);
        flusso.getTracks().forEach((t) => t.stop());
        try { if (r.blocco) r.blocco.release(); } catch (e) {}
        if (registrazione === r) registrazione = null;
        btnVoce.classList.remove("registra");
        document.getElementById("barraAzioni").classList.remove("registrando");
        btnVoce.innerHTML = `${icona("microfono")}<span>Voce</span>`;
      }

      function avviaParte() {
        r.parte += 1;
        const numero = r.parte;
        const pezzi = [];
        let rec;
        try { rec = new MediaRecorder(flusso, opzioni); } catch (e) { rec = new MediaRecorder(flusso, tipo ? { mimeType: tipo } : undefined); }
        r.rec = rec; r.byteCorrenti = 0;
        rec.ondataavailable = (e) => { if (e.data.size) { pezzi.push(e.data); r.byteCorrenti += e.data.size; } };
        rec.onstop = async () => {
          const mime = rec.mimeType || tipo || "audio/webm";
          const est = mime.includes("mp4") ? "m4a" : "webm";
          if (!r.finito) avviaParte(); // la parte successiva parte subito, per non perdere parlato
          const blob = new Blob(pezzi, { type: mime });
          if (blob.size) {
            r.byteSalvati += blob.size;
            await aggiungiAllegato(blob, "audio", `${radice}-p${numero}.${est}`, mime);
          }
          if (r.finito && r.rec === rec) chiudi();
        };
        rec.start(1000);
        r.timerParte = setTimeout(() => { if (rec.state !== "inactive") rec.stop(); }, (CA.minutiSegmento || 10) * 60000);
      }

      r.ferma = () => {
        r.finito = true;
        clearTimeout(r.timerParte);
        if (r.rec && r.rec.state !== "inactive") r.rec.stop(); else chiudi();
      };

      avviaParte();
      btnVoce.classList.add("registra");
      document.getElementById("barraAzioni").classList.add("registrando");
      const agg = () => {
        const sec = Math.floor((Date.now() - r.inizio) / 1000);
        const peso = IF.dimensione(r.byteSalvati + r.byteCorrenti);
        btnVoce.innerHTML = `<span class="punto-reg" aria-hidden="true"></span><span class="tempo-reg">Ferma ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}</span><span class="peso-reg">${peso}</span>`;
        if (!r.avvisato && sec >= (CA.avvisoDopoMinuti || 45) * 60) {
          r.avvisato = true;
          avviso(`Registrazione in corso da ${CA.avvisoDopoMinuti || 45} minuti: ricordati di fermarla`, "info");
        }
      };
      agg(); r.timerUi = setInterval(agg, 500);
    };

    // Uscendo dall'app il telefono interrompe il microfono: si chiude e si salva la parte registrata.
    const suVisibilita = () => {
      if (document.visibilityState === "hidden" && registrazione) { interrottaUscendo = true; registrazione.ferma(); }
      else if (document.visibilityState === "visible" && interrottaUscendo) {
        interrottaUscendo = false;
        avviso("La registrazione si è fermata quando hai lasciato l'app. La parte registrata è salvata.", "info");
      }
    };
    document.addEventListener("visibilitychange", suVisibilita);

    // ----- QR del biglietto da visita -----
    const leggiQr = async () => {
      if (!window.jsQR) { avviso("Lettore QR non disponibile"); return; }
      const testo = await IF.QR.apri();
      if (!testo) return;
      const an = IF.QR.analizza(testo);
      const ids = new Set(IF.tuttiICampi(S).map((c) => c.id));
      const trovati = Object.entries(an.campi).filter(([id]) => ids.has(id));
      if (!trovati.length) { await qrSenzaDati(an); return; }
      const scelti = await confermaDatiQr(trovati);
      if (!scelti || !scelti.length) return;
      for (const [id, val] of scelti) {
        const el = document.getElementById(`c_${id}`);
        if (el) { el.value = val; const campo = el.closest(".campo"); if (campo) campo.classList.remove("non-valido"); }
      }
      await salva();
      // il contatto completo resta allegato alla scheda, pronto da importare in Outlook o in rubrica
      if (an.tipo === "vcard") await aggiungiAllegato(new Blob([testo], { type: "text/vcard" }), "contatto", nomeFile("biglietto", "vcf"), "text/vcard");
      avviso("Dati del biglietto inseriti nella scheda");
    };

    document.querySelectorAll("[data-qr]").forEach((b) => { b.onclick = leggiQr; });

    // ----- Biglietto da visita dalla foto (lettura del testo sul telefono, anche senza rete) -----
    const btnFotoB = document.getElementById("btnFotoBiglietto");
    const inBiglietto = document.getElementById("inBiglietto");
    if (btnFotoB) btnFotoB.onclick = () => { if (window.SIM_OCR) leggiBiglietto(null); else inBiglietto.click(); };
    if (inBiglietto) inBiglietto.onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) leggiBiglietto(f); };
    async function leggiBiglietto(file) {
      if (!IF.OCR || (!IF.OCR.disponibile() && !window.SIM_OCR)) { avviso("La lettura dei biglietti non è disponibile su questo telefono", "errore"); return; }
      const primaVolta = !window.SIM_OCR && !(await DB.leggi("ocr-pronto", false));
      const { d, chiudi } = apriFoglio(`
        <h2>Lettura del biglietto</h2>
        <p id="ocrStato">${primaVolta ? "Preparazione della lettura: solo la prima volta si scaricano circa 8 MB, poi funziona anche senza rete." : "Lettura del testo in corso…"}</p>
        <div class="traccia ocr-traccia" role="progressbar" aria-label="Avanzamento della lettura"><span class="r-accento" id="ocrBarra" style="width:3%"></span></div>`);
      const FASI = { "loading tesseract core": "Preparazione del motore di lettura…", "loading language traineddata": "Preparazione delle lingue (italiano e inglese)…",
        "initializing api": "Avvio…", "recognizing text": "Lettura del testo in corso…" };
      const avanza = (stato, p) => {
        const s = d.querySelector("#ocrStato"), b = d.querySelector("#ocrBarra");
        if (s && FASI[stato]) s.textContent = FASI[stato];
        if (b) b.style.width = `${Math.max(3, Math.round(p * 100))}%`;
      };
      let righe;
      try {
        righe = await IF.OCR.leggi(file, avanza);
        if (!window.SIM_OCR) await DB.scrivi("ocr-pronto", true);
      } catch (e) { chiudi(); avviso(e.message || "Lettura non riuscita", "errore"); return; }
      chiudi();
      if (file) { // la foto resta allegata alla scheda in ogni caso
        try { const ridotta = await comprimiFoto(file); await aggiungiAllegato(ridotta, "foto", nomeFile("biglietto", "jpg"), "image/jpeg"); } catch (e) {}
      }
      if (!righe.length) { avviso("Nessun testo riconosciuto: riprova con più luce e il biglietto dritto. La foto è allegata alla scheda.", "info"); return; }
      const scelte = await confermaRigheBiglietto(IF.OCR.analizza(righe));
      if (!scelte) return;
      const valori = {};
      for (const { campo, testo } of scelte) {
        if (!campo || !testo) continue;
        valori[campo] = valori[campo] ? `${valori[campo]}${campo === "telefono" || campo === "email" ? " / " : " "}${testo}` : testo;
      }
      for (const [id, val] of Object.entries(valori)) {
        const el = document.getElementById(`c_${id}`);
        if (el) { el.value = val; const campo = el.closest(".campo"); if (campo) campo.classList.remove("non-valido"); }
      }
      await salva();
      avviso(Object.keys(valori).length ? "Dati del biglietto inseriti nella scheda" : "Nessun dato inserito", "ok");
    }

    document.getElementById("btnElimina").onclick = async () => {
      const giaInviata = scheda.versioneInviata > 0;
      const ok = await conferma("Eliminare la scheda?",
        giaInviata ? "La scheda verrà cancellata solo da questo telefono. La copia già arrivata in sede resta." : "La scheda non è mai stata inviata: verrà persa definitivamente.",
        "Elimina");
      if (!ok) return;
      clearTimeout(timerSalva);
      await DB.eliminaScheda(scheda.id);
      avviso("Scheda eliminata dal telefono");
      location.hash = "#lista";
    };

    pulisciVista = () => {
      clearTimeout(timerSalva);
      salva();
      if (modificataQui && scheda.stato === "bozza") avviso("Bozza salvata sul telefono");
      if (registrazione) registrazione.ferma();
      document.removeEventListener("visibilitychange", suVisibilita);
      urlOggetti.forEach((u) => URL.revokeObjectURL(u));
      IF._aggiornaEditor = null;
    };

    aggiornaIntestazione();
    await disegnaAllegati();
  }

  function aggiornaStatoEditor(id) { if (IF._aggiornaEditor) IF._aggiornaEditor(id); }

  // ---------- Fogli di conferma per il QR ----------
  function apriFoglio(html) {
    const d = document.getElementById("dialogo");
    d.innerHTML = `<div class="dialogo-velo"></div><div class="dialogo-foglio vetro forte" role="dialog" aria-modal="true">${html}</div>`;
    d.hidden = false;
    const chiudi = () => { d.hidden = true; d.innerHTML = ""; };
    return { d, chiudi };
  }

  function confermaDatiQr(trovati) {
    return new Promise((ok) => {
      const campi = Object.fromEntries(IF.tuttiICampi(S).map((c) => [c.id, c]));
      const righe = trovati.map(([id, val], i) => {
        const el = document.getElementById(`c_${id}`);
        const attuale = el ? el.value.trim() : "";
        const sostituisce = attuale && attuale !== val ? `<span class="qr-sostituisce">sostituisce: ${h(attuale)}</span>` : "";
        return `<label class="qr-riga" for="qr_${i}"><input type="checkbox" id="qr_${i}" checked>
          <span class="qr-testo"><span class="qr-etichetta">${h(campi[id].etichetta)}</span><span class="qr-valore">${h(val)}</span>${sostituisce}</span></label>`;
      }).join("");
      const { d, chiudi } = apriFoglio(`
        <h2>Dati letti dal QR</h2>
        <p>Controlla i dati prima di inserirli. Togli la spunta a quelli da non usare.</p>
        <div class="qr-elenco">${righe}</div>
        <div class="dialogo-azioni"><button class="btn btn-secondario" type="button" id="qrNo">Annulla</button>
        <button class="btn btn-primario" type="button" id="qrSi">Inserisci nella scheda</button></div>`);
      const fine = (r) => { chiudi(); ok(r); };
      d.querySelector("#qrNo").onclick = () => fine(null);
      d.querySelector(".dialogo-velo").onclick = () => fine(null);
      d.querySelector("#qrSi").onclick = () => fine(trovati.filter((_, i) => d.querySelector(`#qr_${i}`).checked));
    });
  }

  // Righe lette dal biglietto: per ognuna l'operatrice conferma o cambia il campo (e corregge il testo se serve)
  function confermaRigheBiglietto(righe) {
    return new Promise((ok) => {
      const CAMPI = [["", "— non usare"], ["nome", "Nome e cognome"], ["azienda", "Azienda"], ["ruolo", "Ruolo"], ["paese", "Paese"], ["email", "Email"], ["telefono", "Telefono"]];
      const elenco = righe.map((r, i) => `<div class="ocr-riga">
          <input type="text" id="ocrT_${i}" value="${h(r.valore || r.testo)}" aria-label="Testo letto, riga ${i + 1}" autocomplete="off" spellcheck="false">
          <select id="ocrC_${i}" aria-label="Campo per la riga ${i + 1}">${CAMPI.map(([v, et]) => `<option value="${v}"${v === r.campo ? " selected" : ""}>${et}</option>`).join("")}</select>
        </div>`).join("");
      const { d, chiudi } = apriFoglio(`
        <h2>Testo letto dal biglietto</h2>
        <p>Per ogni riga scegli il campo della scheda, oppure «non usare». Puoi correggere il testo. I campi già proposti vanno comunque controllati.</p>
        <div class="ocr-elenco">${elenco}</div>
        <div class="dialogo-azioni"><button class="btn btn-secondario" type="button" id="ocrNo">Annulla</button>
        <button class="btn btn-primario" type="button" id="ocrSi">Inserisci nella scheda</button></div>`);
      const fine = (r) => { chiudi(); ok(r); };
      d.querySelector("#ocrNo").onclick = () => fine(null);
      d.querySelector(".dialogo-velo").onclick = () => fine(null);
      d.querySelector("#ocrSi").onclick = () => fine(righe.map((_, i) => ({ campo: d.querySelector(`#ocrC_${i}`).value, testo: d.querySelector(`#ocrT_${i}`).value.trim() })));
    });
  }

  function qrSenzaDati(an) {
    return new Promise((ok) => {
      const corpo = an.tipo === "link"
        ? `<h2>Il QR contiene un link</h2>
           <p>È un biglietto digitale: i dati sono su una pagina web e non nel codice. Aprilo e copia i dati a mano.</p>
           <p class="qr-link">${h(an.testo)}</p>
           <a class="btn btn-secondario" href="${h(an.testo)}" target="_blank" rel="noopener">Apri il link</a>`
        : `<h2>Nessun biglietto da visita nel QR</h2>
           <p>Il codice letto non contiene dati di contatto.</p>
           <p class="qr-link">${h(an.testo.slice(0, 300))}</p>`;
      const { d, chiudi } = apriFoglio(`${corpo}<div class="dialogo-azioni uno"><button class="btn btn-primario" type="button" id="qrOk">Chiudi</button></div>`);
      const fine = () => { chiudi(); ok(); };
      d.querySelector("#qrOk").onclick = fine;
      d.querySelector(".dialogo-velo").onclick = fine;
    });
  }

  // Scorre solo la pagina dell'app (non le pagine che la contengono), lasciando spazio alla barra in alto
  function scorriA(el, alCentro) {
    const r = el.getBoundingClientRect();
    const y = alCentro ? r.top + window.scrollY - (window.innerHeight - r.height) / 2 : r.top + window.scrollY - 64;
    const ridotto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, y), behavior: ridotto ? "auto" : "smooth" });
  }

  function campoHtml(c, valore) {
    const id = `c_${c.id}`;
    const obb = c.obbligatorio ? `<span class="obbligatorio" aria-label="obbligatorio">*</span>` : "";
    const etichetta = `<label class="etichetta" for="${id}">${h(c.etichetta)}${obb}</label>`;
    const v = valore == null ? "" : valore;
    let controllo = "";
    switch (c.tipo) {
      case "testolungo":
        if (c.nota) {
          return `<div class="campo campo-nota" data-id="${c.id}"><label class="etichetta" for="${id}">${icona("matita")}<span>${h(c.etichetta)}</span><span class="suggerimento">facoltative</span></label>
            <textarea id="${id}" rows="2" placeholder="Note su questa sezione">${h(v)}</textarea></div>`;
        }
        controllo = `<textarea id="${id}" rows="3">${h(v)}</textarea>`; break;
      case "email":
        controllo = `<input id="${id}" type="email" inputmode="email" autocomplete="off" autocapitalize="off" value="${h(v)}">`; break;
      case "telefono":
        controllo = `<input id="${id}" type="tel" inputmode="tel" autocomplete="off" value="${h(v)}">`; break;
      case "sino":
        return `<div class="campo campo-sino" data-id="${c.id}"><label class="interruttore" for="${id}">
          <span>${h(c.etichetta)}${obb}</span><input id="${id}" type="checkbox" ${v ? "checked" : ""}><span class="cursore" aria-hidden="true"></span></label></div>`;
      case "scelta":
      case "sceltamultipla": {
        const sel = c.tipo === "sceltamultipla" ? (Array.isArray(v) ? v : []) : [v];
        // poche risposte brevi: in fila su una riga, come un selettore
        const inFila = c.opzioni.length <= 3 && !c.stile && c.opzioni.every((o) => o.length <= 15);
        const lunghe = c.opzioni.some((o) => o.length > 28);
        return `<div class="campo${inFila ? " in-fila" : ""}${lunghe ? " risposte-lunghe" : ""}" data-id="${c.id}" style="--n:${c.opzioni.length}">
          <span class="etichetta" id="${id}_l">${h(c.etichetta)}${obb}${c.tipo === "sceltamultipla" ? ` <span class="suggerimento">più risposte</span>` : ""}</span>
          <div class="scelte" role="group" aria-labelledby="${id}_l" data-campo="${c.id}" data-tipo="${c.tipo}">
            ${c.opzioni.map((o, i) => {
              const extra = c.stile === "priorita" ? prioritaHtml({ [c.id]: o }) : c.stile === "livello" ? taccheHtml(c.opzioni.length - i, c.opzioni.length) : "";
              const dp = c.stile === "priorita" ? ` data-p="${Math.min(i + 1, 4)}"` : "";
              return `<button type="button" class="scelta"${dp} data-valore="${h(o)}" aria-pressed="${sel.includes(o)}">${extra}<span>${h(o)}</span></button>`;
            }).join("")}
          </div></div>`;
      }
      default:
        controllo = `<input id="${id}" type="text" autocomplete="off" value="${h(v)}">`;
    }
    return `<div class="campo${c.dipendeDa ? " dipendente" : ""}" data-id="${c.id}">${etichetta}${controllo}</div>`;
  }

  // Dove il browser lo sa fare da solo (field-sizing) i campi di testo crescono col contenuto senza JavaScript
  const CRESCITA_NATIVA = !!(window.CSS && CSS.supports && CSS.supports("field-sizing", "content"));
  if (CRESCITA_NATIVA) document.documentElement.classList.add("crescita-nativa");
  function adattaAltezza(t) {
    if (CRESCITA_NATIVA) return;
    t.style.height = "auto"; t.style.height = Math.max(t.scrollHeight, 80) + "px";
  }
  // Tutti i campi insieme: prima si scrive, poi si legge, poi si riscrive (evita un ricalcolo per ogni campo).
  // I campi vuoti hanno gia' l'altezza minima: si misurano solo quelli con del testo.
  function adattaAltezze(tutti) {
    if (CRESCITA_NATIVA) return;
    const campi = tutti.filter((t) => t.value);
    if (!campi.length) return;
    campi.forEach((t) => { t.style.height = "auto"; });
    const altezze = campi.map((t) => Math.max(t.scrollHeight, 80));
    campi.forEach((t, i) => { t.style.height = altezze[i] + "px"; });
  }

  // Estensione sicura per il nome dell'allegato: dal nome del file se e' pulita, altrimenti dal tipo
  function estensione(f, predefinita) {
    const dalNome = /\.([a-z0-9]{1,5})$/i.exec(f.name || "");
    if (dalNome) return dalNome[1].toLowerCase();
    const dalTipo = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp",
      "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac", "audio/ogg": "ogg", "audio/webm": "webm",
      "audio/wav": "wav", "audio/x-wav": "wav", "audio/amr": "amr", "audio/3gpp": "3gp" }[(f.type || "").split(";")[0]];
    return dalTipo || predefinita;
  }
  function nomeFile(prefisso, est) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${prefisso}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 5)}.${est}`;
  }

  async function comprimiFoto(file) {
    const max = CFG.foto.latoMassimo;
    let sorgente, w, hgt;
    if (window.createImageBitmap) {
      sorgente = await createImageBitmap(file, { imageOrientation: "from-image" });
      w = sorgente.width; hgt = sorgente.height;
    } else {
      sorgente = await new Promise((ok, ko) => {
        const img = new Image(); img.onload = () => ok(img); img.onerror = ko; img.src = URL.createObjectURL(file);
      });
      w = sorgente.naturalWidth; hgt = sorgente.naturalHeight;
    }
    const scala = Math.min(1, max / Math.max(w, hgt));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scala); canvas.height = Math.round(hgt * scala);
    canvas.getContext("2d").drawImage(sorgente, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", CFG.foto.qualita));
    if (!blob) throw new Error("Compressione non riuscita");
    return blob.size < file.size ? blob : file;
  }

  // ---------- Vista: riepilogo ----------
  async function vistaRiepilogo() {
    barraPrincipale();
    const tutte = await DB.tutteLeSchede();
    const fiera = IF.impostazioni.fiera;
    const schede = fiera && tutte.some((s) => s.fiera === fiera) ? tutte.filter((s) => s.fiera === fiera) : tutte;
    const tot = schede.length;
    const c = { bozza: 0, in_coda: 0, inviata: 0, importata: 0 };
    for (const s of schede) c[s.stato]++;
    const oggi = schede.filter((s) => giornoDi(s.intervistaIl) === "Oggi").length;
    const pct = (n) => (tot ? Math.round((n / tot) * 100) : 0);
    const barra1 = (n, classe) => `<div class="traccia"><span class="${classe}" style="width:${pct(n)}%"></span></div>`;

    const pc = IF.tuttiICampi(S).find((x) => x.stile === "priorita");
    const lc = IF.tuttiICampi(S).find((x) => x.stile === "livello");
    const conta = (campo, valore) => schede.filter((s) => s.dati[campo] === valore).length;
    const nA = pc ? conta(pc.id, pc.opzioni[0]) : 0;
    const completezza = tot ? Math.round(schede.reduce((a, s) => a + IF.completamento(s.dati, S).percento, 0) / tot) : 0;

    vista.innerHTML = `
      <header class="titolo-grande"><h1>Riepilogo</h1><p>${h(fiera && tutte.some((s) => s.fiera === fiera) ? fiera : "Tutte le fiere")} · schede su questo telefono</p></header>
      ${!tot ? `<div class="vuoto"><strong>Ancora nessun dato</strong><span>Il riepilogo si riempie man mano che compili le interviste.</span></div>` : `
      <div class="cifre">
        <div class="cifra"><span class="valore" data-n="${tot}">${tot}</span><span class="nome">Interviste</span></div>
        <div class="cifra"><span class="valore" data-n="${oggi}">${oggi}</span><span class="nome">Oggi</span></div>
        ${pc ? `<div class="cifra"><span class="valore" data-n="${nA}">${nA}</span><span class="nome">${prioritaHtml({ [pc.id]: pc.opzioni[0] })}Priorità ${h(IF.priorita({ [pc.id]: pc.opzioni[0] }, S).sigla)}</span></div>` : ""}
      </div>

      ${FILE ? `<section class="riquadro" aria-label="Esportazione">
        <h2>Esportazione</h2>
        <div class="traccia" style="height:10px" role="img" aria-label="${c.inviata} esportate, ${c.in_coda} da esportare, ${c.bozza} bozze">
          <span class="r-ok" style="width:${pct(c.inviata)}%"></span><span class="r-att" style="width:${pct(c.in_coda)}%"></span>
        </div>
        <ul class="legenda">
          <li><i style="background:var(--ok)"></i>Esportate <strong>${c.inviata}</strong></li>
          <li><i style="background:var(--att)"></i>Da esportare <strong>${c.in_coda}</strong></li>
          <li><i style="background:var(--s3)"></i>Bozze <strong>${c.bozza}</strong></li>
        </ul>
      </section>` : `<section class="riquadro" aria-label="Invio in sede">
        <h2>Invio in sede</h2>
        <div class="traccia" style="height:10px" role="img" aria-label="${c.importata} importate, ${c.inviata} inviate, ${c.in_coda} in coda, ${c.bozza} bozze">
          <span class="r-ok" style="width:${pct(c.importata)}%"></span><span class="r-accento" style="width:${pct(c.inviata)}%"></span><span class="r-att" style="width:${pct(c.in_coda)}%"></span>
        </div>
        <ul class="legenda">
          <li><i style="background:var(--ok)"></i>Importate <strong>${c.importata}</strong></li>
          <li><i style="background:var(--accent)"></i>Inviate <strong>${c.inviata}</strong></li>
          <li><i style="background:var(--att)"></i>In coda <strong>${c.in_coda}</strong></li>
          <li><i style="background:var(--s3)"></i>Bozze <strong>${c.bozza}</strong></li>
        </ul>
      </section>`}

      ${pc ? `<section class="riquadro"><h2>${h(pc.etichetta)}</h2><ul class="barre">
        ${pc.opzioni.map((o, i) => { const n = conta(pc.id, o); return `<li><span class="voce">${prioritaHtml({ [pc.id]: o })}<span>${h(o.replace(/^[A-Z]\s*–\s*/, ""))}</span></span><span class="num">${n}<small>${pct(n)}%</small></span>
          <div class="traccia"><span style="width:${pct(n)}%;background:var(--p${Math.min(i + 1, 4)})"></span></div></li>`; }).join("")}
        ${(() => { const n = schede.filter((s) => !s.dati[pc.id]).length; return n ? `<li><span class="voce">${prioritaHtml({})}<span>Non assegnato</span></span><span class="num">${n}<small>${pct(n)}%</small></span>${barra1(n, "r-neutro")}</li>` : ""; })()}
      </ul></section>` : ""}

      ${lc ? `<section class="riquadro"><h2>${h(lc.etichetta)}</h2><ul class="barre">
        ${lc.opzioni.map((o, i) => { const n = conta(lc.id, o); return `<li><span class="voce">${taccheHtml(lc.opzioni.length - i, lc.opzioni.length)}<span>${h(o)}</span></span><span class="num">${n}<small>${pct(n)}%</small></span>${barra1(n, "r-neutro")}</li>`; }).join("")}
      </ul></section>` : ""}

      <section class="riquadro"><h2>Completezza delle schede</h2>
        <div class="avanzamento"><div class="avanzamento-riga"><span>Campi compilati in media</span><span>${completezza}%</span></div>
        <div class="traccia"><span class="r-accento" style="width:${completezza}%"></span></div></div>
        <p class="nota">Conta i campi visibili di ogni scheda, compresi quelli facoltativi.</p>
      </section>`}
      <div class="spazio-tabbar"></div>`;
    cascata(vista.querySelectorAll(".titolo-grande, .cifra, .riquadro, .vuoto"));
    vista.querySelectorAll(".valore[data-n]").forEach((el) => contaSu(el, Number(el.dataset.n)));
    animaBarre(vista);
  }

  // ---------- Vista: impostazioni ----------
  async function vistaImpostazioni() {
    const c = await conteggi();
    const ocrPronto = !!window.SIM_OCR || await DB.leggi("ocr-pronto", false);
    const sp = CFG.modalita === "server" || FILE;
    const u = IF.adapter && IF.adapter.utente();
    barraPrincipale();
    vista.innerHTML = `
      <header class="titolo-grande"><h1>Impostazioni</h1></header>
      <section class="gruppo">
        <h2>Fiera e compilatrice</h2>
        <div class="campo"><label class="etichetta" for="impFiera">Fiera</label>
          <input id="impFiera" type="text" value="${h(IF.impostazioni.fiera)}" autocomplete="off"></div>
        <div class="campo"><label class="etichetta" for="impComp">Compilata da</label>
          <input id="impComp" type="text" value="${h(IF.impostazioni.compilatrice)}" ${sp && u ? "readonly" : ""} autocomplete="off">
          ${sp && u ? `<p class="nota">Preso dal tuo ${FILE ? "account" : "utente"}.</p>` : ""}</div>
        <p class="nota">Vengono aggiunti a ogni nuova scheda.</p>
      </section>

      ${FILE ? `<section class="gruppo">
        <h2>Account</h2>
        ${u ? `<p class="avviso ok">${icona("spunta")}<span>Telefono collegato all'account di <strong>${h(u.nome)}</strong>${u.username ? ` (${h(u.username)})` : ""}</span></p>` : ""}
        <button class="btn btn-secondario" type="button" id="btnCollegaImp">${icona("qr")}<span>Inquadra un altro QR</span></button>
        <p class="nota">Serve solo se in sede ti danno un nuovo QR (per esempio dopo un cambio di telefono) o se il telefono passa a un'altra collega. Le schede già salvate restano qui.</p>
      </section>
      <section class="gruppo">
        <h2>Passaggio in sede</h2>
        <p>Le schede restano su questo telefono, anche senza rete. La sera premi <strong>«Esporta»</strong>: si prepara un file con le schede complete, le note vocali e le foto. Mandalo o salvalo dove ti hanno detto in sede (cartella condivisa, email, Teams): il gestionale lo importa.</p>
        <div class="pila">
          <button class="btn btn-primario" type="button" id="btnEsportaPronte" ${c.in_coda ? "" : "disabled"}>Esporta le schede da esportare (${c.in_coda})</button>
          <button class="btn btn-secondario" type="button" id="btnEsportaTutte" ${c.in_coda + c.inviata ? "" : "disabled"}>Esporta di nuovo tutte (${c.in_coda + c.inviata})</button>
        </div>
        <p class="nota">«Di nuovo tutte» serve se un file si è perso: in sede le schede già importate non si duplicano. Le bozze non entrano nel file finché non premi «Completa».</p>
        ${!inApp() ? `<button class="btn btn-secondario" type="button" id="btnInstalla">Installa l'app sulla schermata Home</button>` : ""}
      </section>` : `<section class="gruppo">
        <h2>Collegamento</h2>
        <p>${h(IF.adapter ? IF.adapter.descrizione : (IF.adapters[CFG.modalita] || {}).descrizione || "")}</p>
        ${erroreConfig ? `<p class="avviso errore">${icona("attenzione")}<span>Invio non disponibile: ${h(erroreConfig)}. Le schede vengono comunque salvate sul telefono.</span></p>` : ""}
        ${sp && IF.adapter ? (u
          ? `<p class="avviso ok">${icona("spunta")}<span>Accesso eseguito come <strong>${h(u.nome)}</strong> (${h(u.username)})</span></p>
             <button class="btn btn-secondario" type="button" id="btnEsci">Esci da questo telefono</button>`
          : `<button class="btn btn-primario" type="button" id="btnAttivaQr">${icona("qr")}<span>Attiva con il QR</span></button>
             <p class="nota">Inquadra il «QR di attivazione» che ti mostrano in sede: il telefono si collega al tuo utente senza password. Oppure entra con utente e password:</p>
             <form class="pila" id="formAccesso" autocomplete="on">
               <div class="campo"><label class="etichetta" for="accUtente">Nome utente</label>
                 <input id="accUtente" name="username" type="text" autocapitalize="off" autocomplete="username" spellcheck="false" required></div>
               <div class="campo"><label class="etichetta" for="accPassword">Password</label>
                 <input id="accPassword" name="password" type="password" autocomplete="current-password" required></div>
               <button class="btn btn-secondario" type="submit" id="btnEntra">Entra</button>
             </form>`) : ""}
        ${sp && !inApp() ? `<button class="btn btn-secondario" type="button" id="btnInstalla">Installa l'app sulla schermata Home</button>` : ""}
        ${!sp ? `<label class="interruttore" for="impOffline"><span>Simula assenza di rete<span class="nota blocco">Per provare la coda: compila e invia, poi riattiva la rete.</span></span>
          <input id="impOffline" type="checkbox" ${IF.impostazioni.simulaOffline ? "checked" : ""}><span class="cursore" aria-hidden="true"></span></label>` : ""}
      </section>`}

      <section class="gruppo">
        <h2>Aspetto</h2>
        <div class="campo in-fila" style="--n:3">
          <span class="etichetta" id="temaEt">Tema</span>
          <div class="scelte" role="group" aria-labelledby="temaEt" id="sceltaTema">
            ${[["auto", "Automatico"], ["chiaro", "Chiaro"], ["scuro", "Scuro"]].map(([v, et]) => `<button type="button" class="scelta" data-tema="${v}" aria-pressed="${IF.Tema.letto() === v}">${et}</button>`).join("")}
          </div>
        </div>
        <p class="nota">«Automatico» segue il tema del telefono (chiaro di giorno, scuro di sera se impostato così).</p>
      </section>

      <section class="gruppo">
        <h2>Lettura dei biglietti</h2>
        <p>La foto del biglietto da visita si legge sul telefono, anche senza rete. La prima volta si scarica il motore di lettura (circa 8 MB): meglio farlo prima della fiera, con il Wi-Fi.</p>
        <p class="${ocrPronto ? "avviso ok" : "nota"}" id="ocrStatoImp">${ocrPronto ? `${icona("spunta")}<span>Pronta su questo telefono${window.SIM_OCR ? " (simulata in questa prova)" : ""}</span>` : "Non ancora scaricata su questo telefono."}</p>
        ${ocrPronto ? "" : `<button class="btn btn-secondario" type="button" id="btnPreparaOcr">Scarica ora la lettura dei biglietti</button>`}
      </section>

      ${FILE ? `<section class="gruppo">
        <h2>Dati su questo telefono</h2>
        <dl class="riepilogo">
          <div><dt>Bozze</dt><dd>${c.bozza}</dd></div>
          <div><dt>Da esportare</dt><dd>${c.in_coda}</dd></div>
          <div><dt>Esportate</dt><dd>${c.inviata}</dd></div>
        </dl>
        <p class="nota">Le schede esportate restano sul telefono finché non le cancelli. Cancellale solo quando in sede ti confermano di averle importate.</p>
        <button class="btn btn-secondario" type="button" id="btnPulisciEsportate" ${c.inviata ? "" : "disabled"}>Cancella le schede esportate</button>
      </section>` : `<section class="gruppo">
        <h2>Dati su questo telefono</h2>
        <dl class="riepilogo">
          <div><dt>Bozze</dt><dd>${c.bozza}</dd></div>
          <div><dt>In coda</dt><dd>${c.in_coda}</dd></div>
          <div><dt>Inviate</dt><dd>${c.inviata}</dd></div>
          <div><dt>Importate</dt><dd>${c.importata}</dd></div>
        </dl>
        <p class="nota">Le schede importate in sede vengono cancellate dal telefono ${CFG.pulizia.giorniDopoImport ? `dopo ${CFG.pulizia.giorniDopoImport} giorni` : "solo a mano"}.</p>
        <div class="pila">
          <button class="btn btn-secondario" type="button" id="btnEsporta">Esporta copia di emergenza</button>
          <button class="btn btn-secondario" type="button" id="btnPulisci" ${c.importata ? "" : "disabled"}>Cancella ora le schede importate</button>
        </div>
        <p class="nota">La copia di emergenza è un file con tutte le schede e gli allegati: serve solo se il telefono non riesce a inviare.</p>
      </section>`}

      <section class="gruppo">
        <h2>Informazioni</h2>
        <span class="targa-logo grande" style="align-self:flex-start"><img src="${LOGO}" alt="Assut Europe – Suture chirurgiche" width="195" height="44"></span>
        <dl class="riepilogo testo">
          <div><dt>Versione app</dt><dd>${h(CFG.versioneApp)}</dd></div>
          <div><dt>Versione scheda</dt><dd>${h(S.versione)}</dd></div>
          <div><dt>Archivio</dt><dd>${archivioInMemoria ? "Temporaneo (non permanente)" : "Sul dispositivo"}</dd></div>
        </dl>
      </section>
      <div class="spazio-tabbar"></div>`;
    cascata(vista.querySelectorAll(".titolo-grande, .gruppo"));

    const fiera = document.getElementById("impFiera");
    const comp = document.getElementById("impComp");
    const salvaImp = async () => {
      IF.impostazioni.fiera = fiera.value.trim();
      if (!comp.readOnly) IF.impostazioni.compilatrice = comp.value.trim();
      await salvaImpostazioni();
      barraPrincipale();
    };
    fiera.onchange = salvaImp; comp.onchange = salvaImp;
    fiera.oninput = salvaImp; comp.oninput = salvaImp;

    const off = document.getElementById("impOffline");
    if (off) off.onchange = async () => {
      IF.impostazioni.simulaOffline = off.checked; await salvaImpostazioni();
      avviso(off.checked ? "Rete simulata assente" : "Rete ripristinata: invio delle schede in coda", "info");
      if (!off.checked) IF.Sync.adesso();
    };
    const e1 = document.getElementById("btnEsci");
    if (e1) e1.onclick = async () => {
      const ok = await conferma("Uscire da questo telefono?", "Le schede restano salvate qui, ma non partono finché non entri di nuovo.", "Esci");
      if (!ok) return;
      await IF.adapter.esci(); await salvaImpostazioni(); vistaImpostazioni(); aggiornaStrisciaInvio();
    };
    const st = document.getElementById("sceltaTema");
    if (st) st.onclick = (e) => {
      const btn = e.target.closest("[data-tema]");
      if (!btn) return;
      IF.Tema.scegli(btn.dataset.tema);
      st.querySelectorAll("[data-tema]").forEach((x) => x.setAttribute("aria-pressed", String(x === btn)));
    };
    const bpo = document.getElementById("btnPreparaOcr");
    if (bpo) bpo.onclick = () => conCaricamento(bpo, "Download in corso…", async () => {
      try {
        await IF.OCR.prepara((stato, p) => { bpo.textContent = `Download in corso… ${Math.round(p * 100)}%`; });
        await DB.scrivi("ocr-pronto", true);
        avviso("Lettura dei biglietti pronta: ora funziona anche senza rete", "ok");
        vistaImpostazioni();
      } catch (e) { avviso(e.message, "errore"); }
    });
    const bcq = document.getElementById("btnCollegaImp");
    if (bcq) bcq.onclick = async () => { if (await collegaDaScansione()) vistaImpostazioni(); };
    const baq = document.getElementById("btnAttivaQr");
    if (baq) baq.onclick = attivaDaScansione;
    const bin = document.getElementById("btnInstalla");
    if (bin) bin.onclick = () => guidaInstallazione(false);
    const fa = document.getElementById("formAccesso");
    if (fa) fa.onsubmit = (e) => {
      e.preventDefault();
      const b = document.getElementById("btnEntra");
      conCaricamento(b, "Accesso…", async () => {
        try {
          const r = await IF.adapter.entra(fa.username.value.trim().toLowerCase(), fa.password.value);
          IF.impostazioni.compilatrice = r.nome;
          await salvaImpostazioni();
          avviso(`Benvenuta, ${r.nome.split(" ")[0]}`, "ok");
          IF.Sync.adesso();
          // dopo l'accesso si va subito alle interviste (se manca la fiera lo ricorda un suggerimento)
          if (location.hash === "#lista") disegna(); else location.hash = "#lista";
        } catch (err) { avviso(err.message, "errore"); }
      });
    };
    if (FILE) {
      document.getElementById("btnEsportaPronte").onclick = () => esportaPerSede(false);
      document.getElementById("btnEsportaTutte").onclick = () => esportaPerSede(true);
      document.getElementById("btnPulisciEsportate").onclick = async () => {
        const ok = await conferma("Cancellare le schede esportate?", "Fallo solo se in sede ti hanno confermato di averle importate. Verranno tolte da questo telefono, con note vocali e foto.", "Cancella");
        if (!ok) return;
        let n = 0;
        for (const x of await DB.tutteLeSchede()) if (x.stato === "inviata") { await DB.eliminaScheda(x.id); n++; }
        IF.eventi.emit("lista");
        avviso(`${n} ${n === 1 ? "scheda cancellata" : "schede cancellate"} dal telefono`);
        vistaImpostazioni();
      };
      return;
    }
    document.getElementById("btnEsporta").onclick = esportaCopia;
    document.getElementById("btnPulisci").onclick = async () => {
      const ok = await conferma("Cancellare le schede importate?", "Sono già nel software in sede. Verranno tolte solo da questo telefono.", "Cancella");
      if (!ok) return;
      const n = await IF.Sync.pulizia(true);
      avviso(`${n} ${n === 1 ? "scheda cancellata" : "schede cancellate"} dal telefono`);
      vistaImpostazioni();
    };
  }

  async function esportaCopia() {
    const schede = await DB.tutteLeSchede();
    const allegati = await DB.tuttiGliAllegati();
    const conB64 = await Promise.all(allegati.map(async (a) => ({
      ...a, blob: undefined, base64: await new Promise((ok) => {
        const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.readAsDataURL(a.blob);
      })
    })));
    const dati = { app: CFG.nomeApp, versioneApp: CFG.versioneApp, versioneScheda: S.versione, esportatoIl: new Date().toISOString(), schede, allegati: conB64 };
    const blob = new Blob([JSON.stringify(dati, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `interviste-fiera-copia-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    avviso("Copia di emergenza creata");
  }

  // ---------- Info: prezzi Assut (listino della sede, più quelli scritti dalla collega) e rete commerciale ----------
  // I dati fissi (prodotti con il listino, paesi, distributori) arrivano da info-dati.js, generato dagli Excel della sede.
  // I prezzi scritti dalla collega stanno nel database del telefono («info-prezzi»): non vanno nel file esportato né in rete.
  const INFO = window.IF_INFO_DATI || { prezzi: { gruppi: [] }, rete: { aree: [], paesi: [], distributori: {}, accordi: {}, referenti: {} } };
  const infoStato = { cerca: { prezzi: "", rete: "" }, soloPrezzo: false, area: "", accordo: "" };
  const normalizzaTesto = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const formattaPrezzo = (v) => { const n = Number(String(v).replace(",", ".")); return isFinite(n) && String(v).trim() !== "" ? n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : ""; };

  async function vistaInfo(pagina) {
    barraPrincipale();
    const testa = `<header class="titolo-grande"><h1>Info</h1></header>
      <div class="schede-info" role="tablist" aria-label="Pagine di Info">
        <a class="scheda-info" role="tab" href="#info" aria-selected="${pagina === "prezzi"}">Prezzi Assut</a>
        <a class="scheda-info" role="tab" href="#info-rete" aria-selected="${pagina === "rete"}">Rete commerciale</a>
      </div>`;
    if (pagina === "rete") return vistaRete(testa);
    const prezzi = await DB.leggi("info-prezzi", {});
    const aperti = new Set(await DB.leggi("info-gruppi-aperti", []));
    const gruppi = INFO.prezzi.gruppi;
    const tot = gruppi.reduce((n, g) => n + g.voci.length, 0);
    const proprio = (v) => !!(prezzi[v.id] && prezzi[v.id].prezzo);
    const haPrezzo = (v) => proprio(v) || !!v.listino;
    const conPrezzo = gruppi.reduce((n, g) => n + g.voci.filter(haPrezzo).length, 0);
    vista.innerHTML = `${testa}
      <p class="avviso">${icona("info")}<span>Prezzi del listino della sede. Tocca una voce per scrivere un tuo prezzo o una nota: restano solo su questo telefono e non entrano nel file per la sede.</span></p>
      <div class="barra-info">
        <input id="cercaPrezzi" type="search" placeholder="Cerca un prodotto" aria-label="Cerca un prodotto" value="${h(infoStato.cerca.prezzi)}" autocomplete="off">
        <label class="spunta-info"><input type="checkbox" id="soloPrezzo" ${infoStato.soloPrezzo ? "checked" : ""}> Solo con prezzo</label>
      </div>
      <div class="riga-comandi"><p class="conteggio-info">${conPrezzo} di ${tot} voci con prezzo</p>
        <button class="btn btn-piccolo btn-secondario" type="button" id="apriTutti"></button></div>
      <div id="elencoPrezzi" class="pila-gruppi"></div>
      <div class="spazio-tabbar"></div>`;
    const filtrando = () => !!(infoStato.cerca.prezzi.trim() || infoStato.soloPrezzo);
    const disegnaPrezzi = () => {
      const q = normalizzaTesto(infoStato.cerca.prezzi);
      const visibili = [];
      const parti = gruppi.map((g) => {
        const voci = g.voci.filter((v) => (!q || normalizzaTesto(`${g.nome} ${v.nome}`).includes(q)) && (!infoStato.soloPrezzo || haPrezzo(v)));
        if (filtrando() && !voci.length) return "";
        visibili.push(voci.length + 2);
        const aperto = filtrando() || aperti.has(g.nome);
        const n = g.voci.filter(haPrezzo).length;
        const singola = g.voci.length === 1 && !g.voci[0].nome;
        return `<section class="gruppo-prezzi${aperto ? " aperto" : ""}">
          <button class="testa-gruppo" type="button" data-gruppo="${h(g.nome)}" aria-expanded="${aperto}">
            <span class="nome-gruppo">${h(g.nome)}</span>
            <span class="conta-gruppo">${singola ? (n ? "con prezzo" : "senza prezzo") : `${g.voci.length} voci${n ? ` · ${n} con prezzo` : ""}`}</span>
            ${icona("giu")}</button>
          ${aperto ? `<ul class="elenco">${voci.map((v) => {
            const x = prezzi[v.id] || {};
            const mio = !!x.prezzo;
            const sotto = [mio && v.listino ? `Listino: ${v.listino}` : "", x.nota || ""].filter(Boolean).join(" · ");
            return `<li><button class="riga riga-prezzo" type="button" data-voce="${h(v.id)}">
              <span class="riga-corpo"><span class="riga-titolo">${h(v.nome || g.nome)}</span>${sotto ? `<span class="riga-sotto">${h(sotto)}</span>` : ""}</span>
              <span class="prezzo${mio || v.listino ? "" : " manca"}">${mio ? `${h(formattaPrezzo(x.prezzo))}<small class="prezzo-mio">tuo</small>` : v.listino ? h(v.listino) : "Aggiungi"}</span></button></li>`;
          }).join("")}</ul>` : ""}
        </section>`;
      }).filter(Boolean);
      // sul tablet i gruppi stanno in due colonne che scorrono ognuna per conto suo: aprire un gruppo sposta solo la sua
      // colonna. Si dividono in ordine, a metà delle voci, così la divisione non cambia aprendo e chiudendo.
      const totale = visibili.reduce((a, b) => a + b, 0);
      let taglio = 0;
      for (let somma = 0; taglio < visibili.length && somma + visibili[taglio] / 2 <= totale / 2; taglio++) somma += visibili[taglio];
      const html = parti.length ? `<div class="colonne-gruppi"><div class="colonna-gruppi">${parti.slice(0, taglio).join("")}</div>
        <div class="colonna-gruppi">${parti.slice(taglio).join("")}</div></div>` : "";
      document.getElementById("elencoPrezzi").innerHTML = html || `<div class="vuoto"><strong>Nessuna voce trovata</strong><span>${infoStato.soloPrezzo ? "Togli «Solo con prezzo» o cambia la ricerca." : "Prova con un'altra parola."}</span></div>`;
      const bt = document.getElementById("apriTutti");
      bt.hidden = filtrando();
      bt.textContent = aperti.size >= gruppi.length ? "Chiudi tutti" : "Apri tutti";
    };
    const ricordaAperti = () => DB.scrivi("info-gruppi-aperti", [...aperti]);
    disegnaPrezzi();
    document.getElementById("cercaPrezzi").oninput = (e) => { infoStato.cerca.prezzi = e.target.value; disegnaPrezzi(); };
    document.getElementById("soloPrezzo").onchange = (e) => { infoStato.soloPrezzo = e.target.checked; disegnaPrezzi(); };
    document.getElementById("apriTutti").onclick = () => {
      if (aperti.size >= gruppi.length) aperti.clear(); else gruppi.forEach((g) => aperti.add(g.nome));
      ricordaAperti(); disegnaPrezzi();
    };
    document.getElementById("elencoPrezzi").onclick = (e) => {
      const tg = e.target.closest("[data-gruppo]");
      if (tg) {
        if (filtrando()) return;
        const nome = tg.dataset.gruppo;
        if (aperti.has(nome)) aperti.delete(nome); else aperti.add(nome);
        ricordaAperti(); disegnaPrezzi();
        return;
      }
      const b = e.target.closest("[data-voce]");
      if (!b) return;
      const id = b.dataset.voce;
      const g = gruppi.find((x) => x.voci.some((v) => v.id === id));
      const v = g.voci.find((x) => x.id === id);
      const x = prezzi[id] || {};
      const { d, chiudi } = apriFoglio(`<h2 class="maiuscolo">${h(v.nome ? `${g.nome} · ${v.nome}` : g.nome)}</h2>
        <p class="listino-foglio"><span class="etichetta">Listino della sede</span><strong>${v.listino ? h(v.listino) : "Non indicato"}</strong></p>
        <div class="campo"><label class="etichetta" for="ipPrezzo">Il tuo prezzo (€)</label>
          <input id="ipPrezzo" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${h(x.prezzo || "")}"></div>
        <div class="campo"><label class="etichetta" for="ipNota">Nota</label>
          <input id="ipNota" type="text" autocomplete="off" placeholder="es. per confezione da 12" value="${h(x.nota || "")}" maxlength="120"></div>
        <p class="nota" id="ipErrore" role="alert"></p>
        <div class="dialogo-azioni"><button class="btn btn-secondario" type="button" id="ipAnnulla">Annulla</button>
          <button class="btn btn-primario" type="button" id="ipSalva">Salva</button></div>
        ${x.prezzo || x.nota ? `<button class="btn btn-secondario" type="button" id="ipTogli">${v.listino ? "Torna al listino" : "Togli il prezzo"}</button>` : ""}`);
      const salva = async (valore) => {
        const tutti = await DB.leggi("info-prezzi", {});
        if (valore) tutti[id] = valore; else delete tutti[id];
        await DB.scrivi("info-prezzi", tutti);
        chiudi(); vistaInfo("prezzi");
      };
      d.querySelector(".dialogo-velo").onclick = chiudi;
      d.querySelector("#ipAnnulla").onclick = chiudi;
      d.querySelector("#ipSalva").onclick = () => {
        const p = d.querySelector("#ipPrezzo").value.trim().replace(/\s|€/g, "");
        const nota = d.querySelector("#ipNota").value.trim();
        if (p && !/^\d{1,7}([.,]\d{1,4})?$/.test(p)) { d.querySelector("#ipErrore").textContent = "Scrivi solo il numero, per esempio 12,50"; return; }
        salva(p || nota ? { prezzo: p, nota, il: new Date().toISOString() } : null);
      };
      const t = d.querySelector("#ipTogli"); if (t) t.onclick = () => salva(null);
      setTimeout(() => d.querySelector("#ipPrezzo").focus(), 250);
    };
  }

  function vistaRete(testa) {
    const R = INFO.rete, M = window.IF_MAPPA;
    const nomeArea = Object.fromEntries(R.aree.map((a) => [a.id, a.nome]));
    // un paese puo' comparire piu' volte (accordi diversi): una sola scheda con tutte le righe
    const perPaese = new Map();
    for (const p of R.paesi) { if (!perPaese.has(p.paese)) perPaese.set(p.paese, []); perPaese.get(p.paese).push(p); }
    const perIso = new Map([...perPaese].filter(([, r]) => r[0].iso).map(([k, r]) => [r[0].iso, k]));
    const PRIORITA = ["esclusivo", "non_esclusivo", "registrazione", "non_indicato"];
    const accordoPrincipale = (righe) => PRIORITA.find((k) => righe.some((r) => r.accordo === k)) || "non_indicato";
    const referente = (sigle) => sigle ? sigle.split("/").map((x) => { const k = x.trim(); return R.referenti[k] ? `${R.referenti[k]} (${k})` : k; }).join(" / ") : "";
    const cartaPaese = (nome, righe, conMappa) => {
      const dist = R.distributori[nome] || [];
      return `<article class="carta-paese" data-paese="${h(nome)}">
        <header><h2>${h(nome)}</h2><span class="area-paese">${h(nomeArea[righe[0].area] || righe[0].area)}</span></header>
        ${righe.map((r) => `<div class="accordo-paese">
          <span class="pillola-accordo ${r.accordo}"><i class="pallino-accordo ${r.accordo}"></i>${h(R.accordi[r.accordo] || r.accordo)}</span>
          <div class="linee">${r.linee.map((l) => `<span class="linea">${h(l)}</span>`).join("")}</div>
          <dl class="dettagli-paese">${r.sigle ? `<div><dt>Sigle</dt><dd>${h(r.sigle)}</dd></div>` : ""}${r.referenti ? `<div><dt>Referenti</dt><dd>${h(referente(r.referenti))}</dd></div>` : ""}</dl>
        </div>`).join("")}
        ${dist.length ? `<div class="distributori"><span class="etichetta-dist">Distributori</span><ul>${dist.map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>` : ""}
        ${conMappa && righe[0].iso ? `<button class="btn btn-piccolo btn-secondario" type="button" data-mostra="${h(nome)}">${icona("luogo")}<span>Sulla mappa</span></button>` : ""}
      </article>`;
    };
    const percorsi = M ? Object.entries(M.paesi).map(([iso, x]) => {
      const nome = perIso.get(iso);
      const cl = nome ? `paese con-dati ${accordoPrincipale(perPaese.get(nome))}` : "paese";
      return `<path class="${cl}" d="${x.d}" data-iso="${iso}"${nome ? ` data-paese="${h(nome)}"><title>${h(nome)}</title></path>` : "></path>"}`;
    }).join("") + Object.entries(M.punti).map(([iso, x]) => {
      const nome = perIso.get(iso);
      return nome ? `<circle class="paese con-dati punto ${accordoPrincipale(perPaese.get(nome))}" cx="${x.c[0]}" cy="${x.c[1]}" r="3" data-iso="${iso}" data-paese="${h(nome)}"><title>${h(nome)}</title></circle>` : "";
    }).join("") : "";
    vista.innerHTML = `${testa}
      <div class="barra-info"><input id="cercaRete" type="search" placeholder="Cerca un paese o un distributore" aria-label="Cerca un paese o un distributore" value="${h(infoStato.cerca.rete)}" autocomplete="off"></div>
      <div class="scelte filtri-info" id="filtroArea" role="group" aria-label="Area">
        <button type="button" class="scelta" data-area="" aria-pressed="${!infoStato.area}">Tutte</button>
        ${R.aree.map((a) => `<button type="button" class="scelta" data-area="${h(a.id)}" aria-pressed="${infoStato.area === a.id}">${h(a.nome)}</button>`).join("")}
      </div>
      <div class="scelte filtri-info" id="filtroAccordo" role="group" aria-label="Accordo">
        ${["esclusivo", "non_esclusivo", "registrazione"].map((k) => `<button type="button" class="scelta scelta-accordo" data-accordo="${k}" aria-pressed="${infoStato.accordo === k}"><i class="pallino-accordo ${k}"></i>${h(R.accordi[k])}</button>`).join("")}
      </div>
      ${M ? `<section class="mappa-rete" aria-label="Mappa della rete commerciale">
        <div class="mappa-vista" id="mappaVista">
          <svg id="mappaSvg" viewBox="0 0 ${M.larghezza} ${M.altezza}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mappa del mondo: i paesi colorati hanno un accordo">${percorsi}</svg>
          <div class="mappa-comandi">
            <button type="button" class="btn-mappa" id="mappaPiu" aria-label="Ingrandisci">${icona("piu")}</button>
            <button type="button" class="btn-mappa" id="mappaMeno" aria-label="Riduci"><svg class="icona" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
            <button type="button" class="btn-mappa" id="mappaTutto" aria-label="Tutto il mondo"><svg class="icona" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/></svg></button>
          </div>
        </div>
        <ul class="legenda-mappa">
          <li><i class="pallino-accordo esclusivo"></i>Esclusivo</li><li><i class="pallino-accordo non_esclusivo"></i>Non esclusivo</li>
          <li><i class="pallino-accordo registrazione"></i>Registrazione / prospect</li><li><i class="pallino-accordo non_indicato"></i>Non indicato</li>
        </ul>
        <p class="nota">Tocca un paese colorato per vederne i dati. Due dita per ingrandire e spostare.</p>
        <div id="mappaScheda"></div>
      </section>` : ""}
      <p class="conteggio-info" id="contaRete"></p>
      <div id="elencoRete" class="pila-info"></div>
      <p class="nota">Elenco della sede aggiornato al ${h(INFO.generatoIl ? INFO.generatoIl.split("-").reverse().join("/") : "—")}.</p>
      <div class="spazio-tabbar"></div>`;

    const corrisponde = (nome, righe, q) => {
      if (infoStato.area && !righe.some((r) => r.area === infoStato.area)) return false;
      if (infoStato.accordo && !righe.some((r) => r.accordo === infoStato.accordo)) return false;
      return !q || normalizzaTesto([nome, ...(R.distributori[nome] || []), ...righe.map((r) => r.linee.join(" "))].join(" ")).includes(q);
    };
    const svg = document.getElementById("mappaSvg");

    // ---- mappa: vista (viewBox), zoom e spostamento
    let vb = null;
    const proporzione = () => { const r = svg.getBoundingClientRect(); return r.width ? r.height / r.width : M.altezza / M.larghezza; };
    // vista iniziale: su uno schermo largo tutto il mondo; su un telefono la mappa riempie l'altezza, centrata su Europa e Africa
    const tuttoIlMondo = () => {
      const k = proporzione();
      const w = k <= 0.56 ? M.larghezza : Math.max(M.larghezza * 0.62, M.altezza * 1.02 / k);
      const cx = k <= 0.56 ? M.larghezza / 2 : M.larghezza * 0.53;
      return { x: cx - w / 2, y: M.altezza / 2 - (w * k) / 2, w, h: w * k };
    };
    const unitaPerPixel = () => vb.w / (svg.getBoundingClientRect().width || 1);
    function applica() {
      const k = proporzione();
      vb.w = Math.min(M.larghezza * 1.05, Math.max(M.larghezza / 40, vb.w)); vb.h = vb.w * k;
      vb.x = Math.min(M.larghezza - vb.w * 0.3, Math.max(-vb.w * 0.7, vb.x));
      vb.y = Math.min(M.altezza - vb.h * 0.3, Math.max(-vb.h * 0.7, vb.y));
      svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
      const r = 5 * unitaPerPixel();
      svg.querySelectorAll("circle.punto").forEach((c) => c.setAttribute("r", r));
      infoStato.vb = { ...vb };
    }
    function zoom(f, cx, cy) {
      const nw = Math.min(M.larghezza * 1.05, Math.max(M.larghezza / 40, vb.w / f));
      const k = nw / vb.w;
      vb.x = cx - (cx - vb.x) * k; vb.y = cy - (cy - vb.y) * k; vb.w = nw; vb.h = nw * proporzione();
      applica();
    }
    function inquadra(b) {   // b = [x0, y0, x1, y1]
      const k = proporzione();
      let w = Math.max((b[2] - b[0]) * 1.3, M.larghezza / 18);
      if ((b[3] - b[1]) * 1.3 > w * k) w = (b[3] - b[1]) * 1.3 / k;
      vb = { x: (b[0] + b[2]) / 2 - w / 2, y: (b[1] + b[3]) / 2 - (w * k) / 2, w, h: w * k };
      applica();
    }
    const confini = (nomi) => {
      let b = null;
      for (const nome of nomi) {
        const iso = perPaese.get(nome)[0].iso; if (!iso) continue;
        const x = M.paesi[iso] ? M.paesi[iso].b : M.punti[iso] ? [M.punti[iso].c[0] - 4, M.punti[iso].c[1] - 4, M.punti[iso].c[0] + 4, M.punti[iso].c[1] + 4] : null;
        if (!x) continue;
        // la Russia (e chi attraversa la linea del cambio di data) allargherebbe troppo: si usa la parte che si vede
        b = b ? [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] : x.slice();
      }
      return b;
    };
    function seleziona(nome, centra) {
      infoStato.selezione = nome || null;
      svg && svg.querySelectorAll(".selezionato").forEach((x) => x.classList.remove("selezionato"));
      const box = document.getElementById("mappaScheda");
      if (!nome) { if (box) box.innerHTML = ""; return; }
      svg && svg.querySelectorAll(`[data-paese="${CSS.escape(nome)}"]`).forEach((x) => { x.classList.add("selezionato"); x.parentNode.appendChild(x); });
      if (box) box.innerHTML = `<div class="scheda-mappa">${cartaPaese(nome, perPaese.get(nome), false)}<button class="btn-mappa chiudi-scheda" type="button" id="chiudiScheda" aria-label="Chiudi">${icona("x")}</button></div>`;
      const ch = document.getElementById("chiudiScheda"); if (ch) ch.onclick = () => seleziona(null);
      if (centra) { const b = confini([nome]); if (b) inquadra(b); }
    }

    const disegnaRete = () => {
      const q = normalizzaTesto(infoStato.cerca.rete);
      const paesi = [...perPaese.entries()].filter(([nome, righe]) => corrisponde(nome, righe, q));
      const visibili = new Set(paesi.map(([n]) => n));
      if (svg) svg.querySelectorAll(".con-dati").forEach((x) => x.classList.toggle("spento", !visibili.has(x.dataset.paese)));
      document.getElementById("contaRete").textContent = `${paesi.length} ${paesi.length === 1 ? "paese" : "paesi"}`;
      document.getElementById("elencoRete").innerHTML = paesi.length ? paesi.map(([nome, righe]) => cartaPaese(nome, righe, !!svg)).join("")
        : `<div class="vuoto"><strong>Nessun paese trovato</strong><span>Cambia la ricerca o i filtri.</span></div>`;
      return paesi;
    };
    disegnaRete();

    if (svg) {
      vb = infoStato.vb ? { ...infoStato.vb } : tuttoIlMondo();
      applica();
      if (infoStato.selezione && perPaese.has(infoStato.selezione)) seleziona(infoStato.selezione, false);
      const inSvg = (cx, cy) => { const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
      const dita = new Map();
      let inizio = null, distanza = 0;
      const vista2 = document.getElementById("mappaVista");
      vista2.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".mappa-comandi")) return;
        vista2.setPointerCapture(e.pointerId);
        dita.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (dita.size === 1) inizio = { x: e.clientX, y: e.clientY, t: Date.now(), mosso: false };
        if (dita.size === 2) { const [a, b] = [...dita.values()]; distanza = Math.hypot(a.x - b.x, a.y - b.y); if (inizio) inizio.mosso = true; }
      });
      vista2.addEventListener("pointermove", (e) => {
        const prima = dita.get(e.pointerId); if (!prima) return;
        const ora = { x: e.clientX, y: e.clientY };
        if (dita.size === 1) {
          const u = unitaPerPixel();
          vb.x -= (ora.x - prima.x) * u; vb.y -= (ora.y - prima.y) * u;
          if (inizio && Math.hypot(ora.x - inizio.x, ora.y - inizio.y) > 6) inizio.mosso = true;
          dita.set(e.pointerId, ora); applica();
        } else if (dita.size === 2) {
          dita.set(e.pointerId, ora);
          const [a, b] = [...dita.values()];
          const d2 = Math.hypot(a.x - b.x, a.y - b.y);
          if (distanza > 0) { const c = inSvg((a.x + b.x) / 2, (a.y + b.y) / 2); zoom(d2 / distanza, c.x, c.y); }
          distanza = d2;
        }
      });
      const fine = (e) => {
        if (!dita.has(e.pointerId)) return;
        dita.delete(e.pointerId);
        if (dita.size === 0 && inizio && !inizio.mosso && Date.now() - inizio.t < 500 && e.type === "pointerup") {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const x = el && el.closest && el.closest(".con-dati");
          seleziona(x ? x.dataset.paese : null, false);
        }
        if (dita.size < 2) distanza = 0;
        if (dita.size === 0) inizio = null;
      };
      vista2.addEventListener("pointerup", fine); vista2.addEventListener("pointercancel", fine);
      vista2.addEventListener("wheel", (e) => { e.preventDefault(); const c = inSvg(e.clientX, e.clientY); zoom(Math.exp(-e.deltaY * 0.0015), c.x, c.y); }, { passive: false });
      const centro = () => ({ x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 });
      document.getElementById("mappaPiu").onclick = () => { const c = centro(); zoom(1.6, c.x, c.y); };
      document.getElementById("mappaMeno").onclick = () => { const c = centro(); zoom(1 / 1.6, c.x, c.y); };
      document.getElementById("mappaTutto").onclick = () => { vb = tuttoIlMondo(); applica(); };
      window.addEventListener("resize", () => { if (document.getElementById("mappaSvg") === svg) applica(); });
    }
    document.getElementById("elencoRete").onclick = (e) => {
      const b = e.target.closest("[data-mostra]"); if (!b) return;
      seleziona(b.dataset.mostra, true);
      document.getElementById("mappaVista").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    document.getElementById("cercaRete").oninput = (e) => { infoStato.cerca.rete = e.target.value; disegnaRete(); };
    document.getElementById("filtroArea").onclick = (e) => {
      const b = e.target.closest("[data-area]"); if (!b) return;
      infoStato.area = b.dataset.area;
      e.currentTarget.querySelectorAll("[data-area]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      const paesi = disegnaRete();
      if (svg) { if (!infoStato.area) { vb = tuttoIlMondo(); applica(); } else { const bb = confini(paesi.map(([n]) => n)); if (bb) inquadra(bb); } }
    };
    document.getElementById("filtroAccordo").onclick = (e) => {
      const b = e.target.closest("[data-accordo]"); if (!b) return;
      infoStato.accordo = infoStato.accordo === b.dataset.accordo ? "" : b.dataset.accordo;
      e.currentTarget.querySelectorAll("[data-accordo]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.accordo === infoStato.accordo)));
      disegnaRete();
    };
  }

  // ---------- Esportazione per la sede (modalita' "file") ----------
  // In due tempi: prima si prepara il file (puo' richiedere qualche secondo con molte note vocali), poi un tocco
  // lo condivide o lo salva. Il secondo tocco serve: telefoni e browser aprono «Condividi» solo subito dopo un tocco.
  async function esportaPerSede(tutte) {
    const candidate = (await DB.tutteLeSchede()).filter((s) => !s.esempio
      && (s.stato === "in_coda" || (tutte && (s.stato === "inviata" || s.stato === "importata"))))
      .sort((a, b) => (b.intervistaIl || "").localeCompare(a.intervistaIl || ""));
    if (!candidate.length) { avviso("Nessuna scheda da esportare: prima completa le interviste", "info"); return; }
    // 1. scelta delle schede: tutte spuntate, si toglie la spunta a quelle da tenere per un'altra volta
    const nAll = {};
    for (const x of candidate) nAll[x.id] = (await DB.allegatiDi(x.id)).length;
    const { d, chiudi } = apriFoglio(`<h2>Esportazione</h2>
      <p>${tutte ? "Tutte le schede complete, anche quelle già esportate (in sede non si duplicano)." : "Schede da esportare."} Togli la spunta a quelle da tenere per un'altra volta: restano «Da esportare».</p>
      <div class="qr-elenco" id="espElenco">${candidate.map((x, i) => `<label class="qr-riga" for="esp_${i}"><input type="checkbox" id="esp_${i}" data-id="${h(x.id)}" checked>
        <span class="qr-testo"><span class="qr-valore">${h(IF.titoloScheda(x, S))}</span>
        <span class="qr-etichetta">${h(IF.dataOra(x.intervistaIl))}${nAll[x.id] ? ` · ${nAll[x.id]} ${nAll[x.id] === 1 ? "allegato" : "allegati"}` : ""}${x.stato !== "in_coda" ? " · già esportata" : ""}</span></span></label>`).join("")}</div>
      <button class="btn btn-piccolo btn-secondario" type="button" id="espTutte">Togli tutte le spunte</button>
      <div class="dialogo-azioni"><button class="btn btn-secondario" type="button" id="espNo">Annulla</button>
        <button class="btn btn-primario" type="button" id="espSi">Prepara il file (${candidate.length})</button></div>`);
    const caselle = () => [...d.querySelectorAll("#espElenco input")];
    const aggiornaConta = () => {
      const n = caselle().filter((x) => x.checked).length;
      d.querySelector("#espSi").textContent = `Prepara il file (${n})`; d.querySelector("#espSi").disabled = !n;
      d.querySelector("#espTutte").textContent = n ? "Togli tutte le spunte" : "Spunta tutte";
    };
    d.querySelector("#espElenco").onchange = aggiornaConta;
    d.querySelector("#espTutte").onclick = () => { const metti = !caselle().some((x) => x.checked); caselle().forEach((x) => { x.checked = metti; }); aggiornaConta(); };
    const scelte = await new Promise((ok) => {
      d.querySelector("#espNo").onclick = () => ok(null);
      d.querySelector(".dialogo-velo").onclick = () => ok(null);
      d.querySelector("#espSi").onclick = () => ok(caselle().filter((x) => x.checked).map((x) => x.dataset.id));
    });
    if (!scelte || !scelte.length) { chiudi(); return; }
    // 2. preparazione del file
    d.querySelector(".dialogo-foglio").innerHTML = `<h2>Esportazione</h2><p id="espTesto">Preparo il file…</p>
      <div class="traccia" style="height:8px"><span class="r-accento" id="espBarra" style="width:2%"></span></div>
      <div class="dialogo-azioni" id="espAzioni"><button class="btn btn-secondario" type="button" id="espAnnulla">Annulla</button></div>`;
    let annullato = false;
    d.querySelector("#espAnnulla").onclick = () => { annullato = true; chiudi(); };
    let pronto;
    try {
      pronto = await IF.Esporta.prepara({ tutte, ids: scelte }, (p) => { const b = d.querySelector("#espBarra"); if (b) b.style.width = `${Math.max(2, Math.round(p * 100))}%`; });
    } catch (e) { if (!annullato) { chiudi(); avviso(`File non preparato: ${e.message}`, "errore"); } return; }
    if (annullato) return;
    const { file, schede, nAllegati } = pronto;
    const mb = file.size / 1048576;
    const condivisibile = !!(navigator.canShare && navigator.share && (() => { try { return navigator.canShare({ files: [file] }); } catch (e) { return false; } })());
    d.querySelector("#espBarra").style.width = "100%";
    d.querySelector("#espTesto").innerHTML = `File pronto: <strong>${schede.length} ${schede.length === 1 ? "scheda" : "schede"}</strong>${nAllegati ? `, ${nAllegati} ${nAllegati === 1 ? "allegato" : "allegati"}` : ""} (${mb < 0.1 ? "meno di 0,1" : mb.toFixed(1).replace(".", ",")} MB).<br><span class="nota">${h(file.name)}</span>`;
    d.querySelector("#espAzioni").innerHTML = `<button class="btn btn-secondario" type="button" id="espScarica">Salva sul telefono</button>
      ${condivisibile ? `<button class="btn btn-primario" type="button" id="espCondividi">Invia o salva…</button>` : ""}`;
    const fatto = async (come) => {
      await IF.Esporta.segnaEsportate(schede);
      chiudi();
      avviso(`${schede.length} ${schede.length === 1 ? "scheda esportata" : "schede esportate"}${come ? ` (${come})` : ""}: passa il file in sede`, "ok");
      if (vistaCorrente() === "impostazioni") vistaImpostazioni(); else disegnaElenco();
      aggiornaStrisciaInvio();
    };
    const scarica = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return fatto("file salvato sul telefono");
    };
    d.querySelector("#espScarica").onclick = scarica;
    const bc = d.querySelector("#espCondividi");
    if (bc) bc.onclick = async () => {
      try { await navigator.share({ files: [file], title: "Interviste Fiera", text: file.name }); await fatto(""); }
      catch (e) {
        if (e && e.name === "AbortError") { avviso("Esportazione annullata: le schede restano da esportare", "info"); return; }
        avviso("Condivisione non riuscita: uso «Salva sul telefono»", "info"); await scarica();
      }
    };
  }

  // La sera (dalle 18), aprendo l'app con schede da esportare, un promemoria una volta al giorno
  async function promemoriaSerale() {
    const ora = new Date();
    if (ora.getHours() < 18) return;
    const oggi = ora.toISOString().slice(0, 10);
    if ((await DB.leggi("promemoria-esporta", "")) === oggi) return;
    const c = await conteggi();
    if (!c.in_coda) return;
    await DB.scrivi("promemoria-esporta", oggi);
    setTimeout(() => avviso(`${c.in_coda} ${c.in_coda === 1 ? "scheda da esportare" : "schede da esportare"}: premi «Esporta» e passa il file in sede`, "info"), 1200);
  }

  // ---------- Avvisi e conferme (in pagina, senza finestre del browser) ----------
  let timerAvviso = null;
  function avviso(testo, tipo) {
    const t = document.getElementById("toast");
    const k = tipo || (/non |errore|impossibile|mancan|compila i campi/i.test(testo) ? "errore" : "ok");
    t.className = `toast vetro forte ${k}`;
    t.innerHTML = `${icona(k === "errore" ? "attenzione" : k === "info" ? "info" : "spunta")}<span>${h(testo)}</span>`;
    t.hidden = false;
    clearTimeout(timerAvviso);
    timerAvviso = setTimeout(() => { t.hidden = true; }, k === "errore" ? 3600 : 2200);
  }

  function conferma(titolo, testo, etichettaOk) {
    return new Promise((ok) => {
      const d = document.getElementById("dialogo");
      d.innerHTML = `<div class="dialogo-velo"></div>
        <div class="dialogo-foglio vetro forte" role="dialog" aria-modal="true" aria-labelledby="dlgTitolo">
          <h2 id="dlgTitolo">${h(titolo)}</h2><p>${h(testo)}</p>
          <div class="dialogo-azioni"><button class="btn btn-secondario" type="button" id="dlgNo">Annulla</button>
          <button class="btn btn-pericolo" type="button" id="dlgSi">${h(etichettaOk)}</button></div></div>`;
      d.hidden = false;
      const chiudi = (r) => { d.hidden = true; d.innerHTML = ""; ok(r); };
      document.getElementById("dlgNo").onclick = () => chiudi(false);
      document.getElementById("dlgSi").onclick = () => chiudi(true);
      d.querySelector(".dialogo-velo").onclick = () => chiudi(false);
      document.getElementById("dlgNo").focus();
    });
  }

  // ---------- Icone (tratto semplice) ----------
  function icona(n) {
    const p = {
      piu: '<path d="M12 5v14M5 12h14"/>',
      indietro: '<path d="M15 5l-7 7 7 7"/>',
      ingranaggio: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
      camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
      immagine: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M20 16l-5-5-8 8"/>',
      microfono: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
      x: '<path d="M6 6l12 12M18 6L6 18"/>',
      giu: '<path d="M6 9l6 6 6-6"/>',
      luogo: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
      lista: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
      grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      matita: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
      orologio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
      spunta: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      doppiaspunta: '<path d="M2 12.5l4.5 4.5L16 7.5"/><path d="M11 16.5l.5.5L21 7.5"/>',
      attenzione: '<path d="M12 9v4.5M12 17v.01"/><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
      scintilla: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
      qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2M20 14v.01M14 20h.01M17 17h3v3h-3z"/>'
    }[n] || "";
    return `<svg class="icona" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  }

  avvio();
})();
