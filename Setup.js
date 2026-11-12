/**
 * Instalação: rode `setup` uma vez pelo editor do Apps Script (Executar → setup).
 * Cria as abas auxiliares ocultas, sem alterar nenhuma aba existente:
 *   CONFIG_APP  listas e parâmetros editáveis
 *   INDICE_XML  índice dos XMLs da pasta do Drive (refeito automaticamente)
 *   LOG_APP     quem gravou o quê, e erros
 * Rodar de novo só completa o que faltar na CONFIG_APP; nada que já foi digitado é apagado.
 */
function setup() {
  var ss = planilha_();
  colunasDados_(); // falha cedo se os cabeçalhos da DATABASE não forem encontrados

  var completado = garantirConfigApp_();
  if (!ss.getSheetByName(CONFIG.ABA_LOG)) criarAbaOculta_(CONFIG.ABA_LOG, ['Quando', 'Evento', 'Usuário', 'Detalhe']);
  if (!ss.getSheetByName(CONFIG.ABA_INDICE)) criarAbaOculta_(CONFIG.ABA_INDICE, CAB_INDICE);
  limparCache();

  var cfg = lerConfigApp_();
  var msg = ['Setup concluído.' + (completado.length ? ' Completado na CONFIG_APP: ' + completado.join(', ') + '.' : ''),
    'Conferentes: ' + cfg.conferentes.length + ' | Tipos: ' + cfg.tipos.length + ' | Fornecedores: ' + cfg.fornecedores.length];
  if (cfg.parametros.PASTA_XML_ID) {
    atualizarIndiceXml_(true);
    msg.push('Índice de XMLs: ' + (aba_(CONFIG.ABA_INDICE).getLastRow() - 1) + ' notas.');
  } else {
    msg.push('FALTA: colar o link da pasta XMLs do Drive na coluna I, ao lado de PASTA_XML_ID, na aba CONFIG_APP, e rodar setup de novo.');
  }
  console.log(msg.join('\n'));
  return msg.join('\n');
}

/** Esquece listas/índice em cache (use depois de editar a CONFIG_APP, se não quiser esperar 5 min). */
function limparCache() {
  CacheService.getScriptCache().removeAll(['configApp', 'indiceVarrido']);
}

var TITULOS_CONFIG = ['Conferentes', '', 'Tipos de Ocorrência', '', 'CNPJ ou raiz (8 díg.)', 'Nome na planilha', '', 'Parâmetro', 'Valor'];

/**
 * Cria a CONFIG_APP ou completa só o que estiver faltando (títulos, conferentes, tipos,
 * fornecedores, parâmetros). Nunca sobrescreve o que já foi digitado.
 * @return {string[]} partes completadas
 */
