// File Excel (.xlsx) costruito nel browser, senza librerie: fogli con testi, numeri e date, intestazione
// colorata, larghezza delle colonne, riga bloccata e filtro. Lo usa il gestionale per l'export delle schede.
(function () {
  "use strict";
  const enc = new TextEncoder();
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

  // ---------------- archivio zip (senza compressione: per qualche centinaio di schede basta e avanza)
  const TAB_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = TAB_CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const parti = [], centrale = []; let offset = 0;
    for (const [nome, testo] of files) {
      const n = enc.encode(nome), d = enc.encode(testo), crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
      parti.push(new Uint8Array(h.buffer), n, d);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, n.length, true);
      c.setUint32(42, offset, true);
      centrale.push(new Uint8Array(c.buffer), n);
      offset += 30 + n.length + d.length;
    }
    const dimC = centrale.reduce((a, x) => a + x.length, 0);
    const fine = new DataView(new ArrayBuffer(22));
    fine.setUint32(0, 0x06054b50, true); fine.setUint16(8, files.length, true); fine.setUint16(10, files.length, true);
    fine.setUint32(12, dimC, true); fine.setUint32(16, offset, true);
    return new Blob([...parti, ...centrale, new Uint8Array(fine.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  const colonna = (i) => { let s = ""; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
  // data JavaScript -> numero di serie di Excel (giorni dal 30/12/1899, ora locale)
  const serie = (d) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - Date.UTC(1899, 11, 30)) / 86400000;

  // stili: 0 normale, 1 intestazione, 2 testo a capo, 3 data e ora, 4 data
  const STILI = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="DD/MM/YYYY HH:MM"/><numFmt numFmtId="165" formatCode="DD/MM/YYYY"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF004F9F"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs></styleSheet>`;

  // foglio: { nome, larghezze[], righe: [[valore|{data, soloData}]], intestazione: bool, blocca: bool, filtro: bool }
  function foglioXml(f) {
    const righe = f.righe.map((riga, r) => `<row r="${r + 1}"${r === 0 && f.intestazione ? ' ht="30" customHeight="1"' : ""}>` + riga.map((v, c) => {
      const ref = colonna(c) + (r + 1);
      const stile = r === 0 && f.intestazione ? 1 : 2;
      if (v == null || v === "") return `<c r="${ref}" s="${stile}"/>`;
      if (v instanceof Date && !isNaN(v)) return `<c r="${ref}" s="3"><v>${serie(v)}</v></c>`;
      if (v && v.soloData instanceof Date) return `<c r="${ref}" s="4"><v>${Math.round(serie(v.soloData))}</v></c>`;
      if (typeof v === "number" && isFinite(v)) return `<c r="${ref}" s="${stile}"><v>${v}</v></c>`;
      // testo: mai formule (=, +, -, @ all'inizio diventano testo semplice)
      let t = String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return `<c r="${ref}" s="${stile}" t="inlineStr"><is><t xml:space="preserve">${xml(t)}</t></is></c>`;
    }).join("") + "</row>").join("");
    const colonne = f.larghezze && f.larghezze.length ? `<cols>${f.larghezze.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const blocca = f.blocca ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>` : "";
    const filtro = f.filtro && f.righe.length > 1 ? `<autoFilter ref="A1:${colonna(f.righe[0].length - 1)}${f.righe.length}"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${blocca}${colonne}<sheetData>${righe}</sheetData>${filtro}</worksheet>`;
  }

  function crea(fogli) {
    const files = [
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${fogli.map((f, i) => `<sheet name="${xml(f.nome).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${fogli.some((f) => f.filtro && f.righe.length > 1) ? `<definedNames>${fogli.map((f, i) => f.filtro && f.righe.length > 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(f.nome)}'!$A$1:$${colonna(f.righe[0].length - 1)}$${f.righe.length}</definedName>` : "").join("")}</definedNames>` : ""}</workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", STILI],
      ...fogli.map((f, i) => [`xl/worksheets/sheet${i + 1}.xml`, foglioXml(f)]),
    ];
    return zip(files);
  }

  window.XlsxSemplice = { crea };
})();
