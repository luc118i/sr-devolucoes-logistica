/**
 * Fotos da ocorrência: uma pasta "Protocolo N" por PROTOCOLO (= por produto), dentro da pasta
 * configurada em PASTA_FOTOS_ID (CONFIG_APP). N = valor da coluna "Nº Protocolo"
 * (fórmula da planilha). Um registro com vários produtos grava várias linhas e cria uma pasta
 * para cada protocolo (as fotos vão para todas). Pastas antigas "Protocolo N a M" continuam sendo achadas.
 *
 * As fotos sobem uma a uma depois da gravação (enviarFoto), para não pesar no registro.
 */

var TIPOS_FOTO = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf'
};
var LIMITE_FOTO_BYTES = 15 * 1024 * 1024;

/** "Protocolo 2539" ou "Protocolo 2539 a 2540" (pura). */
function nomePastaProtocolo(protocolos) {
  var nums = protocolos.map(function (p) { return String(p).trim(); }).filter(String);
  if (!nums.length) throw new Error('Número de protocolo não encontrado nas linhas gravadas.');
  var prim = nums[0], ult = nums[nums.length - 1];
  return 'Protocolo ' + (prim === ult ? prim : prim + ' a ' + ult);
}

/** Nome de arquivo seguro, com a extensão do tipo (pura). */
function nomeArquivoFoto(nome, tipo, indice) {
  var ext = TIPOS_FOTO[tipo] || 'bin';
  var base = String(nome || '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return (('0' + (indice || 1)).slice(-2)) + '_' + (base || 'foto') + '.' + ext;
}

function pastaFotosRaiz_() {
  var id = String(lerConfigApp_().parametros.PASTA_FOTOS_ID || '').trim();
  var m = /folders\/([\w-]+)/.exec(id);
  if (m) id = m[1];
  if (!id) throw new Error('Pasta das fotos não configurada: preencha PASTA_FOTOS_ID na aba CONFIG_APP.');
  return DriveApp.getFolderById(id);
}

/** Protocolos (coluna "Nº Protocolo") das linhas informadas. */
function protocolosDasLinhas_(linhas) {
  var sh = aba_(CONFIG.ABA_DADOS);
  var cab = sh.getRange(CONFIG.LINHA_CABECALHO, 1, 1, sh.getLastColumn()).getValues()[0];
  var r = mapearCabecalhos(cab, { protocolo: CONFIG.COLUNA_PROTOCOLO });
  if (r.faltando.length) throw new Error('Coluna "' + CONFIG.COLUNA_PROTOCOLO + '" não encontrada na linha de cabeçalhos.');
  var colData = colunasDados_().mapa.data;
  return linhas.map(function (n) {
    n = Number(n);
    if (!(n >= CONFIG.PRIMEIRA_LINHA_DADOS) || n > sh.getMaxRows()) throw new Error('Linha inválida: ' + n);
    if (!String(sh.getRange(n, colData).getDisplayValue()).trim()) throw new Error('A linha ' + n + ' não tem registro.');
    return String(sh.getRange(n, r.mapa.protocolo).getDisplayValue()).trim();
  });
}

/** Pasta "Protocolo N" de um protocolo (cria se não existir). */
function pastaDoProtocoloCriando_(raiz, protocolo) {
  var nome = nomePastaProtocolo([protocolo]);
  var existentes = raiz.getFoldersByName(nome);
  var pasta = existentes.hasNext() ? existentes.next() : raiz.createFolder(nome);
  return { id: pasta.getId(), url: pasta.getUrl(), nome: nome, protocolo: String(protocolo) };
}

/**
 * Uma pasta por protocolo: cada linha gravada (= cada produto) é uma ocorrência individual,
 * com a sua própria pasta "Protocolo N". @return {Array<{id, url, nome, protocolo}>}
 */
function pastasDoRegistro_(linhas) {
  var raiz = pastaFotosRaiz_();
  return protocolosDasLinhas_(linhas).map(function (p) {
    if (!String(p).trim()) throw new Error('Número de protocolo não encontrado nas linhas gravadas.');
    return pastaDoProtocoloCriando_(raiz, p);
  });
}

/** Para a tela tentar de novo quando as pastas não puderam ser criadas na gravação. */
function criarPastaRegistro(linhas) {
  return api_('criarPastaRegistro', function () {
    if (!Array.isArray(linhas) || !linhas.length || linhas.length > CONFIG.LIMITES.itensPorRegistro) throw new Error('Linhas inválidas.');
    return pastasDoRegistro_(linhas);
  });
}

/** Pasta "Protocolo …" dentro da pasta de fotos configurada; senão erro. */
function pastaFotosValida_(pastaId, raizId) {
  var pasta = DriveApp.getFolderById(String(pastaId || ''));
  var pais = pasta.getParents(), dentro = false;
  while (pais.hasNext()) if (pais.next().getId() === raizId) dentro = true;
  if (!dentro || pasta.getName().indexOf('Protocolo ') !== 0) throw new Error('Pasta de destino inválida.');
  return pasta;
}

/**
 * Sobe uma foto para a pasta de um protocolo e, se houver, copia para as pastas dos outros
 * protocolos do mesmo registro (cada produto tem a sua pasta).
 * Só aceita pastas "Protocolo …" que estejam dentro da pasta de fotos configurada.
 * @param {string} pastaId
 * @param {{nome:string, tipo:string, base64:string, indice:number}} arq
 * @param {string[]=} outrasPastas
 * @return {{id, nome, copias}}
 */
function enviarFoto(pastaId, arq, outrasPastas) {
  return api_('enviarFoto', function () {
    if (!arq || typeof arq.base64 !== 'string') throw new Error('Arquivo vazio.');
    if (!TIPOS_FOTO[arq.tipo]) throw new Error('Tipo de arquivo não aceito (' + arq.tipo + '). Envie imagens ou PDF.');
    var raizId = pastaFotosRaiz_().getId();
    var pasta = pastaFotosValida_(pastaId, raizId);
    var outras = (Array.isArray(outrasPastas) ? outrasPastas : []).slice(0, CONFIG.LIMITES.itensPorRegistro)
      .filter(function (id, i, a) { return id && id !== pastaId && a.indexOf(id) === i; })
      .map(function (id) { return pastaFotosValida_(id, raizId); });

    var bytes = Utilities.base64Decode(arq.base64.replace(/^data:[^,]*,/, ''));
    if (!bytes.length) throw new Error('Arquivo vazio.');
    if (bytes.length > LIMITE_FOTO_BYTES) throw new Error('Arquivo grande demais (máx. 15 MB).');
    var nome = nomeArquivoFoto(arq.nome, arq.tipo, Number(arq.indice) || 1);
    var f = pasta.createFile(Utilities.newBlob(bytes, arq.tipo, nome));
    outras.forEach(function (p) { f.makeCopy(nome, p); });
    return { id: f.getId(), nome: nome, copias: outras.length };
  });
}
