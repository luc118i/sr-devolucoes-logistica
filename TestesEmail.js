/**
 * Testes do interpretador de e-mail (chamados por testarRegras, no editor e no Node).
 * Os números abaixo são de exemplo.
 */
function testesEmail_(caso, ok, igual) {
  var listas = {
    tipos: ['Produto faltando dentro dos volumes', 'Produto avariado/danificado', 'Produto em desacordo/trocado', 'Faltando volumes', 'Material com defeito', 'DESISTÊNCIA'],
    conferentes: ['Isaias Gomes', 'Daniel Angelo', 'Paulo Henrique']
  };
  var LISTA_TIPOS = 'TIPO DE OCORRÊNCIA\n\n- PRODUTO FALTANDO DENTRO DOS VOLUMES\n- PRODUTO AVARIADO/DANIFICADO\n- PRODUTO EM DESACORDO/TROCADO\n- FALTANDO VOLUMES\n- MATERIAL COM DEFEITO\n';
  function email(o) {
    o = o || {};
    return [
      'Assunto: Seguem dados Ref. ocorrência da NF: ' + (o.nfAssunto || '3.124.304') + ' - SR Recebimento / Fracionados',
      'De: ednaldo@soreparos.com.br',
      'Enviado em: quinta-feira, 15 de outubro de 2026 14:32',
      '', 'Boa tarde!', '',
      'NF DE ENTRADA: ' + (o.nf || '3.124.304'),
      'PEDIDO: ' + (o.pedido || '3.624.130'),
      'BLOQUEIO: ' + (o.bloqueio || '77.541'), '',
      'FORNECEDOR: Objetiva', '',
      'CONFERENTE:' + (o.conferente === undefined ? ' Isaias Gomes' : o.conferente), '',
      'E-MAIL FORMATADO POR:' + (o.formatado === undefined ? ' Ednaldo' : o.formatado), '',
      o.tipos || LISTA_TIPOS,
      'DESCRIÇÃO DO ITEM', '',
      o.descricao || 'PRODUTO EM DESACORDO/TROCADO\n\n02 UNIDADE(S) DO PRODUTO: 175.192 / 69514 - CORANTE SUVINIL 6100 AZUL BI 900ML.',
      '', 'Att.'
    ].join('\n');
  }
  var ler = function (txt, html) { return interpretarEmailOcorrencia(txt, html || '', listas); };

  caso('E-mail 1: completo', function () {
    var r = ler(email());
    igual([r.campos.nf.valor, r.campos.nf.status], ['3124304', 'ok'], 'nf');
    igual([r.campos.pedido.valor, r.campos.bloqueio.valor], ['3624130', '77541'], 'pedido/bloqueio');
    igual([r.campos.fornecedor.valor, r.campos.conferente.valor, r.campos.conferente.status], ['Objetiva', 'Isaias Gomes', 'ok'], 'textos');
    igual(r.campos.formatadoPor.valor, 'Ednaldo');
    igual(r.itens.length, 1);
    var it = r.itens[0];
    igual([it.qtd, it.codProduto, it.codIntegracao, it.status], ['2', '175192', '69514', 'ok'], 'item');
    igual(it.descricao, 'CORANTE SUVINIL 6100 AZUL BI 900ML');
    igual([it.tipo.valor, it.tipo.status], ['Produto em desacordo/trocado', 'ok'], 'tipo');
    // data de envio não vira data da ocorrência
    igual([r.campos.data.valor, r.campos.data.status, r.campos.data.dataEnvio], ['', 'ausente', '2026-10-15'], 'data');
    ok(/não é usado como conferente/.test(r.informativos.join()), 'remetente informativo');
  });

  caso('E-mail 2: conferente ausente (não usa a linha seguinte nem o remetente)', function () {
    var r = ler(email({ conferente: '' }));
    igual([r.campos.conferente.valor, r.campos.conferente.status], ['', 'ausente']);
  });

  caso('E-mail 3: formatado por ausente', function () {
    var r = ler(email({ formatado: '' }));
    igual([r.campos.formatadoPor.valor, r.campos.formatadoPor.status], ['', 'ausente']);
  });

  caso('E-mail 4: categoria marcada na lista (X)', function () {
    var tipos = LISTA_TIPOS.replace('- MATERIAL COM DEFEITO', '(X) MATERIAL COM DEFEITO');
    var r = ler(email({ tipos: tipos, descricao: '01 UNIDADE(S) DO PRODUTO: 130.816 / 5121 - VALVULA P/MICTORIO' }));
    igual(r.tiposMarcados, ['Material com defeito']);
    igual([r.itens[0].tipo.valor, r.itens[0].tipo.status], ['Material com defeito', 'ok']);
    var r2 = ler(email({ tipos: 'TIPO DE OCORRÊNCIA: FALTANDO VOLUMES\n', descricao: '01 UN DO PRODUTO: 130.816 / 5121 - VALVULA' }));
    igual(r2.itens[0].tipo.valor, 'Faltando volumes', 'na mesma linha');
  });

  caso('E-mail 5: todas as categorias listadas, nenhuma marcada → não escolhe', function () {
    var r = ler(email({ descricao: '01 UNIDADE(S) DO PRODUTO: 130.816 / 5121 - VALVULA P/MICTORIO' }));
    igual(r.tiposMarcados, []);
    igual([r.itens[0].tipo.valor, r.itens[0].tipo.status], ['', 'confirmar']);
    ok(r.itens[0].tipo.alternativas.length >= 5, 'oferece as opções');
  });

  caso('E-mail 6: vários produtos, cada um com sua categoria', function () {
    var r = ler(email({ descricao: 'PRODUTO AVARIADO/DANIFICADO\n01 UNIDADE(S) DO PRODUTO: 193.480 / 87104 - CX DECA P/BACIA\nCaixa amassada na lateral.\n\nFALTANDO VOLUMES\n20 PEÇA(S) DO PRODUTO: 157.944 / 24744 - INTERRUPTOR ZEFFIA\n03 UNIDADES DO PRODUTO: 150.755 / 24743 - TOMADA ZEFFIA' }));
    igual(r.itens.length, 3);
    igual(r.itens.map(function (i) { return [i.qtd, i.codProduto, i.codIntegracao, i.tipo.valor]; }), [
      ['1', '193480', '87104', 'Produto avariado/danificado'],
      ['20', '157944', '24744', 'Faltando volumes'],
      ['3', '150755', '24743', 'Faltando volumes']]);
    igual(r.itens[0].obs, 'Caixa amassada na lateral.', 'observação fica com o item certo');
    igual(r.itens[1].obs, '');
  });

  caso('E-mail 7: zeros à esquerda preservados; zeros de modelo não viram valor', function () {
    var r = ler(email({ nf: '0.012.345', nfAssunto: '0.012.345', bloqueio: '07.541', descricao: '05 UNIDADE(S) DO PRODUTO: 012.345 / 00987 - LUVA TIGRE' }));
    igual([r.campos.nf.valor, r.campos.bloqueio.valor], ['0012345', '07541']);
    igual([r.itens[0].codProduto, r.itens[0].codIntegracao, r.itens[0].qtd], ['012345', '00987', '5']);
    var m = ler(email({ nf: '0.000.000', nfAssunto: '0.000.000', pedido: '0.000.000', bloqueio: '00.000', descricao: '00 UNIDADE(S) DO PRODUTO: 000.000 / 00000 - Produto mencionado na ocorrência.' }));
    igual([m.campos.nf.valor, m.campos.nf.status, m.campos.pedido.status, m.campos.bloqueio.status], ['', 'confirmar', 'confirmar', 'confirmar']);
    igual([m.itens[0].codProduto, m.itens[0].status], ['', 'confirmar']);
    var sb = ler(email({ bloqueio: 'S/B' }));
    igual([sb.campos.bloqueio.valor, sb.campos.bloqueio.status], ['S/B', 'ok']);
  });

  caso('E-mail 8: HTML, espaços e quebras irregulares; destaque em negrito = seleção', function () {
    var html = '<div>Boa&nbsp;tarde!</div><p>NF&nbsp;DE ENTRADA:&nbsp;&nbsp; 3.124.304</p><p>PEDIDO:   3.624.130<br>BLOQUEIO: 77.541</p>' +
      '<p>FORNECEDOR:&nbsp;Objetiva</p><p>CONFERENTE: <span>Daniel   Angelo</span></p><p>TIPO DE OCORRÊNCIA</p><ul>' +
      '<li>PRODUTO FALTANDO DENTRO DOS VOLUMES</li><li><b>PRODUTO AVARIADO/DANIFICADO</b></li><li>PRODUTO EM DESACORDO/TROCADO</li>' +
      '<li>FALTANDO VOLUMES</li><li>MATERIAL COM DEFEITO</li></ul><p>DESCRIÇÃO DO ITEM</p><p>  01 UNIDADE(S)   DO PRODUTO:  193.480 /  87104 - CX DECA  </p><p>Att.</p>';
    var r = ler('', html);
    igual([r.campos.nf.valor, r.campos.pedido.valor, r.campos.bloqueio.valor, r.campos.conferente.valor], ['3124304', '3624130', '77541', 'Daniel Angelo']);
    igual(r.tiposMarcados, ['Produto avariado/danificado']);
    igual([r.itens[0].codProduto, r.itens[0].codIntegracao, r.itens[0].tipo.valor], ['193480', '87104', 'Produto avariado/danificado']);
    // texto colado (sem HTML) com o mesmo conteúdo: sem negrito não há seleção
    var r2 = ler(htmlParaTexto(html));
    igual(r2.tiposMarcados, []);
  });

  caso('E-mail 9: NF diferente no assunto e no corpo → conflito', function () {
    var r = ler(email({ nfAssunto: '3.124.305' }));
    igual([r.campos.nf.status, r.campos.nf.valor], ['conflito', '3124304']);
    igual(r.campos.nf.alternativas, ['3124304', '3124305']);
  });

  caso('E-mail 10: fora do padrão / incompleto', function () {
    var r = ler('Oi, tudo bem? Pode ver a nota da Objetiva depois?');
    ok(/não parece o e-mail/.test(r.avisos.join()), r.avisos.join());
    igual(r.itens, []);
    igual(r.campos.nf.status, 'ausente');
    var inc = ler('NF DE ENTRADA: 3.124.304\nFORNECEDOR: Objetiva\n1 UNIDADE DO PRODUTO: CX DECA SEM CODIGO');
    igual([inc.campos.nf.valor, inc.campos.pedido.status, inc.campos.bloqueio.status], ['3124304', 'ausente', 'ausente']);
    igual(inc.itens[0].status, 'confirmar', 'produto sem código preservado para revisão');
    ok(/CX DECA SEM CODIGO/.test(inc.itens[0].descricao + inc.itens[0].nota), 'texto original mantido');
  });

  caso('E-mail: conferente fora da lista e categoria do item × marcada', function () {
    var r = ler(email({ conferente: ' Isaias' }));
    igual([r.campos.conferente.status, r.campos.conferente.sugestoes], ['confirmar', ['Isaias Gomes']]);
    var tipos = LISTA_TIPOS.replace('- FALTANDO VOLUMES', '[x] FALTANDO VOLUMES');
    var c = ler(email({ tipos: tipos }));
    igual(c.itens[0].tipo.status, 'conflito');
  });

  caso('Rascunho: mensagem MIME com texto acentuado e anexos', function () {
    var b64 = function (s) { return Utilities.base64Encode(s, Utilities.Charset.UTF_8); };
    var mime = montarMime({
      assunto: 'Seguem dados Ref. ocorrência da NF: 3.138.788', texto: 'NF DE ENTRADA: 3.138.788\nDESCRIÇÃO DO ITEM',
      anexos: [{ nome: '01_colada.jpg', tipo: 'image/jpeg', base64: b64('x'.repeat(200)) }, { nome: 'laudo técnico.pdf', tipo: 'application/pdf', base64: b64('pdf') }],
      fronteira: 'sr_teste'
    }, b64);
    ok(/^MIME-Version: 1\.0\r\n/.test(mime), 'cabeçalho MIME');
    ok(mime.indexOf('Subject: =?UTF-8?B?' + b64('Seguem dados Ref. ocorrência da NF: 3.138.788') + '?=') >= 0, 'assunto com acento codificado');
    igual((mime.match(/--sr_teste\r\n/g) || []).length, 3, 'texto + 2 anexos');
    ok(/--sr_teste--\r\n$/.test(mime), 'fecha a fronteira');
    ok(mime.indexOf('filename="01_colada.jpg"') >= 0 && mime.indexOf('filename="=?UTF-8?B?') >= 0, 'nomes dos anexos');
    ok(mime.split('\r\n').every(function (l) { return l.length <= 998; }), 'linhas dentro do limite do e-mail');
    ok(/^[\x00-\x7F]*$/.test(mime), 'só ASCII no MIME (acentos codificados)');
  });

  caso('Rascunho formatado: negrito, vermelho no produto, assinatura e destinatários', function () {
    var texto = 'Bom dia!\n\nNF DE ENTRADA: 3.138.788\nPEDIDO: 3.638.330\n\nE-MAIL FORMATADO POR: Ednaldo <teste>\n\nTIPO DE OCORRÊNCIA\n\n' +
      '(X) PRODUTO FALTANDO DENTRO DOS VOLUMES\n( ) PRODUTO AVARIADO/DANIFICADO\n\nDESCRIÇÃO DO ITEM\n\nPRODUTO FALTANDO DENTRO DOS VOLUMES\n\n' +
      '02 UNIDADE(S) DO PRODUTO: 158.831 / 24.466 - CONDUITE TIGRE REFORCADO 20MM.\nMaterial faltando\n\nAtt.';
    var html = textoParaHtml(texto, { assinatura: true });
    ok(html.indexOf('<b>NF DE ENTRADA:</b> 3.138.788') >= 0, 'rótulo em negrito');
    ok(html.indexOf('<b>TIPO DE OCORRÊNCIA</b>') >= 0, 'seção em negrito');
    ok(html.indexOf('<b>(X) PRODUTO FALTANDO DENTRO DOS VOLUMES</b>') >= 0, 'opção marcada em negrito');
    ok(html.indexOf('( ) PRODUTO AVARIADO/DANIFICADO<br>') >= 0 && html.indexOf('<b>( )') < 0, 'opção não marcada normal');
    ok(/<b style="color:#D00000">02 UNIDADE\(S\) DO PRODUTO: 158\.831/.test(html), 'produto em vermelho');
    ok(html.indexOf('<b style="color:#D00000">Material faltando</b>') >= 0, 'observação do produto em vermelho');
    ok(html.indexOf('Att.<br>') >= 0 && html.indexOf('color:#D00000">Att.') < 0, 'Att. sem destaque');
    ok(html.indexOf('Ednaldo &lt;teste&gt;') >= 0, 'texto escapado');
    ok(html.indexOf('cid:assinatura') >= 0, 'assinatura no fim');
    var b64 = function (s) { return Utilities.base64Encode(s, Utilities.Charset.UTF_8); };
    var mime = montarMime({ assunto: 'Teste', texto: texto, html: html, para: ['a@soreparos.com.br'], cc: ['b@x.com', 'c@y.com'],
      imagemInline: { tipo: 'image/png', base64: b64('png') }, anexos: [{ nome: 'f.jpg', tipo: 'image/jpeg', base64: b64('j') }], fronteira: 'fz' }, b64);
    ok(mime.indexOf('To: a@soreparos.com.br\r\nCc: b@x.com, c@y.com\r\n') >= 0, 'destinatários');
    ok(mime.indexOf('multipart/related; boundary="fz_rel"') >= 0 && mime.indexOf('multipart/alternative; boundary="fz_alt"') >= 0, 'estrutura');
    ok(mime.indexOf('Content-ID: <assinatura>\r\nX-Attachment-Id: assinatura\r\n') >= 0, 'imagem inline vinculada ao cid');
    ok(mime.indexOf('filename="assinatura.png"') >= 0, 'nome da imagem com extensão');
    var comCid = textoParaHtml('Att.', { assinatura: true, cidAssinatura: 'ii_x1' });
    ok(comCid.indexOf('src="cid:ii_x1"') >= 0, 'cid personalizado no HTML');
    ok(/--fz_alt--\r\n[\s\S]*--fz_rel--\r\n[\s\S]*--fz--\r\n$/.test(mime), 'fronteiras fechadas na ordem');
    igual(listaEmails('a@x.com; b@y.com,  A@x.com'), ['a@x.com', 'b@y.com']);
    var erro = ''; try { listaEmails('a@x.com, nao-e-email'); } catch (e) { erro = e.message; }
    ok(/nao-e-email/.test(erro), erro);
  });

  caso('E-mail: perfis (assunto com {NF}, validação, escolha)', function () {
    igual(aplicarModeloAssunto('Seguem dados Ref. ocorrência da NF: {NF} - SR Recebimento', '3.046.462'), 'Seguem dados Ref. ocorrência da NF: 3.046.462 - SR Recebimento');
    igual(aplicarModeloAssunto('Seguem dados Ref. ocorrência da NF: {nf} - SR Reversa', '3.135.396'), 'Seguem dados Ref. ocorrência da NF: 3.135.396 - SR Reversa');
    igual(aplicarModeloAssunto('', '1'), 'Seguem dados Ref. ocorrência da NF: 1 - SR Recebimento');
    var n = 0, novoId = function () { return 'novo' + (++n); };
    var v = validarPerfisEmail([
      { id: 'a', nome: ' Recebimento ', assunto: 'x {NF}', para: 'a@x.com; A@x.com', cc: '', formatador: 'Ed' },
      { nome: 'Reversa', assunto: 'y {NF}', para: '', cc: 'b@y.com' }
    ], novoId);
    igual([v[0].id, v[0].nome, v[0].para, v[1].id, v[1].cc], ['a', 'Recebimento', ['a@x.com'], 'novo1', ['b@y.com']]);
    var falha = function (lista) { try { validarPerfisEmail(lista, novoId); return ''; } catch (e) { return e.message; } };
    ok(/ao menos um/.test(falha([])), 'lista vazia');
    ok(/nome do perfil/.test(falha([{ nome: ' ', assunto: 'x' }])), 'sem nome');
    ok(/informe o assunto/.test(falha([{ nome: 'A', assunto: '' }])), 'sem assunto');
    ok(/dois perfis/.test(falha([{ nome: 'A', assunto: 'x' }, { nome: 'a', assunto: 'y' }])), 'nome repetido');
    ok(/Perfil "A".*nao-email/.test(falha([{ nome: 'A', assunto: 'x', para: 'nao-email' }])), 'e-mail inválido aponta o perfil');
    igual(perfilPorId_(v, 'novo1').nome, 'Reversa');
    igual([v[0].de, validarPerfisEmail([{ nome: 'R', assunto: 'x', de: 'Reversa@SoReparos.com.br' }], novoId)[0].de], ['', 'Reversa@SoReparos.com.br']);
    ok(/remetente/.test(falha([{ nome: 'A', assunto: 'x', de: 'invalido' }])), 'De inválido');
    ok(/um só remetente/.test(falha([{ nome: 'A', assunto: 'x', de: 'a@x.com, b@x.com' }])), 'dois remetentes');
    var m = montarMime({ assunto: 'T', texto: 't', de: 'reversa@soreparos.com.br', fronteira: 'f' }, function (s) { return s; });
    ok(m.indexOf('From: reversa@soreparos.com.br' + String.fromCharCode(13, 10)) >= 0, 'cabeçalho From');
    igual(perfilPorId_(v, 'sumiu').nome, 'Recebimento');
  });

  caso('E-mail: data da ocorrência explícita e datas por extenso', function () {
    var r = ler(email().replace('Boa tarde!', 'Boa tarde!\nDATA DA OCORRÊNCIA: 14/10/2026'));
    igual([r.campos.data.valor, r.campos.data.status], ['2026-10-14', 'ok']);
    igual([dataDoTexto('qui., 15 de out. de 2026, 14:32'), dataDoTexto('2026-10-01'), dataDoTexto('31/02/2026')], ['2026-10-15', '2026-10-01', '']);
  });
}
