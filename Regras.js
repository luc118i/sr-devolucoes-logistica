/**
 * Regras de negócio puras: validação do registro, montagem das linhas, duplicidade
 * e casamento item da nota → produto SR. Nada aqui acessa planilha ou Drive.
 *
 * Um registro = uma linha por produto envolvido (como no histórico da planilha).
 * Os dados gerais (data, fornecedor, conferente, NF, pedido, bloqueio, valor) se repetem
 * em todas as linhas do mesmo envio.
 */

/** Valor que conta como "preenchido": não vazio e não um tracinho/ponto de "sem informação". */
function preenchido(v) {
  var s = String(v == null ? '' : v).trim();
  return s !== '' && !/^[-–.\s]+$/.test(s);
}

/** O campo é obrigatório? (CONFIG.OBRIGATORIOS) */
function obrigatorio(campo) {
  return CONFIG.OBRIGATORIOS.indexOf(campo) >= 0;
}

/**
 * Valida o envio e devolve {erros: string[], avisos: string[]}.
 * Os campos exigidos estão em CONFIG.OBRIGATORIOS.
 * @param {Object} p        payload vindo da tela
 * @param {Object} listas   {conferentes: string[], tipos: string[], produto?: function(codigoSR) → {nome, marca}|null}
 */
function validarRegistro(p, listas) {
  var erros = [], avisos = [];
  if (!p || typeof p !== 'object') return { erros: ['Dados do registro ausentes.'], avisos: [] };
  var g = p.geral || {};
  listas = listas || {};

  if (!dataISO(g.data)) { if (obrigatorio('data') || preenchido(g.data)) erros.push('Informe a data da ocorrência.'); }
  else {
    var d = dataISO(g.data), hoje = new Date();
    var amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
    if (d >= amanha) erros.push('A data da ocorrência não pode ser futura.');
  }
  if (obrigatorio('fornecedor') && !preenchido(g.fornecedor)) erros.push('Informe o fornecedor.');
  if (!preenchido(g.conferente)) { if (obrigatorio('conferente')) erros.push('Selecione o conferente.'); }
  else if (listas.conferentes && listas.conferentes.indexOf(g.conferente) < 0) erros.push('Conferente "' + g.conferente + '" não está na lista da aba CONFIG_APP.');
  if (!somenteDigitos(g.nf)) erros.push('Informe o número da nota fiscal.');
  if (obrigatorio('pedido') && !preenchido(g.pedido)) erros.push('Informe o N° do pedido.');
  if (obrigatorio('bloqueio') && !preenchido(g.bloqueio)) erros.push('Informe o bloqueio (número ou S/B).');
  if (!preenchido(g.valor)) { if (obrigatorio('valor')) erros.push('Informe o valor.'); }
  else if (numeroBR(g.valor) === null) erros.push('Valor inválido: use números (ex.: 123,45).');
  else if (numeroBR(g.valor) < 0) erros.push('O valor não pode ser negativo.');

  var itens = Array.isArray(p.itens) ? p.itens : [];
  if (!itens.length) erros.push('Selecione ao menos um produto.');
  if (itens.length > CONFIG.LIMITES.itensPorRegistro) erros.push('Itens demais em um único registro.');

  var vistos = {};
  itens.forEach(function (it, i) {
    var rotulo = 'Item ' + (i + 1) + (it.descricao ? ' (' + String(it.descricao).slice(0, 40) + ')' : '');
    if (!preenchido(it.tipo)) { if (obrigatorio('tipo')) erros.push(rotulo + ': selecione o tipo de ocorrência.'); }
    else if (listas.tipos && listas.tipos.indexOf(it.tipo) < 0) erros.push(rotulo + ': tipo "' + it.tipo + '" não está na lista.');
    var q = numeroBR(it.qtd);
    if (q === null || q <= 0) erros.push(rotulo + ': quantidade deve ser maior que zero.');
    else if (it.qtdNota != null && it.qtdNota !== '' && q > Number(it.qtdNota) + 1e-9) erros.push(rotulo + ': quantidade (' + q + ') maior que a da nota (' + it.qtdNota + ').');
    if (obrigatorio('codIntegracao') && !preenchido(it.codIntegracao)) erros.push(rotulo + ': informe o Cod integração.');

    var cod = somenteDigitos(it.codProduto);
    if (!cod) {
      if (obrigatorio('codProduto')) erros.push(rotulo + ': sem Cod produto (código SR) — use "Buscar no cadastro".');
      else if (!preenchido(it.codIntegracao)) erros.push(rotulo + ': sem código de produto.');
      else avisos.push(rotulo + ': sem código SR — Produto e Marca ficarão em branco na planilha.');
    } else if (listas.produto) {
      var prod = listas.produto(cod);
      if (!prod) erros.push(rotulo + ': Cod produto ' + cod + ' não existe no CADASTRO DE PRODUTOS.');
      else {
        if (obrigatorio('produto') && !preenchido(prod.nome)) erros.push(rotulo + ': o produto ' + cod + ' está sem nome no CADASTRO DE PRODUTOS.');
        if (obrigatorio('marca') && !preenchido(prod.marca)) erros.push(rotulo + ': o produto ' + cod + ' está sem marca no CADASTRO DE PRODUTOS — preencha a marca no cadastro.');
      }
    }
    var k = chaveDuplicidade(g.nf, it);
    if (vistos[k]) erros.push(rotulo + ': o mesmo produto com o mesmo tipo aparece duas vezes neste registro — junte as quantidades.');
    vistos[k] = true;
  });
  return { erros: erros, avisos: avisos };
}

