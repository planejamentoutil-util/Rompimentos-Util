// Fila de envio guardada no aparelho (IndexedDB). Usada pela página e pelo service worker.
(function (g) {
  var DB = 'rompimentos', VER = 1;

  function abrir() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, VER);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('fila')) d.createObjectStore('fila', { keyPath: 'idEnvio' });
        if (!d.objectStoreNames.contains('enviados')) d.createObjectStore('enviados', { keyPath: 'idEnvio' });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }

  function op(store, modo, fn) {
    return abrir().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(store, modo), out;
        var q = fn(tx.objectStore(store));
        if (q) q.onsuccess = function () { out = q.result; };
        tx.oncomplete = function () { d.close(); res(out); };
        tx.onerror = tx.onabort = function () { d.close(); rej(tx.error); };
      });
    });
  }

  function todos() {
    return op('fila', 'readonly', function (st) { return st.getAll(); })
      .then(function (l) { return (l || []).sort(function (a, b) { return a.criadoEm - b.criadoEm; }); });
  }
  function gravar(item) { return op('fila', 'readwrite', function (st) { return st.put(item); }); }
  function remover(id) { return op('fila', 'readwrite', function (st) { return st.delete(id); }); }

  function historico() {
    return op('enviados', 'readonly', function (st) { return st.getAll(); })
      .then(function (l) { return (l || []).sort(function (a, b) { return b.enviadoEm - a.enviadoEm; }); });
  }
  function anotar(reg) {
    return op('enviados', 'readwrite', function (st) { return st.put(reg); })
      .then(historico)
      .then(function (l) {
        return Promise.all(l.slice(30).map(function (x) {
          return op('enviados', 'readwrite', function (st) { return st.delete(x.idEnvio); });
        }));
      });
  }

  // Cada registro vai para a planilha do seu tipo: rompimento (padrão), manutenção de POP ou levantamento de POP (mesma planilha da manutenção).
  function destino(item) {
    var c = g.APP_CONFIG || {};
    if (item.destino === 'manut' || item.destino === 'lev') return { url: c.MANUT_URL, chave: c.MANUT_CHAVE };
    return { url: c.API_URL, chave: c.CHAVE };
  }

  function temDestino(item) {
    return /^https:\/\/script\.google\.com\/.+\/exec$/.test(String(destino(item).url || ''));
  }

  function enviarItem(item) {
    var d = destino(item);
    return fetch(d.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ acao: item.acao || 'registrar', chave: d.chave || '', dados: item.dados }),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  var ocupado = false;
  /** Envia a fila em ordem. Para no primeiro erro de rede; recusas do servidor ficam marcadas. */
  function enviarFila() {
    var res = { enviados: [], recusados: [], falha: null };
    if (ocupado) return Promise.resolve(res);
    ocupado = true;
    return todos().then(function (itens) {
      // sem planilha configurada para o tipo, o item espera no aparelho sem travar os outros
      return itens.filter(function (i) { return i.status !== 'recusado' && temDestino(i); }).reduce(function (p, item) {
        return p.then(function () {
          return enviarItem(item).then(function (r) {
            if (r && r.ok) {
              var reg = {
                idEnvio: item.idEnvio, id: r.id, resumo: item.resumo, enviadoEm: Date.now(), destino: item.destino || 'romp',
                alertas: r.alertas || [], repetido: !!r.repetido
              };
              res.enviados.push(reg);
              return remover(item.idEnvio).then(function () { return anotar(reg); });
            }
            if (r && r.temporario) throw new Error((r.erros || ['Servidor ocupado'])[0]);
            item.status = 'recusado';
            item.erros = (r && r.erros) || ['Recusado pelo servidor.'];
            res.recusados.push(item);
            return gravar(item);
          });
        });
      }, Promise.resolve());
    }).catch(function (e) {
      res.falha = (e && e.message) || String(e);
    }).then(function () {
      ocupado = false;
      return res;
    });
  }

  g.Fila = { todos: todos, gravar: gravar, remover: remover, historico: historico, enviarFila: enviarFila };
})(self);
