// Configurazione dell'app.
window.APP_CONFIG = {
  // "server": invio al servizio aziendale (lo stesso server che pubblica l'app), con utente e password.
  // "demo": i dati restano sul dispositivo e l'invio e' simulato (per mostrare l'app senza server).
  // "file": nessun invio in rete; la sera si esporta un file da importare nel gestionale sul condiviso (vedi docs/GUIDA-FILE.md).
  modalita: "file",

  nomeApp: "Interviste Fiera",
  versioneApp: "1.7.3",

  // Indirizzo delle funzioni del server, relativo alla pagina dell'app (/app/ -> /api/).
  server: {
    api: "../api"
  },

  sync: {
    intervalloSecondi: 30,     // ogni quanto riprovare mentre l'app e' aperta
    verificaImportOgni: 3,     // ogni quanti cicli controllare se le schede sono state importate in sede
    oreAttesaSunto: 12         // per quante ore dopo l'invio aspettare il sunto breve delle note vocali
  },

  pulizia: {
    // Dopo quanti giorni dall'import in sede le schede vengono cancellate dal telefono (0 = mai in automatico)
    giorniDopoImport: 7
  },

  audio: {
    bitrate: 32000,          // bit al secondo: 32 kbps mono bastano per la voce (circa 240 KB al minuto)
    minutiSegmento: 10,      // ogni quanti minuti chiudere una parte e iniziarne un'altra
    avvisoDopoMinuti: 45     // avviso (senza interrompere) per registrazioni molto lunghe
  },

  foto: {
    latoMassimo: 1600,   // pixel del lato lungo dopo la compressione
    qualita: 0.8
  }
};
