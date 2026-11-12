/**
 * Acompanhamento da ocorrência depois do registro (colunas preenchidas pela equipe):
 *   R "Status"               caixa de seleção: VERDADEIRO = formalizada (e-mail enviado)
 *   S "Data de Formalização" data em que foi formalizada
 *   T "Tempo de finalização" fórmula da planilha (não é gravada)
 *   U "STATUS"               situação (lista da validação da planilha)
 *   V "Nº da NFD"            número da NF de devolução (ou texto como "TRATATIVA INTERNA")
 * Regras combinadas: formalizar é um botão explícito; NFD obrigatória para
 * "Aguardando transportadora" e "Finalizada"; qualquer usuário pode atualizar (tudo vai para a LOG_APP).
 */

var COLUNAS_STATUS = { formalizado: 'Status', dataFormalizacao: 'Data de Formalização', situacao: 'STATUS', nfd: 'Nº da NFD' };
var SITUACAO_APOS_FORMALIZAR = 'Aguardando autorização p/ emissão de NFD';
var SITUACOES_COM_NFD = ['Aguardando transportadora', 'Finalizada'];
var SITUACOES_PADRAO = ['Aguardando autorização p/ emissão de NFD', 'Aguardando emissão de NFD', 'Aguardando transportadora', 'Finalizada',
  'DEXCO', 'Verificar', 'Aguardando remessa em garantia', 'Tratativa compras'];

/**
 * Valores da caixa de seleção (pura): `personalizados` = getCriteriaValues() da validação
 * ([] = padrão VERDADEIRO/FALSO; [marcado, desmarcado] = valores próprios, ex.: 1 e 0).
 */
function regraCaixa(personalizados) {
  var p = personalizados || [];
  var temProprios = p.length > 0 && p[0] !== '' && p[0] != null;
  var marcado = temProprios ? p[0] : true;
  var desmarcado = temProprios ? (p.length > 1 ? p[1] : '') : false;
  return {
    marcado: marcado,
    desmarcado: desmarcado,
    /** Lê o que está na célula, seja qual for a forma (booleano, 1/0, texto TRUE/VERDADEIRO). */
    ehMarcado: function (v) {
      if (v === true) return true;
      if (temProprios && String(v) === String(marcado)) return true;
      return ['1', 'TRUE', 'VERDADEIRO'].indexOf(String(v).trim().toUpperCase()) >= 0;
    },
    valor: function (sim) { return sim ? marcado : desmarcado; }
  };
}

/** Regra da caixa de seleção da coluna R (lida da validação da planilha, na linha informada ou na primeira de dados). */
function caixaFormalizado_(sh, col, linha) {
  var dv = sh.getRange(linha || CONFIG.PRIMEIRA_LINHA_DADOS, col).getDataValidation();
  if (!dv && linha) dv = sh.getRange(CONFIG.PRIMEIRA_LINHA_DADOS, col).getDataValidation();
  if (dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX) return regraCaixa(dv.getCriteriaValues());
  // Sem caixa de seleção: segue o histórico da planilha (1 / 0).
  return regraCaixa([1, 0]);
}

/** A situação exige o Nº da NFD? (pura) */
function exigeNfd(situacao) {
  return SITUACOES_COM_NFD.some(function (s) { return normalizar(s) === normalizar(situacao); });
}

/**
 * Novos valores de uma linha (pura).
 * @param {{formalizado: boolean, dataFormalizacao: string, situacao: string, nfd: string}} atual
 * @param {{acao: 'formalizar'|'status', situacao?: string, nfd?: string}} pedido
 * @return {{formalizado, dataFormalizacao (true = usar hoje), situacao, nfd, erros: string[], formalizouAgora: boolean}}
 */
function planoStatus(atual, pedido, opcoes) {
  var r = { formalizado: atual.formalizado, dataFormalizacao: null, situacao: atual.situacao, nfd: atual.nfd, erros: [], formalizouAgora: false };
  var formalizar = function () {
    if (atual.formalizado && atual.dataFormalizacao) return;
    r.formalizado = true; r.dataFormalizacao = true; r.formalizouAgora = true;
  };
  if (pedido.acao === 'formalizar') {
    formalizar();
    if (!String(atual.situacao || '').trim()) r.situacao = SITUACAO_APOS_FORMALIZAR;
    return r;
  }
  if (pedido.acao === 'desformalizar') {
    // Desfaz uma formalização feita por engano (ex.: rascunho criado e não enviado):
    // desmarca R, apaga S e devolve a situação que havia antes (se a tela informar).
    r.formalizado = false;
    r.dataFormalizacao = 'limpar';
    if (pedido.situacaoAnterior != null) r.situacao = String(pedido.situacaoAnterior).trim();
    return r;
  }
  if (pedido.acao !== 'status') { r.erros.push('Ação desconhecida.'); return r; }
  var sit = String(pedido.situacao || '').trim();
  var valida = (opcoes || SITUACOES_PADRAO).filter(function (o) { return normalizar(o) === normalizar(sit); })[0];
  if (!valida) { r.erros.push('Situação "' + sit + '" não está na lista da coluna STATUS.'); return r; }
  var nfd = pedido.nfd != null ? String(pedido.nfd).trim() : String(atual.nfd || '').trim();
  if (exigeNfd(valida) && !preenchido(nfd)) r.erros.push('Informe o Nº da NFD para "' + valida + '" (ou um texto como "TRATATIVA INTERNA").');
  r.situacao = valida;
  r.nfd = nfd;
  formalizar(); // mudar a situação pressupõe a ocorrência formalizada
  return r;
}

