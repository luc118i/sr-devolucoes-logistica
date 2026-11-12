/**
 * Testes. No editor do Apps Script:
 *   testarRegras()               — regras puras (XML de 1 e de vários itens, dados ausentes,
 *                                  quantidade parcial, duplicidade, formatos). Não toca na planilha.
 *   testarIntegracaoLeitura()    — confere cabeçalhos, próxima linha, CONFIG_APP, índice de XMLs
 *                                  e abre uma nota real. Só LÊ — não grava nada.
 * Os mesmos testes de regras rodam fora do Google: `node tests/rodar.js`.
 */

function testarRegras() {
  var falhas = [], total = 0;
  var caso = function (nome, fn) {
    total++;
    try { fn(); } catch (e) { falhas.push(nome + ': ' + (e && e.message || e)); }
  };
  var ok = function (c, m) { if (!c) throw new Error(m || 'condição falsa'); };
  var igual = function (a, b, m) {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ' esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a));
  };

  var XML_1_ITEM = xmlTeste_({
    numero: '3138000', cnpj: '05059270000191', nome: 'OBJETIVA ATACADISTA DA CONSTRUCAO LTDA',
    infCpl: 'Nota fiscal com valor parcial referente ao pedido 3.641.026; Referente ao pedido de compra no OC:123451; ENT 3.777.791 PED 3.641.026;',
    itens: [{ cProd: '2577', cEAN: '7894200775362', xProd: 'MICTORIO C/SIFAO INTEGRADO M715 GE17', qCom: '2.0000', vUnCom: '1154.63', vProd: '2309.26' }]
  });
  var XML_VARIOS = xmlTeste_({
    numero: '3131281', cnpj: '05059270000191', nome: 'OBJETIVA ATACADISTA DA CONSTRUCAO LTDA', infCpl: 'PED 3.631.041;',
    itens: [
      { cProd: '24744', cEAN: '7891284040812', xProd: 'INTERRUPTOR 4X2 SIMPLES+TOM', qCom: '60.0000', vUnCom: '15.99', vProd: '959.40' },
      { cProd: '24743', cEAN: '7891284040713', xProd: 'TOMADA 4X2 20A', qCom: '60.0000', vUnCom: '15.99', vProd: '959.40' },
      { cProd: '24731', cEAN: 'SEM GTIN', xProd: 'PLACA 4X2 2POSTOS', qCom: '40.0000', vUnCom: '3.10', vProd: '124.00' }
    ]
  });
  var XML_INCOMPLETO = xmlTeste_({ numero: '342301', cnpj: '61092037000505', nome: 'Eternit S/A', infCpl: null, semProtocolo: true,
    itens: [{ cProd: '000000000353028195', cEAN: '', xProd: 'CUMEEIRA 1,10M', qCom: '10.0000', vUnCom: '36.07', vProd: '360.70' }] });

  // ── XML ──
  caso('NF-e com 1 item', function () {
    var n = lerNfe(XML_1_ITEM);
    igual(n.numero, '3138000'); igual(n.emitente.cnpj, '05059270000191'); igual(n.itens.length, 1);
    igual(n.itens[0].codigo, '2577'); igual(n.itens[0].quantidade, 2); igual(n.itens[0].ean, '7894200775362');
    igual(n.pedidos, ['3641026'], 'pedido');
    igual(n.chave.length, 44, 'chave');
  });
  caso('NF-e com vários itens; "SEM GTIN" vira EAN vazio', function () {
    var n = lerNfe(XML_VARIOS);
    igual(n.itens.length, 3); igual(n.itens[2].ean, ''); igual(n.itens.map(function (i) { return i.nItem; }), [1, 2, 3]);
    igual(n.pedidos, ['3631041']);
  });
  caso('NF-e sem infCpl, sem protocolo e código com zeros à esquerda', function () {
    var n = lerNfe(XML_INCOMPLETO);
    igual(n.pedidos, []); igual(n.infCpl, ''); igual(n.itens[0].codigo, '000000000353028195'); ok(n.chave.length === 44, 'chave pelo Id');
  });
  caso('Arquivo que não é NF-e', function () {
    var erro = '';
    try { lerNfe('<?xml version="1.0"?><outro/>'); } catch (e) { erro = e.message; }
    ok(/não é uma NF-e/.test(erro), 'mensagem: ' + erro);
    erro = '';
    try { lerNfe('isto não é xml'); } catch (e) { erro = e.message; }
    ok(/Não foi possível ler o XML/.test(erro), 'mensagem: ' + erro);
  });
  caso('Pedidos no infCpl', function () {
    igual(extrairPedidos('ENT 3.777.791 PED 3.624.130; referente ao pedido 3.624.130'), ['3624130']);
    igual(extrairPedidos('PEDIDO SR.MIGUEL; pedido 3.569.163'), ['3569163']);
    igual(extrairPedidos('Referente ao pedido de compra no OC:123451'), []);
    igual(extrairPedidos('Pedido nº 45871'), ['45871']);
    igual(extrairPedidos(''), []);
  });
  caso('Chave de acesso pelo nome do arquivo', function () {
    var i = infoDaChave('53260905059270000191550010031243041437962379 (1).xml');
    igual([i.cnpjEmitente, i.modelo, i.serie, i.numero], ['05059270000191', '55', '1', '3124304']);
    igual(infoDaChave('outro.xml'), null);
  });

  // ── validação / quantidade parcial ──
  var listas = { conferentes: ['Isaias Gomes'], tipos: ['Produto avariado/danificado', 'Material com defeito'] };
  var base = function (itens) {
    return { geral: { data: '2026-10-01', fornecedor: 'Objetiva', conferente: 'Isaias Gomes', nf: '3131281', pedido: '3631041', bloqueio: '77541', valor: '319,80' }, itens: itens };
  };
  var item = function (o) {
    var b = { nItem: 1, descricao: 'INTERRUPTOR', codIntegracao: '24744', codProduto: '157944', tipo: 'Material com defeito', qtd: '20', qtdNota: 60, obs: '' };
    Object.keys(o || {}).forEach(function (k) { b[k] = o[k]; });
    return b;
  };
  caso('Quantidade parcial válida', function () { igual(validarRegistro(base([item({ qtd: '20' })]), listas).erros, []); });
  caso('Quantidade decimal com vírgula', function () { igual(validarRegistro(base([item({ qtd: '2,5' })]), listas).erros, []); });
  caso('Quantidade maior que a da nota', function () { ok(/maior que a da nota/.test(validarRegistro(base([item({ qtd: '61' })]), listas).erros.join())); });
  caso('Quantidade zero / vazia', function () {
    ok(/maior que zero/.test(validarRegistro(base([item({ qtd: '0' })]), listas).erros.join()));
    ok(/maior que zero/.test(validarRegistro(base([item({ qtd: '' })]), listas).erros.join()));
  });
  caso('Campos obrigatórios ausentes', function () {
    var p = base([]); p.geral.conferente = ''; p.geral.nf = ''; p.geral.data = ''; p.geral.fornecedor = ' '; p.geral.pedido = ''; p.geral.bloqueio = ''; p.geral.valor = '';
    var e = validarRegistro(p, listas).erros.join('|');
    ['data', 'fornecedor', 'conferente', 'nota fiscal', 'pedido', 'bloqueio', 'valor', 'ao menos um produto'].forEach(function (t) { ok(e.toLowerCase().indexOf(t) >= 0, 'faltou erro de ' + t + ': ' + e); });
  });
  caso('Conferente/tipo fora da lista e data futura', function () {
    var p = base([item({ tipo: 'Inventado' })]); p.geral.conferente = 'Fulano'; p.geral.data = '2999-01-01';
    var e = validarRegistro(p, listas).erros.join('|');
    ok(/Fulano/.test(e) && /Inventado/.test(e) && /futura/.test(e), e);
  });
  caso('Item sem Cod produto (código SR): recusa', function () {
    ok(/sem Cod produto/.test(validarRegistro(base([item({ codProduto: '' })]), listas).erros.join()));
  });
  caso('Item sem Cod integração: recusa', function () {
    ok(/Cod integração/.test(validarRegistro(base([item({ codIntegracao: '' })]), listas).erros.join()));
  });
  caso('Pedido, bloqueio e valor obrigatórios; "-" conta como vazio', function () {
    var p = base([item()]); p.geral.pedido = ''; p.geral.bloqueio = '-'; p.geral.valor = '';
    var e = validarRegistro(p, listas).erros.join('|');
    ok(/pedido/.test(e) && /bloqueio/.test(e) && /Informe o valor/.test(e), e);
  });
  caso('O que conta como preenchido', function () {
    igual([preenchido('S/B'), preenchido('s'), preenchido(' - '), preenchido('.'), preenchido(''), preenchido(0)], [true, true, false, false, false, true]);
  });
  caso('Bloqueio "S/B" e valor 0 são aceitos', function () {
    var p = base([item()]); p.geral.bloqueio = 'S/B'; p.geral.valor = '0';
    igual(validarRegistro(p, listas).erros, []);
  });
  caso('Produto precisa existir no cadastro com nome e marca', function () {
    var cad = { '157944': { nome: 'INTERRUPTOR', marca: 'PIAL' }, '200': { nome: 'SEM MARCA', marca: '' } };
    var l = { conferentes: listas.conferentes, tipos: listas.tipos, produto: function (c) { return cad[c] || null; } };
    igual(validarRegistro(base([item()]), l).erros, []);
    ok(/não existe no CADASTRO/.test(validarRegistro(base([item({ codProduto: '999' })]), l).erros.join()));
    ok(/sem marca/.test(validarRegistro(base([item({ codProduto: '200' })]), l).erros.join()));
  });

  caso('Cadastro de conferente', function () {
    igual(validarNomeConferente('  joão   da silva ', ['Isaias Gomes']), { nome: 'joão da silva', erro: '' });
    ok(/já está na lista/.test(validarNomeConferente('ISAIAS gomes', [' Isaias Gomes ']).erro), 'duplicado');
    ok(/mínimo/.test(validarNomeConferente('ab', []).erro), 'curto');
    ok(/só letras/.test(validarNomeConferente('=HYPERLINK(1)', []).erro), 'fórmula');
    ok(/só letras/.test(validarNomeConferente('Fulano 123', []).erro), 'números');
  });

  // ── duplicidade ──
  var existentes = [{ linha: 2520, data: '01/10/2026', nf: '3131281', codIntegracao: '24744', codProduto: '157944', tipo: 'Material com defeito', qtd: 20 }];
  caso('Duplicado: mesma NF + produto + tipo', function () {
    var d = acharDuplicados(base([item()]), existentes);
    igual(d.length, 1); igual(d[0].linha, 2520);
  });
  caso('Mesmo produto com outro tipo não é duplicado', function () {
    igual(acharDuplicados(base([item({ tipo: 'Produto avariado/danificado' })]), existentes), []);
  });
  caso('Mesmo produto em outra NF não é duplicado', function () {
    var p = base([item()]); p.geral.nf = '3131282';
    igual(acharDuplicados(p, existentes), []);
  });
  caso('NF gravada como número x texto com zeros', function () {
    var p = base([item()]); p.geral.nf = '003131281';
    igual(acharDuplicados(p, existentes).length, 1);
  });
  caso('Sem código SR compara pelo código de integração', function () {
    var ex = [{ linha: 9, data: '', nf: '3131281', codIntegracao: '24744', codProduto: '', tipo: 'Material com defeito', qtd: 1 }];
    igual(acharDuplicados(base([item({ codProduto: '' })]), ex).length, 1);
  });
  caso('Produto + tipo repetidos no mesmo envio', function () {
    ok(/aparece duas vezes/.test(validarRegistro(base([item(), item({ nItem: 2 })]), listas).erros.join()));
  });

  // ── linhas gravadas ──
  caso('Formatos das células', function () {
    var p = base([item({ codIntegracao: '000000000353028195', obs: '=HYPERLINK("x")' })]);
    p.geral.bloqueio = 'S/B';
    var l = montarLinhas(p, { STATUS_INICIAL: '0' })[0];
    igual(l.nf, 3131281, 'nf'); igual(l.pedido, 3631041, 'pedido'); igual(l.bloqueio, { texto: 'S/B' }, 'bloqueio');
    igual(l.codIntegracao, { texto: '000000000353028195' }, 'zeros à esquerda preservados');
    igual(l.codProduto, 157944, 'cod produto numérico para o PROCV');
    igual(l.valor, 319.8, 'valor'); igual(l.qtd, 20, 'qtd'); igual(l.status, false, 'status: caixa de seleção FALSO');
    igual(l.obs.charAt(0), "'", 'fórmula neutralizada');
    ok(l.data instanceof Date && l.data.getDate() === 1, 'data');
  });
  caso('Status vazio não grava', function () { igual(montarLinhas(base([item()]), { STATUS_INICIAL: '' })[0].status, ''); });
  caso('Bloqueio "-" permanece', function () { var p = base([item()]); p.geral.bloqueio = '-'; igual(montarLinhas(p, {})[0].bloqueio, { texto: '-' }); });

  // ── cabeçalhos e colunas ──
  caso('Cabeçalhos reais da DATABASE', function () {
    var cab = ['Nº Protocolo', 'Data da Ocorrência', 'Fornecedor', 'Conferente', 'Nota fiscal ', 'Nº Pedidos', 'Bloqueio', 'Valor', 'Cod integração ', 'Cod produto',
      'Produto', 'Marca', '', 'Tipo de Ocorrência', 'Qnt.', 'Observação', '', 'Status', 'Data de Formalização', 'Tempo de finalização', 'STATUS', 'Nº da NFD'];
    var r = mapearCabecalhos(cab, CONFIG.COLUNAS);
    igual(r.faltando, []);
    igual([r.mapa.data, r.mapa.nf, r.mapa.pedido, r.mapa.codIntegracao, r.mapa.codProduto, r.mapa.tipo, r.mapa.qtd, r.mapa.obs, r.mapa.status],
      [2, 5, 6, 9, 10, 14, 15, 16, 18]);
    ['Nº Protocolo', 'Produto', 'Marca', 'Tempo de finalização'].forEach(function (h) {
      ok(Object.keys(r.mapa).every(function (k) { return r.mapa[k] !== cab.indexOf(h) + 1; }), 'não pode gravar em ' + h);
    });
  });
  caso('Valores fora da lista de validação', function () {
    igual(valoresForaDaLista(['Isaias Gomes', 'LUCIANO SILVA RODRIGUES', 'Marcos', 'Marcos', ''], ['Isaias Gomes', ' LUCIANO SILVA RODRIGUES ']),
      ['LUCIANO SILVA RODRIGUES', 'Marcos']);
    igual(valoresForaDaLista(['A'], ['A']), []);
  });
  caso('Nome da pasta do protocolo', function () {
    igual(nomePastaProtocolo(['2539']), 'Protocolo 2539');
    igual(nomePastaProtocolo(['2539', '2540', '2541']), 'Protocolo 2539 a 2541');
    var erro = ''; try { nomePastaProtocolo(['', '']); } catch (e) { erro = e.message; }
    ok(/protocolo não encontrado/.test(erro), erro);
  });
  caso('Nome seguro do arquivo de foto', function () {
    igual(nomeArquivoFoto('Avaria caixa (1).PNG', 'image/jpeg', 3), '03_Avaria_caixa_1.jpg');
    igual(nomeArquivoFoto('../../x', 'application/pdf', 12), '12_x.pdf');
    igual(nomeArquivoFoto('', 'image/png', 1), '01_foto.png');
  });
  caso('Período da consulta', function () {
    var p = validarPeriodo('2026-10-12', '2026-10-18');
    igual([p.inicio.getDate(), p.fim.getDate()], [12, 18]);
    var e1 = ''; try { validarPeriodo('2026-10-18', '2026-10-12'); } catch (e) { e1 = e.message; }
    var e2 = ''; try { validarPeriodo('2024-01-01', '2026-10-12'); } catch (e) { e2 = e.message; }
    var e3 = ''; try { validarPeriodo('x', '2026-10-12'); } catch (e) { e3 = e.message; }
    ok(/anterior/.test(e1) && /1 ano/.test(e2) && /inválido/.test(e3), [e1, e2, e3].join('|'));
  });
  caso('Pasta de fotos cobre o protocolo', function () {
    ok(pastaCobreProtocolo('Protocolo 2539', '2539'));
    ok(pastaCobreProtocolo('Protocolo 2539 a 2541', 2540));
    ok(!pastaCobreProtocolo('Protocolo 2539 a 2541', 2542));
    ok(!pastaCobreProtocolo('Protocolo 25390', 2539));
    ok(!pastaCobreProtocolo('Outra pasta', 2539));
  });
  caso('Coluna R (caixa de seleção) em registro novo', function () {
    igual([valorStatusInicial('0'), valorStatusInicial('FALSO'), valorStatusInicial('1'), valorStatusInicial('VERDADEIRO'), valorStatusInicial('')], [false, false, true, true, '']);
  });
  caso('Caixa de seleção da coluna R: valores próprios (1/0) ou padrão', function () {
    var c10 = regraCaixa([1, 0]);
    igual([c10.valor(true), c10.valor(false)], [1, 0], '1/0');
    ok(c10.ehMarcado(1) && c10.ehMarcado('1') && c10.ehMarcado(true) && c10.ehMarcado('TRUE') && c10.ehMarcado('VERDADEIRO'), 'lê marcado em qualquer forma');
    ok(!c10.ehMarcado(0) && !c10.ehMarcado('0') && !c10.ehMarcado(false) && !c10.ehMarcado(''), 'desmarcado');
    var pad = regraCaixa([]);
    igual([pad.valor(true), pad.valor(false)], [true, false], 'padrão VERDADEIRO/FALSO');
    var txt = regraCaixa(['Feito', 'Pendente']);
    igual([txt.valor(true), txt.valor(false), txt.ehMarcado('Feito'), txt.ehMarcado('Pendente')], ['Feito', 'Pendente', true, false], 'texto próprio');
  });

  caso('Formalizar: marca R, data de hoje e situação inicial', function () {
    var p = planoStatus({ formalizado: false, dataFormalizacao: '', situacao: '', nfd: '' }, { acao: 'formalizar' });
    igual([p.formalizado, p.dataFormalizacao, p.situacao, p.formalizouAgora, p.erros], [true, true, 'Aguardando autorização p/ emissão de NFD', true, []]);
    var ja = planoStatus({ formalizado: true, dataFormalizacao: '14/10/2026', situacao: 'Verificar', nfd: '' }, { acao: 'formalizar' });
    igual([ja.dataFormalizacao, ja.situacao, ja.formalizouAgora], [null, 'Verificar', false], 'já formalizada: não mexe na data nem na situação');
  });
  caso('Desfazer formalização volta R, S e a situação anterior', function () {
    var atual = { formalizado: true, dataFormalizacao: '16/10/2026', situacao: 'Aguardando autorização p/ emissão de NFD', nfd: '' };
    var p = planoStatus(atual, { acao: 'desformalizar', situacaoAnterior: '' });
    igual([p.formalizado, p.dataFormalizacao, p.situacao, p.erros], [false, 'limpar', '', []]);
    igual(planoStatus(atual, { acao: 'desformalizar' }).situacao, 'Aguardando autorização p/ emissão de NFD', 'sem situação anterior: mantém');
  });
  caso('Status: NFD obrigatória para Aguardando transportadora e Finalizada', function () {
    var base = { formalizado: true, dataFormalizacao: '14/10/2026', situacao: 'Aguardando autorização p/ emissão de NFD', nfd: '' };
    ok(/Nº da NFD/.test(planoStatus(base, { acao: 'status', situacao: 'Finalizada', nfd: '' }).erros.join()), 'sem NFD bloqueia');
    ok(/Nº da NFD/.test(planoStatus(base, { acao: 'status', situacao: 'Aguardando transportadora', nfd: ' - ' }).erros.join()), 'tracinho não conta');
    var ok1 = planoStatus(base, { acao: 'status', situacao: 'aguardando transportadora', nfd: '1118006' });
    igual([ok1.erros, ok1.situacao, ok1.nfd], [[], 'Aguardando transportadora', '1118006'], 'grafia da lista');
    igual(planoStatus(base, { acao: 'status', situacao: 'Finalizada', nfd: 'TRATATIVA INTERNA' }).erros, [], 'texto vale como NFD');
    igual(planoStatus(base, { acao: 'status', situacao: 'Verificar', nfd: '' }).erros, [], 'Verificar não exige NFD');
    var comNfd = planoStatus({ formalizado: true, dataFormalizacao: 'x', situacao: 'Aguardando transportadora', nfd: '1118006' }, { acao: 'status', situacao: 'Finalizada' });
    igual([comNfd.erros, comNfd.nfd], [[], '1118006'], 'mantém a NFD que já existe');
    ok(/não está na lista/.test(planoStatus(base, { acao: 'status', situacao: 'Inventado' }).erros.join()));
    var naoForm = planoStatus({ formalizado: false, dataFormalizacao: '', situacao: '', nfd: '' }, { acao: 'status', situacao: 'Verificar' });
    igual([naoForm.formalizado, naoForm.formalizouAgora], [true, true], 'mudar a situação formaliza');
  });
  caso('Blocos de colunas contíguas', function () { igual(agruparColunas([10, 2, 3, 4, 14, 15, 16, 18]), [[2, 3, 4], [10], [14, 15, 16], [18]]); });

  // ── casamento com o cadastro ──
  var cadastro = [
    { codigo: '157944', nome: 'INTERRUPTOR ZEFFIA 4X2 SIMPLES+TOM', marca: 'PIAL LEGRAND', ean: '7891284040812' },
    { codigo: '150762', nome: 'PLACA ZEFFIA 4X2 2POSTOS 680182', marca: 'PIAL LEGRAND', ean: '' },
    { codigo: '1', nome: 'A', marca: '', ean: '7890000000001' }, { codigo: '2', nome: 'B', marca: '', ean: '7890000000001' }
  ];
  var hist = [{ fornecedor: 'objetiva', codIntegracao: '24731', codProduto: '150762' }, { fornecedor: 'Objetiva', codIntegracao: '999', codProduto: '1' },
    { fornecedor: 'Objetiva', codIntegracao: '999', codProduto: '2' }];
  var cas = criarCasador(cadastro, hist);
  caso('Casa pelo EAN', function () { igual(cas.casar({ codigo: '24744', ean: '7891284040812' }, 'Objetiva').produto.codigo, '157944'); });
  caso('Casa pelo histórico (mesmo fornecedor)', function () {
    var c = cas.casar({ codigo: '24731', ean: '' }, 'Objetiva'); igual([c.produto.codigo, c.via], ['150762', 'historico']);
    igual(cas.casar({ codigo: '24731', ean: '' }, 'Outro fornecedor'), null);
  });
  caso('Histórico contraditório e EAN repetido não decidem', function () {
    igual(cas.casar({ codigo: '999', ean: '' }, 'Objetiva'), null);
    igual(cas.casar({ codigo: 'x', ean: '7890000000001' }, 'Objetiva'), null);
  });
  caso('Busca no cadastro', function () {
    igual(cas.buscar('157944').map(function (p) { return p.codigo; }), ['157944']);
    igual(cas.buscar('zeffia placa').map(function (p) { return p.codigo; }), ['150762']);
  });
  caso('Nome do fornecedor', function () {
    igual(nomeFornecedor('05059270000191', [['05059270', 'Objetiva']], 'OBJETIVA ATACADISTA', ''), 'Objetiva');
    igual(nomeFornecedor('61092037000505', [['05059270', 'Objetiva']], 'Eternit S/A', 'ETERNIT S/A'), 'ETERNIT S/A');
  });

  testesEmail_(caso, ok, igual);
  testesBloqueios_(caso, ok, igual);

  var resumo = (total - falhas.length) + '/' + total + ' testes OK';
  console.log(resumo + (falhas.length ? '\nFALHAS:\n- ' + falhas.join('\n- ') : ''));
  if (falhas.length) throw new Error(resumo + ' — ' + falhas.length + ' falha(s), veja o log.');
  return resumo;
}

