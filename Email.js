/**
 * Interpretador do e-mail de ocorrência da equipe de entrada de notas
 * ("Seguem dados Ref. ocorrência da NF: … - SR Recebimento / Fracionados").
 *
 * Funções PURAS (sem planilha/Drive): recebem o texto colado (e, se houver, o HTML
 * da área de transferência) e devolvem os campos encontrados, cada um com um status:
 *   ok        identificado com segurança
 *   ausente   o e-mail não traz a informação
 *   confirmar existe, mas precisa de conferência (valor de modelo, ambíguo, fora da lista…)
 *   conflito  o e-mail traz valores diferentes para a mesma informação
 * Nada é inventado: campo sem evidência fica vazio.
 *
 * Para suportar uma nova variação de e-mail, ajuste os ROTULOS_EMAIL / MARCAS_EMAIL abaixo.
 */

/** Rótulos aceitos para cada campo (comparados sem acento, em maiúsculas). */
var ROTULOS_EMAIL = {
  nf: ['NF DE ENTRADA', 'NOTA FISCAL DE ENTRADA', 'NOTA FISCAL', 'NF ENTRADA', 'NFE', 'NF'],
  pedido: ['PEDIDO', 'N PEDIDO', 'NO PEDIDO', 'NUMERO DO PEDIDO', 'PEDIDOS'],
  bloqueio: ['BLOQUEIO', 'N BLOQUEIO', 'NO BLOQUEIO'],
  fornecedor: ['FORNECEDOR'],
  conferente: ['CONFERENTE', 'CONFERIDO POR'],
  formatadoPor: ['E MAIL FORMATADO POR', 'EMAIL FORMATADO POR', 'FORMATADO POR'],
  dataOcorrencia: ['DATA DA OCORRENCIA', 'DATA OCORRENCIA']
};
var SECOES_EMAIL = { tipos: ['TIPO DE OCORRENCIA', 'TIPOS DE OCORRENCIA'], itens: ['DESCRICAO DO ITEM', 'DESCRICAO DOS ITENS', 'DESCRICAO DO PRODUTO'] };
var FIM_EMAIL = /^(ATT|ATENCIOSAMENTE|OBRIGAD|GRATO|CORDIALMENTE|ABRACO|ABS)\b/;

/** Categorias do modelo de e-mail (as da CONFIG_APP também valem). */
var CATEGORIAS_EMAIL = ['Produto faltando dentro dos volumes', 'Produto avariado/danificado', 'Produto em desacordo/trocado',
  'Faltando volumes', 'Material com defeito'];

/** Marcas que indicam opção SELECIONADA antes/depois do texto. Marcadores neutros (-, •, *) não contam. */
var MARCAS_EMAIL = {
  antes: /^\s*(\[\s*[xX✓✔]\s*\]|\(\s*[xX✓✔]\s*\)|[xX]\s*[\)\]\-–:]|[☒☑✔✓✅■◉●▶►➔➜→»]|-+>|=>)\s*/,
  depois: /\s*(\(\s*[xX✓✔]\s*\)|\[\s*[xX✓✔]\s*\]|<-+|<=|←|[☒☑✔✓✅]|\bSELECIONAD[OA]\b|\bMARCAD[OA]\b)\s*$/i,
  vazio: /^\s*(\[\s*\]|\(\s*\)|[☐□○◯]|[-–•*·o]\s)\s*/
};

/** Linha do produto: "02 UNIDADE(S) DO PRODUTO: 175.192 / 69514 - CUBA …" e variações. */
var RE_PRODUTO = /^(\d+(?:[.,]\d+)?)\s*(?:UNIDADE\s*\(\s*S\s*\)|UNIDADES?|UNID\.?|UN\.?|PE[CÇ]A\s*\(\s*S\s*\)|PE[CÇ]AS?|P[CÇ]S?\.?|CAIXAS?|CX\.?|VOLUMES?|M2|M²|KG|L|LITROS?|BARRAS?|ROLOS?|LATAS?|SACOS?)?\s*(?:DO|DE|DA)?\s*(?:PRODUTO|ITEM|MATERIAL)?\s*[:\-–]?\s*(.*)$/i;

