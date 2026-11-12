/**
 * Consulta das ocorrências já registradas (tela inicial): lê a aba DATABASE
 * e devolve as linhas com "Data da Ocorrência" dentro do período pedido.
 * Usa só colunas que existem na planilha; nada é inventado.
 */

/** Colunas só de leitura (preenchidas por fórmula ou por outra equipe). Faltando alguma, ela só não aparece. */
var COLUNAS_CONSULTA = {
  protocolo: 'Nº Protocolo',
  produto: 'Produto',
  marca: 'Marca',
  situacao: 'STATUS',
  formalizacao: 'Data de Formalização',
  nfd: 'Nº da NFD'
};

var LIMITE_CONSULTA = 1000;

/** Intervalo [inicio, fim] em "yyyy-MM-dd" válido e com no máximo ~1 ano (pura). */
function validarPeriodo(inicio, fim) {
  var a = dataISO(inicio), b = dataISO(fim);
  if (!a || !b) throw new Error('Período inválido.');
  if (b < a) throw new Error('A data final é anterior à inicial.');
  if ((b - a) / 86400000 > 400) throw new Error('Escolha um período de até 1 ano.');
  return { inicio: a, fim: b };
}

/**
 * Colunas da DATABASE e montagem do item que a tela usa (lista, detalhe e formalização).
 * @return {{sheet, mapa, largura, tz, item: function(number, string, Array, Array): Object}}
 */
function contextoOcorrencias_() {
  var d = colunasDados_();
  var sh = d.sheet;
  var cab = sh.getRange(CONFIG.LINHA_CABECALHO, 1, 1, sh.getLastColumn()).getValues()[0];
  var extra = {};
  Object.keys(COLUNAS_CONSULTA).forEach(function (k) {
    try {
      var r = mapearCabecalhos(cab, (function (o) { o[k] = COLUNAS_CONSULTA[k]; return o; })({}));
      if (!r.faltando.length) extra[k] = r.mapa[k];
    } catch (e) { /* coluna ambígua: não mostra */ }
  });
  var largura = Math.max.apply(null, Object.keys(d.mapa).map(function (k) { return d.mapa[k]; })
    .concat(Object.keys(extra).map(function (k) { return extra[k]; })));
  var caixa = caixaFormalizado_(sh, d.mapa.status);
  return {
    sheet: sh, mapa: d.mapa, largura: largura, tz: Session.getScriptTimeZone(),
    item: function (linha, dia, valores, textos) {
      var g = function (col) { return col ? String(textos[col - 1]).trim() : ''; };
      return {
        linha: linha,
        data: dia,
        protocolo: g(extra.protocolo),
        fornecedor: g(d.mapa.fornecedor),
        conferente: g(d.mapa.conferente),
        nf: g(d.mapa.nf),
        pedido: g(d.mapa.pedido),
        bloqueio: g(d.mapa.bloqueio),
        valor: g(d.mapa.valor),
        codIntegracao: g(d.mapa.codIntegracao),
        codProduto: g(d.mapa.codProduto),
        produto: g(extra.produto),
        marca: g(extra.marca),
        tipo: g(d.mapa.tipo),
        qtd: g(d.mapa.qtd),
        obs: g(d.mapa.obs),
        situacao: g(extra.situacao),
        formalizacao: g(extra.formalizacao),
        nfd: g(extra.nfd),
        formalizado: caixa.ehMarcado(valores[d.mapa.status - 1])
      };
    }
  };
}

/**
 * Ocorrências do período, mais recentes primeiro.
 * @return {{itens: Array, total: number, limitado: boolean}}
 */
