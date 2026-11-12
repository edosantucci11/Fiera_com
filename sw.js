// Service worker: tiene in memoria i file dell'app per aprirla anche senza rete.
// Le chiamate al server (/api/) passano sempre dalla rete e non vengono mai salvate.
// Ad ogni rilascio aumentare VERSIONE: i telefoni scaricano la nuova versione alla prossima apertura.
const VERSIONE = "interviste-fiera-v1.7.7";
const FILE_APP = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/ocr/worker.min.js"
];
const FONT = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE_APP)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((chiavi) => Promise.all(chiavi.filter((k) => k !== VERSIONE && k !== "font" && k !== "ocr").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Caratteri tipografici: dalla memoria se presenti, altrimenti dalla rete (e li si conserva)
  if (FONT.test(req.url)) {
    e.respondWith(caches.open("font").then(async (c) => {
      const salvato = await c.match(req);
      if (salvato) return salvato;
      const r = await fetch(req);
      if (r.ok || r.type === "opaque") c.put(req, r.clone());
      return r;
    }));
    return;
  }

  // Solo i file dell'app stessa; tutto il resto va diretto in rete
  if (url.origin !== self.location.origin) return;
  // Funzioni del server: sempre dalla rete, mai dalla memoria
  if (url.pathname.includes("/api/")) return;

  // Motore di lettura dei biglietti e lingue (qualche MB): si conservano alla prima lettura, poi vanno anche senza rete
  if (url.pathname.includes("/vendor/ocr/core/") || url.pathname.includes("/vendor/ocr/lang/")) {
    e.respondWith(caches.open("ocr").then(async (c) => {
      const salvato = await c.match(req, { ignoreSearch: true });
      if (salvato) return salvato;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    }));
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((salvato) => {
      if (salvato) return salvato;
      return fetch(req).catch(() => (req.mode === "navigate" ? caches.match("index.html") : Response.error()));
    })
  );
});
