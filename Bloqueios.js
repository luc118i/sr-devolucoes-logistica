/**
 * Tela "Bloqueios": lê o relatório analítico do Santri (.ods) e cruza pelo número do bloqueio
 * com a aba DATABASE, montando o quadro em três recortes:
 *   abertos   bloqueios com status Ab, na coluna da situação da ocorrência
 *   baixados  bloqueios Bx cuja ocorrência ainda está em andamento (o material pode seguir na pilha)
 *   fora      ocorrências em andamento cujo bloqueio não veio no relatório
 * Nada é gravado na DATABASE, e o relatório não é guardado (só uma linha na LOG_APP).
 * A única gravação da tela são os selos dos cartões, na aba oculta CONFIG.ABA_SELOS.
 */

/** Colunas especiais do recorte "abertos". */
var COL_SEM_OCORRENCIA = 'SEM';
var COL_CONFIRMAR = 'CONFIRMAR';
var SEM_STATUS = 'Sem status';
var SITUACAO_FINAL = 'Finalizada';

/** Ordem das colunas (fluxo da devolução). Com situações diferentes no mesmo bloqueio, vale a que vem antes. */
var ORDEM_SITUACOES = [SEM_STATUS, 'Verificar', 'Tratativa compras', 'DEXCO', 'Aguardando remessa em garantia',
  'Aguardando autorização p/ emissão de NFD', 'Aguardando emissão de NFD', 'Aguardando transportadora', SITUACAO_FINAL];

/** Janela (dias) entre bloqueio e ocorrência para sugerir um vínculo sem número de bloqueio. */
var JANELA_VINCULO_DIAS = 45;

var LIMITE_ODS_BASE64 = 20 * 1024 * 1024;

/** Selos sugeridos em todo cartão. Os criados pela equipe entram na lista quando usados. */
var SELOS_PADRAO = ['Aguardando retorno', 'Conferir físico', 'Separado p/ coleta'];
var TAMANHO_MAX_SELO = 40;
var MAX_SELOS_POR_CARTAO = 6;

// ── leitura do .ods (puras) ─────────────────────────────────────────────────

function decodificarXml_(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, function (m, e) {
    var k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}

function atributoOds_(attrs, nome) {
  var m = new RegExp('\\b' + nome + '="([^"]*)"').exec(attrs);
  return m ? m[1] : '';
}

/** Texto de uma célula: parágrafos separados por quebra de linha, sem as marcações internas. */
function textoCelulaOds_(corpo) {
  var partes = [], re = /<text:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:p>)/g, m;
  while ((m = re.exec(corpo))) {
    partes.push(decodificarXml_(String(m[1] || '')
      .replace(/<text:s\b[^>]*?text:c="(\d+)"[^>]*\/>/g, function (x, n) { return new Array(Number(n) + 1).join(' '); })
      .replace(/<text:s\b[^>]*\/>/g, ' ')
      .replace(/<[^>]+>/g, '')));
  }
  return partes.join('\n');
}

/**
 * Linhas não vazias da primeira aba de um content.xml de .ods, como listas de textos.
 * Regex em vez de XmlService: o XML passa de 19 MB, e aqui só importam linhas e células.
 */
function lerTabelaOds(xml) {
  var ini = xml.indexOf('<table:table ');
  if (ini < 0) return [];
  var fim = xml.indexOf('</table:table>', ini);
  var tabela = xml.slice(ini, fim < 0 ? xml.length : fim);
  var linhas = [];
  var reLinha = /<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g, l;
  while ((l = reLinha.exec(tabela))) {
    if (!l[2]) continue;
    var celulas = [];
    var reCel = /<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g, c;
    while ((c = reCel.exec(l[2]))) {
      var repete = Number(atributoOds_(c[1], 'table:number-columns-repeated')) || 1;
      var valor = textoCelulaOds_(c[2] || '') || atributoOds_(c[1], 'office:value') || atributoOds_(c[1], 'office:date-value');
      if (repete > 50 && !valor) continue; // preenchimento até o fim da aba
      for (var i = 0; i < repete; i++) celulas.push(valor);
    }
    while (celulas.length && celulas[celulas.length - 1] === '') celulas.pop();
    if (!celulas.length) continue;
    var vezes = Number(atributoOds_(l[1], 'table:number-rows-repeated')) || 1;
    for (var j = 0; j < (vezes > 50 ? 1 : vezes); j++) linhas.push(celulas);
  }
  return linhas;
}

