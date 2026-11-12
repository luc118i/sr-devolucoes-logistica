/**
 * Rascunho no Gmail para formalizar a ocorrência: assunto + texto (montados na tela, no modelo
 * da equipe) + as fotos das pastas "Protocolo N" como anexos. O rascunho fica no Gmail da conta
 * que executa o Web App ("Executar como: Eu") e nada é enviado — a pessoa revisa e envia.
 *
 * Usa o serviço avançado Gmail com o escopo gmail.compose (só cria rascunhos; não lê a caixa).
 */

/** Limite dos anexos somados (o Gmail aceita ~25 MB por mensagem, já com a codificação). */
var LIMITE_ANEXOS_BYTES = 18 * 1024 * 1024;

/** Base64 em linhas de 76 caracteres (pura). */
function base64EmLinhas(b64) {
  return String(b64).replace(/.{1,76}/g, function (l) { return l + '\r\n'; }).replace(/\r\n$/, '');
}

/** Cabeçalho com acentos: "=?UTF-8?B?…?=" (precisa do codificador por ser dependente do ambiente). */
function cabecalhoUtf8(texto, base64Utf8) {
  return /^[\x20-\x7E]*$/.test(texto) ? texto : '=?UTF-8?B?' + base64Utf8(texto) + '?=';
}

/**
 * Mensagem MIME (multipart/mixed) com texto e anexos (pura: recebe o codificador base64).
 * @param {{assunto, texto, anexos: Array<{nome, tipo, base64}>, fronteira}} m
 * @param {function(string): string} base64Utf8  texto → base64 dos bytes UTF-8
 */