/**
 * Identidade de uma ocorrência para detectar duplicidade:
 * nota fiscal + produto (código SR; sem ele, código de integração) + tipo de ocorrência.
 * O mesmo produto com outro tipo, ou em outra nota, é ocorrência legítima diferente.
 */
function chaveDuplicidade(nf, item) {
  var prod = somenteDigitos(item.codProduto) ? 'SR' + semZerosEsquerda(somenteDigitos(item.codProduto))
    : 'IN' + normalizar(item.codIntegracao).replace(/ /g, '');
  return [semZerosEsquerda(somenteDigitos(nf)), prod, normalizar(item.tipo)].join('|');
}

/**
 * Registros já gravados que batem com os itens do envio.
 * @param {Array<{linha,nf,codProduto,codIntegracao,tipo,data,qtd}>} existentes
 */
function acharDuplicados(p, existentes) {
  var porChave = {};
  existentes.forEach(function (r) {
    var k = chaveDuplicidade(r.nf, r);
    (porChave[k] = porChave[k] || []).push(r);
  });
  var dup = [];
  (p.itens || []).forEach(function (it) {
    var achados = porChave[chaveDuplicidade(p.geral.nf, it)];
    if (achados) achados.forEach(function (r) { dup.push({ item: it.descricao || it.codProduto, linha: r.linha, data: r.data, qtd: r.qtd, tipo: r.tipo }); });
  });
  return dup;
}

/**
 * Linhas a gravar: um objeto por item, com as chaves de CONFIG.COLUNAS.
 * Códigos viram número quando possível (mantém o padrão da planilha e o PROCV do Cod produto);
 * com zero à esquerda ou letras ficam como texto.
 */
function montarLinhas(p, parametros) {
  var g = p.geral;
  var status = String(parametros.STATUS_INICIAL == null ? '' : parametros.STATUS_INICIAL).trim();
  var valor = numeroBR(g.valor);
  return p.itens.map(function (it) {
    return {
      data: dataISO(g.data),
      fornecedor: textoSeguro(g.fornecedor, 120),
      conferente: textoSeguro(g.conferente, 120),
      nf: codigoParaCelula(somenteDigitos(g.nf)),
      pedido: codigoParaCelula(textoSeguro(g.pedido, 60)),
      bloqueio: codigoParaCelula(textoSeguro(g.bloqueio, 60)),
      valor: valor === null ? '' : valor,
      codIntegracao: codigoParaCelula(textoSeguro(it.codIntegracao, 60)),
      codProduto: somenteDigitos(it.codProduto) ? Number(semZerosEsquerda(somenteDigitos(it.codProduto))) : '',
      tipo: textoSeguro(it.tipo, 120),
      qtd: numeroBR(it.qtd),
      obs: textoSeguro(it.obs, CONFIG.LIMITES.tamanhoTexto),
      status: valorStatusInicial(status)
    };
  });
}

/**
 * Valor da coluna R ("Status") para registro novo. A coluna é caixa de seleção (VERDADEIRO/FALSO):
 * "0"/"FALSO"/"FALSE"/"NAO" → false; "1"/"VERDADEIRO"/"TRUE"/"SIM" → true; vazio → não grava (pura).
 */
function valorStatusInicial(v) {
  var n = normalizar(v);
  if (!n) return '';
  if (['0', 'FALSO', 'FALSE', 'NAO', 'N'].indexOf(n) >= 0) return false;
  if (['1', 'VERDADEIRO', 'TRUE', 'SIM', 'S'].indexOf(n) >= 0) return true;
  return String(v).trim();
}