/** Opções da coluna STATUS lidas da validação da planilha (lista); se não houver, as padrão. */
function opcoesStatus_() {
  try {
    var d = colunasDados_();
    var col = colunasStatus_(d.sheet).situacao;
    var dv = d.sheet.getRange(CONFIG.PRIMEIRA_LINHA_DADOS, col).getDataValidation();
    if (dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      var v = dv.getCriteriaValues()[0].map(function (x) { return String(x).trim(); }).filter(String);
      if (v.length) return v;
    }
  } catch (e) { console.error('opcoesStatus_: ' + e); }
  return SITUACOES_PADRAO.slice();
}

function colunasStatus_(sh) {
  var cab = sh.getRange(CONFIG.LINHA_CABECALHO, 1, 1, sh.getLastColumn()).getValues()[0];
  var r = mapearCabecalhos(cab, COLUNAS_STATUS);
  if (r.faltando.length) throw new Error('Colunas de acompanhamento não encontradas: ' + r.faltando.join(', '));
  return r.mapa;
}

/**
 * Formaliza ou atualiza a situação/NFD das linhas informadas.
 * @param {{acao: 'formalizar'|'status', linhas: number[], situacao?: string, nfd?: string,
 *          esperado: Object<string, {situacao, nfd, formalizado}>}} pedido
 *   esperado = o que a tela mostrava; se a planilha mudou nesse meio-tempo, nada é gravado.
 */
