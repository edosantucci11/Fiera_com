// Tema chiaro o scuro: "auto" segue il telefono, oppure la scelta fatta in Impostazioni.
// Si applica prima di disegnare la pagina (niente lampo di colore all'apertura).
(function () {
  "use strict";
  const CHIAVE = "if-tema";
  const COLORE_BARRA = { scuro: "#0F1115", chiaro: "#F3F4F7" };
  const scuroSistema = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const html = document.documentElement;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) html.classList.add("ios");

  function letto() { try { return localStorage.getItem(CHIAVE) || "auto"; } catch (e) { return "auto"; } }
  function attivo(scelta) { return scelta === "chiaro" || scelta === "scuro" ? scelta : (scuroSistema && !scuroSistema.matches ? "chiaro" : "scuro"); }

  function applica(scelta) {
    scelta = scelta || letto();
    if (scelta === "auto") delete html.dataset.tema; else html.dataset.tema = scelta;
    const eff = attivo(scelta);
    html.dataset.temaAttivo = eff;
    // colore della barra di stato (Android) e del browser
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    const m = document.createElement("meta");
    m.name = "theme-color"; m.content = COLORE_BARRA[eff];
    document.head.appendChild(m);
  }
  function scegli(scelta) {
    try { if (scelta === "auto") localStorage.removeItem(CHIAVE); else localStorage.setItem(CHIAVE, scelta); } catch (e) {}
    applica(scelta);
  }
  if (scuroSistema) {
    const cambio = () => { if (letto() === "auto") applica("auto"); };
    if (scuroSistema.addEventListener) scuroSistema.addEventListener("change", cambio); else if (scuroSistema.addListener) scuroSistema.addListener(cambio);
  }
  applica();
  window.IF = window.IF || {};
  window.IF.Tema = { letto, attivo: () => attivo(letto()), scegli };
})();
