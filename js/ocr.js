// Lettura del testo di un biglietto da visita dalla foto, sul telefono e senza rete (Tesseract.js in WebAssembly).
// Il riconoscimento da' le righe di testo; poi si propone a quale campo va ogni riga, e l'operatrice conferma
// o corregge prima che entri nella scheda. Nulla viene dedotto: solo righe stampate sul biglietto.
(function () {
  "use strict";
  const BASE = "vendor/ocr";
  let lavoratore = null;      // un solo motore, riusato per tutte le letture
  let inPreparazione = null;

  const disponibile = () => !!(window.Tesseract && window.WebAssembly && window.Worker);

  async function prepara(avanzamento) {
    if (window.SIM_OCR) return null; // simulazione: nessun motore da scaricare
    if (lavoratore) return lavoratore;
    if (inPreparazione) return inPreparazione;
    if (!disponibile()) throw new Error("La lettura dei biglietti non è disponibile su questo telefono");
    const assoluto = (p) => new URL(p, location.href).href;
    inPreparazione = window.Tesseract.createWorker(["ita", "eng"], 1, {
      workerPath: assoluto(`${BASE}/worker.min.js`),
      corePath: assoluto(`${BASE}/core`),
      langPath: assoluto(`${BASE}/lang`),
      workerBlobURL: false, // il motore resta un file dell'app (regole di sicurezza della pagina)
      gzip: true,
      cacheMethod: "write",
      logger: (m) => { if (avanzamento && m && typeof m.progress === "number") avanzamento(m.status || "", m.progress); }
    }).then((w) => { lavoratore = w; inPreparazione = null; return w; })
      .catch((e) => { inPreparazione = null; throw new Error("Preparazione della lettura non riuscita: " + (e && e.message ? e.message : e)); });
    return inPreparazione;
  }

  // Foto ridotta e in scala di grigi: lettura piu' rapida e spesso piu' precisa
  async function preparaImmagine(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const lato = 2000, k = Math.min(1, lato / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d");
    g.filter = "grayscale(1) contrast(1.15)";
    g.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }

  async function leggi(file, avanzamento) {
    if (window.SIM_OCR) {
      for (const p of [0.2, 0.5, 0.8, 1]) { await new Promise((r) => setTimeout(r, 250)); if (avanzamento) avanzamento("recognizing text", p); }
      return window.SIM_OCR.map((t, i) => ({ testo: t, altezza: i === 0 ? 40 : 22, fiducia: 90 }));
    }
    const w = await prepara(avanzamento);
    const immagine = await preparaImmagine(file);
    const r = await w.recognize(immagine, {}, { text: true, blocks: true });
    const righe = [];
    for (const b of (r.data.blocks || [])) for (const p of (b.paragraphs || [])) for (const l of (p.lines || [])) {
      const testo = String(l.text || "").replace(/\s+/g, " ").trim();
      if (testo.length >= 2 && (l.confidence || 0) >= 35) righe.push({ testo, altezza: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0, fiducia: Math.round(l.confidence || 0) });
    }
    if (!righe.length && r.data.text) String(r.data.text).split(/\n+/).map((x) => x.trim()).filter((x) => x.length >= 2).forEach((testo) => righe.push({ testo, altezza: 0, fiducia: 0 }));
    return righe;
  }

  // ---------------------------------------------------------------- a quale campo va ogni riga
  const PAESI = ["Italia", "Italy", "Germany", "Deutschland", "Germania", "France", "Francia", "Spain", "España", "Espana", "Spagna",
    "Portugal", "Portogallo", "United Kingdom", "Regno Unito", "UK", "England", "Netherlands", "Nederland", "Paesi Bassi", "Belgium", "Belgio",
    "Switzerland", "Schweiz", "Suisse", "Svizzera", "Austria", "Österreich", "Sweden", "Sverige", "Svezia", "Norway", "Norvegia", "Denmark",
    "Danimarca", "Finland", "Finlandia", "Poland", "Polska", "Polonia", "Greece", "Grecia", "Turkey", "Türkiye", "Turchia", "Romania",
    "Hungary", "Ungheria", "Czech Republic", "Czechia", "Croatia", "Croazia", "Slovenia", "Serbia", "Albania", "Israel", "Egypt", "Egitto",
    "Morocco", "Marocco", "Tunisia", "Algeria", "Saudi Arabia", "Arabia Saudita", "UAE", "United Arab Emirates", "Emirati Arabi Uniti", "Qatar",
    "Kuwait", "Iran", "Iraq", "India", "Pakistan", "China", "Cina", "Japan", "Giappone", "Korea", "Corea", "USA", "United States", "Stati Uniti",
    "Canada", "Mexico", "Messico", "Brazil", "Brasil", "Brasile", "Argentina", "Chile", "Cile", "Colombia", "Peru", "Perù", "Australia", "South Africa", "Sudafrica"];
  const RE_PAESE = new RegExp(`(^|[\\s,.\\-–(])(${PAESI.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})($|[\\s,.)])`, "i");
  const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const RE_SITO = /(^|\s)(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|it|de|fr|es|eu|net|org|co\.uk|ch|nl|be|at)\b(?!@)/i;
  const RE_AZIENDA = /\b(s\.?\s?p\.?\s?a\.?|s\.?\s?r\.?\s?l\.?|s\.?\s?n\.?\s?c\.?|s\.?a\.?s\.?|gmbh|ag|kg|ltd\.?|limited|inc\.?|llc|plc|b\.?v\.?|n\.?v\.?|s\.?\s?a\.?|s\.?\s?l\.?|s\.?\s?a\.?\s?u\.?|oy|a\/s|ab|sas|sarl|corp\.?|group|gruppo|holding|hospital|ospedale|clinica|clinic|klinik|policlinico|medical|medica|healthcare|pharma|farmaceutic\w*|laborator\w*|surgical)\b/i;
  const RE_RUOLO = /\b(manager|director|direttore|direttrice|responsabile|buyer|purchas\w*|procurement|acquisti|sales|vendite|commerciale|export|import|marketing|ceo|cfo|coo|cto|owner|titolare|founder|fondatore|head|chief|president\w*|presidente|amministrator\w*|engineer|ingegnere|specialist|consultant|consulente|officer|coordinator|coordinatore|supervisor|assistant|assistente|product|area|key account|business development|dott\.?|dr\.?|prof\.?|md|phd|chirurg\w*|surgeon|nurse|infermier\w*)\b/i;

  // Una riga letta puo' contenere piu' cose (es. indirizzo e telefono su colonne affiancate, paese ed email):
  // email, telefoni e siti diventano righe a se', il resto resta una riga da classificare.
  const RE_TEL = /(?:\b(?:tel|phone|ph|mob|mobile|cell|cellulare|fax|t|m)\b\.?\s*[:.]?\s*)?\+?\(?\d[\d\s().\/-]{6,}\d/gi;
  function segmenta(r) {
    const pezzi = [];
    let resto = r.testo;
    resto = resto.replace(new RegExp(RE_EMAIL.source, "g"), (m) => { pezzi.push({ ...r, testo: m, campo: "email" }); return " "; });
    resto = resto.replace(/(https?:\/\/|www\.)\S+/gi, (m) => { pezzi.push({ ...r, testo: m, campo: "" }); return " "; });
    resto = resto.replace(RE_TEL, (m) => {
      if ((m.match(/\d/g) || []).length < 7) return m; // CAP, numeri civici
      const fax = /\bfax\b/i.test(m);
      pezzi.push({ ...r, testo: m.replace(/^(tel|phone|ph|mob|mobile|cell|cellulare|fax|t|m)\b\.?\s*[:.]?\s*/i, "").trim(), campo: fax ? "" : "telefono" });
      return " ";
    });
    resto = resto.replace(/\s+/g, " ").replace(/^[\s,;:|·•-]+|[\s,;:|·•-]+$/g, "").trim();
    if ((resto.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length >= 3) pezzi.unshift({ ...r, testo: resto, campo: undefined });
    return pezzi;
  }

  function analizza(righe) {
    const assegnate = righe.flatMap(segmenta);
    for (const r of assegnate) {
      if (r.campo !== undefined) continue; // email, telefono o sito gia' riconosciuti
      r.campo = "";
      const t = r.testo;
      const email = t.match(RE_EMAIL);
      const cifre = (t.match(/\d/g) || []).length;
      if (email) { r.campo = "email"; r.valore = email[0]; continue; }
      if (/\bfax\b/i.test(t)) continue;
      if (cifre >= 7 && /^[\s+()\d./-]*$/.test(t.replace(/^(tel\.?|phone|ph\.?|mob\.?|mobile|cell\.?|cellulare|t\.|m\.|tel\/fax)\s*[:.]?\s*/i, ""))) {
        r.campo = "telefono"; r.valore = t.replace(/^(tel\.?|phone|ph\.?|mob\.?|mobile|cell\.?|cellulare|t\.|m\.)\s*[:.]?\s*/i, "").trim(); continue;
      }
      if (RE_SITO.test(t)) continue;
      const paese = t.match(RE_PAESE);
      if (paese && cifre <= 6) { r.campo = "paese"; r.valore = paese[2]; continue; }
      if (cifre >= 3) continue; // indirizzi, partite IVA, codici
      if (RE_AZIENDA.test(t)) { r.campo = "azienda"; continue; }
      if (RE_RUOLO.test(t)) { r.campo = "ruolo"; continue; }
    }
    // nome: la riga senza cifre di 2-4 parole con il carattere piu' grande tra quelle non assegnate
    const candidati = assegnate.filter((r) => !r.campo && /^[A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+$/.test(r.testo)
      && r.testo.split(/\s+/).length >= 2 && r.testo.split(/\s+/).length <= 4
      && r.testo.split(/\s+/).every((p) => /^[A-ZÀ-ÖØ-Þ]/.test(p) || /^(de|di|da|del|della|van|von|der|le|la|el|al|dos|das)$/i.test(p)));
    if (candidati.length) candidati.sort((a, b) => b.altezza - a.altezza)[0].campo = "nome";
    for (const campo of ["azienda", "ruolo", "paese"]) {
      // per questi campi si propone una sola riga (la prima trovata); le altre restano da scegliere a mano
      let visto = false;
      for (const r of assegnate) if (r.campo === campo) { if (visto) r.campo = ""; visto = true; }
    }
    return assegnate;
  }

  window.IF = window.IF || {};
  window.IF.OCR = { disponibile, prepara, leggi, analizza };
})();