/**
 * Casador item da nota → produto SR, em camadas:
 *   1. EAN do XML igual ao "Código de barras" do cadastro (EAN repetido no cadastro não decide)
 *   2. histórico da planilha: mesmo fornecedor já registrou esse Cod integração com um Cod produto
 *      (só se o histórico for consistente — sempre o mesmo código SR)
 * O nome sozinho nunca casa: a pessoa escolhe na busca.
 * @param {Array<{codigo,nome,marca,ean}>} produtos  cadastro SR
 * @param {Array<{fornecedor,codIntegracao,codProduto}>} historico  linhas da DATABASE
 */
function criarCasador(produtos, historico) {
  var porCodigo = {}, porEan = {}, eanRepetido = {};
  produtos.forEach(function (p) {
    porCodigo[p.codigo] = p;
    if (!p.ean) return;
    var k = semZerosEsquerda(p.ean);
    if (porEan[k] && porEan[k].codigo !== p.codigo) eanRepetido[k] = true;
    porEan[k] = p;
  });
  Object.keys(eanRepetido).forEach(function (k) { delete porEan[k]; });

  var hist = {};
  (historico || []).forEach(function (h) {
    var ci = normalizar(h.codIntegracao).replace(/ /g, '');
    var cp = semZerosEsquerda(somenteDigitos(h.codProduto));
    if (!ci || !cp || !porCodigo[cp]) return;
    var k = normalizar(h.fornecedor) + '|' + ci;
    if (hist[k] === undefined) hist[k] = cp;
    else if (hist[k] !== cp) hist[k] = null; // histórico contraditório: não usa
  });

  return {
    produto: function (codigo) { return porCodigo[semZerosEsquerda(somenteDigitos(codigo))] || null; },
    casar: function (item, fornecedor) {
      if (item.ean) {
        var p = porEan[semZerosEsquerda(item.ean)];
        if (p) return { produto: p, via: 'ean' };
      }
      var h = hist[normalizar(fornecedor) + '|' + normalizar(item.codigo).replace(/ /g, '')];
      if (h) return { produto: porCodigo[h], via: 'historico' };
      return null;
    },
    buscar: function (consulta, limite) {
      var norm = normalizar(consulta), lim = limite || 20, achados = [];
      if (!norm) return achados;
      var dig = norm.replace(/ /g, '');
      if (/^\d+$/.test(dig)) {
        var porCod = porCodigo[semZerosEsquerda(dig)];
        if (porCod) achados.push(porCod);
        var porE = porEan[semZerosEsquerda(dig)];
        if (porE && porE !== porCod) achados.push(porE);
        if (achados.length) return achados;
      }
      var tokens = norm.split(' ');
      for (var i = 0; i < produtos.length && achados.length < lim; i++) {
        var n = produtos[i]._norm || (produtos[i]._norm = normalizar(produtos[i].nome + ' ' + produtos[i].marca));
        if (tokens.every(function (t) { return n.indexOf(t) >= 0; })) achados.push(produtos[i]);
      }
      return achados;
    }
  };
}

/** Nome do fornecedor para a planilha: apelido cadastrado (CNPJ completo ou raiz de 8 dígitos) ou o nome do XML. */
function nomeFornecedor(cnpj, apelidos, nomeXml, fantasiaXml) {
  var c = somenteDigitos(cnpj);
  for (var i = 0; i < apelidos.length; i++) {
    var a = somenteDigitos(apelidos[i][0]);
    if (a && (a === c || (a.length === 8 && c.indexOf(a) === 0))) return String(apelidos[i][1]).trim();
  }
  return fantasiaXml || nomeXml || '';
}

/**
 * Nome de conferente novo: espaços extras removidos, só letras (com acento), espaço, ponto,
 * hífen e apóstrofo, 3 a 60 caracteres, e não pode repetir um da lista (ignorando maiúsculas/acentos).
 * @return {{nome: string, erro: string}}
 */
function validarNomeConferente(nome, existentes) {
  var s = String(nome == null ? '' : nome).replace(/\s+/g, ' ').trim();
  if (s.length < 3) return { nome: s, erro: 'Informe o nome do conferente (mínimo 3 letras).' };
  if (s.length > 60) return { nome: s, erro: 'Nome do conferente muito longo (máximo 60 caracteres).' };
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'-]*$/.test(s)) return { nome: s, erro: 'Use só letras no nome do conferente.' };
  var k = normalizar(s);
  var igual = (existentes || []).filter(function (e) { return normalizar(e) === k; })[0];
  if (igual) return { nome: s, erro: 'O conferente "' + String(igual).trim() + '" já está na lista.' };
  return { nome: s, erro: '' };
}
