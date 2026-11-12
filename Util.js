/**
 * Funções puras (sem acesso a planilha/Drive) — usadas pelo servidor e pelos testes locais.
 */

/** Maiúsculas, sem acento, só letras/dígitos separados por espaço. */
function normalizar(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** Chave para comparar cabeçalhos: "N° Pedidos" = "Nº Pedidos" = "n pedidos ". */
function chaveCabecalho(s) {
  return normalizar(s).replace(/ /g, '');
}

function somenteDigitos(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

function semZerosEsquerda(s) {
  return String(s).replace(/^0+(?=\d)/, '');
}

/**
 * Valor de um código (NF, pedido, cod. produto…) para a célula.
 * Só dígitos, sem zero à esquerda e até 15 dígitos → número (igual ao histórico da planilha
 * e necessário para o PROCV do Cod produto). Qualquer outra coisa → texto preservado
 * (zeros à esquerda, letras, "S/B", "-").
 */
function codigoParaCelula(v) {
  var s = String(v == null ? '' : v).trim();
  if (s === '') return '';
  if (/^[1-9]\d{0,14}$/.test(s) || s === '0') return Number(s);
  return { texto: s };
}

/** "1.234,56" | "1234.56" | 1234.56 → 1234.56 ; vazio/ inválido → null */
function numeroBR(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Texto livre seguro para a célula: limita tamanho e impede que vire fórmula. */
function textoSeguro(v, limite) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (limite && s.length > limite) s = s.slice(0, limite);
  if (/^[=+@]/.test(s) || /^-[^\s\d]/.test(s)) s = "'" + s;
  return s;
}

/** "2026-10-15" → Date local (meia-noite). Inválida → null. */
function dataISO(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}

/**
 * Agrupa números de coluna em blocos contíguos: [2,3,4,9,10,14] → [[2,3,4],[9,10],[14]].
 * Permite gravar com poucos setValues sem tocar nas colunas de fórmula entre elas.
 */
function agruparColunas(colunas) {
  var ord = colunas.slice().sort(function (a, b) { return a - b; });
  var blocos = [];
  ord.forEach(function (c) {
    var ult = blocos[blocos.length - 1];
    if (ult && c === ult[ult.length - 1] + 1) ult.push(c); else blocos.push([c]);
  });
  return blocos;
}

/**
 * Mapeia campos → número da coluna (1-based) a partir da linha de cabeçalhos.
 * Casamento exato (sem espaços nas pontas) tem prioridade; depois o normalizado.
 * Assim "Status" (R) não é confundido com "STATUS" (U).
 */
function mapearCabecalhos(cabecalhos, colunasDesejadas) {
  var mapa = {}, faltando = [];
  Object.keys(colunasDesejadas).forEach(function (campo) {
    var alvo = colunasDesejadas[campo];
    var idx = cabecalhos.findIndex(function (h) { return String(h).trim() === alvo; });
    if (idx < 0) {
      var k = chaveCabecalho(alvo);
      var achados = [];
      cabecalhos.forEach(function (h, i) { if (chaveCabecalho(h) === k) achados.push(i); });
      if (achados.length > 1) throw new Error('Cabeçalho "' + alvo + '" aparece mais de uma vez na linha de cabeçalhos — ajuste CONFIG.COLUNAS.');
      idx = achados.length ? achados[0] : -1;
    }
    if (idx < 0) faltando.push(alvo); else mapa[campo] = idx + 1;
  });
  return { mapa: mapa, faltando: faltando };
}

/** Valores (não vazios, sem repetir) que não aparecem exatamente na lista de validação. */
function valoresForaDaLista(valores, lista) {
  var permitidos = {};
  (lista || []).forEach(function (v) { permitidos[String(v)] = true; });
  var fora = [];
  valores.forEach(function (v) {
    var s = String(v == null ? '' : v);
    if (s.trim() !== '' && !permitidos[s] && fora.indexOf(s) < 0) fora.push(s);
  });
  return fora;
}
