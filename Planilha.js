/**
 * Acesso à planilha: abas, colunas pelos cabeçalhos, leitura do histórico,
 * parâmetros da CONFIG_APP e gravação das ocorrências.
 */

var planilhaAberta_ = null; // cada execução do Apps Script começa com globais novas: vale só durante a chamada

function planilha_() {
  if (planilhaAberta_) return planilhaAberta_; // openById custa centenas de ms e era refeito a cada aba_()
  var id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID') || CONFIG.PLANILHA_ID;
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Planilha não encontrada: vincule o script à planilha ou defina a propriedade PLANILHA_ID.');
  planilhaAberta_ = ss;
  return ss;
}

function aba_(nome, obrigatoria) {
  var sh = planilha_().getSheetByName(nome);
  if (!sh && obrigatoria !== false) throw new Error('Aba "' + nome + '" não encontrada na planilha.');
  return sh;
}

/** {sheet, mapa: campo → coluna} da aba DATABASE. Falha se algum cabeçalho sumiu. */
function colunasDados_() {
  var sh = aba_(CONFIG.ABA_DADOS);
  var cab = sh.getRange(CONFIG.LINHA_CABECALHO, 1, 1, sh.getLastColumn()).getValues()[0];
  var r = mapearCabecalhos(cab, CONFIG.COLUNAS);
  if (r.faltando.length) throw new Error('Cabeçalhos não encontrados na linha ' + CONFIG.LINHA_CABECALHO + ' da aba ' + CONFIG.ABA_DADOS + ': ' + r.faltando.join(', '));
  return { sheet: sh, mapa: r.mapa };
}

/**
 * Próxima linha livre = depois da última com "Data da Ocorrência" preenchida.
 * (getLastRow não serve: as fórmulas de matriz vão até o fim da aba.)
 */
function proximaLinha_(sh, mapa) {
  var ult = CONFIG.PRIMEIRA_LINHA_DADOS - 1;
  colunasDeRegistro_(mapa).forEach(function (col) { ult = Math.max(ult, ultimaLinhaComDado_(sh, col)); });
  return ult + 1;
}

/**
 * Colunas que o app grava e que identificam uma linha ocupada.
 * "Status" fica de fora: a planilha já traz 0 em linhas vazias.
 */
function colunasDeRegistro_(mapa) {
  return Object.keys(mapa).filter(function (c) { return c !== 'status'; }).map(function (c) { return mapa[c]; });
}

/** Última linha com qualquer conteúdo na coluna (1 se vazia). Rápido: não lê a coluna inteira. */
function ultimaLinhaComDado_(sh, col) {
  var max = sh.getMaxRows();
  var fim = sh.getRange(max, col);
  if (String(fim.getDisplayValue()) !== '') return max;
  return fim.getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
}

/** Recusa gravar se alguma das linhas de destino já tiver algo nas colunas do registro. */
function conferirLinhasVazias_(sh, mapa, linhaInicial, n) {
  var cols = colunasDeRegistro_(mapa);
  var min = Math.min.apply(null, cols), max = Math.max.apply(null, cols);
  if (linhaInicial > sh.getMaxRows()) return;
  var qtd = Math.min(n, sh.getMaxRows() - linhaInicial + 1);
  var vals = sh.getRange(linhaInicial, min, qtd, max - min + 1).getDisplayValues();
  vals.forEach(function (linha, i) {
    cols.forEach(function (c) {
      if (String(linha[c - min]).trim() !== '') {
        throw new Error('A linha ' + (linhaInicial + i) + ' da aba ' + CONFIG.ABA_DADOS + ' não está vazia — nada foi gravado para não sobrescrever dados. Tente de novo; se repetir, confira essa linha.');
      }
    });
  });
}

/** Linhas já gravadas (para duplicidade e histórico de códigos). */
function lerRegistros_(sh, mapa, ultimaLinha) {
  var ini = CONFIG.PRIMEIRA_LINHA_DADOS;
  if (ultimaLinha < ini) return [];
  var cols = ['data', 'fornecedor', 'nf', 'codIntegracao', 'codProduto', 'tipo', 'qtd'];
  var min = Math.min.apply(null, cols.map(function (c) { return mapa[c]; }));
  var max = Math.max.apply(null, cols.map(function (c) { return mapa[c]; }));
  var vals = sh.getRange(ini, min, ultimaLinha - ini + 1, max - min + 1).getValues();
  var tz = Session.getScriptTimeZone();
  return vals.map(function (v, i) {
    var g = function (c) { return v[mapa[c] - min]; };
    var d = g('data');
    return {
      linha: ini + i,
      data: d instanceof Date ? Utilities.formatDate(d, tz, 'dd/MM/yyyy') : String(d),
      fornecedor: String(g('fornecedor')),
      nf: String(g('nf')),
      codIntegracao: String(g('codIntegracao')),
      codProduto: String(g('codProduto')),
      tipo: String(g('tipo')),
      qtd: g('qtd')
    };
  }).filter(function (r) { return r.nf !== '' || r.codProduto !== ''; });
}