function atualizarStatus(pedido) {
  return api_('atualizarStatus', function () {
    pedido = pedido || {};
    var linhas = (Array.isArray(pedido.linhas) ? pedido.linhas : []).map(Number)
      .filter(function (n, i, a) { return n >= CONFIG.PRIMEIRA_LINHA_DADOS && a.indexOf(n) === i; });
    if (!linhas.length) throw new Error('Nenhuma linha selecionada.');
    if (linhas.length > 200) throw new Error('Linhas demais de uma vez.');
    var opcoes = opcoesStatus_();

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('A planilha está ocupada. Tente de novo em alguns segundos.');
    try {
      var d = colunasDados_();
      var sh = d.sheet;
      var cs = colunasStatus_(sh);
      var caixa = caixaFormalizado_(sh, cs.formalizado);
      var tz = Session.getScriptTimeZone();
      var hoje = dataISO(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
      var ler = function (n, col) { return sh.getRange(n, col); };

      // 1) lê o estado atual e confere com o que a tela tinha
      var atuais = {}, mudaram = [], erros = [];
      linhas.forEach(function (n) {
        if (n > sh.getMaxRows() || !String(ler(n, d.mapa.data).getDisplayValue()).trim()) { erros.push('A linha ' + n + ' não tem registro.'); return; }
        var a = {
          formalizado: caixa.ehMarcado(ler(n, cs.formalizado).getValue()),
          dataFormalizacao: ler(n, cs.dataFormalizacao).getDisplayValue(),
          situacao: String(ler(n, cs.situacao).getDisplayValue()).trim(),
          nfd: String(ler(n, cs.nfd).getDisplayValue()).trim()
        };
        atuais[n] = a;
        var e = pedido.esperado && pedido.esperado[n];
        if (e && (normalizar(e.situacao) !== normalizar(a.situacao) || normalizar(e.nfd) !== normalizar(a.nfd) || !!e.formalizado !== a.formalizado)) mudaram.push(n);
      });
      if (erros.length) return { status: 'INVALIDO', erros: erros };
      if (mudaram.length) {
        return { status: 'MUDOU', linhas: mudaram, mensagem: 'A planilha foi alterada por outra pessoa nas linhas ' + mudaram.join(', ') + '. Atualize a lista antes de salvar.' };
      }

      // 2) calcula e valida tudo antes de gravar qualquer coisa
      var planos = {};
      linhas.forEach(function (n) {
        var p = planoStatus(atuais[n], pedido, opcoes);
        p.erros.forEach(function (e) { if (erros.indexOf(e) < 0) erros.push(e); });
        planos[n] = p;
      });
      if (erros.length) return { status: 'INVALIDO', erros: erros };

      // 3) grava (só as células que mudam)
      var resultado = [];
      linhas.forEach(function (n) {
        var a = atuais[n], p = planos[n];
        // grava sempre no formato da caixa (corrige também células com "TRUE" em texto)
        var alvoR = caixa.valor(p.formalizado), brutoR = ler(n, cs.formalizado).getValue();
        if (brutoR !== alvoR && String(brutoR) !== String(alvoR)) ler(n, cs.formalizado).setValue(alvoR);
        if (p.dataFormalizacao === true) ler(n, cs.dataFormalizacao).setNumberFormat('dd/mm/yyyy').setValue(hoje);
        else if (p.dataFormalizacao === 'limpar') ler(n, cs.dataFormalizacao).setValue('');
        if (p.situacao !== a.situacao) ler(n, cs.situacao).setValue(p.situacao);
        if (p.nfd !== a.nfd) {
          var v = codigoParaCelula(textoSeguro(p.nfd, 120));
          if (v && typeof v === 'object') ler(n, cs.nfd).setNumberFormat('@').setValue(v.texto); else ler(n, cs.nfd).setValue(v);
        }
        resultado.push({ linha: n, antes: a, depois: { formalizado: p.formalizado, situacao: p.situacao, nfd: p.nfd, formalizouAgora: p.formalizouAgora } });
      });
      SpreadsheetApp.flush();

      var final = linhas.map(function (n) {
        return {
          linha: n,
          formalizado: caixa.ehMarcado(ler(n, cs.formalizado).getValue()),
          formalizacao: String(ler(n, cs.dataFormalizacao).getDisplayValue()),
          situacao: String(ler(n, cs.situacao).getDisplayValue()).trim(),
          nfd: String(ler(n, cs.nfd).getDisplayValue()).trim()
        };
      });
      registrarLog_({ formalizar: 'FORMALIZOU', desformalizar: 'DESFEZ FORMALIZAÇÃO', status: 'STATUS' }[pedido.acao] || 'STATUS', usuario_(), JSON.stringify(resultado));
      return { status: 'OK', linhas: final };
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * Manutenção (rodar no editor): deixa a coluna R no formato da caixa de seleção da planilha.
 * Conserta células com TRUE/FALSE/VERDADEIRO/FALSO (texto ou booleano) ou 0/1 que não batem com os
 * valores da caixa (ex.: a caixa usa 1/0) — caso da r19, que gravou TRUE. Linhas vazias ficam como estão.
 */
function corrigirColunaFormalizado() {
  var d = colunasDados_();
  var cs = colunasStatus_(d.sheet);
  var caixa = caixaFormalizado_(d.sheet, cs.formalizado);
  var ult = proximaLinha_(d.sheet, d.mapa) - 1;
  if (ult < CONFIG.PRIMEIRA_LINHA_DADOS) return 'Nada a corrigir.';
  var vals = d.sheet.getRange(CONFIG.PRIMEIRA_LINHA_DADOS, cs.formalizado, ult - CONFIG.PRIMEIRA_LINHA_DADOS + 1, 1).getValues();
  var desmarcados = [false, 0, '0', 'FALSE', 'FALSO'];
  var corrigidas = [];
  vals.forEach(function (r, i) {
    var v = r[0];
    if (v === '' || v == null) return;
    var marcado = caixa.ehMarcado(v);
    var desmarcado = !marcado && desmarcados.indexOf(typeof v === 'string' ? v.trim().toUpperCase() : v) >= 0;
    if (!marcado && !desmarcado) return; // valor estranho: não mexe
    var alvo = caixa.valor(marcado);
    if (v === alvo || (typeof v !== 'boolean' && typeof alvo !== 'boolean' && String(v) === String(alvo))) return;
    var n = CONFIG.PRIMEIRA_LINHA_DADOS + i;
    d.sheet.getRange(n, cs.formalizado).setValue(alvo);
    corrigidas.push(n);
  });
  if (corrigidas.length) registrarLog_('CORRIGIU COLUNA R', usuario_(), 'valor ' + JSON.stringify(caixa.marcado) + '/' + JSON.stringify(caixa.desmarcado) + ': ' + corrigidas.join(','));
  var msg = 'Caixa da coluna R usa marcado=' + JSON.stringify(caixa.marcado) + ' / desmarcado=' + JSON.stringify(caixa.desmarcado) + '. ' +
    (corrigidas.length ? 'Corrigidas ' + corrigidas.length + ' linha(s): ' + corrigidas.join(', ') : 'Nenhuma linha precisou de correção.');
  console.log(msg);
  return msg;
}