/** Confere a ligação com a planilha e a pasta de XMLs. Não grava nada na DATABASE. */
function testarIntegracaoLeitura() {
  var d = colunasDados_();
  var prox = proximaLinha_(d.sheet, d.mapa);
  var cfg = lerConfigApp_();
  var log = ['Colunas: ' + JSON.stringify(d.mapa), 'Próxima linha livre: ' + prox,
    'Conferentes: ' + cfg.conferentes.length + ', tipos: ' + cfg.tipos.length, 'Cadastro: ' + lerCadastro_().length + ' produtos'];
  var regs = lerRegistros_(d.sheet, d.mapa, prox - 1);
  log.push('Registros lidos: ' + regs.length);
  if (cfg.parametros.PASTA_XML_ID) {
    atualizarIndiceXml_(true);
    var sh = aba_(CONFIG.ABA_INDICE);
    log.push('Índice de XMLs: ' + (sh.getLastRow() - 1) + ' notas');
    if (sh.getLastRow() > 1) {
      var numero = sh.getRange(sh.getLastRow(), 2).getValue();
      var r = buscarNota(numero);
      log.push('Nota ' + numero + ': ' + r.status + (r.nota ? ' · ' + r.nota.fornecedor + ' · ' + r.nota.itens.length + ' itens · ' +
        r.nota.itens.filter(function (i) { return i.sr; }).length + ' com código SR · pedidos ' + r.nota.pedidos.join(',') : ''));
    }
  } else {
    log.push('PASTA_XML_ID não configurada.');
  }
  console.log(log.join('\n'));
  return log.join('\n');
}

