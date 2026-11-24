/**
 * Coleta de pontos GPS: recebe os pontos do app campo e grava na aba "Pontos GPS".
 * Arquivo NOVO: crie um arquivo "ColetaPontos.gs" no mesmo projeto Apps Script do Codigo.gs e cole tudo.
 * Não mexe em Registro, Ativos, Vencimentos nem Painel: só cria e usa a aba "Pontos GPS".
 *
 * Ligação com o Codigo.gs (uma vez): dentro do doPost, logo DEPOIS de conferir a chave e ANTES do
 * tratamento de 'registrar', acrescente:
 *
 *   if (corpo.acao === 'registrar_pontos') {
 *     return ContentService.createTextOutput(JSON.stringify(coletaRegistrar_(corpo.dados)))
 *       .setMimeType(ContentService.MimeType.JSON);
 *   }
 *
 * ("corpo" é a variável onde o seu doPost guarda o JSON recebido; use o nome que ele já usa.)
 * Depois: Implantar > Gerenciar implantações > lápis > Nova versão.
 */
var ABA_PONTOS = 'Pontos GPS';
var CAB_PONTOS = ['Projeto', 'Nº', 'Nome do ponto', 'Tipo', 'Latitude', 'Longitude', 'Precisão (m)', 'Observação',
  'Coletado por', 'Coletado em', 'Enviado em', 'ID do ponto (app)'];
var COL_ID_PONTO = 12;
var TIPOS_PONTO = ['CTO', 'CEO', 'Poste', 'Caixa de inspeção', 'Curva', 'POP', 'Rack', 'Câmera', 'Outro'];

/** Cria a aba com o mesmo visual do Registro. Pode rodar à mão (menu ou editor); o envio também chama. */
function coletaPrepararAba() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ABA_PONTOS);
  if (sh) return sh;
  sh = ss.insertSheet(ABA_PONTOS);
  sh.setTabColor('#7030A0');
  sh.getRange('A2').setValue('Pontos GPS coletados em campo (um por linha)')
    .setFontFamily('Arial').setFontSize(14).setFontWeight('bold').setFontColor('#1F3864');
  sh.getRange('A3').setValue('O app campo preenche esta aba. Reenviar um ponto atualiza a linha dele (pelo ID do app), não duplica. Para o KMZ, use a exportação do próprio app.')
    .setFontFamily('Arial').setFontSize(9).setFontColor('#595959');
  sh.getRange(4, 1, 1, CAB_PONTOS.length).setValues([CAB_PONTOS])
    .setFontFamily('Arial').setFontSize(10).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3864')
    .setVerticalAlignment('middle').setWrap(true);
  sh.getRange(4, COL_ID_PONTO).setFontColor('#8B95A8');
  sh.setFrozenRows(4);
  var larg = [140, 50, 160, 130, 95, 95, 85, 260, 130, 130, 130, 250];
  for (var i = 0; i < larg.length; i++) sh.setColumnWidth(i + 1, larg[i]);
  var corpo = sh.getRange(5, 1, 2000, CAB_PONTOS.length);
  corpo.setFontFamily('Arial').setFontSize(10).setFontColor('#0000FF');
  sh.getRange(5, 5, 2000, 2).setNumberFormat('0.000000');
  sh.getRange(5, 7, 2000, 1).setNumberFormat('0.0');
  sh.getRange(5, 10, 2000, 2).setNumberFormat('dd/MM/yyyy HH:mm');
  sh.getRange(5, 4, 2000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(TIPOS_PONTO, true).setAllowInvalid(true).build());
  sh.getRange(4, 1, 2001, CAB_PONTOS.length).createFilter();
  return sh;
}

/** Recebe {projeto, projetoId, coletor, pontos:[{id,n,nome,tipo,lat,lon,prec,obs,em}]} e grava/atualiza. */
function coletaRegistrar_(dados) {
  var erros = [];
  if (!dados || !dados.projeto) erros.push('Projeto sem nome.');
  var pontos = (dados && dados.pontos) || [];
  if (!pontos.length) erros.push('Nenhum ponto enviado.');
  pontos.forEach(function (p, i) {
    var lat = Number(p.lat), lon = Number(p.lon);
    if (!p.id) erros.push('Ponto ' + (i + 1) + ': sem ID.');
    if (!String(p.nome || '').trim()) erros.push('Ponto ' + (i + 1) + ': sem nome.');
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180) || (lat === 0 && lon === 0)) erros.push('Ponto ' + (i + 1) + ': coordenada inválida.');
  });
  if (erros.length) return { ok: false, erros: erros.slice(0, 5) };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (e) { return { ok: false, temporario: true, erros: ['Servidor ocupado, tente de novo.'] }; }
  try {
    var sh = coletaPrepararAba();
    var ultima = Math.max(sh.getLastRow(), 4);
    var ids = ultima > 4 ? sh.getRange(5, COL_ID_PONTO, ultima - 4, 1).getValues() : [];
    var linhaPorId = {};
    ids.forEach(function (r, i) { if (r[0]) linhaPorId[String(r[0])] = i + 5; });
    var agora = new Date(), novos = 0, atualizados = 0, proxima = ultima + 1;
    pontos.forEach(function (p) {
      var linha = [String(dados.projeto), Number(p.n) || '', String(p.nome).trim(), String(p.tipo || 'Outro'),
        Number(p.lat), Number(p.lon), (p.prec == null || p.prec === '') ? '' : Number(p.prec), String(p.obs || ''),
        String(dados.coletor || ''), p.em ? new Date(p.em) : agora, agora, String(p.id)];
      var destino = linhaPorId[String(p.id)];
      if (destino) { atualizados++; }
      else { destino = proxima++; linhaPorId[String(p.id)] = destino; novos++; }
      sh.getRange(destino, 1, 1, linha.length).setValues([linha]);
    });
    return { ok: true, id: dados.projeto + ' · ' + pontos.length + (pontos.length === 1 ? ' ponto' : ' pontos'), novos: novos, atualizados: atualizados };
  } finally {
    lock.releaseLock();
  }
}

/** Teste rápido no editor do Apps Script: grava um ponto de exemplo (rode 2 vezes: a 2ª atualiza, não duplica). */
function coletaTeste() {
  Logger.log(JSON.stringify(coletaRegistrar_({
    projeto: 'Teste', coletor: 'Teste',
    pontos: [{ id: 'teste-1', n: 1, nome: 'CEO-TESTE', tipo: 'CEO', lat: -15.6014, lon: -56.0979, prec: 4.2, obs: 'pode apagar', em: new Date().toISOString() }]
  })));
}