/** HTML colado → texto com quebras de linha (pura). */
function htmlParaTexto(html) {
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<input[^>]*checked[^>]*>/gi, '[x] ')
    .replace(/<input[^>]*type=["']?checkbox[^>]*>/gi, '[ ] ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); });
}

/** Textos destacados no HTML (negrito, marca-texto, cor) — evidência de seleção (pura). */
function destaquesHtml(html) {
  var out = [];
  var re = /<(b|strong|mark|u|span|font)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var tag = m[1].toLowerCase(), attrs = (m[2] || '').toLowerCase();
    var destacado = tag === 'b' || tag === 'strong' || tag === 'mark' || tag === 'u' ||
      /background|font-weight\s*:\s*(bold|[6-9]00)/.test(attrs) ||
      (/color\s*[:=]/.test(attrs) && !/color\s*[:=]\s*["']?\s*(#0{3,6}|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|#222|#333|windowtext)/.test(attrs));
    if (destacado) out.push(normalizar(htmlParaTexto(m[3])));
  }
  return out.filter(String);
}

/** Só dígitos de um identificador com pontos ("3.124.304" → "3124304"); preserva zeros à esquerda (pura). */
function idEmail(bruto) {
  var s = String(bruto || '').trim();
  var m = /[0-9][0-9.\s]*[0-9]|[0-9]/.exec(s);
  return m ? m[0].replace(/[.\s]/g, '') : '';
}

/** "0.000.000", "00000": modelo sem preencher (pura). */
function pareceModelo(id) { return /^0+$/.test(String(id || '')); }

function campoEmail(valor, status, nota, extra) {
  var c = { valor: valor == null ? '' : String(valor), status: status, nota: nota || '' };
  Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
  return c;
}

/** Linha → {rotulo, valor} se for "RÓTULO: valor" de um dos rótulos conhecidos. */
function lerRotulo_(linha) {
  var i = linha.indexOf(':');
  var cab = normalizar(i >= 0 ? linha.slice(0, i) : linha);
  var campos = Object.keys(ROTULOS_EMAIL);
  for (var c = 0; c < campos.length; c++) {
    var lista = ROTULOS_EMAIL[campos[c]];
    for (var k = 0; k < lista.length; k++) {
      if (cab === lista[k]) return { campo: campos[c], valor: i >= 0 ? linha.slice(i + 1).trim() : '' };
    }
  }
  return null;
}

function ehSecao_(linha, nomes) {
  var dois = String(linha).indexOf(':');
  var n = normalizar(dois >= 0 ? String(linha).slice(0, dois) : linha);
  return nomes.some(function (s) { return n === s || n.indexOf(s) === 0 && n.length - s.length < 4; });
}

/** Categoria escrita na linha (sem marcadores), ou null. */
function categoriaDaLinha_(linha, categorias) {
  var limpa = linha.replace(MARCAS_EMAIL.antes, '').replace(MARCAS_EMAIL.vazio, '').replace(MARCAS_EMAIL.depois, '');
  var n = normalizar(limpa);
  if (!n) return null;
  for (var i = 0; i < categorias.length; i++) {
    var c = normalizar(categorias[i]);
    if (n === c) return categorias[i];
  }
  return null;
}

/** "15/10/2026", "2026-10-15", "15 de out. de 2026", "qui., 15 de outubro de 2026 14:32" → "2026-10-15" (pura). */
function dataDoTexto(t) {
  var s = String(t || '');
  var m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) return montarIso_(m[3], m[2], m[1]);
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return montarIso_(m[1], m[2], m[3]);
  var meses = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  var n = normalizar(s);
  m = /(\d{1,2}) DE ([A-Z]{3})[A-Z]* DE (\d{4})/.exec(n);
  if (m && meses.indexOf(m[2]) >= 0) return montarIso_(m[3], meses.indexOf(m[2]) + 1, m[1]);
  return '';
}
function montarIso_(a, m, d) {
  a = String(a); if (a.length === 2) a = '20' + a;
  var iso = a + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  return dataISO(iso) ? iso : '';
}

/**
 * Interpreta o e-mail.
 * @param {string} texto  conteúdo colado (assunto + corpo)
 * @param {string} html   HTML da área de transferência, se houver (melhora a detecção de seleção)
 * @param {{tipos?: string[], conferentes?: string[]}} listas
 * @return {{campos, tiposMarcados, itens, avisos, informativos}}
 */
function interpretarEmailOcorrencia(texto, html, listas) {
  listas = listas || {};
  var bruto = String(texto || '');
  if (!bruto.trim() && html) bruto = htmlParaTexto(html);
  var linhas = bruto.replace(/\r/g, '').replace(/ /g, ' ').split('\n')
    .map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); });
  var avisos = [], informativos = [];

  // Categorias conhecidas: as do e-mail + as da CONFIG_APP (sem repetir).
  var categorias = CATEGORIAS_EMAIL.slice();
  (listas.tipos || []).forEach(function (t) {
    if (!categorias.some(function (c) { return normalizar(c) === normalizar(t); })) categorias.push(t);
  });
  var paraLista = function (cat) {
    var t = (listas.tipos || []).filter(function (x) { return normalizar(x) === normalizar(cat); })[0];
    return t || cat;
  };

  // ── Assunto, remetente e data do e-mail ──
  var assunto = '', remetente = '', dataEnvio = '';
  linhas.forEach(function (l) {
    var n = normalizar(l);
    if (!assunto && /^(ASSUNTO|SUBJECT)\b/.test(n)) assunto = l.replace(/^[^:]*:\s*/, '');
    else if (!assunto && /REF\.?\s*OCORR[EÊ]NCIA/i.test(l)) assunto = l;
    if (!remetente && /^(DE|FROM|REMETENTE)\b/.test(n) && /@/.test(l)) remetente = (/[\w.+-]+@[\w.-]+/.exec(l) || [''])[0];
    if (!dataEnvio && /^(ENVIADO EM|ENVIADA EM|DATA|DATE|SENT|EM)\b/.test(n) && !/OCORRENCIA/.test(n)) dataEnvio = dataDoTexto(l);
  });
  if (!remetente) { var r = /[\w.+-]+@[\w.-]+\.\w+/.exec(bruto); if (r) remetente = r[0]; }
  if (!dataEnvio) {
    var g = linhas.filter(function (l) { return /\b\d{1,2} de [a-zç]{3}/i.test(l) && /\d{4}/.test(l); })[0];
    if (g) dataEnvio = dataDoTexto(g);
  }

  // ── Campos rotulados (o valor fica na mesma linha; se vazio, a próxima linha só vale se não for outro rótulo/seção) ──
  var achados = {};
  for (var i = 0; i < linhas.length; i++) {
    var rot = lerRotulo_(linhas[i]);
    if (!rot) continue;
    var v = rot.valor;
    if (!v) {
      var prox = linhas.slice(i + 1).filter(function (x) { return x; })[0] || '';
      var j = linhas.indexOf(prox, i + 1);
      var proxEhEstrutura = !prox || lerRotulo_(prox) || ehSecao_(prox, SECOES_EMAIL.tipos) || ehSecao_(prox, SECOES_EMAIL.itens) ||
        FIM_EMAIL.test(normalizar(prox)) || categoriaDaLinha_(prox, categorias) || RE_PRODUTO.test(prox) && /\d/.test(prox.charAt(0));
      // só aceita a linha seguinte se ela estiver logo abaixo (no máximo uma linha em branco)
      if (!proxEhEstrutura && j - i <= 2) v = prox;
    }
    (achados[rot.campo] = achados[rot.campo] || []).push(v);
  }

  var campos = {};
  // Identificadores: NF, pedido, bloqueio
  ['nf', 'pedido', 'bloqueio'].forEach(function (k) {
    var vals = (achados[k] || []).filter(function (x) { return String(x).trim(); });
    if (!vals.length) { campos[k] = campoEmail('', 'ausente', 'Não informado no e-mail.'); return; }
    var bruto0 = vals[0];
    var semBloqueio = k === 'bloqueio' && /^\s*(S\s*\/\s*B|SEM BLOQUEIO)\s*$/i.test(bruto0);
    var id = semBloqueio ? 'S/B' : idEmail(bruto0);
    var outros = vals.map(function (x) { return k === 'bloqueio' && /^\s*S\s*\/\s*B\s*$/i.test(x) ? 'S/B' : idEmail(x); })
      .filter(function (x, p, arr) { return x && arr.indexOf(x) === p; });
    if (!id) campos[k] = campoEmail('', 'confirmar', 'Valor sem número: "' + bruto0 + '".', { bruto: bruto0 });
    else if (pareceModelo(id)) campos[k] = campoEmail('', 'confirmar', 'O e-mail traz "' + bruto0 + '", que parece o modelo sem preencher.', { bruto: bruto0 });
    else if (outros.length > 1) campos[k] = campoEmail(id, 'conflito', 'O e-mail traz mais de um valor: ' + outros.join(', ') + '.', { alternativas: outros });
    else if ((bruto0.match(/\d[\d.]*/g) || []).length > 1 && !semBloqueio) campos[k] = campoEmail(id, 'confirmar', 'A linha tem mais de um número: "' + bruto0 + '".', { bruto: bruto0 });
    else campos[k] = campoEmail(id, 'ok', '', { bruto: bruto0 });
  });

  // NF do assunto × corpo
  var nfAssunto = '';
  var ma = /\bNF\b\s*(?:DE ENTRADA)?\s*[:º°n.]*\s*([\d][\d.]*)/i.exec(assunto);
  if (ma) nfAssunto = idEmail(ma[1]);
  if (nfAssunto && !pareceModelo(nfAssunto)) {
    var cnf = campos.nf;
    if (cnf.status === 'ausente' || (cnf.status === 'confirmar' && !cnf.valor)) {
      campos.nf = campoEmail(nfAssunto, 'confirmar', 'Encontrada só no assunto do e-mail.', { origem: 'assunto' });
    } else if (cnf.valor && semZerosEsquerda(cnf.valor) !== semZerosEsquerda(nfAssunto)) {
      campos.nf = campoEmail(cnf.valor, 'conflito', 'Assunto diz NF ' + nfAssunto + ' e o corpo diz NF ' + cnf.valor + '.', { alternativas: [cnf.valor, nfAssunto] });
    }
  }
  ['pedido', 'bloqueio'].forEach(function (k) {
    if (campos.nf.valor && campos[k].valor && semZerosEsquerda(campos[k].valor) === semZerosEsquerda(campos.nf.valor)) {
      campos[k] = campoEmail(campos[k].valor, 'confirmar', 'Igual ao número da NF — confira se não foi copiado no lugar errado.');
    }
  });

  // Textos: fornecedor, conferente, formatado por
  ['fornecedor', 'conferente', 'formatadoPor'].forEach(function (k) {
    var vals = (achados[k] || []).map(function (x) { return String(x).trim(); }).filter(String);
    if (!vals.length) { campos[k] = campoEmail('', 'ausente', 'Não informado no e-mail.'); return; }
    var dif = vals.filter(function (x, p) { return vals.map(normalizar).indexOf(normalizar(x)) === p; });
    campos[k] = dif.length > 1 ? campoEmail(dif[0], 'conflito', 'Valores diferentes: ' + dif.join(' / ') + '.', { alternativas: dif })
      : campoEmail(vals[0], 'ok');
  });
  if (campos.formatadoPor.valor) campos.formatadoPor.nota = 'A planilha não tem coluna para isso: só para conferência, não será gravado.';

  // Conferente precisa estar na lista da CONFIG_APP
  if (campos.conferente.valor && listas.conferentes && listas.conferentes.length) {
    var nc = normalizar(campos.conferente.valor);
    var exato = listas.conferentes.filter(function (c) { return normalizar(c) === nc; })[0];
    var parecidos = listas.conferentes.filter(function (c) {
      var a = normalizar(c); return a !== nc && (a.indexOf(nc) === 0 || nc.indexOf(a) === 0 || a.split(' ')[0] === nc.split(' ')[0]);
    });
    if (exato) campos.conferente = campoEmail(exato, 'ok');
    else campos.conferente = campoEmail(campos.conferente.valor, 'confirmar',
      parecidos.length ? 'Não está na lista; parecido(s): ' + parecidos.join(', ') + '.' : 'Não está na lista de conferentes — escolha ou cadastre.',
      { sugestoes: parecidos });
  }

  // Data da ocorrência: só se o e-mail disser explicitamente; a data de envio vira sugestão.
  var dOc = (achados.dataOcorrencia || []).map(dataDoTexto).filter(String)[0] || '';
  if (dOc) campos.data = campoEmail(dOc, 'ok', 'Data da ocorrência informada no e-mail.');
  else campos.data = campoEmail('', 'ausente', dataEnvio
    ? 'O e-mail não informa a data da ocorrência. Ele foi enviado em ' + dataEnvio.split('-').reverse().join('/') + ' — confirme qual data usar.'
    : 'O e-mail não informa a data da ocorrência: vale a regra padrão (data de hoje, editável).', { dataEnvio: dataEnvio });

  // ── Seção TIPO DE OCORRÊNCIA: só conta opção com marca de seleção / destaque ──
  var iTipos = -1, iItens = -1;
  linhas.forEach(function (l, k) {
    if (iTipos < 0 && ehSecao_(l, SECOES_EMAIL.tipos)) iTipos = k;
    if (iItens < 0 && ehSecao_(l, SECOES_EMAIL.itens)) iItens = k;
  });
  var tiposMarcados = [], listados = [];
  if (iTipos >= 0) {
    // "TIPO DE OCORRÊNCIA: PRODUTO AVARIADO/DANIFICADO" na mesma linha = escolha explícita
    var dois = linhas[iTipos].indexOf(':');
    var naLinha = dois >= 0 ? categoriaDaLinha_(linhas[iTipos].slice(dois + 1), categorias) : null;
    if (naLinha) tiposMarcados.push(paraLista(naLinha));
    var fimTipos = iItens > iTipos ? iItens : linhas.length;
    for (var t = iTipos + 1; t < fimTipos; t++) {
      var l = linhas[t];
      if (!l) continue;
      if (lerRotulo_(l) || FIM_EMAIL.test(normalizar(l))) break;
      var cat = categoriaDaLinha_(l, categorias);
      if (!cat) continue;
      listados.push(cat);
      if (MARCAS_EMAIL.antes.test(l) || MARCAS_EMAIL.depois.test(l)) tiposMarcados.push(paraLista(cat));
    }
    // HTML: destaque (negrito/cor/marca-texto) em PARTE das opções = seleção; em todas = só formatação.
    if (!tiposMarcados.length && html && listados.length) {
      var dest = destaquesHtml(html);
      var marcadosHtml = listados.filter(function (c) { return dest.indexOf(normalizar(c)) >= 0; });
      if (marcadosHtml.length && marcadosHtml.length < listados.length) tiposMarcados = marcadosHtml.map(paraLista);
    }
  }
  tiposMarcados = tiposMarcados.filter(function (x, p, a) { return a.indexOf(x) === p; });

  // ── Itens: linhas "N UNIDADE(S) DO PRODUTO: código / código - descrição" ──
  var itens = [];
  var inicioItens = iItens >= 0 ? iItens + 1 : 0;
  var tipoAtual = null, obsSoltas = [];
  for (var p = inicioItens; p < linhas.length; p++) {
    var lp = linhas[p];
    if (!lp) continue;
    if (FIM_EMAIL.test(normalizar(lp))) break;
    if (iItens < 0 && (p <= iTipos || lerRotulo_(lp))) continue;
    var catL = categoriaDaLinha_(lp, categorias);
    if (catL) {
      if (iItens >= 0 || !(iTipos >= 0 && p < (iItens > 0 ? iItens : linhas.length) && listados.length)) tipoAtual = paraLista(catL);
      continue;
    }
    var item = lerLinhaProduto(lp);
    if (item) {
      item.tipoExplicito = tipoAtual;
      itens.push(item);
    } else if (iItens >= 0 && !lerRotulo_(lp) && !ehSecao_(lp, SECOES_EMAIL.tipos)) {
      if (itens.length) itens[itens.length - 1].obsExtra.push(lp); else obsSoltas.push(lp);
    }
  }

  itens.forEach(function (it) {
    var tipo;
    if (it.tipoExplicito) {
      tipo = campoEmail(it.tipoExplicito, 'ok', 'Categoria escrita junto do item.');
      if (tiposMarcados.length && tiposMarcados.indexOf(it.tipoExplicito) < 0) {
        tipo = campoEmail(it.tipoExplicito, 'conflito', 'No item está "' + it.tipoExplicito + '", mas a opção marcada foi "' + tiposMarcados.join(', ') + '".',
          { alternativas: [it.tipoExplicito].concat(tiposMarcados) });
      }
    } else if (tiposMarcados.length === 1) tipo = campoEmail(tiposMarcados[0], 'ok', 'Opção marcada em "Tipo de ocorrência".');
    else if (tiposMarcados.length > 1) tipo = campoEmail('', 'confirmar', 'Mais de uma opção marcada (' + tiposMarcados.join(', ') + ') e o item não diz qual é a dele.', { alternativas: tiposMarcados });
    else tipo = campoEmail('', 'confirmar', listados.length ? 'O e-mail lista todas as opções sem indicar qual foi marcada — escolha.' : 'O e-mail não indica o tipo — escolha.',
      { alternativas: categorias.map(paraLista) });
    it.tipo = tipo;
    it.obs = it.obsExtra.join(' ').trim();
    delete it.obsExtra; delete it.tipoExplicito;
  });

  if (!itens.length) avisos.push('Nenhuma linha de produto reconhecida (formato esperado: "02 UNIDADE(S) DO PRODUTO: 175.192 / 69514 - descrição"). Adicione os produtos pela nota ou pelo cadastro.');
  if (obsSoltas.length) informativos.push('Texto da descrição sem produto associado: "' + obsSoltas.join(' ').slice(0, 300) + '".');
  if (tiposMarcados.length > 1 && itens.length && itens.every(function (x) { return x.tipo.status === 'ok'; })) {
    informativos.push('Mais de uma categoria marcada; cada produto ficou com a sua própria categoria.');
  }
  if (assunto) {
    var setor = /-\s*([^-]+)$/.exec(assunto);
    informativos.push('Assunto: ' + assunto + (setor ? ' (setor: ' + setor[1].trim() + ')' : ''));
  }
  if (remetente) informativos.push('Remetente: ' + remetente + ' (não é usado como conferente).');

  var reconheceu = Object.keys(campos).some(function (k) { return campos[k].status === 'ok'; }) || itens.length;
  if (!reconheceu) avisos.unshift('O texto não parece o e-mail de ocorrência esperado: nenhum campo foi reconhecido.');

  return { campos: campos, tiposMarcados: tiposMarcados, tiposListados: listados, itens: itens, avisos: avisos, informativos: informativos, assunto: assunto, remetente: remetente };
}

