/**
 * Ponto de entrada do Web App e funções chamadas pela tela (google.script.run).
 * Toda função pública passa por `api_`: erros viram mensagem objetiva para a tela
 * e ficam registrados (LOG_APP + Stackdriver) com um código para localizar.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(CONFIG.NOME_APP)
    .setFaviconUrl(CONFIG.FAVICON_URL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function incluir_(arquivo) {
  return HtmlService.createHtmlOutputFromFile(arquivo).getContent();
}

/** Conta cujas permissões o Web App usa (a de quem implantou, em "Executar como: Eu"). */
function executaComo_() {
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function usuario_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function api_(nome, fn) {
  try {
    return fn();
  } catch (e) {
    var codigo = Utilities.getUuid().slice(0, 8);
    console.error('[' + codigo + '] ' + nome + ': ' + (e && e.stack || e));
    registrarLog_('ERRO ' + nome, usuario_(), '[' + codigo + '] ' + (e && e.message || e) + ' (versão ' + CONFIG.VERSAO + ', executa como ' + executaComo_() + ')');
    var msg = e && e.message ? e.message : String(e);
    if (/permiss(ão|ion)[\s\S]*googleapis\.com\/auth\//i.test(msg)) {
      msg = 'A conta que executa o Web App (' + executaComo_() + ') ainda não autorizou esta permissão do Google (' +
        (msg.match(/googleapis\.com\/auth\/[\w.]*\w/) || [''])[0] + '). No editor do Apps Script, rode a função ' +
        '"verificarPermissoes" logado com essa conta, aceite a autorização e depois clique em "Tentar de novo".';
    }
    throw new Error(msg + ' (código ' + codigo + ')');
  }
}

/** Dados para abrir a tela. */
function iniciar() {
  return api_('iniciar', function () {
    var cfg = lerConfigApp_();
    return {
      conferentes: cfg.conferentes,
      tipos: cfg.tipos,
      usuario: usuario_(),
      hoje: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      pastaConfigurada: !!cfg.parametros.PASTA_XML_ID,
      versao: CONFIG.VERSAO,
      executaComo: executaComo_(),
      statusOpcoes: opcoesStatus_(),
      statusComNfd: SITUACOES_COM_NFD,
      email: (function (e) { return { nome: e.nome, para: e.para, cc: e.cc, temAssinatura: !!e.assinaturaId }; })(configEmail_())
    };
  });
}

/**
 * Procura a nota pelo número na pasta de XMLs.
 * @return {{status:'UMA', nota}|{status:'VARIAS', opcoes}|{status:'NENHUMA'}}
 */
function buscarNota(numero) {
  return api_('buscarNota', function () {
    var n = somenteDigitos(numero);
    if (!n || n.length > 9) throw new Error('Número de nota inválido.');
    var achadas = procurarNoIndice_(n);
    if (!achadas.length && atualizarIndiceXml_(false)) achadas = procurarNoIndice_(n);
    if (!achadas.length) return { status: 'NENHUMA', numero: n };
    if (achadas.length === 1) return { status: 'UMA', nota: abrirNota_(achadas[0].fileId) };
    var apelidos = lerConfigApp_().fornecedores;
    return {
      status: 'VARIAS',
      opcoes: achadas.map(function (a) {
        return { fileId: a.fileId, numero: a.numero, serie: a.serie, cnpj: a.cnpj, fornecedor: nomeFornecedor(a.cnpj, apelidos, '', '') || formatarCnpj_(a.cnpj) };
      })
    };
  });
}

/** Abre uma nota escolhida entre várias com o mesmo número. */
function abrirNota(fileId) {
  return api_('abrirNota', function () { return abrirNota_(String(fileId || '')); });
}

/** XML anexado na tela (quando a nota não está na pasta). */
function lerXmlEnviado(texto) {
  return api_('lerXmlEnviado', function () {
    if (typeof texto !== 'string' || texto.length > CONFIG.LIMITES.tamanhoXml) throw new Error('Arquivo inválido ou grande demais.');
    return prepararNota_(lerNfe(texto), null);
  });
}

/**
 * Cadastra um conferente novo no fim da lista (coluna A da CONFIG_APP).
 * @return {{nome: string, conferentes: string[]}|{erro: string}} nome gravado e a lista atualizada, ou o motivo da recusa
 */
function cadastrarConferente(nome) {
  return api_('cadastrarConferente', function () {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('A planilha está ocupada. Tente de novo em alguns segundos.');
    try {
      limparCache();
      var r = validarNomeConferente(nome, lerConfigApp_().conferentes);
      if (r.erro) return { erro: r.erro };
      var sh = aba_(CONFIG.ABA_CONFIG);
      var n = Math.max(sh.getLastRow() - 1, 0);
      var colA = n ? sh.getRange(2, 1, n, 1).getDisplayValues() : [];
      var ultima = 0;
      colA.forEach(function (v, i) { if (String(v[0]).trim()) ultima = i + 1; });
      sh.getRange(2 + ultima, 1).setNumberFormat('@').setValue(r.nome);
      limparCache();
      registrarLog_('NOVO CONFERENTE', usuario_(), r.nome);
      return { nome: r.nome, conferentes: lerConfigApp_().conferentes };
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * Importação por e-mail: interpreta o texto colado e completa com o que o sistema sabe
 * (cadastro SR, histórico de códigos, XML da nota, ocorrências já registradas).
 * Não grava nada — o registro segue o fluxo normal (registrar).
 */
function interpretarEmail(texto, html) {
  return api_('interpretarEmail', function () {
    texto = String(texto || '').slice(0, 200000);
    html = String(html || '').slice(0, 1000000);
    if (!texto.trim() && !html.trim()) throw new Error('Cole o conteúdo do e-mail.');
    var cfg = lerConfigApp_();
    var r = interpretarEmailOcorrencia(texto, html, { tipos: cfg.tipos, conferentes: cfg.conferentes });

    var d = colunasDados_();
    var registros = lerRegistros_(d.sheet, d.mapa, proximaLinha_(d.sheet, d.mapa) - 1);
    var casador = criarCasador(lerCadastro_(), registros);
    var fornecedor = r.campos.fornecedor.valor;

    r.itens.forEach(function (it) {
      var p = it.codProduto && /^\d+$/.test(it.codProduto) ? casador.produto(it.codProduto) : null;
      var pelaIntegracao = it.codIntegracao ? casador.casar({ codigo: it.codIntegracao, ean: '' }, fornecedor) : null;
      if (p) {
        it.sr = { codigo: p.codigo, nome: p.nome, marca: p.marca, via: 'email' };
        if (pelaIntegracao && pelaIntegracao.produto.codigo !== p.codigo) {
          it.status = 'confirmar';
          it.nota = (it.nota ? it.nota + ' ' : '') + 'No histórico, o Cod integração ' + it.codIntegracao + ' é do produto SR ' +
            pelaIntegracao.produto.codigo + ' (' + pelaIntegracao.produto.nome + ').';
        }
      } else {
        it.sr = null;
        if (it.codProduto) {
          it.status = 'confirmar';
          it.nota = (it.nota ? it.nota + ' ' : '') + 'O Cod produto ' + it.codProduto + ' não está no CADASTRO DE PRODUTOS.';
        }
        if (pelaIntegracao) {
          it.sugestaoSr = { codigo: pelaIntegracao.produto.codigo, nome: pelaIntegracao.produto.nome, marca: pelaIntegracao.produto.marca };
          it.status = 'confirmar';
          it.nota = (it.nota ? it.nota + ' ' : '') + 'Sugestão pelo histórico do Cod integração: SR ' + pelaIntegracao.produto.codigo + ' — ' + pelaIntegracao.produto.nome + '.';
        }
      }
    });

    // XML da nota (se estiver na pasta): permite conferir quantidades e códigos com a nota.
    var nota = null, notaStatus = 'SEM_NF', avisoNota = '';
    var nf = r.campos.nf.valor;
    if (nf && r.campos.nf.status !== 'conflito') {
      notaStatus = 'SEM_XML';
      try {
        var achadas = procurarNoIndice_(nf);
        if (!achadas.length && atualizarIndiceXml_(false)) achadas = procurarNoIndice_(nf);
        if (achadas.length > 1) {
          var doForn = achadas.filter(function (a) { return normalizar(nomeFornecedor(a.cnpj, cfg.fornecedores, '', '')) === normalizar(fornecedor); });
          achadas = doForn.length === 1 ? doForn : achadas;
        }
        if (achadas.length === 1) { nota = abrirNota_(achadas[0].fileId); notaStatus = 'XML'; }
        else if (achadas.length > 1) { notaStatus = 'VARIAS'; avisoNota = 'Há mais de uma nota com o número ' + nf + ' na pasta; registre sem o XML ou busque a nota pelo número.'; }
      } catch (e) {
        avisoNota = 'Não foi possível consultar a pasta de XMLs: ' + (e && e.message || e);
      }
    }
    var jaRegistradas = nota ? nota.jaRegistradas : registros.filter(function (x) {
      return nf && semZerosEsquerda(somenteDigitos(x.nf)) === semZerosEsquerda(nf);
    }).map(function (x) {
      var p = casador.produto(x.codProduto);
      return { linha: x.linha, data: x.data, codProduto: x.codProduto, codIntegracao: x.codIntegracao, produto: p ? p.nome : '', tipo: x.tipo, qtd: x.qtd };
    });

    registrarLog_('EMAIL INTERPRETADO', usuario_(), JSON.stringify({ nf: nf, itens: r.itens.length, nota: notaStatus }));
    return { interpretacao: r, nota: nota, notaStatus: notaStatus, avisoNota: avisoNota, jaRegistradas: jaRegistradas, hoje: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') };
  });
}

/** Busca no cadastro SR por código, código de barras ou palavras do nome/marca. */
function buscarProdutoSR(consulta) {
  return api_('buscarProdutoSR', function () {
    var q = String(consulta || '').slice(0, 80);
    if (normalizar(q).length < 2) return [];
    return criarCasador(lerCadastro_(), []).buscar(q, 20).map(function (p) {
      return { codigo: p.codigo, nome: p.nome, marca: p.marca, ean: p.ean };
    });
  });
}

/**
 * Grava a ocorrência (uma linha por item).
 * @return {{status:'OK', linhas:number[], avisos}|{status:'DUPLICADO', duplicados}|{status:'INVALIDO', erros}}
 */
function registrar(payload) {
  return api_('registrar', function () {
    var idEnvio = String(payload && payload.idEnvio || '').slice(0, 64);
    if (!/^[\w-]{8,64}$/.test(idEnvio)) throw new Error('Envio sem identificador — recarregue a página.');
    var cache = CacheService.getScriptCache();
    var anterior = cache.get('envio_' + idEnvio);
    if (anterior) return JSON.parse(anterior); // clique repetido / reenvio: devolve o mesmo resultado

    if (!payload.geral || typeof payload.geral !== 'object' || !Array.isArray(payload.itens)) throw new Error('Dados do registro incompletos — recarregue a página.');
    var cfg = lerConfigApp_();
    conferirComXml_(payload);
    var cadastro = criarCasador(lerCadastro_(), []);
    var v = validarRegistro(payload, { conferentes: cfg.conferentes, tipos: cfg.tipos, produto: cadastro.produto });
    if (v.erros.length) {
      registrarLog_('RECUSADO (dados)', usuario_(), JSON.stringify({ nf: payload.geral.nf, erros: v.erros, envio: idEnvio, versao: CONFIG.VERSAO }));
      return { status: 'INVALIDO', erros: v.erros };
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('A planilha está ocupada com outra gravação. Tente de novo em alguns segundos.');
    try {
      anterior = cache.get('envio_' + idEnvio);
      if (anterior) return JSON.parse(anterior);

      var d = colunasDados_();
      var linha = proximaLinha_(d.sheet, d.mapa);
      if (!payload.confirmarDuplicados) {
        var dup = acharDuplicados(payload, lerRegistros_(d.sheet, d.mapa, linha - 1));
        if (dup.length) {
          registrarLog_('AVISO DUPLICIDADE', usuario_(), JSON.stringify({ nf: payload.geral.nf, linhas: dup.map(function (x) { return x.linha; }), envio: idEnvio }));
          return { status: 'DUPLICADO', duplicados: dup };
        }
      }
      var linhas = montarLinhas(payload, cfg.parametros);
      // Coluna R é caixa de seleção: grava o valor que ELA usa (ex.: 1/0 ou VERDADEIRO/FALSO).
      var caixaR = caixaFormalizado_(d.sheet, d.mapa.status, linha);
      linhas.forEach(function (l) { if (typeof l.status === 'boolean') l.status = caixaR.valor(l.status); });
      conferirLinhasVazias_(d.sheet, d.mapa, linha, linhas.length);
      gravarLinhas_(d.sheet, d.mapa, linha, linhas);
      SpreadsheetApp.flush();

      // Confere lendo de volta: a NF precisa estar em todas as linhas gravadas.
      var nfGravada = d.sheet.getRange(linha, d.mapa.nf, linhas.length, 1).getDisplayValues();
      var nfEsperada = semZerosEsquerda(somenteDigitos(payload.geral.nf));
      if (nfGravada.some(function (r) { return semZerosEsquerda(somenteDigitos(r[0])) !== nfEsperada; })) {
        throw new Error('A gravação não se confirmou na planilha (linha ' + linha + '). Confira a aba ' + CONFIG.ABA_DADOS + ' antes de tentar de novo.');
      }

      var numeros = linhas.map(function (_, i) { return linha + i; });
      var avisos = v.avisos.slice();
      var anteriorComData = Math.max.apply(null, [CONFIG.PRIMEIRA_LINHA_DADOS - 1].concat(
        d.sheet.getRange(CONFIG.PRIMEIRA_LINHA_DADOS, d.mapa.data, Math.max(linha - CONFIG.PRIMEIRA_LINHA_DADOS, 1), 1).getDisplayValues()
          .map(function (r, i) { return r[0] !== '' ? CONFIG.PRIMEIRA_LINHA_DADOS + i : 0; })));
      if (linha - anteriorComData > 1) {
        avisos.push('Gravado na linha ' + linha + ': entre as linhas ' + (anteriorComData + 1) + ' e ' + (linha - 1) +
          ' há dados sem "Data da Ocorrência" (registro incompleto feito à mão?). Confira essas linhas.');
      }
      var pastas = null;
      try {
        pastas = pastasDoRegistro_(numeros); // uma pasta por protocolo (cada produto é uma ocorrência)
      } catch (e) {
        console.error('Pastas dos protocolos: ' + (e && e.stack || e));
        avisos.push('Registro gravado, mas as pastas de fotos não foram criadas: ' + (e && e.message || e));
      }
      var resultado = { status: 'OK', linhas: numeros, avisos: avisos, pastas: pastas };
      cache.put('envio_' + idEnvio, JSON.stringify(resultado), 21600);
      registrarLog_('GRAVOU', usuario_(), JSON.stringify({
        linhas: numeros, nf: payload.geral.nf, itens: payload.itens.length, pastas: pastas && pastas.map(function (p) { return p.url; }),
        duplicadoConfirmado: !!payload.confirmarDuplicados, envio: idEnvio, versao: CONFIG.VERSAO
      }));
      return resultado;
    } finally {
      lock.releaseLock();
    }
  });
}

// ── internos ────────────────────────────────────────────────────────────────

function abrirNota_(fileId) {
  return prepararNota_(lerNfe(lerXmlIndexado_(fileId)), fileId);
}

/** Nota pronta para a tela: fornecedor pela tabela de apelidos, itens casados com o cadastro SR e ocorrências já registradas. */
function prepararNota_(nfe, fileId) {
  var cfg = lerConfigApp_();
  var fornecedor = nomeFornecedor(nfe.emitente.cnpj, cfg.fornecedores, nfe.emitente.nome, nfe.emitente.fantasia);
  var d = colunasDados_();
  var registros = lerRegistros_(d.sheet, d.mapa, proximaLinha_(d.sheet, d.mapa) - 1);
  var casador = criarCasador(lerCadastro_(), registros);
  var nf = semZerosEsquerda(nfe.numero);
  var tz = Session.getScriptTimeZone();

  return {
    origem: { fileId: fileId, chave: nfe.chave },
    numero: nfe.numero,
    serie: nfe.serie,
    emissao: nfe.emissao ? Utilities.formatDate(new Date(nfe.emissao), tz, 'dd/MM/yyyy') : '',
    natOp: nfe.natOp,
    emitente: { cnpj: formatarCnpj_(nfe.emitente.cnpj), nome: nfe.emitente.nome },
    fornecedor: fornecedor,
    valorTotal: nfe.valorTotal,
    pedidos: nfe.pedidos,
    itens: nfe.itens.map(function (it) {
      var c = casador.casar(it, fornecedor);
      return {
        nItem: it.nItem, codigo: it.codigo, ean: it.ean, descricao: it.descricao, unidade: it.unidade,
        quantidade: it.quantidade, valorUnitario: it.valorUnitario,
        sr: c ? { codigo: c.produto.codigo, nome: c.produto.nome, marca: c.produto.marca, via: c.via } : null
      };
    }),
    jaRegistradas: registros.filter(function (r) { return semZerosEsquerda(somenteDigitos(r.nf)) === nf; })
      .map(function (r) {
        var p = casador.produto(r.codProduto);
        return { linha: r.linha, data: r.data, codProduto: r.codProduto, codIntegracao: r.codIntegracao, produto: p ? p.nome : '', tipo: r.tipo, qtd: r.qtd };
      })
  };
}

/**
 * Quando a nota veio da pasta, confere no servidor o que a tela mandou:
 * mesma NF, itens existentes na nota, código de integração e quantidade máxima do XML.
 */
function conferirComXml_(payload) {
  var fileId = payload && payload.origem && payload.origem.fileId;
  if (!fileId) return;
  var nfe = lerNfe(lerXmlIndexado_(String(fileId)));
  if (semZerosEsquerda(somenteDigitos(payload.geral.nf)) !== semZerosEsquerda(nfe.numero)) {
    throw new Error('O número da nota foi alterado em relação ao XML (' + nfe.numero + ').');
  }
  (payload.itens || []).forEach(function (it) {
    if (it.nItem == null || it.nItem === '') { it.qtdNota = null; return; } // item adicionado manualmente
    var orig = nfe.itens.filter(function (x) { return x.nItem === Number(it.nItem); })[0];
    if (!orig) throw new Error('Item ' + it.nItem + ' não existe na nota.');
    it.codIntegracao = orig.codigo;
    it.qtdNota = orig.quantidade;
  });
}

function formatarCnpj_(c) {
  var d = somenteDigitos(c);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d;
}
