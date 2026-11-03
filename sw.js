// Mode hors connexion du livret : garde une copie de la page et du contenu chiffré.
// Le réseau reste prioritaire (mises à jour) ; la copie sert quand il n'y a pas de connexion.
// Les données en direct (météo, trafic, Vélib', événements) ne sont pas mises en cache.
const CACHE = "livret-v1";
const COQUE = ["./", "index.html", "contenu.enc", "img/four-panneau.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith(".pdf")) return; // la notice (2 Mo) reste en ligne uniquement
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
          return r;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === "navigate" ? caches.match("./") : Response.error()))
        )
    );
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.match(req).then((r) => r || fetch(req).then((rr) => { const copie = rr.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); return rr; }))
    );
  }
});