/**
 * Grava as linhas a partir de `linhaInicial`, coluna a coluna (só as do mapa),
 * em blocos contíguos. Nunca toca nas colunas de fórmula.
 */
function gravarLinhas_(sh, mapa, linhaInicial, linhas) {
  var campos = Object.keys(mapa);
  var colParaCampo = {};
  campos.forEach(function (c) { colParaCampo[mapa[c]] = c; });
  var n = linhas.length;
  var precisaLinhas = linhaInicial + n - 1 - sh.getMaxRows();
  if (precisaLinhas > 0) sh.insertRowsAfter(sh.getMaxRows(), precisaLinhas);

  ajustarValidacoes_(sh, mapa, linhaInicial, linhas);

  var gravados = [];
  try {
    agruparColunas(campos.map(function (c) { return mapa[c]; })).forEach(function (bloco) {
      var rng = sh.getRange(linhaInicial, bloco[0], n, bloco.length);
      var formatos = rng.getNumberFormats();
      var valores = linhas.map(function (l, i) {
        return bloco.map(function (col, j) {
          var v = l[colParaCampo[col]];
          if (v && typeof v === 'object' && !(v instanceof Date) && 'texto' in v) { formatos[i][j] = '@'; return v.texto; }
          if (v instanceof Date) formatos[i][j] = 'dd/mm/yyyy';
          return v == null ? '' : v;
        });
      });
      rng.setNumberFormats(formatos);
      try {
        rng.setValues(valores);
      } catch (e) {
        var nomes = bloco.map(function (col) { return CONFIG.COLUNAS[colParaCampo[col]]; }).join(', ');
        throw new Error('A planilha recusou valores nas colunas ' + nomes + ': ' + (e && e.message || e));
      }
      gravados.push(rng);
    });
  } catch (e) {
    // Desfaz o que já tinha sido escrito nessas linhas (estavam vazias) para não sobrar registro pela metade.
    gravados.forEach(function (r) { try { r.clearContent(); } catch (x) { /* segue */ } });
    throw e;
  }
}

/**
 * Validações de dados "lista de itens" que rejeitam valores fora da lista
 * (ex.: Conferente): se um valor a gravar não está na lista, ele é ACRESCENTADO
 * à lista dessa coluna, da linha nova até o fim da aba. Nada é removido.
 * Lista baseada em intervalo não é alterada — o erro diz o que incluir.
 */
function ajustarValidacoes_(sh, mapa, linhaInicial, linhas) {
  var crit = SpreadsheetApp.DataValidationCriteria;
  Object.keys(mapa).forEach(function (campo) {
    var col = mapa[campo];
    var regra = sh.getRange(linhaInicial, col).getDataValidation();
    if (!regra || regra.getAllowInvalid()) return;
    var escritos = linhas.map(function (l) {
      var v = l[campo];
      if (v && typeof v === 'object' && 'texto' in v) return v.texto;
      return v instanceof Date || v == null ? '' : String(v);
    });
    var tipo = regra.getCriteriaType(), args = regra.getCriteriaValues();
    if (tipo === crit.VALUE_IN_LIST) {
      var faltando = valoresForaDaLista(escritos, args[0]);
      if (!faltando.length) return;
      var nova = regra.copy().requireValueInList(args[0].concat(faltando), args[1] !== false).build();
      sh.getRange(linhaInicial, col, sh.getMaxRows() - linhaInicial + 1, 1).setDataValidation(nova);
      registrarLog_('VALIDAÇÃO AMPLIADA', usuario_(), CONFIG.COLUNAS[campo] + ': ' + faltando.join(', '));
    } else if (tipo === crit.VALUE_IN_RANGE) {
      var permitidos = [].concat.apply([], args[0].getDisplayValues());
      var fora = valoresForaDaLista(escritos, permitidos);
      if (fora.length) {
        throw new Error('"' + fora.join('", "') + '" não está na lista de validação da coluna ' + CONFIG.COLUNAS[campo] +
          ' (intervalo ' + args[0].getSheet().getName() + '!' + args[0].getA1Notation() + '). Inclua lá e tente de novo.');
      }
    }
  });
}