function listarOcorrencias(inicio, fim) {
  return api_('listarOcorrencias', function () {
    var p = validarPeriodo(inicio, fim);
    var c = contextoOcorrencias_();
    var sh = c.sheet;
    var ult = proximaLinha_(sh, c.mapa) - 1;
    if (ult < CONFIG.PRIMEIRA_LINHA_DADOS) return { itens: [], total: 0, limitado: false };

    var n = ult - CONFIG.PRIMEIRA_LINHA_DADOS + 1;
    var valores = sh.getRange(CONFIG.PRIMEIRA_LINHA_DADOS, 1, n, c.largura).getValues();
    var textos = sh.getRange(CONFIG.PRIMEIRA_LINHA_DADOS, 1, n, c.largura).getDisplayValues();
    var iniMs = p.inicio.getTime(), fimMs = p.fim.getTime();

    var itens = [];
    for (var i = 0; i < n; i++) {
      var bruto = valores[i][c.mapa.data - 1];
      if (!(bruto instanceof Date)) continue;
      var dia = Utilities.formatDate(bruto, c.tz, 'yyyy-MM-dd');
      var ms = dataISO(dia).getTime();
      if (ms < iniMs || ms > fimMs) continue;
      itens.push(c.item(CONFIG.PRIMEIRA_LINHA_DADOS + i, dia, valores[i], textos[i]));
    }
    itens.sort(function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : b.linha - a.linha; });
    var total = itens.length;
    return { itens: itens.slice(0, LIMITE_CONSULTA), total: total, limitado: total > LIMITE_CONSULTA };
  });
}

/** Linhas pedidas pela tela: números válidos, sem repetir, no máximo 50 (pura). */
function linhasDeOcorrencia(linhas) {
  return (Array.isArray(linhas) ? linhas : []).map(Number).filter(function (n, i, a) {
    return Math.floor(n) === n && n >= CONFIG.PRIMEIRA_LINHA_DADOS && a.indexOf(n) === i;
  }).slice(0, 50);
}

/** Ocorrências atuais das linhas informadas, no mesmo formato da lista (detalhe e rascunho). */
function ocorrenciasDasLinhas(linhas) {
  return api_('ocorrenciasDasLinhas', function () {
    var nums = linhasDeOcorrencia(linhas);
    if (!nums.length) return [];
    var c = contextoOcorrencias_();
    var itens = [];
    nums.forEach(function (n) {
      if (n > c.sheet.getMaxRows()) return;
      var rng = c.sheet.getRange(n, 1, 1, c.largura);
      var v = rng.getValues()[0];
      var bruto = v[c.mapa.data - 1];
      if (!(bruto instanceof Date)) return;
      itens.push(c.item(n, Utilities.formatDate(bruto, c.tz, 'yyyy-MM-dd'), v, rng.getDisplayValues()[0]));
    });
    return itens;
  });
}

/** "Protocolo 2539" e "Protocolo 2539 a 2541" cobrem o protocolo 2540? (pura) */
function pastaCobreProtocolo(nomePasta, protocolo) {
  var m = /^Protocolo (\d+)(?: a (\d+))?$/.exec(String(nomePasta).trim());
  var n = Number(protocolo);
  if (!m || !n) return false;
  var ini = Number(m[1]), fim = m[2] ? Number(m[2]) : ini;
  return n >= ini && n <= fim;
}

/** Pasta de fotos do protocolo, se existir. @return {{url, nome, arquivos}|null} */
/** Pasta (Drive) do protocolo: nome exato primeiro (rápido), depois as de faixa "N a M". null se não houver. */
function pastaDoProtocolo_(protocolo) {
  var n = somenteDigitos(protocolo);
  if (!n) return null;
  var raiz = pastaFotosRaiz_();
  var exata = raiz.getFoldersByName('Protocolo ' + n);
  if (exata.hasNext()) return exata.next();
  var it = raiz.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (pastaCobreProtocolo(f.getName(), n)) return f;
  }
  return null;
}

function pastaDoProtocolo(protocolo) {
  return api_('pastaDoProtocolo', function () {
    var pasta = pastaDoProtocolo_(protocolo);
    if (!pasta) return null;
    var arquivos = 0, fs = pasta.getFiles();
    while (fs.hasNext() && arquivos < 100) { fs.next(); arquivos++; }
    return { url: pasta.getUrl(), nome: pasta.getName(), arquivos: arquivos };
  });
}
