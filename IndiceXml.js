/**
 * Índice dos XMLs que o NF-e Agent (bot_sr) baixa.
 *
 * O bot grava os arquivos como <chave>.xml numa pasta local, sincronizada com o Google Drive
 * (Google Drive para computador). A chave de acesso já traz CNPJ do emitente, série e número,
 * então o índice é montado só pelos NOMES dos arquivos (rápido), na aba oculta INDICE_XML.
 * A busca do Drive não acha trechos no meio do nome — por isso o índice.
 *
 * O índice é refeito na hora em que uma nota não é encontrada (no máximo 1 vez por minuto).
 */

var CAB_INDICE = ['Chave', 'Número', 'Série', 'CNPJ emitente', 'Arquivo', 'Pasta', 'ID do arquivo'];

function pastaXmlId_() {
  var id = String(lerConfigApp_().parametros.PASTA_XML_ID || '').trim();
  var m = /folders\/([\w-]+)/.exec(id); // aceita o link da pasta
  if (m) id = m[1];
  if (!id) throw new Error('Pasta dos XMLs não configurada: preencha PASTA_XML_ID na aba CONFIG_APP.');
  return id;
}

/** Lista recursiva (Drive API v3) de arquivos .xml com chave no nome. */
function listarXmls_(pastaId) {
  var achados = [], fila = [{ id: pastaId, nome: '' }], visitadas = {};
  var ignoradas = CONFIG.PASTAS_IGNORADAS.map(normalizar);
  while (fila.length) {
    var pasta = fila.shift();
    if (visitadas[pasta.id]) continue;
    visitadas[pasta.id] = true;
    var token = null;
    do {
      var opcoes = {
        q: "'" + pasta.id + "' in parents and trashed = false",
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: 1000,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      };
      if (token) opcoes.pageToken = token;
      var resp = Drive.Files.list(opcoes);
      (resp.files || []).forEach(function (f) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          if (ignoradas.indexOf(normalizar(f.name)) < 0) fila.push({ id: f.id, nome: f.name });
          return;
        }
        if (!/\.xml$/i.test(f.name)) return;
        var info = infoDaChave(f.name);
        if (!info || info.modelo !== '55') return;
        achados.push([info.chave, info.numero, info.serie, info.cnpjEmitente, f.name, pasta.nome || '(raiz)', f.id]);
      });
      token = resp.nextPageToken;
    } while (token);
  }
  return achados;
}

/** Refaz a aba INDICE_XML. Sem `forcar`, respeita o intervalo mínimo entre varreduras. */
function atualizarIndiceXml_(forcar) {
  var cache = CacheService.getScriptCache();
  if (!forcar && cache.get('indiceVarrido')) return false;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return false;
  try {
    if (!forcar && cache.get('indiceVarrido')) return false;
    var linhas = listarXmls_(pastaXmlId_());
    // Mesma chave em mais de um lugar (cópias "(1)", entrada/importados): fica uma só.
    var vistos = {}, unicos = [];
    linhas.forEach(function (l) { if (!vistos[l[0]]) { vistos[l[0]] = true; unicos.push(l); } });

    var sh = aba_(CONFIG.ABA_INDICE, false) || criarAbaOculta_(CONFIG.ABA_INDICE, CAB_INDICE);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, CAB_INDICE.length).clearContent();
    if (unicos.length) {
      var rng = sh.getRange(2, 1, unicos.length, CAB_INDICE.length);
      rng.setNumberFormat('@');
      rng.setValues(unicos);
    }
    cache.put('indiceVarrido', '1', CONFIG.INTERVALO_REVARREDURA_S);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Entradas do índice com esse número de nota: [{chave, numero, serie, cnpj, fileId, pasta}] */
function procurarNoIndice_(numero) {
  var sh = aba_(CONFIG.ABA_INDICE, false);
  if (!sh || sh.getLastRow() < 2) return [];
  var alvo = semZerosEsquerda(somenteDigitos(numero));
  return sh.getRange(2, 1, sh.getLastRow() - 1, CAB_INDICE.length).getValues()
    .filter(function (r) { return String(r[1]) === alvo; })
    .map(function (r) { return { chave: String(r[0]), numero: String(r[1]), serie: String(r[2]), cnpj: String(r[3]), pasta: String(r[5]), fileId: String(r[6]) }; });
}

/** Conteúdo do XML — só de arquivos que estão no índice (evita abrir qualquer arquivo do Drive por ID). */
function lerXmlIndexado_(fileId) {
  var sh = aba_(CONFIG.ABA_INDICE, false);
  var ids = sh && sh.getLastRow() > 1 ? sh.getRange(2, 7, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  if (ids.indexOf(String(fileId)) < 0) throw new Error('Arquivo não pertence à pasta de XMLs configurada.');
  var arq = DriveApp.getFileById(fileId);
  if (arq.getSize() > CONFIG.LIMITES.tamanhoXml) throw new Error('XML grande demais.');
  return arq.getBlob().getDataAsString('UTF-8');
}

function criarAbaOculta_(nome, cabecalho) {
  var sh = planilha_().insertSheet(nome);
  sh.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.hideSheet();
  return sh;
}
