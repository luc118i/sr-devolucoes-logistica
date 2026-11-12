/**
 * Testes do cruzamento de bloqueios (chamados por testarRegras).
 * Os casos vêm de situações reais do relatório de 04/11/2026.
 */
function testesBloqueios_(caso, ok, igual) {
  var celula = function (t, rep) {
    return '<table:table-cell' + (rep ? ' table:number-columns-repeated="' + rep + '"' : '') + (t === '' ? '/>' : '><text:p>' + t + '</text:p></table:table-cell>');
  };
  var linha = function (cs) { return '<table:table-row>' + cs.map(function (c) { return celula(c); }).join('') + '</table:table-row>'; };
  var ods = function (linhas) { return '<x><table:table table:name="A">' + linhas.join('') + '</table:table></x>'; };
  var vazio = function (n) { return new Array(n).fill(''); };
  var CAB_B = ['Bloqueio', 'Entrada', 'Transferência', 'Fornecedor', '', 'Data cadastro', 'Data baixa', 'Empresa', 'Status', 'Negociação', 'Tipo de bloqueio de estoque', '', 'Valor do bloqueio', 'Valor pendente'];
  var CAB_I = ['', 'Produto', 'Nome', '', 'Lote', 'Marca', 'Código original', 'Unidade', 'Preço de custo', 'Quantidade', 'Valor do bloqueio', 'Qtd. baixada', 'Qtd. pendente', 'Valor pendente', 'Local'];
  var RELATORIO = [
    linha(['Santri ADM', '', 'Emitido em 04/11/2026 12:49:42']),
    linha(['Relação de bloqueios de estoque - Analítico']),
    linha(CAB_B),
    linha(['78.652', '289.669', '', '988 - OBJETIVA ATACADISTA DA CONSTRUCAO LTDA MATRIZ', '', '03/11/2026', '', '1 - SIA', 'Ab', '', '9.998 - ENTRADA - ITENS DANIFICADOS', '', '819,20', '819,20']),
    linha(CAB_I),
    linha(['', '173.714', 'DUCHA &amp; CIA', '', '?', '97 - DECA', 'X', 'UN', '409,60', '2,00', '819,20', '0,00', '2,00', '819,20', '14 - AVARIAS']),
    linha(['Filtros selecionados']),
    linha(['Tipos de Bloqueios de Estoque']),
    linha(['  9.998 - ENTRADA - ITENS DANIFICADOS']),
    linha(['Agrupado por: Nenhum'])
  ];

  var bloco = function (o) {
    return Object.assign({ bloqueio: '100', entrada: '1', fornecedor: '988 - OBJETIVA X MATRIZ', cad: '01/10/2026', baixa: '', status: 'Ab', tipo: '9.998 - X', valor: 100, pend: 100,
      itens: [{ cod: '500', nome: 'PRODUTO', marca: '1 - M', un: 'UN', qtd: 2, valor: 100, qb: 0, qp: 2, vp: 100, local: '14 - AVARIAS' }] }, o);
  };
  var oc = function (o) {
    return Object.assign({ prot: 1, data: '2026-10-02', forn: 'Objetiva', nf: 1, ped: 2, blq: 100, valor: 100, cod: 500, prod: 'PRODUTO', marca: 'M', tipo: 'T', qtd: 2, obs: '', formal: true, dform: '2026-10-03', status: 'Tratativa compras', nfd: '' }, o);
  };
  var HOJE = '2026-11-04';

  caso('Bloqueios: lê células repetidas, entidades e preenchimento do .ods', function () {
    var l = lerTabelaOds(ods(['<table:table-row>' + celula('A') + celula('', 2) + celula('B', 2) + celula('', 9000) + '</table:table-row>', '<table:table-row table:number-rows-repeated="1000">' + celula('', 9000) + '</table:table-row>']));
    igual(l, [['A', '', '', 'B', 'B']]);
  });
  caso('Bloqueios: relatório analítico vira bloqueio com itens e filtros', function () {
    var r = interpretarRelatorioBloqueios(lerTabelaOds(ods(RELATORIO)));
    igual(r.emitido, '04/11/2026 12:49');
    igual(r.blocos.length, 1);
    igual(r.blocos[0].bloqueio, '78652');
    igual(r.blocos[0].pend, 819.2);
    igual(r.blocos[0].itens[0].cod, '173714');
    igual(r.blocos[0].itens[0].nome, 'DUCHA & CIA');
    igual(r.blocos[0].itens[0].qp, 2);
    igual(r.filtros, ['Tipos de Bloqueios de Estoque: 9.998 - ENTRADA - ITENS DANIFICADOS']);
  });
  caso('Bloqueios: recusa arquivo errado ou sintético', function () {
    var erro = function (linhas) { try { interpretarRelatorioBloqueios(lerTabelaOds(ods(linhas))); return ''; } catch (e) { return e.message; } };
    ok(/não é a "Relação/.test(erro([linha(['Outro relatório'])])));
    ok(/Analítico/.test(erro([linha(['Relação de bloqueios de estoque - Sintético'])])));
    ok(/Analítico/.test(erro(RELATORIO.filter(function (l, i) { return i !== 4 && i !== 5; }))));
    ok(/layout do relatório mudou/.test(erro([RELATORIO[1], linha(['Bloqueio', 'Entrada'])])));
  });
  caso('Bloqueios: número aceita ponto, texto e descarta S/B', function () {
    igual(numerosBloqueio(51690), ['51690']);
    igual(numerosBloqueio('78.001'), ['78001']);
    igual(numerosBloqueio('S/B'), []);
    igual(numerosBloqueio('-'), []);
    igual(numerosBloqueio(0), []);
    igual(numerosBloqueio(''), []);
  });
  caso('Bloqueios: aberto vai para a coluna da situação da ocorrência', function () {
    var r = cruzarBloqueios([bloco()], [oc({ status: 'Aguardando emissão de NFD' })], HOJE);
    igual(r.abertos[0].col, 'Aguardando emissão de NFD');
    igual(r.abertos[0].dias, 34);
    igual(r.abertos[0].alertas, []);
    igual(r.fora, []);
  });
  caso('Bloqueios: aberto sem nenhuma pista fica sem ocorrência', function () {
    igual(cruzarBloqueios([bloco()], [oc({ blq: 999, cod: 777 })], HOJE).abertos[0].col, COL_SEM_OCORRENCIA);
  });
  caso('Bloqueios: situações diferentes no bloqueio mostram a mais atrasada', function () {
    var r = cruzarBloqueios([bloco()], [oc({ status: 'Finalizada' }), oc({ prot: 2, status: 'Aguardando transportadora' })], HOJE);
    igual(r.abertos[0].col, 'Aguardando transportadora');
  });
  caso('Bloqueios: aberto com tudo finalizado aparece em Finalizada', function () {
    igual(cruzarBloqueios([bloco()], [oc({ status: 'Finalizada' })], HOJE).abertos[0].col, 'Finalizada');
  });
  caso('Bloqueios: situação nova na lista não quebra o cruzamento', function () {
    igual(cruzarBloqueios([bloco()], [oc({ status: 'Situação nova' })], HOJE).abertos[0].col, 'Situação nova');
  });
  caso('Bloqueios: campo Bloqueio vazio com mesmo produto e quantidade vira vínculo a confirmar', function () {
    var r = cruzarBloqueios([bloco()], [oc({ prot: 2051, blq: '' })], HOJE);
    igual(r.abertos[0].col, COL_CONFIRMAR);
    ok(/protocolo 2051/.test(r.abertos[0].cand.motivo));
    igual(r.fora, [], 'protocolo vinculado não repete em Fora do relatório');
  });
  caso('Bloqueios: número de outro bloqueio sem o produto vira vínculo a confirmar', function () {
    var outro = bloco({ bloqueio: '200', status: 'Bx', itens: [{ cod: '900', nome: 'N', marca: '', un: 'UN', qtd: 1, valor: 1, qb: 1, qp: 0, vp: 0, local: '' }] });
    var r = cruzarBloqueios([bloco(), outro], [oc({ blq: 200 })], HOJE);
    igual(r.abertos[0].col, COL_CONFIRMAR);
  });
  caso('Bloqueios: ocorrência certa de outro bloqueio não é sugerida (caso 77.866 x 77.862)', function () {
    var irmao = bloco({ bloqueio: '200', status: 'Bx' });
    igual(cruzarBloqueios([bloco(), irmao], [oc({ blq: 200 })], HOJE).abertos[0].col, COL_SEM_OCORRENCIA);
  });
  caso('Bloqueios: quantidade diferente ou data distante não sugere vínculo', function () {
    igual(cruzarBloqueios([bloco()], [oc({ blq: '', qtd: 3 })], HOJE).abertos[0].col, COL_SEM_OCORRENCIA);
    igual(cruzarBloqueios([bloco()], [oc({ blq: '', data: '2026-01-01' })], HOJE).abertos[0].col, COL_SEM_OCORRENCIA);
  });
  caso('Bloqueios: alertas de divergência no cartão', function () {
    var dois = bloco({ valor: 200, itens: bloco().itens.concat([{ cod: '600', nome: 'B', marca: '', un: 'UN', qtd: 1, valor: 100, qb: 0, qp: 1, vp: 100, local: '' }]) });
    var r = cruzarBloqueios([dois], [oc({ qtd: 1.5, formal: false, nfd: 1096701 }), oc({ prot: 7, cod: 999 })], HOJE).abertos[0];
    igual(r.alertas, [
      'Quantidade diverge no produto 500: ocorrência 1,5, bloqueio 2',
      'Protocolo 7 cita um produto que não está neste bloqueio (999)',
      'Produto 600 sem ocorrência',
      'Ocorrência ainda não formalizada',
      'NFD 1096701 registrada, bloqueio segue aberto',
      'Baixa parcial no Santri'
    ]);
  });
  caso('Bloqueios: baixa parcial mostra só o item pendente', function () {
    var b = bloco({ pend: 50, itens: [bloco().itens[0], { cod: '600', nome: 'B', marca: '', un: 'UN', qtd: 1, valor: 50, qb: 1, qp: 0, vp: 0, local: '' }] });
    igual(cruzarBloqueios([b], [oc()], HOJE).abertos[0].itens.map(function (i) { return i.cod; }), ['500']);
  });
  caso('Bloqueios: baixado entra só com ocorrência em andamento', function () {
    var b = bloco({ status: 'Bx', baixa: '20/10/2026' });
    igual(cruzarBloqueios([b], [oc({ status: 'Finalizada' })], HOJE).baixados, []);
    var r = cruzarBloqueios([b], [oc({ status: 'Aguardando transportadora' })], HOJE).baixados[0];
    igual(r.col, 'Aguardando transportadora');
    igual(r.baixa, '2026-10-20');
    igual(r.alertas, ['Baixado sem NFD registrada']);
    igual(cruzarBloqueios([b], [oc({ status: 'Aguardando transportadora', nfd: 123 })], HOJE).baixados[0].alertas, []);
  });
  caso('Bloqueios: fora do relatório agrupa por bloqueio e não soma o valor repetido', function () {
    var r = cruzarBloqueios([], [oc({ blq: 300, valor: 80, status: 'Aguardando transportadora', nfd: 1 }), oc({ prot: 2, blq: '78.300'.replace('78.', ''), valor: 80, status: 'Aguardando transportadora', nfd: 1 }), oc({ prot: 3, blq: 'S/B', status: 'Finalizada' })], HOJE).fora;
    igual(r.length, 1);
    igual(r[0].b, '300');
    igual(r[0].valor, 80);
    igual(r[0].itens.length, 2);
  });
  caso('Bloqueios: cartão leva a linha da ocorrência para abrir detalhe e rascunho', function () {
    igual(cruzarBloqueios([bloco()], [oc({ linha: 2520 })], HOJE).abertos[0].occ[0].linha, 2520);
  });
  caso('Consulta por linha: aceita só linhas válidas, sem repetir e com limite', function () {
    igual(linhasDeOcorrencia([2520, '2521', 2520, 3, 'x', 10.5, null]), [2520, 2521]);
    igual(linhasDeOcorrencia('2520'), []);
    igual(linhasDeOcorrencia(new Array(80).fill(0).map(function (_, i) { return 100 + i; })).length, 50);
  });
  caso('Estoque: cada situação cai na ação certa', function () {
    igual(grupoEstoque_('Aguardando transportadora'), 'coleta');
    igual(grupoEstoque_('Aguardando autorização p/ emissão de NFD'), 'nfd');
    igual(grupoEstoque_('Aguardando emissão de NFD'), 'nfd');
    igual(grupoEstoque_('Tratativa compras'), 'analise');
    igual(grupoEstoque_('Situação nova'), 'analise');
    igual(grupoEstoque_(SEM_STATUS), 'analise');
    igual(grupoEstoque_(COL_SEM_OCORRENCIA), 'sem');
    igual(grupoEstoque_(COL_CONFIRMAR), 'sem');
    igual(grupoEstoque_('Finalizada'), 'baixa');
  });
  caso('Estoque: junta abertos e baixados em tratativa, sem repetir nem somar finalizados', function () {
    var aberto = bloco({ bloqueio: '100', cad: '01/10/2026' });
    var antigo = bloco({ bloqueio: '101', cad: '01/06/2026' });
    var baixado = bloco({ bloqueio: '200', status: 'Bx', baixa: '20/10/2026' });
    var pronto = bloco({ bloqueio: '300', status: 'Bx', baixa: '20/10/2026' });
    var r = relatorioEstoque(cruzarBloqueios([aberto, antigo, baixado, pronto], [
      oc({ blq: 100, status: 'Aguardando transportadora', nfd: 1 }), oc({ prot: 2, blq: 101, status: 'Aguardando transportadora' }),
      oc({ prot: 3, blq: 200, status: 'Aguardando transportadora', nfd: 2 }), oc({ prot: 4, blq: 300, status: 'Finalizada' })
    ], HOJE));
    igual(r.bloqueios, 3);
    igual(r.produtos, 3);
    igual(r.grupos.length, 1);
    igual(r.grupos[0].id, 'coleta');
    igual(r.grupos[0].cartoes.map(function (c) { return c.b; }), ['101', '100', '200'], 'mais antigos primeiro, depois pelo número');
    igual(r.grupos[0].cartoes[0].obs, ['Sem NFD registrada']);
    igual(r.grupos[0].cartoes[2].obs, []);
    igual(r.locais, [{ local: 'AVARIAS', produtos: 3 }]);
  });
  caso('Estoque: cartão traz situação, protocolos e NFs sem repetir, e o grupo conta por situação', function () {
    var dois = bloco({ bloqueio: '100' });
    var um = bloco({ bloqueio: '101' });
    var r = relatorioEstoque(cruzarBloqueios([dois, um], [
      oc({ prot: 7, nf: 55, status: 'Aguardando emissão de NFD' }), oc({ prot: 8, nf: 55, status: 'Aguardando emissão de NFD' }),
      oc({ prot: 9, nf: 66, blq: 101, status: 'Aguardando autorização p/ emissão de NFD' })
    ], HOJE));
    var c = r.grupos[0].cartoes.filter(function (x) { return x.b === '100'; })[0];
    igual(c.col, 'Aguardando emissão de NFD');
    igual(c.prots, ['7', '8']);
    igual(c.nfs, ['55']);
    igual(r.grupos[0].situacoes.length, 2);
    igual(r.grupos[0].situacoes.map(function (s) { return s.bloqueios; }), [1, 1]);
  });
  caso('Estoque: vínculo a confirmar pede a conferência do protocolo', function () {
    var r = relatorioEstoque(cruzarBloqueios([bloco()], [oc({ prot: 2051, blq: '' })], HOJE));
    igual(r.grupos[0].id, 'sem');
    igual(r.grupos[0].cartoes[0].obs, ['Conferir protocolo 2051']);
    igual(r.fora, 0);
  });
  caso('Estoque: conta o que ficou fora do relatório do Santri', function () {
    var r = relatorioEstoque(cruzarBloqueios([], [oc({ blq: 300, status: 'Aguardando transportadora', nfd: 1 }), oc({ prot: 2, blq: 301, status: 'Tratativa compras' })], HOJE));
    igual(r.fora, 2);
    igual(r.foraColeta, 1);
    igual(r.grupos, []);
  });
  caso('Selos: limpa o texto e recusa vazio ou longo demais', function () {
    igual(limparSelo('  Aguardando   retorno '), 'Aguardando retorno');
    igual(limparSelo('   '), '');
    igual(limparSelo(null), '');
    igual(limparSelo(new Array(42).join('x')), '');
    igual(limparSelo(new Array(41).join('x')).length, 40);
  });
  caso('Selos: chave aceita bloqueio ou protocolo e recusa o resto', function () {
    ok(chaveCartaoValida('78652'));
    ok(chaveCartaoValida('P2051'));
    ok(!chaveCartaoValida(''));
    ok(!chaveCartaoValida('78652; drop'));
    ok(!chaveCartaoValida('P'));
  });
  caso('Selos: agrupa por cartão sem repetir, mesmo com caixa ou acento diferente', function () {
    igual(selosPorChave([['1', 'Aguardando retorno'], ['1', 'AGUARDANDO RETORNO'], ['2', 'Conferir físico'], ['2', 'conferir fisico'], ['', 'x'], ['3', '']]),
      { 1: ['Aguardando retorno'], 2: ['Conferir físico'] });
  });
  caso('Selos: opções trazem os padrão e os criados pela equipe, sem repetir', function () {
    igual(opcoesSelos({ 1: ['Zebra', 'aguardando retorno'], 2: ['Avaria grave'] }), SELOS_PADRAO.concat(['Avaria grave', 'Zebra']));
  });
  caso('Bloqueios: ocorrência em andamento sem número aparece e avisa', function () {
    var r = cruzarBloqueios([], [oc({ prot: 9, blq: '-', status: '' })], HOJE).fora[0];
    igual(r.b, '');
    igual(r.col, SEM_STATUS);
    igual(r.alertas, ['Ocorrência sem número de bloqueio']);
  });
}
