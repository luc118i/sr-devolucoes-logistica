/**
 * Configuração fixa do Web App de Ocorrências.
 *
 * O que muda no dia a dia (conferentes, tipos de ocorrência, apelidos de fornecedor,
 * pasta dos XMLs, status inicial) fica na aba CONFIG_APP da própria planilha — ver Setup.js.
 * Aqui ficam só os nomes de abas/cabeçalhos, que mudam raramente.
 */
var CONFIG = {
  /** Aparece no topo da tela: confirma qual código a implantação está rodando. Mude a cada push. */
  VERSAO: '2026-11-04 r35',

  /** Nome da aplicação (título da aba do navegador e do cabeçalho). */
  NOME_APP: 'SR_dados/Devoluções - Logística',
  /** Ícone "S/R" oficial do site da Soreparos. */
  FAVICON_URL: 'https://cdn.soreparos.com.br/wp-content/uploads/2026/10/Ico-SR-PNG-300x300.png',

  /** ID da planilha. Vazio = planilha à qual o script está vinculado. Pode ser sobrescrito pela propriedade de script PLANILHA_ID. */
  PLANILHA_ID: '',

  ABA_DADOS: 'DATABASE',
  /** Linha dos cabeçalhos na aba DATABASE (acima dela ficam títulos e links). */
  LINHA_CABECALHO: 8,
  /** Primeira linha que pode receber registro (a 9 só tem as fórmulas de matriz). */
  PRIMEIRA_LINHA_DADOS: 10,

  ABA_CADASTRO: 'CADASTRO DE PRODUTOS',
  ABA_CONFIG: 'CONFIG_APP',
  ABA_INDICE: 'INDICE_XML',
  ABA_LOG: 'LOG_APP',
  /** Selos dos cartões da tela Bloqueios (aba oculta, criada no primeiro selo). */
  ABA_SELOS: 'BLOQUEIOS_SELOS',

  /**
   * Campos gravados pelo app → texto do cabeçalho na linha 8.
   * As colunas são localizadas pelo cabeçalho (nunca por posição).
   * Colunas que NÃO estão aqui nunca são escritas: Nº Protocolo, Produto, Marca,
   * código de barras e Tempo de finalização são fórmulas de matriz da planilha.
   */
  COLUNAS: {
    data: 'Data da Ocorrência',
    fornecedor: 'Fornecedor',
    conferente: 'Conferente',
    nf: 'Nota fiscal',
    pedido: 'N° Pedidos',
    bloqueio: 'Bloqueio',
    valor: 'Valor',
    codIntegracao: 'Cod integração',
    codProduto: 'Cod produto',
    tipo: 'Tipo de Ocorrência',
    qtd: 'Qnt.',
    obs: 'Observação',
    status: 'Status'
  },

  /** Coluna do número de protocolo (fórmula da planilha): dá nome à pasta de fotos. */
  COLUNA_PROTOCOLO: 'Nº Protocolo',

  /**
   * Campos sem os quais a gravação é recusada (tire da lista para tornar opcional).
   * "produto" e "marca" são fórmulas da planilha: exigir = o Cod produto precisa existir
   * no CADASTRO DE PRODUTOS com nome/marca preenchidos. Observação é sempre opcional.
   * Valores como "-" ou "." contam como vazios; no Bloqueio, "S/B" é aceito.
   */
  OBRIGATORIOS: ['data', 'fornecedor', 'conferente', 'nf', 'pedido', 'bloqueio', 'valor',
    'codIntegracao', 'codProduto', 'produto', 'marca', 'tipo', 'qtd'],

  /** Cadastro de produtos: a coluna do código SR não tem título, é a 1ª. */
  CADASTRO: { colunaCodigo: 1, nome: 'Nome', marca: 'Marca', ean: 'Código de barras' },

  /** Subpastas da pasta de XMLs que não entram no índice. */
  PASTAS_IGNORADAS: ['canceladas'],

  /** Intervalo mínimo entre duas varreduras completas da pasta de XMLs (segundos). */
  INTERVALO_REVARREDURA_S: 60,

  LIMITES: {
    itensPorRegistro: 200,
    tamanhoTexto: 500,
    tamanhoXml: 3 * 1024 * 1024
  }
};

/** Parâmetros editáveis na aba CONFIG_APP (bloco "Parâmetro | Valor") e seus padrões. */
var PARAMETROS_PADRAO = {
  PASTA_XML_ID: '',
  /** Pasta onde ficam as pastas "Protocolo N" com as fotos. */
  PASTA_FOTOS_ID: '1_QcSpFxr8RVwfzxRmh4kp5x7dP3cTIVO',
  STATUS_INICIAL: 'FALSO'
};

/** Fornecedores conhecidos (raiz do CNPJ → nome usado na planilha), semeados no setup. */
var FORNECEDORES_PADRAO = [
  ['05059270', 'Objetiva']
];

/** Listas usadas caso o setup não consiga ler as validações atuais da planilha. */
var TIPOS_PADRAO = [
  'Produto faltando dentro dos volumes',
  'Produto avariado/danificado',
  'Produto em desacordo/trocado',
  'Faltando volumes',
  'Material com defeito',
  'DESISTÊNCIA',
  'Devolução Suvinil'
];