function garantirConfigApp_() {
  var ss = planilha_();
  var sh = ss.getSheetByName(CONFIG.ABA_CONFIG);
  var nova = !sh;
  if (nova) sh = ss.insertSheet(CONFIG.ABA_CONFIG);
  var feito = [];
  var dados = colunasDados_();

  // Link colado por engano na linha de títulos (I1): guarda para usar como PASTA_XML_ID.
  var linkNoTitulo = '';
  var tit = sh.getRange(1, 1, 1, TITULOS_CONFIG.length).getDisplayValues()[0];
  if (/drive\.google\.com|^[\w-]{25,}$/.test(String(tit[8]).trim())) { linkNoTitulo = String(tit[8]).trim(); tit[8] = ''; }
  var mudouTitulo = false;
  TITULOS_CONFIG.forEach(function (t, i) { if (t && String(tit[i]).trim() !== t) { tit[i] = t; mudouTitulo = true; } });
  if (mudouTitulo) { sh.getRange(1, 1, 1, TITULOS_CONFIG.length).setValues([tit]).setFontWeight('bold'); feito.push('títulos'); }

  if (!lerColuna_(sh, 1).length) {
    escreverColuna_(sh, 1, listaDaValidacao_(dados.sheet, dados.mapa.conferente) || valoresRecentes_(dados.sheet, dados.mapa.conferente));
    feito.push('conferentes');
  }
  if (!lerColuna_(sh, 3).length) {
    escreverColuna_(sh, 3, listaDaValidacao_(dados.sheet, dados.mapa.tipo) || TIPOS_PADRAO);
    feito.push('tipos de ocorrência');
  }
  if (!lerColuna_(sh, 5).length && FORNECEDORES_PADRAO.length) {
    sh.getRange(2, 5, FORNECEDORES_PADRAO.length, 2).setNumberFormat('@').setValues(FORNECEDORES_PADRAO);
    feito.push('fornecedores');
  }

  // Parâmetros: inclui os que faltam na coluna H sem mexer nos valores já preenchidos na I.
  var n = Math.max(sh.getLastRow(), 1 + Object.keys(PARAMETROS_PADRAO).length);
  var hi = sh.getRange(2, 8, n, 2).getDisplayValues();
  var existentes = hi.map(function (r) { return String(r[0]).trim(); });
  Object.keys(PARAMETROS_PADRAO).forEach(function (k) {
    if (existentes.indexOf(k) >= 0) return;
    var pareceLink = function (v) { return /drive\.google\.com|^[\w-]{25,}$/.test(String(v).trim()); };
    var i = hi.findIndex(function (r, j) {
      return !existentes[j] && (!String(r[1]).trim() || (k === 'PASTA_XML_ID' && pareceLink(r[1])));
    });
    if (i < 0) { i = hi.length; hi.push(['', '']); existentes.push(''); }
    var valor = String(hi[i][1]).trim() || (k === 'PASTA_XML_ID' && linkNoTitulo) || PARAMETROS_PADRAO[k];
    sh.getRange(2 + i, 8, 1, 2).setNumberFormat('@').setValues([[k, valor]]);
    existentes[i] = k; hi[i] = [k, valor];
    feito.push(k);
  });

  if (!String(sh.getRange(1, 11).getValue()).trim()) {
    sh.getRange(1, 11, 5, 1).setValues([
      ['Como usar'],
      ['PASTA_XML_ID: cole na coluna I o link da pasta "XMLs" sincronizada no Drive.'],
      ['STATUS_INICIAL: valor gravado na coluna Status (vazio = não grava).'],
      ['Listas: uma opção por linha; a ordem aqui é a ordem na tela.'],
      ['Depois de editar, rode limparCache() ou espere 5 minutos.']
    ]).setFontColor('#666666').setFontStyle('italic');
  }
  sh.setFrozenRows(1);
  if (nova) { sh.autoResizeColumns(1, 9); sh.hideSheet(); }
  return feito;
}

/** Opções da validação de dados (lista) usada hoje na coluna, lida na próxima linha livre. */
function listaDaValidacao_(sh, col) {
  var linhas = [proximaLinha_(sh, colunasDados_().mapa), CONFIG.PRIMEIRA_LINHA_DADOS];
  for (var i = 0; i < linhas.length; i++) {
    var dv = sh.getRange(linhas[i], col).getDataValidation();
    if (dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      var vals = dv.getCriteriaValues()[0].map(function (v) { return String(v).trim(); }).filter(String);
      var unicos = vals.filter(function (v, j) { return vals.indexOf(v) === j; });
      if (unicos.length) return unicos;
    }
  }
  return null;
}

function valoresRecentes_(sh, col) {
  var ult = proximaLinha_(sh, colunasDados_().mapa) - 1;
  var ini = Math.max(CONFIG.PRIMEIRA_LINHA_DADOS, ult - 500);
  if (ult < ini) return [];
  var vals = sh.getRange(ini, col, ult - ini + 1, 1).getDisplayValues().map(function (r) { return r[0].trim(); }).filter(String);
  return vals.filter(function (v, j) { return vals.indexOf(v) === j; }).sort();
}

function escreverColuna_(sh, col, valores) {
  if (!valores.length) return;
  sh.getRange(2, col, valores.length, 1).setNumberFormat('@').setValues(valores.map(function (v) { return [v]; }));
}