// ── CONFIG_APP ──────────────────────────────────────────────────────────────
// Layout (criado pelo setup):  A Conferentes | C Tipos de Ocorrência | E CNPJ (ou raiz) · F Nome na planilha | H Parâmetro · I Valor

function lerColuna_(sh, col) {
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, col, n, 1).getDisplayValues().map(function (r) { return r[0]; })
    .filter(function (v) { return String(v).trim() !== ''; });
}

/** Listas e parâmetros da aba CONFIG_APP (com cache de 5 min). */
function lerConfigApp_() {
  var cache = CacheService.getScriptCache();
  var c = cache.get('configApp');
  if (c) return JSON.parse(c);
  var sh = aba_(CONFIG.ABA_CONFIG, false);
  if (!sh) throw new Error('Aba CONFIG_APP não existe. Rode a função "setup" no editor do Apps Script.');
  var n = Math.max(sh.getLastRow() - 1, 0);
  var forn = n ? sh.getRange(2, 5, n, 2).getDisplayValues().filter(function (r) { return r[0] && r[1]; }) : [];
  var params = {};
  Object.keys(PARAMETROS_PADRAO).forEach(function (k) { params[k] = PARAMETROS_PADRAO[k]; });
  if (n) sh.getRange(2, 8, n, 2).getDisplayValues().forEach(function (r) { if (r[0]) params[String(r[0]).trim()] = String(r[1]).trim(); });
  var cfg = {
    conferentes: lerColuna_(sh, 1),
    tipos: lerColuna_(sh, 3),
    fornecedores: forn,
    parametros: params
  };
  cache.put('configApp', JSON.stringify(cfg), 300);
  return cfg;
}

/** Grava "Parâmetro | Valor" na CONFIG_APP (colunas H/I): atualiza a linha do parâmetro ou usa a primeira livre. */
function definirParametro_(chave, valor) {
  var sh = aba_(CONFIG.ABA_CONFIG);
  var n = Math.max(sh.getLastRow() - 1, 1);
  var hi = sh.getRange(2, 8, n, 2).getDisplayValues();
  var i = hi.findIndex(function (r) { return String(r[0]).trim() === chave; });
  if (i < 0) i = hi.findIndex(function (r) { return !String(r[0]).trim() && !String(r[1]).trim(); });
  if (i < 0) i = hi.length;
  sh.getRange(2 + i, 8, 1, 2).setNumberFormat('@').setValues([[chave, valor == null ? '' : String(valor)]]);
  CacheService.getScriptCache().remove('configApp');
}

// ── CADASTRO DE PRODUTOS ────────────────────────────────────────────────────

/** Produtos do cadastro: {codigo, nome, marca, ean}. */
function lerCadastro_() {
  var sh = aba_(CONFIG.ABA_CADASTRO);
  var ult = sh.getLastRow();
  if (ult < 2) return [];
  var larg = sh.getLastColumn();
  var cab = sh.getRange(1, 1, 1, larg).getValues()[0];
  var r = mapearCabecalhos(cab, { nome: CONFIG.CADASTRO.nome, marca: CONFIG.CADASTRO.marca, ean: CONFIG.CADASTRO.ean });
  if (r.faltando.length) throw new Error('Cabeçalhos não encontrados no cadastro: ' + r.faltando.join(', '));
  var vals = sh.getRange(2, 1, ult - 1, larg).getValues();
  var cc = CONFIG.CADASTRO.colunaCodigo - 1;
  var out = [];
  vals.forEach(function (v) {
    var codigo = somenteDigitos(typeof v[cc] === 'number' ? Math.round(v[cc]) : v[cc]);
    var nome = String(v[r.mapa.nome - 1]).trim();
    if (!codigo || !nome) return;
    var ean = v[r.mapa.ean - 1];
    ean = typeof ean === 'number' ? String(Math.round(ean)) : String(ean).trim();
    out.push({ codigo: semZerosEsquerda(codigo), nome: nome, marca: String(v[r.mapa.marca - 1]).trim(), ean: /^\d{8,14}$/.test(ean) ? ean : '' });
  });
  return out;
}

// ── LOG_APP ─────────────────────────────────────────────────────────────────

/** Uma linha por evento: gravações (auditoria de quem gravou o quê) e erros. */
function registrarLog_(tipo, usuario, detalhe) {
  try {
    var sh = aba_(CONFIG.ABA_LOG, false);
    if (!sh) return;
    sh.appendRow([new Date(), tipo, usuario || '', String(detalhe).slice(0, 45000)]);
  } catch (e) {
    console.error('Falha ao gravar LOG_APP: ' + e);
  }
}
