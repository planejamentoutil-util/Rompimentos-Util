// Service worker: guarda o app no aparelho (abre sem internet) e envia a fila quando o sinal volta.
importScripts('config.js', 'fila.js');

var CACHE = 'rompimentos-v2';
var ARQUIVOS = ['./', 'index.html', 'config.js', 'fila.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Arquivos do app: responde do aparelho na hora e atualiza em segundo plano quando houver internet.
// Chamadas à planilha (outro domínio) não passam por aqui.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (guardado) {
      var rede = fetch(req).then(function (r) {
        if (r && r.ok) cache.put(req, r.clone());
        return r;
      }).catch(function () {
        return guardado || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
      });
      if (guardado) { e.waitUntil(rede.catch(function () {})); return guardado; }
      return rede;
    });
  }));
});

// Envio em segundo plano quando a conexão volta (Chrome no Android).
self.addEventListener('sync', function (e) {
  if (e.tag !== 'enviar-fila') return;
  e.waitUntil(self.Fila.enviarFila().then(function (res) {
    return self.clients.matchAll().then(function (cs) {
      cs.forEach(function (c) { c.postMessage({ tipo: 'fila' }); });
      if (res.falha) throw new Error(res.falha); // o navegador tenta de novo mais tarde
    });
  }));
});
