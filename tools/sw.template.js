// Service worker: permite abrir el emulador sin conexión.
// La versión cambia en cada publicación, así que al haber internet se descarga lo nuevo.
const VERSION = "emu-__VERSION__";
const FILES = __FILES__;
let slowUntil = 0;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("emu-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Carátulas oficiales (libretro-thumbnails): se guardan para verlas también sin conexión
  if (url.hostname === "raw.githubusercontent.com" && url.pathname.startsWith("/libretro-thumbnails/")) {
    event.respondWith(
      caches.open("art-v1").then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }
  if (url.origin !== location.origin) return;

  // La página y su código: primero internet (para coger cambios), si no hay, la copia guardada
  const shell = req.mode === "navigate" ? "index.html" : ["index.html", "app.js", "app.css"].find((f) => url.pathname.endsWith("/" + f));
  if (shell) {
    // Con mala cobertura no se espera más de 2,5 s: se abre la copia guardada y la descarga sigue
    // en segundo plano para la próxima vez.
    const net = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(shell, copy)); }
      return res;
    });
    event.respondWith(
      caches.match(shell, { ignoreSearch: true }).then((cached) => {
        if (!cached) return net;
        // si la página ya tuvo que tirar de la copia, el resto del código también (sin volver a esperar)
        if (Date.now() < slowUntil) return cached;
        const timeout = new Promise((resolve) => setTimeout(() => { slowUntil = Date.now() + 15000; resolve(cached); }, 2500));
        return Promise.race([net.catch(() => { slowUntil = Date.now() + 15000; return cached; }), timeout]);
      })
    );
    event.waitUntil(net.then(() => {}, () => {}));
    return;
  }

  // El resto (motor, núcleos, traducciones): primero la copia guardada
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
