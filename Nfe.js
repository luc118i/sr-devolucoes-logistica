/**
 * Leitura do XML da NF-e (procNFe ou NFe) — só XmlService, sem planilha/Drive.
 */

var NS_NFE = 'http://www.portalfiscal.inf.br/nfe';

/**
 * Dados da nota e itens. Lança erro com mensagem clara se o arquivo não for uma NF-e.
 * @return {{chave,numero,serie,modelo,emissao,natOp,emitente:{cnpj,nome,fantasia},destinatario:{cnpj,nome},
 *           valorTotal,infCpl,pedidos:string[],itens:Array}}
 */
function lerNfe(xmlTexto) {
  if (!xmlTexto || typeof xmlTexto !== 'string') throw new Error('Arquivo XML vazio.');
  var doc;
  try {
    doc = XmlService.parse(xmlTexto.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error('Não foi possível ler o XML (arquivo corrompido ou não é XML).');
  }
  var raiz = doc.getRootElement();
  var ns = XmlService.getNamespace(NS_NFE);
  var nfe = raiz.getName() === 'nfeProc' ? raiz.getChild('NFe', ns) : (raiz.getName() === 'NFe' ? raiz : null);
  var inf = nfe && nfe.getChild('infNFe', ns);
  if (!inf) throw new Error('O arquivo não é uma NF-e (não encontrei infNFe).');

  var t = function (el, caminho) {
    var atual = el;
    var partes = caminho.split('/');
    for (var i = 0; i < partes.length; i++) {
      if (!atual) return '';
      atual = atual.getChild(partes[i], ns);
    }
    return atual ? String(atual.getText()).trim() : '';
  };

  var prot = raiz.getName() === 'nfeProc' ? raiz.getChild('protNFe', ns) : null;
  var chave = (prot && t(prot, 'infProt/chNFe')) || String(inf.getAttribute('Id') ? inf.getAttribute('Id').getValue() : '').replace(/^NFe/, '');
  var infCpl = t(inf, 'infAdic/infCpl');

  var itens = inf.getChildren('det', ns).map(function (det, i) {
    var p = det.getChild('prod', ns);
    var ean = t(p, 'cEAN');
    return {
      nItem: Number(det.getAttribute('nItem') ? det.getAttribute('nItem').getValue() : i + 1),
      codigo: t(p, 'cProd'),
      ean: /^\d{8,14}$/.test(ean) ? ean : '',
      descricao: t(p, 'xProd'),
      unidade: t(p, 'uCom'),
      quantidade: Number(t(p, 'qCom')) || 0,
      valorUnitario: Number(t(p, 'vUnCom')) || 0,
      valorTotal: Number(t(p, 'vProd')) || 0,
      pedidoItem: t(p, 'xPed')
    };
  });

  return {
    chave: chave,
    numero: t(inf, 'ide/nNF'),
    serie: t(inf, 'ide/serie'),
    modelo: t(inf, 'ide/mod'),
    emissao: t(inf, 'ide/dhEmi') || t(inf, 'ide/dEmi'),
    natOp: t(inf, 'ide/natOp'),
    emitente: { cnpj: t(inf, 'emit/CNPJ') || t(inf, 'emit/CPF'), nome: t(inf, 'emit/xNome'), fantasia: t(inf, 'emit/xFant') },
    destinatario: { cnpj: t(inf, 'dest/CNPJ') || t(inf, 'dest/CPF'), nome: t(inf, 'dest/xNome') },
    valorTotal: Number(t(inf, 'total/ICMSTot/vNF')) || 0,
    infCpl: infCpl,
    pedidos: extrairPedidos(infCpl),
    itens: itens
  };
}

/**
 * Números de pedido citados nas informações complementares, sem repetição, só dígitos.
 * Ex.: "…referente ao pedido 3.624.130; … ENT 3.777.791 PED 3.624.130;" → ["3624130"]
 * Não pega "pedido de compra no OC:123451" (é o pedido do cliente, não o da Objetiva).
 */
function extrairPedidos(texto) {
  var re = /\bPED(?:IDO)?\b\.?\s*(?:N[º°O]?\.?\s*)?:?\s*(\d{1,3}(?:\.\d{3})+|\d{4,})/gi;
  var vistos = {}, lista = [], m;
  while ((m = re.exec(String(texto || ''))) !== null) {
    var n = m[1].replace(/\./g, '');
    if (!vistos[n]) { vistos[n] = true; lista.push(n); }
  }
  return lista;
}

/** Partes da chave de acesso (44 dígitos), sem abrir o arquivo. null se não for chave. */
function infoDaChave(texto) {
  var m = /(\d{44})/.exec(String(texto || ''));
  if (!m) return null;
  var c = m[1];
  return {
    chave: c,
    cnpjEmitente: c.substr(6, 14),
    modelo: c.substr(20, 2),
    serie: String(Number(c.substr(22, 3))),
    numero: String(Number(c.substr(25, 9)))
  };
}