/** Monta um procNFe mínimo para os testes. */
function xmlTeste_(o) {
  var nnf = ('000000000' + o.numero).slice(-9);
  var chave = '5326' + '09' + o.cnpj + '55' + '001' + nnf + '1' + '12345678' + '9';
  var itens = o.itens.map(function (it, i) {
    return '<det nItem="' + (i + 1) + '"><prod><cProd>' + it.cProd + '</cProd><cEAN>' + it.cEAN + '</cEAN><xProd>' + it.xProd + '</xProd>' +
      '<uCom>PC</uCom><qCom>' + it.qCom + '</qCom><vUnCom>' + it.vUnCom + '</vUnCom><vProd>' + it.vProd + '</vProd></prod></det>';
  }).join('');
  var nfe = '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe' + chave + '" versao="4.00">' +
    '<ide><mod>55</mod><serie>1</serie><nNF>' + o.numero + '</nNF><dhEmi>2026-09-21T11:23:00-03:00</dhEmi><natOp>VENDA</natOp></ide>' +
    '<emit><CNPJ>' + o.cnpj + '</CNPJ><xNome>' + o.nome + '</xNome></emit><dest><CNPJ>26443804000159</CNPJ><xNome>SR</xNome></dest>' + itens +
    '<total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>' + (o.infCpl ? '<infAdic><infCpl>' + o.infCpl + '</infCpl></infAdic>' : '') +
    '</infNFe></NFe>';
  if (o.semProtocolo) return '<?xml version="1.0" encoding="UTF-8"?>' + nfe;
  return '<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' + nfe +
    '<protNFe><infProt><chNFe>' + chave + '</chNFe></infProt></protNFe></nfeProc>';
}

