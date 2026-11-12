/**
 * Roda os testes de regras fora do Google (Node 18+), com um XmlService mínimo.
 *   node tests/rodar.js                     → testarRegras()
 *   node tests/rodar.js <pasta de XMLs>     → também lê todos os XMLs reais da pasta
 * Não faz parte do Apps Script (ignorado pelo .claspignore).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── XmlService mínimo (o suficiente para NF-e) ───────────────────────────────
function parseXml(texto) {
  let i = 0;
  const s = texto;
  const ent = t => t.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" :
    String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
  const pilha = [];
  let raiz = null;
  while (i < s.length) {
    if (s.startsWith('<?', i)) { i = s.indexOf('?>', i) + 2; continue; }
    if (s.startsWith('<!--', i)) { i = s.indexOf('-->', i) + 3; continue; }
    if (s.startsWith('<![CDATA[', i)) { const f = s.indexOf(']]>', i); pilha[pilha.length - 1].texto += s.slice(i + 9, f); i = f + 3; continue; }
    if (s.startsWith('<!', i)) { i = s.indexOf('>', i) + 1; continue; }
    if (s[i] === '<' && s[i + 1] === '/') {
      const f = s.indexOf('>', i); const nome = s.slice(i + 2, f).trim();
      const el = pilha.pop();
      if (!el || el.qname !== nome) throw new Error('XML malformado: </' + nome + '>');
      i = f + 1; continue;
    }
    if (s[i] === '<') {
      const f = s.indexOf('>', i);
      if (f < 0) throw new Error('XML malformado');
      let corpo = s.slice(i + 1, f); const fecha = corpo.endsWith('/'); if (fecha) corpo = corpo.slice(0, -1);
      const m = /^([^\s]+)/.exec(corpo); if (!m) throw new Error('XML malformado');
      const attrs = {}; const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a;
      while ((a = re.exec(corpo.slice(m[1].length)))) attrs[a[1]] = ent(a[3] !== undefined ? a[3] : a[4]);
      const pai = pilha[pilha.length - 1];
      const nsMap = Object.assign({}, pai ? pai.nsMap : {});
      Object.keys(attrs).forEach(k => { if (k === 'xmlns') nsMap[''] = attrs[k]; else if (k.startsWith('xmlns:')) nsMap[k.slice(6)] = attrs[k]; });
      const [pref, local] = m[1].includes(':') ? m[1].split(':') : ['', m[1]];
      const el = { qname: m[1], nome: local, ns: nsMap[pref] || '', nsMap, attrs, filhos: [], texto: '' };
      if (pai) pai.filhos.push(el); else if (!raiz) raiz = el; else throw new Error('XML com mais de uma raiz');
      if (!fecha) pilha.push(el);
      i = f + 1; continue;
    }
    const f = s.indexOf('<', i); const fim = f < 0 ? s.length : f;
    const t = s.slice(i, fim);
    if (pilha.length) pilha[pilha.length - 1].texto += ent(t);
    else if (t.trim()) throw new Error('Texto fora da raiz');
    i = fim;
  }
  if (!raiz || pilha.length) throw new Error('XML incompleto');
  return raiz;
}
function embrulhar(el) {
  return {
    getName: () => el.nome,
    getText: () => el.texto,
    getAttribute: n => (n in el.attrs ? { getValue: () => el.attrs[n] } : null),
    getChild: (n, ns) => { const f = el.filhos.find(c => c.nome === n && (!ns || c.ns === ns.uri)); return f ? embrulhar(f) : null; },
    getChildren: (n, ns) => el.filhos.filter(c => c.nome === n && (!ns || c.ns === ns.uri)).map(embrulhar)
  };
}
const XmlService = {
  parse: t => { const r = parseXml(t); return { getRootElement: () => embrulhar(r) }; },
  getNamespace: uri => ({ uri })
};

// ── carrega os .js do projeto num contexto ───────────────────────────────────
const raiz = path.join(__dirname, '..');
// Utilities mínimo (só o base64 que os testes usam)
const Utilities = {
  Charset: { UTF_8: 'utf8' },
  base64Encode: (s) => Buffer.from(typeof s === 'string' ? s : Uint8Array.from(s), 'utf8').toString('base64')
};
const ctx = vm.createContext({ XmlService, Utilities, console });
fs.readdirSync(raiz).filter(f => f.endsWith('.js')).sort().forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), ctx, { filename: f });
});

let falhou = false;
if (require.main !== module) { module.exports = { ctx }; return; }
try { ctx.testarRegras(); } catch (e) { console.error(e.message); falhou = true; }

// ── XMLs reais (opcional) ────────────────────────────────────────────────────
const pasta = process.argv[2];
if (pasta) {
  const arquivos = [];
  (function andar(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) andar(path.join(d, f.name));
      else if (/\.xml$/i.test(f.name)) arquivos.push(path.join(d, f.name));
    }
  })(pasta);
  let ok = 0, naoNfe = 0, comPedido = 0, objetiva = 0, objetivaPedido = 0, itens = 0, maxItens = 0;
  const erros = [];
  for (const a of arquivos) {
    const nomeInfo = ctx.infoDaChave(path.basename(a));
    try {
      const n = ctx.lerNfe(fs.readFileSync(a, 'utf8'));
      ok++; itens += n.itens.length; maxItens = Math.max(maxItens, n.itens.length);
      if (n.pedidos.length) comPedido++;
      if (n.emitente.cnpj.startsWith('05059270')) { objetiva++; if (n.pedidos.length) objetivaPedido++; }
      if (nomeInfo && nomeInfo.numero !== String(Number(n.numero))) erros.push(a + ': número do nome ≠ XML');
    } catch (e) {
      if (/não é uma NF-e/.test(e.message)) naoNfe++; else erros.push(path.basename(a) + ': ' + e.message);
    }
  }
  console.log(`XMLs reais: ${arquivos.length} arquivos · ${ok} NF-e lidas · ${naoNfe} não-NF-e (eventos/resumos) · ${erros.length} erros`);
  console.log(`  itens: ${itens} (máx. ${maxItens} numa nota) · notas com pedido no infCpl: ${comPedido}`);
  console.log(`  Objetiva: ${objetiva} notas, ${objetivaPedido} com pedido extraído`);
  if (erros.length) { console.log('  ' + erros.slice(0, 10).join('\n  ')); falhou = true; }
}
process.exit(falhou ? 1 : 0);
