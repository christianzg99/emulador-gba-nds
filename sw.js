// Service worker: permite abrir el emulador sin conexión.
// La versión cambia en cada publicación, así que al haber internet se descarga lo nuevo.
const VERSION = "emu-76962f38ab";
const FILES = [
  "./",
  "index.html",
  "app.css",
  "app.js",
  "data/loader.js",
  "data/emulator.min.js",
  "data/emulator.min.css",
  "data/localization/es-ES.json",
  "data/localization/en-US.json",
  "data/localization/retroarch.json",
  "data/compression/extract7z.js",
  "data/compression/extractzip.js",
  "data/compression/libunrar.js",
  "data/compression/libunrar.wasm",
  "data/cores/desmume2015-legacy-wasm.data",
  "data/cores/desmume2015-wasm.data",
  "data/cores/melonds-legacy-wasm.data",
  "data/cores/melonds-wasm.data",
  "data/cores/mgba-legacy-wasm.data",
  "data/cores/mgba-wasm.data",
  "data/cores/reports/desmume2015.json",
  "data/cores/reports/melonds.json",
  "data/cores/reports/mgba.json"
];
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