/**
 * Onde o app está gravando: última linha com dado em cada coluna do registro,
 * próxima linha livre e as últimas gravações da LOG_APP (com o conteúdo atual dessas linhas).
 * Só lê.
 */
function diagnosticarGravacao() {
  var d = colunasDados_();
  var sh = d.sheet;
  var log = ['Aba ' + CONFIG.ABA_DADOS + ' — linhas na aba: ' + sh.getMaxRows()];
  Object.keys(d.mapa).forEach(function (c) {
    log.push('  ' + CONFIG.COLUNAS[c] + ' (col ' + d.mapa[c] + '): última linha com dado = ' + ultimaLinhaComDado_(sh, d.mapa[c]));
  });
  log.push('Próxima linha livre: ' + proximaLinha_(sh, d.mapa));
  var shLog = aba_(CONFIG.ABA_LOG, false);
  if (shLog && shLog.getLastRow() > 1) {
    var ini = Math.max(2, shLog.getLastRow() - 14);
    log.push('Últimos eventos da LOG_APP:');
    shLog.getRange(ini, 1, shLog.getLastRow() - ini + 1, 4).getDisplayValues().forEach(function (r) {
      log.push('  ' + r.join(' | '));
      if (r[1] === 'GRAVOU') {
        try {
          JSON.parse(r[3]).linhas.forEach(function (n) {
            var v = sh.getRange(n, 1, 1, Math.max(d.mapa.obs, d.mapa.qtd)).getDisplayValues()[0];
            log.push('      linha ' + n + ' hoje: data=' + v[d.mapa.data - 1] + ' nf=' + v[d.mapa.nf - 1] + ' produto=' + v[d.mapa.codProduto - 1] + ' tipo=' + v[d.mapa.tipo - 1]);
          });
        } catch (e) { /* detalhe sem linhas */ }
      }
    });
  }
  console.log(log.join('\n'));
  return log.join('\n');
}