/**
 * Uma linha de produto → {qtd, codProduto, codIntegracao, descricao, status, nota, bruto, obsExtra}, ou null (pura).
 * "02 UNIDADE(S) DO PRODUTO: 175.192 / 69514 - CUBA …": antes da barra = código SR (Cod produto),
 * depois da barra = código do fornecedor (Cod integração).
 */
function lerLinhaProduto(linha) {
  var l = String(linha || '').replace(MARCAS_EMAIL.vazio, '').trim();
  if (!/^\d/.test(l)) return null;
  var m = RE_PRODUTO.exec(l);
  if (!m) return null;
  var temUnidade = /UNIDADE|UNID|\bUN\b|PE[CÇ]A|\bP[CÇ]S?\b|CAIXA|\bCX\b|VOLUME|PRODUTO|ITEM|MATERIAL/i.test(l.slice(0, l.length - m[2].length));
  if (!temUnidade) return null;
  var qtd = String(Number(m[1].replace(',', '.'))); // quantidade é número (não identificador): "02" → "2"
  var resto = m[2].trim();
  var it = { qtd: qtd, codProduto: '', codIntegracao: '', descricao: '', status: 'ok', nota: '', bruto: linha, obsExtra: [] };
  var mc = /^([\w.\-]+)\s*\/\s*([\w.\-]+)\s*(?:[-–—:]\s*(.*))?$/.exec(resto) || /^([\d.]+)\s*(?:[-–—:]\s*(.*))?$/.exec(resto);
  if (!mc) {
    it.status = 'confirmar';
    it.nota = 'Não consegui separar os códigos: "' + resto + '". Confira o produto.';
    it.descricao = resto;
  } else if (mc.length === 4) {
    it.codProduto = idEmail(mc[1]) === mc[1].replace(/\./g, '') ? idEmail(mc[1]) : mc[1];
    it.codIntegracao = mc[2].replace(/\.$/, '');
    it.descricao = (mc[3] || '').trim().replace(/\.$/, '');
    if (!/^\d+$/.test(it.codProduto)) { it.status = 'confirmar'; it.nota = 'Código antes da barra não é numérico: "' + mc[1] + '".'; }
  } else {
    it.codProduto = idEmail(mc[1]);
    it.descricao = (mc[2] || '').trim().replace(/\.$/, '');
    it.status = 'confirmar';
    it.nota = 'Só um código no e-mail ("' + mc[1] + '"): confira se é o código SR e informe o Cod integração.';
  }
  if (Number(qtd) <= 0) { it.status = 'confirmar'; it.nota = (it.nota ? it.nota + ' ' : '') + 'Quantidade zero no e-mail.'; }
  if ((it.codProduto && pareceModelo(it.codProduto)) || (it.codIntegracao && pareceModelo(it.codIntegracao))) {
    it.status = 'confirmar';
    it.nota = 'Códigos parecem o modelo sem preencher ("' + resto + '").';
    if (pareceModelo(it.codProduto)) it.codProduto = '';
    if (pareceModelo(it.codIntegracao)) it.codIntegracao = '';
  }
  return it;
}