function montarMime(m, base64Utf8) {
  var f = m.fronteira;
  var L = ['MIME-Version: 1.0'];
  if (m.para && m.para.length) L.push('To: ' + m.para.join(', '));
  if (m.cc && m.cc.length) L.push('Cc: ' + m.cc.join(', '));
  L.push('Subject: ' + cabecalhoUtf8(m.assunto, base64Utf8),
    'Content-Type: multipart/mixed; boundary="' + f + '"',
    '');
  var parteTexto = function (tipo, conteudo) {
    return ['Content-Type: ' + tipo + '; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', base64EmLinhas(base64Utf8(conteudo))];
  };
  if (m.html) {
    // mixed > related > (alternative: texto | html) + imagem da assinatura (cid:assinatura)
    var fr = f + '_rel', fa = f + '_alt';
    L.push('--' + f, 'Content-Type: multipart/related; boundary="' + fr + '"', '',
      '--' + fr, 'Content-Type: multipart/alternative; boundary="' + fa + '"', '',
      '--' + fa);
    L = L.concat(parteTexto('text/plain', m.texto));
    L.push('--' + fa);
    L = L.concat(parteTexto('text/html', m.html));
    L.push('--' + fa + '--', '');
    if (m.imagemInline) {
      // No formato das imagens inline do próprio Gmail: sem X-Attachment-Id (= Content-ID), o Gmail
      // perde o vínculo com o cid: ao reabrir o rascunho e enviar, e a assinatura chega quebrada.
      var cid = m.imagemInline.cid || 'assinatura';
      var arq = 'assinatura.' + (TIPOS_ASSINATURA[m.imagemInline.tipo] || 'png');
      L.push('--' + fr,
        'Content-Type: ' + m.imagemInline.tipo + '; name="' + arq + '"',
        'Content-Disposition: inline; filename="' + arq + '"',
        'Content-Transfer-Encoding: base64',
        'Content-ID: <' + cid + '>',
        'X-Attachment-Id: ' + cid, '',
        base64EmLinhas(m.imagemInline.base64));
    }
    L.push('--' + fr + '--', '');
  } else {
    L.push('--' + f);
    L = L.concat(parteTexto('text/plain', m.texto));
  }
  (m.anexos || []).forEach(function (a) {
    var nome = cabecalhoUtf8(a.nome, base64Utf8).replace(/"/g, '');
    L.push('--' + f,
      'Content-Type: ' + (a.tipo || 'application/octet-stream') + '; name="' + nome + '"',
      'Content-Disposition: attachment; filename="' + nome + '"',
      'Content-Transfer-Encoding: base64',
      '',
      base64EmLinhas(a.base64));
  });
  L.push('--' + f + '--', '');
  return L.join('\r\n');
}

var COR_DESTAQUE_EMAIL = '#D00000';

function escaparHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Texto do modelo → HTML do e-mail (pura), no padrão da equipe:
 * rótulos ("NF DE ENTRADA:", "PEDIDO:"…) e títulos de seção em negrito, opção marcada "(X)" em negrito,
 * linha do produto e a observação logo abaixo em vermelho e negrito. Respeita o que a pessoa editou.
 * @param {string} texto
 * @param {{assinatura?: boolean, cidAssinatura?: string}} opcoes  assinatura = inclui <img src="cid:…"> no fim
 */
function textoParaHtml(texto, opcoes) {
  opcoes = opcoes || {};
  var linhas = String(texto || '').replace(/\r/g, '').split('\n');
  var emProduto = false;
  var html = linhas.map(function (l) {
    var t = l.trim();
    if (!t) { emProduto = false; return '<br>'; }
    var e = escaparHtml(l);
    if (lerLinhaProduto(t)) { emProduto = true; return '<b style="color:' + COR_DESTAQUE_EMAIL + '">' + e + '</b><br>'; }
    if (emProduto && !lerRotulo_(t) && !FIM_EMAIL.test(normalizar(t))) return '<b style="color:' + COR_DESTAQUE_EMAIL + '">' + e + '</b><br>';
    emProduto = false;
    if (lerRotulo_(t)) {
      var i = l.indexOf(':');
      return '<b>' + escaparHtml(l.slice(0, i + 1)) + '</b>' + escaparHtml(l.slice(i + 1)) + '<br>';
    }
    if (ehSecao_(t, SECOES_EMAIL.tipos)) return '<b>' + e + '</b><br>';
    if (MARCAS_EMAIL.antes.test(t)) return '<b>' + e + '</b><br>';
    return e + '<br>';
  }).join('\n');
  // width="600": a imagem é guardada com até 1200 px (nítida em telas de alta resolução) e exibida a 600 px
  if (opcoes.assinatura) html += '\n<br><img src="cid:' + (opcoes.cidAssinatura || 'assinatura') + '" alt="Assinatura" width="600" style="width:100%;max-width:600px;height:auto;display:block">';
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">\n' + html + '\n</div>';
}

/** "a@x.com; b@y.com, c@z.com" → lista válida; lança erro com o endereço inválido (pura). */
function listaEmails(texto) {
  var itens = String(texto || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(String);
  itens.forEach(function (x) {
    if (!/^[^\s@<>"(),;:]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(x)) throw new Error('E-mail inválido: ' + x);
  });
  if (itens.length > 20) throw new Error('No máximo 20 endereços por campo.');
  return itens.filter(function (x, i, a) { return a.map(function (y) { return y.toLowerCase(); }).indexOf(x.toLowerCase()) === i; });
}

/**
 * Cria o rascunho e devolve o link para abri-lo.
 * @param {{assunto: string, texto: string, protocolos: string[]}} dados
 * @return {{url, anexados, total, deFora: string[], pastas: Array<{nome, url}>, conta}}
 */
function criarRascunhoGmail(dados) {
  return api_('criarRascunhoGmail', function () {
    dados = dados || {};
    var assunto = String(dados.assunto || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
    var texto = String(dados.texto || '').slice(0, 50000);
    if (!assunto || !texto.trim()) throw new Error('Assunto e texto do e-mail são obrigatórios.');
    var protocolos = (Array.isArray(dados.protocolos) ? dados.protocolos : [])
      .map(somenteDigitos).filter(String).filter(function (p, i, a) { return a.indexOf(p) === i; }).slice(0, 50);

    // Pastas e arquivos dos protocolos (cada pasta uma vez só)
    var pastas = [], vistas = {}, arquivos = [];
    protocolos.forEach(function (p) {
      var pasta = pastaDoProtocolo_(p);
      if (!pasta || vistas[pasta.getId()]) return;
      vistas[pasta.getId()] = true;
      pastas.push({ nome: pasta.getName(), url: pasta.getUrl() });
      var it = pasta.getFiles();
      var daPasta = [];
      while (it.hasNext()) daPasta.push(it.next());
      daPasta.sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
      arquivos = arquivos.concat(daPasta);
    });

    var anexos = [], deFora = [], soma = 0;
    arquivos.forEach(function (f) {
      var tam = f.getSize();
      if (f.getMimeType().indexOf('application/vnd.google-apps') === 0) { deFora.push(f.getName() + ' (arquivo do Google, não anexável)'); return; }
      if (soma + tam > LIMITE_ANEXOS_BYTES) { deFora.push(f.getName()); return; }
      soma += tam;
      anexos.push({ nome: f.getName(), tipo: f.getMimeType(), base64: Utilities.base64Encode(f.getBlob().getBytes()) });
    });

    var corpo = texto.replace(/\s+$/, '');
    // As fotos vão anexadas; o link da pasta só entra se alguma ficou de fora (para não se perder).
    if (deFora.length && pastas.length) {
      corpo += '\n\nArquivos que não couberam no e-mail estão no Drive:\n' + pastas.map(function (p) { return p.nome + ': ' + p.url; }).join('\n');
    }

    var cfg = configEmail_();
    var assinatura = cfg.assinaturaId ? arquivoAssinatura_(cfg.assinaturaId) : null;
    // cid único por mensagem (como o "ii_…" do Gmail): um cid fixo pode colidir em respostas/encaminhamentos
    var cid = 'ii_sr' + Utilities.getUuid().replace(/-/g, '').slice(0, 14);
    var b64 = function (s) { return Utilities.base64Encode(s, Utilities.Charset.UTF_8); };
    var mime = montarMime({
      assunto: assunto, texto: corpo, anexos: anexos, fronteira: 'sr_' + Utilities.getUuid().replace(/-/g, ''),
      para: cfg.para, cc: cfg.cc,
      html: textoParaHtml(corpo, { assinatura: !!assinatura, cidAssinatura: cid }),
      imagemInline: assinatura ? { tipo: assinatura.getMimeType(), cid: cid, base64: Utilities.base64Encode(assinatura.getBlob().getBytes()) } : null
    }, b64);
    var rascunho = Gmail.Users.Drafts.create({}, 'me', Utilities.newBlob(mime, 'message/rfc822'));

    var conta = Session.getEffectiveUser().getEmail();
    var url = 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(conta) + '#drafts?compose=' + rascunho.message.id;
    registrarLog_('RASCUNHO GMAIL', usuario_(), JSON.stringify({ assunto: assunto, protocolos: protocolos, anexos: anexos.length, deFora: deFora.length }));
    return { url: url, anexados: anexos.length, total: arquivos.length, deFora: deFora, pastas: pastas, conta: conta,
      para: cfg.para, cc: cfg.cc, comAssinatura: !!assinatura };
  });
}

// ── Configuração do e-mail (aba CONFIG_APP, parâmetros EMAIL_*) ──────────────

var LIMITE_ASSINATURA_BYTES = 1024 * 1024;
var TIPOS_ASSINATURA = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };

/** {nome, para[], cc[], assinaturaId} lidos da CONFIG_APP. */
function configEmail_() {
  var p = lerConfigApp_().parametros;
  var lista = function (v) { try { return listaEmails(v); } catch (e) { return []; } };
  return {
    nome: String(p.EMAIL_NOME || '').trim(),
    para: lista(p.EMAIL_PARA),
    cc: lista(p.EMAIL_CC),
    assinaturaId: String(p.EMAIL_ASSINATURA_ID || '').trim()
  };
}

/** Arquivo da assinatura (só se for imagem e couber); null se sumiu. */
function arquivoAssinatura_(id) {
  try {
    var f = DriveApp.getFileById(id);
    if (f.isTrashed() || !TIPOS_ASSINATURA[f.getMimeType()] || f.getSize() > LIMITE_ASSINATURA_BYTES) return null;
    return f;
  } catch (e) { return null; }
}

/** Para a tela: configuração atual + a imagem da assinatura (data URL) para pré-visualizar. */
function obterConfigEmail() {
  return api_('obterConfigEmail', function () {
    var c = configEmail_();
    var f = c.assinaturaId ? arquivoAssinatura_(c.assinaturaId) : null;
    return {
      nome: c.nome, para: c.para.join(', '), cc: c.cc.join(', '),
      assinatura: f ? 'data:' + f.getMimeType() + ';base64,' + Utilities.base64Encode(f.getBlob().getBytes()) : '',
      conta: Session.getEffectiveUser().getEmail()
    };
  });
}

/**
 * Salva nome, destinatários e (opcional) a nova imagem da assinatura.
 * @param {{nome, para, cc, assinatura?: {tipo, base64}|null, removerAssinatura?: boolean}} d
 */
function salvarConfigEmail(d) {
  return api_('salvarConfigEmail', function () {
    d = d || {};
    var nome = textoSeguro(d.nome, 80);
    var para = listaEmails(d.para), cc = listaEmails(d.cc);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('A planilha está ocupada. Tente de novo em alguns segundos.');
    try {
      definirParametro_('EMAIL_NOME', nome);
      definirParametro_('EMAIL_PARA', para.join(', '));
      definirParametro_('EMAIL_CC', cc.join(', '));
      var atual = configEmail_().assinaturaId;
      if (d.assinatura && d.assinatura.base64) {
        var tipo = String(d.assinatura.tipo || '');
        if (!TIPOS_ASSINATURA[tipo]) throw new Error('A assinatura precisa ser PNG, JPG ou GIF.');
        var bytes = Utilities.base64Decode(String(d.assinatura.base64).replace(/^data:[^,]*,/, ''));
        if (bytes.length > LIMITE_ASSINATURA_BYTES) throw new Error('Imagem da assinatura grande demais (máx. 1 MB).');
        var novo = pastaFotosRaiz_().createFile(Utilities.newBlob(bytes, tipo, 'assinatura_email.' + TIPOS_ASSINATURA[tipo]));
        definirParametro_('EMAIL_ASSINATURA_ID', novo.getId());
        if (atual) { try { DriveApp.getFileById(atual).setTrashed(true); } catch (e) { /* já não existe */ } }
      } else if (d.removerAssinatura && atual) {
        definirParametro_('EMAIL_ASSINATURA_ID', '');
        try { DriveApp.getFileById(atual).setTrashed(true); } catch (e) { /* já não existe */ }
      }
      limparCache();
    } finally {
      lock.releaseLock();
    }
    registrarLog_('CONFIG E-MAIL', usuario_(), JSON.stringify({ nome: nome, para: para.length, cc: cc.length }));
    return obterConfigEmail();
  });
}