/**
 * Rode no editor depois de mudar permissões (ex.: fotos): o Google pede a autorização
 * que faltar e esta função confere se a conta consegue ler os XMLs e EDITAR a pasta de fotos.
 * Não cria nem altera nada.
 */
function verificarPermissoes() {
  // A tela de consentimento do Google deixa desmarcar permissões; isto pede de novo as que faltarem.
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  var log = ['Conta que executa: ' + Session.getEffectiveUser().getEmail()];
  CONFIG_ESCOPOS_.forEach(function (escopo) {
    var st = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, [escopo]).getAuthorizationStatus();
    log.push('Permissão ' + escopo.replace('https://www.googleapis.com/auth/', '') + ': ' +
      (st === ScriptApp.AuthorizationStatus.NOT_REQUIRED ? 'concedida' : 'FALTANDO — rode de novo e marque todas as caixas'));
  });
  try {
    // Teste real de escrita: cria uma pasta e manda para a lixeira na hora.
    var teste = pastaFotosRaiz_().createFolder('_teste_permissao_app');
    teste.setTrashed(true);
    log.push('Teste de criar pasta na pasta de fotos: OK.');
  } catch (e) {
    log.push('Teste de criar pasta: ERRO — ' + (e && e.message || e));
  }
  var cfg = lerConfigApp_();
  try {
    var raiz = pastaFotosRaiz_();
    var acesso = raiz.getAccess(Session.getEffectiveUser());
    var podeEditar = acesso === DriveApp.Permission.OWNER || acesso === DriveApp.Permission.EDIT || acesso === DriveApp.Permission.ORGANIZER || acesso === DriveApp.Permission.FILE_ORGANIZER;
    log.push('Pasta de fotos "' + raiz.getName() + '": acesso ' + acesso + (podeEditar ? ' — OK, pode criar pastas.' : ' — SEM EDIÇÃO: peça ao dono da pasta para compartilhar como Editor com esta conta.'));
  } catch (e) {
    log.push('Pasta de fotos: ERRO — ' + (e && e.message || e));
  }
  if (cfg.parametros.PASTA_XML_ID) {
    try { log.push('Pasta de XMLs: "' + DriveApp.getFolderById(pastaXmlId_()).getName() + '" — OK.'); }
    catch (e) { log.push('Pasta de XMLs: ERRO — ' + (e && e.message || e)); }
  }
  console.log(log.join('\n'));
  return log.join('\n');
}

/** Escopos do appsscript.json conferidos por verificarPermissoes. */
var CONFIG_ESCOPOS_ = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.compose'
];