/**
 * Estrutura o relatório: cabeçalho de cada bloqueio seguido dos itens. As colunas saem dos títulos;
 * se o layout mudar, a mensagem diz o que faltou em vez de ler a coluna errada.
 * @return {{blocos: Array, emitido: string, filtros: string[]}}
 */
function interpretarRelatorioBloqueios(linhas) {
  var titulo = linhas.slice(0, 6).map(function (r) { return r.join(' '); }).join(' ');
  var tituloN = normalizar(titulo);
  if (tituloN.indexOf('BLOQUEIOS DE ESTOQUE') < 0) throw new Error('Este arquivo não é a "Relação de bloqueios de estoque" do Santri.');
  if (tituloN.indexOf('ANALITICO') < 0) throw new Error('Use o relatório Analítico: o cruzamento precisa dos itens de cada bloqueio.');
  var emitido = (/Emitido em\s+(\d{2}\/\d{2}\/\d{4}(?: \d{2}:\d{2})?)/.exec(titulo) || [])[1] || '';

  var COLS_BLOQUEIO = { bloqueio: 'Bloqueio', entrada: 'Entrada', fornecedor: 'Fornecedor', cadastro: 'Data cadastro', baixa: 'Data baixa',
    status: 'Status', tipo: 'Tipo de bloqueio de estoque', valor: 'Valor do bloqueio', pendente: 'Valor pendente' };
  var COLS_ITEM = { produto: 'Produto', nome: 'Nome', marca: 'Marca', unidade: 'Unidade', quantidade: 'Quantidade', baixada: 'Qtd. baixada',
    pendente: 'Qtd. pendente', valor: 'Valor do bloqueio', valorPendente: 'Valor pendente', local: 'Local' };
  var cB = null, cI = null, cur = null, blocos = [], filtros = [], secao = null;
  var g = function (r, mapa, campo) { return String(r[mapa[campo] - 1] == null ? '' : r[mapa[campo] - 1]).trim(); };
  var n = function (s) { return numeroBR(s) || 0; };
  var colunas = function (r, desejadas, nome) {
    var m = mapearCabecalhos(r, desejadas);
    if (m.faltando.length) throw new Error('O layout do relatório mudou: não achei ' + m.faltando.join(', ') + ' em ' + nome + '.');
    return m.mapa;
  };

  linhas.forEach(function (r) {
    var primeira = String(r[0] == null ? '' : r[0]).trim();
    if (!cB) {
      if (normalizar(primeira) === 'BLOQUEIO') cB = colunas(r, COLS_BLOQUEIO, 'cabeçalho dos bloqueios');
      return;
    }
    if (/^[\d.]+$/.test(primeira) && g(r, cB, 'status')) {
      cur = {
        bloqueio: primeira.replace(/\./g, ''), entrada: g(r, cB, 'entrada'), fornecedor: g(r, cB, 'fornecedor'), cad: g(r, cB, 'cadastro'),
        baixa: g(r, cB, 'baixa'), status: g(r, cB, 'status'), tipo: g(r, cB, 'tipo'), valor: n(g(r, cB, 'valor')), pend: n(g(r, cB, 'pendente')), itens: []
      };
      blocos.push(cur);
      return;
    }
    if (!primeira && normalizar(r[1]) === 'PRODUTO') { if (!cI) cI = colunas(r, COLS_ITEM, 'cabeçalho dos itens'); return; }
    if (!primeira && cI && cur && /^[\d.]+$/.test(g(r, cI, 'produto')) && g(r, cI, 'nome')) {
      cur.itens.push({
        cod: g(r, cI, 'produto').replace(/\./g, ''), nome: g(r, cI, 'nome'), marca: g(r, cI, 'marca'), un: g(r, cI, 'unidade'),
        qtd: n(g(r, cI, 'quantidade')), valor: n(g(r, cI, 'valor')), qb: n(g(r, cI, 'baixada')), qp: n(g(r, cI, 'pendente')),
        vp: n(g(r, cI, 'valorPendente')), local: g(r, cI, 'local')
      });
      return;
    }
    // Rodapé: "Filtros selecionados", um título por filtro e os valores recuados.
    if (r.length === 1 && primeira && !/^(Filtros selecionados|Agrupado por)/i.test(primeira)) {
      if (/^\s/.test(String(r[0])) && secao) secao.valores.push(primeira);
      else { secao = { nome: primeira, valores: [] }; filtros.push(secao); }
    }
  });
  if (!cB || !blocos.length) throw new Error('Nenhum bloqueio encontrado no arquivo.');
  if (!cI) throw new Error('Use o relatório Analítico: este arquivo não traz os itens de cada bloqueio.');
  return {
    blocos: blocos, emitido: emitido,
    filtros: filtros.filter(function (f) { return f.valores.length; }).map(function (f) { return f.nome + ': ' + f.valores.join(', '); })
  };
}

