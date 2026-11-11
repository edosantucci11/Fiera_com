// Lettura del QR code del biglietto da visita.
// Tutto avviene sul telefono, anche senza rete: nessun dato viene inviato a servizi esterni.
// Formati riconosciuti: vCard (il piu' diffuso), MECARD, BIZCARD. Un QR con solo un link viene segnalato.
(function () {
  // ------------------------------------------------------------ analisi del contenuto
  function unescapeV(s) {
    return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
  }

  function decodificaQP(s, charset) {
    const byte = [];
    const t = s.replace(/=\r?\n/g, "");
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(t.substr(i + 1, 2))) { byte.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; }
      else byte.push(t.charCodeAt(i) & 0xff);
    }
    try { return new TextDecoder(charset || "utf-8").decode(new Uint8Array(byte)); } catch (e) { return t; }
  }

  // Divide su ';' non preceduti da '\'
  function dividi(s, sep) {
    const out = []; let cur = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\" && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; continue; }
      if (s[i] === sep) { out.push(cur); cur = ""; continue; }
      cur += s[i];
    }
    out.push(cur);
    return out;
  }

  function vcard(testo) {
    const righe = testo.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    const v = { tel: [], email: [] };
    for (const riga of righe) {
      const i = riga.indexOf(":");
      if (i < 0) continue;
      const testa = riga.slice(0, i);
      let valore = riga.slice(i + 1);
      const parti = testa.split(";");
      const chiave = parti[0].replace(/^[^.]*\./, "").toUpperCase(); // toglie "item1."
      const parametri = parti.slice(1).join(";").toUpperCase();
      if (/ENCODING=QUOTED-PRINTABLE|QUOTED-PRINTABLE/.test(parametri)) {
        const cs = (parametri.match(/CHARSET=([^;:]+)/) || [])[1];
        valore = decodificaQP(valore, cs);
      }
      const pref = /PREF|TYPE=WORK|WORK/.test(parametri) ? 0 : /CELL/.test(parametri) ? 1 : 2;
      switch (chiave) {
        case "FN": v.nome = unescapeV(valore); break;
        case "N": {
          const [cognome, nome, secondo, prefisso] = dividi(valore, ";").map(unescapeV);
          v.n = [prefisso, nome, secondo, cognome].filter(Boolean).join(" ");
          break;
        }
        case "ORG": v.azienda = dividi(valore, ";").map(unescapeV).filter(Boolean).join(" – "); break;
        case "TITLE": v.ruolo = unescapeV(valore); break;
        case "ROLE": v.ruoloAlt = unescapeV(valore); break;
        case "EMAIL": v.email.push({ val: unescapeV(valore), pref }); break;
        case "TEL": v.tel.push({ val: unescapeV(valore).replace(/^tel:/i, ""), pref }); break;
        case "ADR": {
          const c = dividi(valore, ";").map(unescapeV);
          if (c[6] && !v.paese) v.paese = c[6];
          break;
        }
      }
    }
    const ordina = (a) => a.sort((x, y) => x.pref - y.pref).map((x) => x.val).filter(Boolean);
    const tel = [...new Set(ordina(v.tel))];
    return pulisci({
      nome: v.nome || v.n, azienda: v.azienda, ruolo: v.ruolo || v.ruoloAlt, paese: v.paese,
      email: ordina(v.email)[0], telefono: tel.join(" / ")
    });
  }

  function mecard(testo) {
    const corpo = testo.replace(/^MECARD:/i, "").replace(/;;\s*$/, "");
    const r = {}; const tel = [];
    for (const campo of dividi(corpo, ";")) {
      const i = campo.indexOf(":"); if (i < 0) continue;
      const k = campo.slice(0, i).toUpperCase(); const val = unescapeV(campo.slice(i + 1));
      if (k === "N") {
        const [cognome, nome] = dividi(val, ",").map((x) => x.trim());
        r.nome = [nome, cognome].filter(Boolean).join(" ");
      } else if (k === "ORG") r.azienda = val;
      else if (k === "TITLE") r.ruolo = val;
      else if (k === "EMAIL" && !r.email) r.email = val;
      else if (k === "TEL") tel.push(val);
    }
    r.telefono = tel.join(" / ");
    return pulisci(r);
  }

  function bizcard(testo) {
    const corpo = testo.replace(/^BIZCARD:/i, "");
    const m = {};
    for (const campo of dividi(corpo, ";")) {
      const i = campo.indexOf(":"); if (i < 0) continue;
      m[campo.slice(0, i).toUpperCase()] = unescapeV(campo.slice(i + 1));
    }
    return pulisci({ nome: [m.N, m.X].filter(Boolean).join(" "), azienda: m.C, ruolo: m.T, email: m.E, telefono: [m.B, m.M].filter(Boolean).join(" / ") });
  }

  function pulisci(o) {
    const r = {};
    for (const [k, v] of Object.entries(o)) if (v && String(v).trim()) r[k] = String(v).trim();
    return r;
  }

  // Ritorna { tipo: "vcard"|"mecard"|"bizcard"|"link"|"testo", campi, testo }
  function analizza(testo) {
    const t = (testo || "").trim();
    if (/BEGIN:VCARD/i.test(t)) return { tipo: "vcard", campi: vcard(t), testo: t };
    if (/^MECARD:/i.test(t)) return { tipo: "mecard", campi: mecard(t), testo: t };
    if (/^BIZCARD:/i.test(t)) return { tipo: "bizcard", campi: bizcard(t), testo: t };
    if (/^https?:\/\//i.test(t)) return { tipo: "link", campi: {}, testo: t };
    return { tipo: "testo", campi: {}, testo: t };
  }

  // ------------------------------------------------------------ decodifica dell'immagine
  function testoDaRisultato(r) {
    if (r.binaryData && r.binaryData.length) {
      try { return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(r.binaryData)); } catch (e) {}
    }
    return r.data;
  }

  function cercaInCanvas(ctx, w, h, tentativi) {
    const img = ctx.getImageData(0, 0, w, h);
    const r = jsQR(img.data, w, h, { inversionAttempts: tentativi || "dontInvert" });
    return r ? testoDaRisultato(r) : null;
  }

  async function leggiDaFile(file) {
    let sorgente, w, h;
    if (window.createImageBitmap) {
      sorgente = await createImageBitmap(file, { imageOrientation: "from-image" });
      w = sorgente.width; h = sorgente.height;
    } else {
      sorgente = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); });
      w = sorgente.naturalWidth; h = sorgente.naturalHeight;
    }
    for (const lato of [1600, 1000, 640]) {
      const s = Math.min(1, lato / Math.max(w, h));
      const c = document.createElement("canvas");
      c.width = Math.round(w * s); c.height = Math.round(h * s);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(sorgente, 0, 0, c.width, c.height);
      const t = cercaInCanvas(ctx, c.width, c.height, "attemptBoth");
      if (t) return t;
    }
    return null;
  }

  // ------------------------------------------------------------ schermata di scansione
  // Apre la fotocamera; se non e' disponibile resta il pulsante per fotografare il QR.
  function apri(cosa) {
    const oggetto = cosa || "il QR code del biglietto da visita";
    return new Promise((risolvi) => {
      const box = document.createElement("div");
      box.className = "scanner";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", "Lettura di " + oggetto);
      box.innerHTML = `
        <div class="scanner-video"><video playsinline muted></video><div class="scanner-mirino" aria-hidden="true"></div></div>
        <p class="scanner-testo" id="scannerTesto">Inquadra ${oggetto}</p>
        <div class="scanner-azioni">
          <label class="btn btn-secondario" for="scannerFoto">Fotografa il QR</label>
          <input type="file" id="scannerFoto" accept="image/*" capture="environment" hidden>
          <button class="btn btn-secondario" type="button" id="scannerAnnulla">Annulla</button>
        </div>`;
      document.body.appendChild(box);
      const video = box.querySelector("video");
      const testo = box.querySelector("#scannerTesto");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let flusso = null, attivo = true, ultimo = 0;

      function chiudi(risultato) {
        if (!attivo) return;
        attivo = false;
        if (flusso) flusso.getTracks().forEach((t) => t.stop());
        box.remove();
        risolvi(risultato);
      }

      function ciclo(t) {
        if (!attivo) return;
        if (video.readyState >= 2 && t - ultimo > 150) {
          ultimo = t;
          const s = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * s); canvas.height = Math.round(video.videoHeight * s);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const r = cercaInCanvas(ctx, canvas.width, canvas.height);
          if (r) { if (navigator.vibrate) navigator.vibrate(60); chiudi(r); return; }
        }
        requestAnimationFrame(ciclo);
      }

      box.querySelector("#scannerAnnulla").onclick = () => chiudi(null);
      box.querySelector("#scannerFoto").onchange = async (e) => {
        const f = e.target.files[0]; e.target.value = "";
        if (!f) return;
        testo.textContent = "Lettura della foto…";
        const r = await leggiDaFile(f).catch(() => null);
        if (r) chiudi(r);
        else testo.textContent = "Nessun QR trovato nella foto. Riprova avvicinandoti e con più luce.";
      };

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
          .then((s) => {
            if (!attivo) { s.getTracks().forEach((t) => t.stop()); return; }
            flusso = s; video.srcObject = s; video.play().catch(() => {});
            requestAnimationFrame(ciclo);
          })
          .catch(() => {
            box.classList.add("senza-camera");
            testo.textContent = "Fotocamera non disponibile qui: usa «Fotografa il QR».";
          });
      } else {
        box.classList.add("senza-camera");
        testo.textContent = "Fotocamera non disponibile qui: usa «Fotografa il QR».";
      }
    });
  }

  window.IF = window.IF || {};
  window.IF.QR = { apri, analizza, leggiDaFile };
})();