// ── cruzamento (puras) ──────────────────────────────────────────────────────

/** Números de bloqueio de uma célula ("78.001", 51690, "S/B" → nenhum). */
function numerosBloqueio(v) {
  if (v == null || v === '') return [];
  if (typeof v === 'number') return Math.trunc(v) ? [String(Math.trunc(v))] : [];
  return (String(v).match(/\d[\d.]*\d|\d/g) || []).map(function (m) { return m.replace(/\./g, '').replace(/^0+/, ''); })
    .filter(function (d) { return d; });
}

function codigoProdutoBloqueio_(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return String(Math.trunc(v));
  return somenteDigitos(v).replace(/^0+/, '');
}

/** Texto útil de uma célula: "-----" e vazios viram "". */
function textoCelula_(v) {
  if (v == null) return '';
  var s = String(v).trim();
  return /[0-9A-Za-zÀ-ÿ]/.test(s) ? s : '';
}

function numeroCelula_(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

function dataIso_(v) { return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : ''; }
function isoDeBr_(s) { return s ? s.split('/').reverse().join('-') : ''; }
function diasEntre_(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
function ehFinalizada_(s) { return normalizar(s) === normalizar(SITUACAO_FINAL); }

function posicaoSituacao_(s) {
  var i = ORDEM_SITUACOES.indexOf(s);
  return i < 0 ? ORDEM_SITUACOES.length - 1.5 : i; // situação nova na lista: antes de Finalizada
}

/** Coluna do cartão: a situação mais atrasada entre as ocorrências informadas. */
function colunaDaSituacao_(ocorrencias) {
  return ocorrencias.map(function (o) { return textoCelula_(o.status) || SEM_STATUS; })
    .sort(function (a, b) { return posicaoSituacao_(a) - posicaoSituacao_(b); })[0];
}

function nomeFornecedor_(s) {
  var nome = String(s || '').replace(/^[\d.]+ - /, '').trim();
  var n = normalizar(nome);
  if (n.indexOf('OBJETIVA') >= 0) return /FILIAL/.test(n) ? 'Objetiva (filial)' : /MATRIZ/.test(n) ? 'Objetiva (matriz)' : 'Objetiva';
  return nome || 'Sem fornecedor';
}

function tipoBloqueio_(s) {
  return { '9.998': 'Danificados', '9.999': 'Faltando', '9.996': 'Vencidos' }[String(s).slice(0, 5)] || String(s).replace(/^[\d.]+ - /, '');
}

function ocorrenciaDoCartao_(o) {
  return {
    linha: o.linha, prot: textoCelula_(o.prot), data: dataIso_(o.data), nf: textoCelula_(o.nf), ped: textoCelula_(o.ped), cod: codigoProdutoBloqueio_(o.cod),
    prod: textoCelula_(o.prod), qtd: numeroCelula_(o.qtd), tipo: textoCelula_(o.tipo), status: textoCelula_(o.status) || SEM_STATUS,
    nfd: textoCelula_(o.nfd), dform: dataIso_(o.dform), formal: !!o.formal, obs: textoCelula_(o.obs)
  };
}

function itensDoCartao_(bloco, soPendentes) {
  return bloco.itens.filter(function (i) { return !soPendentes || i.qp > 0; }).map(function (i) {
    return {
      cod: i.cod, nome: i.nome, marca: i.marca.replace(/^[\d.]+ - /, ''), un: i.un, qtd: soPendentes ? i.qp : i.qtd,
      vp: soPendentes ? i.vp : null, local: i.local.replace(/^\d+ - /, '')
    };
  });
}

/**
 * Ocorrência sem o número certo que provavelmente é deste bloqueio: mesmo produto e quantidade,
 * data próxima e, no campo Bloqueio, nada ou um bloqueio do relatório que não tem o produto.
 * Se o bloqueio informado tem o produto, o vínculo dela já está certo e não entra aqui.
 */
function vinculoProvavel_(bloco, ocorrencias, porNumero) {
  var iso = isoDeBr_(bloco.cad);
  for (var a = 0; a < bloco.itens.length; a++) {
    var item = bloco.itens[a];
    if (item.qp <= 0) continue;
    for (var b = 0; b < ocorrencias.length; b++) {
      var o = ocorrencias[b], data = dataIso_(o.data);
      if (codigoProdutoBloqueio_(o.cod) !== item.cod || Math.abs(numeroCelula_(o.qtd) - item.qtd) > 1e-6 || !data) continue;
      if (Math.abs(diasEntre_(iso, data)) > JANELA_VINCULO_DIAS) continue;
      var nums = numerosBloqueio(o.blq);
      if (!nums.length) return { o: o, motivo: 'o campo Bloqueio da ocorrência está vazio' };
      var semProduto = nums.every(function (n) {
        return porNumero[n] && porNumero[n].itens.every(function (k) { return k.cod !== item.cod; });
      });
      if (semProduto) return { o: o, motivo: 'a ocorrência está no bloqueio ' + nums[0] + ', que não tem esse produto' };
    }
  }
  return null;
}

function alertasDoBloqueio_(bloco, os) {
  var alertas = [], itens = {}, codigos = [], qtd = {};
  bloco.itens.forEach(function (i) { itens[i.cod] = i; });
  os.forEach(function (o) {
    var c = codigoProdutoBloqueio_(o.cod);
    if (!(c in qtd)) { qtd[c] = 0; codigos.push(c); }
    qtd[c] += numeroCelula_(o.qtd);
  });
  var br = function (v) { return String(Number(v.toFixed(4))).replace('.', ','); };
  codigos.forEach(function (c) {
    if (!itens[c]) {
      var o = os.filter(function (x) { return codigoProdutoBloqueio_(x.cod) === c; })[0];
      alertas.push('Protocolo ' + textoCelula_(o.prot) + ' cita um produto que não está neste bloqueio (' + c + ')');
    } else if (Math.abs(qtd[c] - itens[c].qtd) > 1e-6) {
      alertas.push('Quantidade diverge no produto ' + c + ': ocorrência ' + br(qtd[c]) + ', bloqueio ' + br(itens[c].qtd));
    }
  });
  bloco.itens.forEach(function (i) { if (!(i.cod in qtd) && i.qp > 0) alertas.push('Produto ' + i.cod + ' sem ocorrência'); });
  if (os.some(function (o) { return !o.formal; })) alertas.push('Ocorrência ainda não formalizada');
  var nfd = os.map(function (o) { return textoCelula_(o.nfd); }).filter(String)[0];
  if (nfd) alertas.push('NFD ' + nfd + ' registrada, bloqueio segue aberto');
  return alertas;
}

/**
 * Cruza os bloqueios do relatório com as ocorrências da DATABASE.
 * @param {Array} blocos saída de interpretarRelatorioBloqueios
 * @param {Array} ocorrencias {prot, data, forn, nf, ped, blq, valor, cod, prod, marca, tipo, qtd, obs, formal, dform, status, nfd}
 * @param {string} hoje yyyy-MM-dd
 * @return {{abertos: Array, baixados: Array, fora: Array}}
 */
function cruzarBloqueios(blocos, ocorrencias, hoje) {
  var porNumero = {}, porBloqueio = {};
  blocos.forEach(function (b) { porNumero[b.bloqueio] = b; });
  ocorrencias.forEach(function (o) {
    numerosBloqueio(o.blq).forEach(function (n) { (porBloqueio[n] = porBloqueio[n] || []).push(o); });
  });
  var dias = function (iso) { return diasEntre_(iso, hoje); };
  var vinculados = {};

  var abertos = blocos.filter(function (b) { return b.status === 'Ab'; }).map(function (b) {
    var os = porBloqueio[b.bloqueio] || [], alertas = [], cand = null, col;
    if (os.length) {
      col = colunaDaSituacao_(os);
      alertas = alertasDoBloqueio_(b, os);
    } else {
      var v = vinculoProvavel_(b, ocorrencias, porNumero);
      if (v) {
        col = COL_CONFIRMAR;
        os = [v.o];
        cand = { motivo: 'Mesmo produto e quantidade do protocolo ' + textoCelula_(v.o.prot) + ', mas ' + v.motivo + '.', status: textoCelula_(v.o.status) || SEM_STATUS };
        vinculados[textoCelula_(v.o.prot)] = true;
      } else col = COL_SEM_OCORRENCIA;
    }
    if (b.pend < b.valor - 0.005) alertas.push('Baixa parcial no Santri');
    var iso = isoDeBr_(b.cad);
    return {
      b: b.bloqueio, col: col, forn: nomeFornecedor_(b.fornecedor), ent: b.entrada, data: iso, dias: dias(iso), tipo: tipoBloqueio_(b.tipo),
      valor: b.pend, itens: itensDoCartao_(b, true), occ: os.map(ocorrenciaDoCartao_), alertas: alertas, cand: cand
    };
  });

  var baixados = [];
  blocos.forEach(function (b) {
    if (b.status !== 'Bx') return;
    var os = porBloqueio[b.bloqueio] || [];
    var pendentes = os.filter(function (o) { return !ehFinalizada_(o.status); });
    if (!pendentes.length) return;
    var iso = isoDeBr_(b.cad);
    baixados.push({
      b: b.bloqueio, col: colunaDaSituacao_(pendentes), forn: nomeFornecedor_(b.fornecedor), ent: b.entrada, data: iso, dias: dias(iso),
      baixa: isoDeBr_(b.baixa), tipo: tipoBloqueio_(b.tipo), valor: b.valor, itens: itensDoCartao_(b, false), occ: os.map(ocorrenciaDoCartao_),
      alertas: pendentes.some(function (o) { return textoCelula_(o.nfd); }) ? [] : ['Baixado sem NFD registrada'], cand: null
    });
  });

  var grupos = {}, ordem = [];
  ocorrencias.forEach(function (o) {
    var nums = numerosBloqueio(o.blq), prot = textoCelula_(o.prot);
    if (ehFinalizada_(o.status) || vinculados[prot] || nums.some(function (n) { return porNumero[n]; })) return;
    var chave = nums.length ? nums[0] : 'P' + prot;
    if (!grupos[chave]) { grupos[chave] = []; ordem.push(chave); }
    grupos[chave].push(o);
  });
  var fora = ordem.map(function (chave) {
    var os = grupos[chave], semNumero = chave.charAt(0) === 'P';
    var col = colunaDaSituacao_(os);
    var datas = os.map(function (o) { return dataIso_(o.data); }).filter(String).sort();
    var iso = datas[0] || hoje;
    var alertas = semNumero ? ['Ocorrência sem número de bloqueio'] : [];
    if (normalizar(col) === normalizar('Aguardando transportadora') && !os.some(function (o) { return textoCelula_(o.nfd); })) alertas.push('Sem NFD registrada');
    return {
      b: semNumero ? '' : chave, col: col, forn: nomeFornecedor_(os[0].forn), ent: '', data: iso, dias: dias(iso), tipo: textoCelula_(os[0].tipo),
      // A coluna Valor repete o valor do bloqueio nas linhas dele: somar contaria em dobro.
      valor: Math.max.apply(null, os.map(function (o) { return numeroCelula_(o.valor); })),
      itens: os.map(function (o) {
        return { cod: codigoProdutoBloqueio_(o.cod), nome: textoCelula_(o.prod) || 'Produto não identificado', marca: textoCelula_(o.marca), un: '', qtd: numeroCelula_(o.qtd), vp: null, local: '' };
      }),
      occ: os.map(ocorrenciaDoCartao_), alertas: alertas, cand: null
    };
  });

  return { abertos: abertos, baixados: baixados, fora: fora };
}

// ── relatório para o estoque (pura) ─────────────────────────────────────────

/** Grupos do relatório, na ordem em que aparecem. Os textos são para quem está na pilha, sem termos internos. */
var GRUPOS_ESTOQUE = [
  { id: 'baixa', titulo: 'Ocorrência finalizada', acao: 'Conferir com o Recebimento: a tratativa terminou, mas o bloqueio segue aberto no Santri.', tom: 'aviso' },
  { id: 'coleta', titulo: 'Separar para coleta', acao: 'Deixar separado e identificado. O material aguarda a transportadora.', tom: 'ok' },
  { id: 'nfd', titulo: 'Manter bloqueado: aguardando nota de devolução', acao: 'Não movimentar. A nota de devolução ainda não saiu.', tom: 'info' },
  { id: 'analise', titulo: 'Manter bloqueado: em análise', acao: 'Não movimentar. O caso está em análise e ainda não tem destino definido.', tom: 'neutro' },
  { id: 'sem', titulo: 'Sem ocorrência registrada', acao: 'Não movimentar. O Recebimento precisa registrar a ocorrência. Se o produto não estiver na pilha, avise.', tom: 'erro' }
];

function grupoEstoque_(col) {
  if (col === COL_SEM_OCORRENCIA || col === COL_CONFIRMAR) return 'sem';
  var n = normalizar(col);
  if (n === normalizar(SITUACAO_FINAL)) return 'baixa';
  if (n.indexOf('TRANSPORTADORA') >= 0) return 'coleta';
  return /\bNFD\b/.test(n) ? 'nfd' : 'analise';
}

/**
 * Resumo do que está na pilha: bloqueios abertos e baixados que seguem em tratativa, agrupados pelo que
 * o estoque deve fazer. Sem valores: quem usa precisa saber o que é, onde está e o que fazer.
 * @param {{abertos: Array, baixados: Array, fora: Array}} r saída de cruzarBloqueios
 */
function relatorioEstoque(r) {
  var grupos = GRUPOS_ESTOQUE.map(function (g) {
    return { id: g.id, titulo: g.titulo, acao: g.acao, tom: g.tom, produtos: 0, cartoes: [], situacoes: [] };
  });
  var porLocal = {}, produtos = 0;
  var incluir = function (c) {
    var g = grupos.filter(function (x) { return x.id === grupoEstoque_(c.col); })[0];
    var obs = [];
    if (c.cand) obs.push('Conferir protocolo ' + textoCelula_(c.occ[0].prot));
    if (g.id === 'coleta' && !c.occ.some(function (o) { return o.nfd; })) obs.push('Sem NFD registrada');
    g.produtos += c.itens.length;
    produtos += c.itens.length;
    c.itens.forEach(function (i) {
      var local = i.local || 'Sem local';
      porLocal[local] = (porLocal[local] || 0) + 1;
    });
    var situacao = g.situacoes.filter(function (s) { return s.col === c.col; })[0];
    if (!situacao) { situacao = { col: c.col, bloqueios: 0 }; g.situacoes.push(situacao); }
    situacao.bloqueios++;
    var unicos = function (campo) {
      return c.occ.map(function (o) { return o[campo]; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    };
    g.cartoes.push({
      b: c.b, col: c.col, dias: c.dias, obs: obs, prots: unicos('prot'), nfs: unicos('nf'),
      itens: c.itens.map(function (i) { return { cod: i.cod, nome: i.nome, qtd: i.qtd, un: i.un, local: i.local }; })
    });
  };
  r.abertos.concat(r.baixados).forEach(incluir);
  grupos.forEach(function (g) {
    g.cartoes.sort(function (a, b) { return b.dias - a.dias || Number(a.b) - Number(b.b); });
    g.situacoes.sort(function (a, b) { return b.bloqueios - a.bloqueios; });
  });
  var cheios = grupos.filter(function (g) { return g.cartoes.length; });
  return {
    grupos: cheios,
    bloqueios: cheios.reduce(function (s, g) { return s + g.cartoes.length; }, 0),
    produtos: produtos,
    locais: Object.keys(porLocal).sort(function (a, b) { return porLocal[b] - porLocal[a] || a.localeCompare(b, 'pt-BR'); })
      .map(function (l) { return { local: l, produtos: porLocal[l] }; }),
    fora: r.fora.length,
    foraColeta: r.fora.filter(function (c) { return grupoEstoque_(c.col) === 'coleta'; }).length
  };
}

// ── selos (puras) ───────────────────────────────────────────────────────────

/** Texto do selo sem espaços sobrando; vazio ou longo demais vira "". */
function limparSelo(texto) {
  var s = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
  return s.length > TAMANHO_MAX_SELO ? '' : s;
}

/** Cartão com número de bloqueio ("78652") ou sem número, pelo protocolo ("P2051"). */
function chaveCartaoValida(chave) { return /^P?\d{1,12}$/.test(String(chave)); }

function mesmoSelo_(a, b) { return normalizar(a) === normalizar(b); }

/** Linhas [chave, selo] da aba → {chave: [selos]}, sem repetir o mesmo selo no cartão. */
function selosPorChave(linhas) {
  var mapa = {};
  linhas.forEach(function (l) {
    var chave = String(l[0]).trim(), selo = limparSelo(l[1]);
    if (!chave || !selo) return;
    var lista = mapa[chave] = mapa[chave] || [];
    if (!lista.some(function (s) { return mesmoSelo_(s, selo); })) lista.push(selo);
  });
  return mapa;
}

/** Selos para oferecer: os padrão e depois os usados, em ordem alfabética. */
function opcoesSelos(mapa) {
  var usados = [];
  Object.keys(mapa).forEach(function (k) { usados = usados.concat(mapa[k]); });
  var lista = SELOS_PADRAO.slice();
  usados.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).forEach(function (s) {
    if (!lista.some(function (x) { return mesmoSelo_(x, s); })) lista.push(s);
  });
  return lista;
}

// ── servidor ────────────────────────────────────────────────────────────────

/** Ocorrências da DATABASE no formato de cruzarBloqueios. */
function lerOcorrenciasParaBloqueios_() {
  var d = colunasDados_(), sh = d.sheet, m = d.mapa;
  var cs = colunasStatus_(sh);
  var cab = sh.getRange(CONFIG.LINHA_CABECALHO, 1, 1, sh.getLastColumn()).getValues()[0];
  var extra = mapearCabecalhos(cab, { protocolo: CONFIG.COLUNA_PROTOCOLO, produto: COLUNAS_CONSULTA.produto, marca: COLUNAS_CONSULTA.marca });
  if (extra.faltando.length) throw new Error('Colunas não encontradas na ' + CONFIG.ABA_DADOS + ': ' + extra.faltando.join(', '));
  // Uma coluna basta: linha sem Fornecedor fica de fora do cruzamento de qualquer jeito.
  var ult = ultimaLinhaComDado_(sh, m.fornecedor);
  if (ult < CONFIG.PRIMEIRA_LINHA_DADOS) return [];
  var todas = [m, cs, extra.mapa].reduce(function (l, o) { return l.concat(Object.keys(o).map(function (k) { return o[k]; })); }, []);
  var largura = Math.max.apply(null, todas);
  var vals = sh.getRange(CONFIG.PRIMEIRA_LINHA_DADOS, 1, ult - CONFIG.PRIMEIRA_LINHA_DADOS + 1, largura).getValues();
  var tz = Session.getScriptTimeZone();
  var caixa = caixaFormalizado_(sh, m.status);
  var iso = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : ''; };
  return vals.map(function (v, i) { return { v: v, linha: CONFIG.PRIMEIRA_LINHA_DADOS + i }; }).filter(function (x) {
    return String(x.v[m.fornecedor - 1]).trim() !== '';
  }).map(function (x) {
    var v = x.v;
    return {
      linha: x.linha, prot: v[extra.mapa.protocolo - 1], data: iso(v[m.data - 1]), forn: v[m.fornecedor - 1], nf: v[m.nf - 1], ped: v[m.pedido - 1],
      blq: v[m.bloqueio - 1], valor: v[m.valor - 1], cod: v[m.codProduto - 1], prod: v[extra.mapa.produto - 1], marca: v[extra.mapa.marca - 1],
      tipo: v[m.tipo - 1], qtd: v[m.qtd - 1], obs: v[m.obs - 1], formal: caixa.ehMarcado(v[m.status - 1]),
      dform: iso(v[cs.dataFormalizacao - 1]), status: v[cs.situacao - 1], nfd: v[cs.nfd - 1]
    };
  });
}

/** content.xml de um .ods enviado em base64. */
function conteudoOds_(base64) {
  var arquivos;
  try {
    arquivos = Utilities.unzip(Utilities.newBlob(Utilities.base64Decode(base64), 'application/zip', 'relatorio.zip'));
  } catch (e) {
    throw new Error('Não consegui abrir o arquivo. Envie o .ods exportado do Santri.');
  }
  var conteudo = arquivos.filter(function (b) { return b.getName() === 'content.xml'; })[0];
  if (!conteudo) throw new Error('Este arquivo não é um .ods.');
  return conteudo.getDataAsString('UTF-8');
}

/**
 * Tela Bloqueios: recebe o .ods e devolve o quadro. Só lê a planilha.
 * @param {{nome: string, base64: string}} arquivo
 */
function analisarBloqueios(arquivo) {
  return api_('analisarBloqueios', function () {
    if (!arquivo || typeof arquivo.base64 !== 'string' || !arquivo.base64) throw new Error('Escolha o arquivo do relatório.');
    if (arquivo.base64.length > LIMITE_ODS_BASE64) throw new Error('Arquivo grande demais para este relatório.');
    var t0 = Date.now();
    var relatorio = interpretarRelatorioBloqueios(lerTabelaOds(conteudoOds_(arquivo.base64.replace(/^data:[^,]*,/, ''))));
    var t1 = Date.now();
    var hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var ocorrencias = lerOcorrenciasParaBloqueios_();
    var t2 = Date.now();
    var r = cruzarBloqueios(relatorio.blocos, ocorrencias, hoje);
    var selos = selosPorChave(linhasSelos_());
    registrarLog_('BLOQUEIOS CRUZADOS', usuario_(), JSON.stringify({
      arquivo: String(arquivo.nome || '').slice(0, 120), emitido: relatorio.emitido, bloqueios: relatorio.blocos.length,
      abertos: r.abertos.length, baixados: r.baixados.length, fora: r.fora.length,
      ms: { relatorio: t1 - t0, planilha: t2 - t1, cruzamento: Date.now() - t2 }
    }));
    return {
      abertos: r.abertos, baixados: r.baixados, fora: r.fora, ordem: ORDEM_SITUACOES,
      emitido: relatorio.emitido, filtros: relatorio.filtros, totalBloqueios: relatorio.blocos.length, hoje: hoje,
      selos: selos, selosOpcoes: opcoesSelos(selos), estoque: relatorioEstoque(r),
      lidoEm: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
    };
  });
}

/** Linhas [chave, selo] da aba de selos; sem a aba, nenhuma. */
function linhasSelos_() {
  var sh = aba_(CONFIG.ABA_SELOS, false);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues();
}

/** Aba de selos, criada oculta no primeiro uso. A chave fica como texto para não virar número formatado. */
function abaSelos_() {
  var sh = aba_(CONFIG.ABA_SELOS, false);
  if (sh) return sh;
  sh = planilha_().insertSheet(CONFIG.ABA_SELOS);
  sh.getRange(1, 1, 1, 4).setValues([['Chave', 'Selo', 'Usuário', 'Data']]);
  sh.getRange('A:A').setNumberFormat('@');
  sh.setFrozenRows(1);
  sh.hideSheet();
  return sh;
}

/**
 * Coloca ou tira um selo do cartão. Vale para toda a equipe e fica na LOG_APP.
 * @return {{chave: string, selos: string[], opcoes: string[]}} situação atual, relida da aba
 */
function alterarSeloBloqueio(chave, selo, ligar) {
  return api_('alterarSeloBloqueio', function () {
    chave = String(chave || '').trim();
    var texto = limparSelo(selo);
    if (!chaveCartaoValida(chave)) throw new Error('Cartão inválido. Recarregue a página.');
    if (!texto) throw new Error('Escreva um selo de até ' + TAMANHO_MAX_SELO + ' caracteres.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('A planilha está ocupada. Tente de novo em alguns segundos.');
    try {
      var sh = abaSelos_();
      var linhas = linhasSelos_();
      var doCartao = linhas.filter(function (l) { return String(l[0]).trim() === chave; });
      var existe = doCartao.some(function (l) { return mesmoSelo_(l[1], texto); });
      if (ligar && !existe) {
        if (doCartao.length >= MAX_SELOS_POR_CARTAO) throw new Error('Este cartão já tem ' + MAX_SELOS_POR_CARTAO + ' selos. Tire um antes de colocar outro.');
        sh.getRange(linhas.length + 2, 1, 1, 4).setValues([[chave, texto, usuario_(), new Date()]]);
      } else if (!ligar) {
        for (var i = linhas.length - 1; i >= 0; i--) {
          if (String(linhas[i][0]).trim() === chave && mesmoSelo_(linhas[i][1], texto)) sh.deleteRow(i + 2);
        }
      }
      SpreadsheetApp.flush();
      registrarLog_(ligar ? 'SELO COLOCADO' : 'SELO RETIRADO', usuario_(), JSON.stringify({ cartao: chave, selo: texto }));
      var mapa = selosPorChave(linhasSelos_());
      return { chave: chave, selos: mapa[chave] || [], opcoes: opcoesSelos(mapa) };
    } finally {
      lock.releaseLock();
    }
  });
}
