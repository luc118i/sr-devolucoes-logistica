# Ocorrências de Recebimento — Web App (Google Apps Script)

Registra ocorrências de recebimento na aba **DATABASE** da planilha *[SR] Devoluções – Logística*,
aproveitando os XMLs de NF-e que o **NF-e Agent (bot_sr)** já baixa da SEFAZ.

O fluxo tem 3 passos: **número da nota → marcar produtos e tipo → revisar e registrar**.

## Como cada coluna é preenchida

| Coluna | Origem |
|---|---|
| Data da Ocorrência | Data de hoje (editável). Não é a emissão da nota. |
| Fornecedor | Apelido do CNPJ emitente na `CONFIG_APP` (ex.: Objetiva). Sem apelido, usa o nome do XML. Editável. |
| Conferente | Lista da `CONFIG_APP`. A tela lembra o último escolhido. |
| Nota fiscal | `nNF` do XML. |
| N° Pedidos | "PED x.xxx.xxx" / "pedido x.xxx.xxx" das informações complementares. Editável. |
| Bloqueio | Manual. Aceita número ou `S/B`. |
| Valor | Manual. O botão **Sugerir** calcula preço unitário da nota × quantidade (o valor do bloqueio costuma ser ~3% menor). |
| Cod integração | `cProd`, o código do produto no fornecedor. |
| Cod produto | Código SR casado pelo **EAN** do XML no CADASTRO. Sem EAN, usa o **histórico** da planilha (mesmo fornecedor + mesmo cod. integração). Se não achar, a pessoa busca no cadastro. |
| Produto, Marca, Nº Protocolo, código de barras, Tempo de finalização | **Não são gravados**: são fórmulas de matriz da planilha (PROCV pelo Cod produto). |
| Tipo de Ocorrência, Qnt., Observação | Escolhidos por item. A quantidade vem com a da nota e pode ser parcial, nunca maior. |
| Status (R) | Valor `STATUS_INICIAL` da `CONFIG_APP` (padrão `0`; vazio = não grava). |

### Campos obrigatórios
O registro é **bloqueado** se faltar qualquer um: Data, Fornecedor, Conferente, Nota fiscal, N° Pedidos, Bloqueio, Valor, Cod integração, Cod produto, Produto, Marca, Tipo de Ocorrência e Qnt. Só a Observação é opcional.
- `-` ou `.` contam como vazios. No Bloqueio, `S/B` é aceito; no Valor, `0` é aceito.
- Produto e Marca são fórmulas: o app exige que o **Cod produto exista no CADASTRO com nome e marca**. Produto sem marca no cadastro precisa ser corrigido lá antes.
- Item sem cod. integração no XML (ou registro sem XML) ganha um campo para digitar.
- Para tornar algum campo opcional, tire-o de `CONFIG.OBRIGATORIOS` em `Config.js`.

Cada produto marcado vira **uma linha** (como no histórico). Os dados gerais se repetem nas linhas do mesmo envio.

### Fotos da ocorrência
- Na seção **4. Fotos** da tela: **Ctrl+V** em qualquer ponto (print, foto copiada do WhatsApp Web etc.), **arrastar** arquivos ou **clicar para escolher**. Aceita imagens e PDF, até 30 por ocorrência.
- Fotos JPG/PNG/WEBP são reduzidas no navegador (lado máximo de 2000 px, JPEG) antes de subir.
- Ao registrar, o app cria (ou reaproveita) **uma pasta "Protocolo N" por protocolo** dentro de `PASTA_FOTOS_ID` (N = coluna **Nº Protocolo**). Cada produto é uma ocorrência individual: num registro com vários produtos, cada protocolo ganha a sua pasta e as fotos vão para todas. Pastas antigas "Protocolo N a M" continuam sendo encontradas.
- As fotos sobem uma a uma depois da gravação. Se alguma falhar, o registro continua gravado e a tela oferece **Tentar enviar de novo**.
- O link da pasta aparece na mensagem de sucesso e na `LOG_APP` (evento GRAVOU).

### Duplicidade
- **Clique repetido / reenvio:** cada envio tem um identificador. O servidor grava sob trava (`LockService`) e devolve o mesmo resultado se o envio chegar de novo (6 h).
- **Ocorrência já registrada:** mesma **nota + produto (código SR, ou cod. integração) + tipo**. A tela mostra as linhas existentes e só grava com "Registrar mesmo assim". O mesmo produto com outro tipo, ou em outra nota, passa direto.
- Ao abrir uma nota, a tela já lista as ocorrências registradas para ela.

## Tela inicial (Ocorrências)

- Abre sempre na **semana atual (segunda a domingo)**, no fuso da planilha (America/Sao_Paulo).
- **Período:** atalhos *Esta semana*, *Semana anterior*, *Últimos 7 dias* e *Este mês*, ou um intervalo personalizado (até 1 ano). *Limpar* volta para a semana atual.
- **Busca** dentro do período: NF, pedido, fornecedor, produto, conferente, tipo, protocolo.
- **Lista** agrupada por dia, com dados reais da DATABASE: Nº Protocolo, fornecedor, NF, produto, conferente, tipo e a coluna **STATUS** como selo. No celular vira cartões; a partir de 1024 px, uma tabela.
- **Detalhe** (painel lateral no computador, folha inferior no celular): todos os campos da linha, link da pasta "Protocolo N" com as fotos e o atalho *Registrar outra ocorrência desta nota*.
- Estados de carregamento (esqueleto), lista vazia (com atalhos para ampliar o período) e erro (com *Tentar novamente*).

## Bloqueios (relatório do Santri)

Na tela inicial, o botão **Bloqueios** abre o cruzamento da *Relação de bloqueios de estoque - Analítico* (`.ods`) com a DATABASE, pelo número do bloqueio. Nada é gravado na DATABASE, e cada envio deixa uma linha `BLOQUEIOS CRUZADOS` na `LOG_APP`. O relatório não fica guardado: ao recarregar a página, é preciso enviar de novo. *Atualizar ocorrências* relê a DATABASE com o mesmo arquivo.

| Aba | O que mostra |
|---|---|
| **Abertos** | Bloqueios com status `Ab`, na coluna da situação da ocorrência. Duas colunas extras: *Sem ocorrência* e *Vínculo a confirmar*. |
| **Baixados em tratativa** | Bloqueios `Bx` com ocorrência em andamento: o material pode seguir na pilha até a coleta. |
| **Fora do relatório** | Ocorrências em andamento cujo bloqueio não veio no `.ods` (os filtros do relatório aparecem na tela). Valores aproximados, vindos da DATABASE. |

- **Vínculo a confirmar:** sem ocorrência pelo número, mas há uma com o mesmo produto e quantidade, até 45 dias de diferença, e o campo Bloqueio dela vazio ou com um bloqueio do relatório que não tem esse produto. Nunca entra em uma situação por suposição.
- **Mais de uma situação no mesmo bloqueio:** o cartão fica na mais atrasada do fluxo (`ORDEM_SITUACOES`).
- **Colunas:** o × esconde a coluna, e os botões em *Colunas ocultas* trazem de volta. A escolha é por aba e fica neste navegador. Os totais do topo seguem contando tudo.
- **Selos:** em cada cartão, *+ Selo* marca situações que não existem na planilha (ex.: Aguardando retorno). Clicar no selo tira. Valem para toda a equipe e ficam na aba oculta `BLOQUEIOS_SELOS` (criada no primeiro selo), presos ao número do bloqueio ou ao protocolo quando não há número, então continuam no cartão nos relatórios seguintes. Cada mudança fica na `LOG_APP`. Sugestões padrão em `SELOS_PADRAO`.
- **Detalhes:** abre o painel lateral com resumo, produtos e ocorrências do bloqueio. Cada ocorrência abre o detalhe completo ou o rascunho.
- **Montar ocorrência:** aparece nos abertos com produto sem ocorrência e abre a Nova ocorrência com bloqueio, valor (só dos produtos sem ocorrência), fornecedor, produtos e quantidades. O Santri não traz a NF: a pessoa informa o número, e o app busca o XML. O tipo também fica para a pessoa, porque o tipo do bloqueio não define o da ocorrência (nos dados reais, só 34% dos "danificados" viraram "Produto avariado/danificado"). Produto do bloqueio que não está na nota entra como item manual, com aviso.
- **Gerar rascunho:** abre o *Formalizar e-mail* do protocolo, com os dados atuais da planilha. Cada protocolo tem o seu e-mail: com mais de um, a tela pede a escolha. O botão também aparece logo depois de registrar, em qualquer ocorrência.
- **Depois de mudar algo:** ao voltar de um registro, o quadro relê a planilha sozinho. Se a mudança foi pelo painel, a tela avisa para clicar em *Atualizar ocorrências*.
- **Relatório para o estoque:** resumo sem valores, com o que está na pilha (abertos e baixados em tratativa), onde está e o que fazer, agrupado em *Separar para coleta*, *Manter bloqueado* (aguardando nota de devolução ou em análise) e *Sem ocorrência registrada*. Cada bloqueio mostra protocolo, NF e etiquetas com a Situação (STATUS), os selos da equipe e os avisos. Sai com os dados da última leitura. Os blocos do resumo funcionam como filtro: clique em um ou mais, e a lista, o total, os locais, a impressão e o resumo copiado acompanham a escolha. *Imprimir ou salvar PDF* gera a lista completa, e *Copiar resumo* dá um texto curto para WhatsApp ou e-mail. Os textos ficam em `GRUPOS_ESTOQUE`.
- **Copiar:** clicar no número do bloqueio, no nome do item ou no código copia o valor, no quadro, no painel e no relatório. O bloqueio vai sem ponto e o código vai sem o "Cód.".
- **Dias:** âmbar acima de 60 e vermelho acima de 180 (`AGING_ALERTA` e `AGING_CRITICO` em `TelaBloqueios.html`).

## Importar ocorrência do e-mail

Em **Nova ocorrência → Importar e-mail**: cole o e-mail inteiro (assunto e corpo) e clique em **Interpretar e-mail**. O app preenche o formulário de sempre e mostra a **Conferência da importação**, com o status de cada campo (Identificado, Confirmar, Conflito, Ausente) e o e-mail original ao lado. Corrija o que precisar e use **Revisar e registrar**: a gravação é a mesma do registro manual (validações, duplicidade, fotos).

| No e-mail | No formulário |
|---|---|
| NF DE ENTRADA (e a NF do assunto) | Nota fiscal — se assunto e corpo divergirem, vira **conflito** |
| PEDIDO / BLOQUEIO | N° Pedido / Bloqueio (pontos removidos, zeros à esquerda mantidos; `0.000.000` = modelo, não é aceito) |
| FORNECEDOR | Fornecedor (com XML, vale o da nota; diferença vira conflito) |
| CONFERENTE | Conferente, só se estiver na lista (senão: sugestões ou cadastrar) |
| E-MAIL FORMATADO POR | Só exibido — a planilha não tem coluna para isso |
| Categoria escrita acima do produto, ou opção marcada (X, [x], ☑, negrito no HTML) | Tipo de Ocorrência do item |
| `02 UNIDADE(S) DO PRODUTO: 175.192 / 69514 - descrição` | Qnt. 2 · Cod produto 175192 · Cod integração 69514 |
| Texto abaixo do produto | Observação do item |

- Quando o e-mail **lista todas as categorias sem marcar nenhuma**, nenhuma é escolhida: a conferência mostra as opções para escolher.
- A **data de envio** do e-mail não vira a data da ocorrência: fica a regra padrão (hoje) e aparece o botão *Usar data do envio*. Só "DATA DA OCORRÊNCIA:" no corpo preenche direto.
- O **valor** não vem no e-mail: continua obrigatório (use *Sugerir*).
- Com o **XML da nota** na pasta, os produtos são conferidos com a nota (código, quantidade). Produto que não está no XML entra como manual e fica sinalizado.
- O remetente nunca é usado como conferente.
- O interpretador está em `Email.js` (funções puras). Novos rótulos ou marcas de seleção: `ROTULOS_EMAIL` e `MARCAS_EMAIL`.

## Formalizar e-mail (a partir de uma ocorrência)

Na tela **Ocorrências**, abra o registro e clique em **Formalizar e-mail**. O app monta assunto e texto no modelo da equipe ("Seguem dados Ref. ocorrência da NF: … - SR Recebimento"), com NF, pedido, bloqueio, fornecedor, conferente, quem formatou (o usuário logado), o tipo marcado com **(X)** e os produtos no formato `02 UNIDADE(S) DO PRODUTO: 175.192 / 69514 - descrição`.
- O e-mail é **só do protocolo aberto** (cada produto/protocolo é formalizado separadamente).
- **Abrir rascunho no Gmail**: cria um rascunho com o texto e **as fotos das pastas "Protocolo N" anexadas** (até ~18 MB; o que passar fica de fora, com aviso, e o link da pasta vai no texto) e abre o rascunho numa nova aba. O rascunho fica no Gmail da conta que executa o Web App (entradadenotas@). Destinatários em branco: você revisa e envia.
- **Copiar texto / Copiar assunto** continuam disponíveis.
- O rascunho sai **formatado**: rótulos e opção marcada em negrito, linha do produto e a observação logo abaixo em **vermelho e negrito**, e a **imagem da assinatura** no fim. O link da pasta de fotos só entra no texto se algum arquivo não coube no e-mail.
- **⚙ Perfis do e-mail** (engrenagem no topo): cada perfil tem **nome** (ex.: Recebimento, Reversa), **assunto** com `{NF}` no lugar do número (ex.: `Seguem dados Ref. ocorrência da NF: {NF} - SR Reversa`), nome em "E-MAIL FORMATADO POR" (vazio = e-mail de quem está logado), **Para**, **Cc** e a **imagem da assinatura** (qualquer imagem — WEBP, PNG, JPG…; o app converte para PNG de até 1200 px e mostra a 600 px no e-mail; dá para clicar, arrastar ou colar com Ctrl+V). Até 10 perfis, valem para todos e ficam na `CONFIG_APP` (parâmetro `EMAIL_PERFIS`, JSON). Ao formalizar, a pessoa escolhe o perfil (o navegador lembra a última escolha) e o assunto, os destinatários e a assinatura mudam junto. Quem já tinha a configuração única ganha automaticamente o perfil "Recebimento".
- Permissão usada: `gmail.compose` (só cria rascunhos; não lê a caixa). Depois de atualizar, rode `verificarPermissoes` no editor e aceite.
- Nada é enviado nem gravado na planilha pelo app.
- O e-mail gerado é lido de volta sem perdas pela importação por e-mail.

## Formalização e status (colunas R, S, U, V)

No detalhe da ocorrência, seção **Formalização e status**:
- **Abrir rascunho no Gmail já formaliza o protocolo** (R marcado, S = hoje, U inicial se estiver vazia). Se o e-mail não for enviado, use **Desfazer formalização** (volta R, S e a situação anterior).
- **Marcar como formalizada** (botão no detalhe, para quem formaliza sem usar o rascunho): coluna **R** = VERDADEIRO, **S** (Data de Formalização) = hoje e, se a situação estiver vazia, **U** = *Aguardando autorização p/ emissão de NFD*.
- **Situação (U)** com as opções da própria validação da planilha e **Nº da NFD (V)** — obrigatório para *Aguardando transportadora* e *Finalizada* (número da NFD ou texto como "TRATATIVA INTERNA").
- Vale **só para o protocolo aberto** (cada produto é uma ocorrência individual).
- **T** (Tempo de finalização) é fórmula e não é tocada.
- Se outra pessoa alterou a linha enquanto a tela estava aberta, nada é gravado e o app pede para atualizar a lista.
- Toda mudança vai para a `LOG_APP` (FORMALIZOU / STATUS) com antes e depois.
- A coluna R é caixa de seleção e o app usa **os valores dela** (lidos da validação da planilha — na planilha atual, 1 = marcada e 0 = desmarcada), em qualquer idioma. Se aparecer `TRUE`/`FALSE` em vez da caixa (a r19 gravou assim), rode **`corrigirColunaFormalizado`** no editor: ele mostra os valores da caixa e conserta as células.

## Design system

Os tokens ficam no início de `Estilo.html` (`:root`): cores da marca Soreparos (navy `#2A4063`, accent `#002233`, vinho `#66323F`), superfícies, cores semânticas, tipografia (Inter), espaçamentos, raios, sombras, tamanho mínimo de controle (44 px) e tempos de animação. Breakpoints: 600, 768, 1024 e 1440 px. Respeita "reduzir movimento" do sistema.
**Menus suspensos** (`Componentes.html`): todo `<select>` da tela ganha a aparência do design system (lista com cantos arredondados, ✓ na opção atual, bolinhas de cor na Situação; no celular, folha inferior). O `<select>` original continua escondido por baixo, então o código segue usando `sel.value` e o evento `change`. Teclado: setas, Home/End, Enter, Esc e busca pela letra.
A logo oficial (`Logo.html`, PNG embutido) e o ícone S/R (favicon) vieram de soreparos.com.br.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `Config.js` | Nomes de abas e cabeçalhos, limites, padrões |
| `Util.js` | Funções puras (normalização, formatos, mapeamento de cabeçalhos) |
| `Nfe.js` | Leitura do XML da NF-e e extração do pedido |
| `Regras.js` | Validação, duplicidade, montagem das linhas, casamento com o cadastro |
| `Planilha.js` | Acesso à planilha, CONFIG_APP, cadastro, gravação, LOG_APP |
| `IndiceXml.js` | Índice dos XMLs da pasta do Drive |
| `Fotos.js` | Pasta "Protocolo N" e envio das fotos |
| `Email.js` | Interpretador do e-mail de ocorrência (puro, testável) |
| `TestesEmail.js` | Testes do interpretador (cenários do e-mail) |
| `Status.js` | Formalização e situação (colunas R, S, U, V) |
| `Gmail.js` | Rascunho no Gmail (HTML formatado, assinatura, fotos) e configuração do e-mail |
| `ConfigEmail.html` | Tela ⚙ Perfis do e-mail |
| `Consultas.js` | Listagem das ocorrências por período e pasta de fotos do protocolo |
| `Bloqueios.js` | Leitura do `.ods` do Santri e cruzamento com a DATABASE (regras puras e `analisarBloqueios`) |
| `TestesBloqueios.js` | Testes do cruzamento de bloqueios |
| `Api.js` | `doGet` e funções chamadas pela tela |
| `Setup.js` | Instalação (`setup`) e `limparCache` |
| `Testes.js` | `testarRegras()` e `testarIntegracaoLeitura()` |
| `Index.html` | Estrutura da tela (Home, Nova ocorrência, painel, créditos) |
| `Estilo.html` | Design system e estilos |
| `App.html` | Formulário de registro e navegação |
| `Home.html` | Tela inicial: período, busca, lista e detalhe |
| `Importar.html` | Tela de importação por e-mail e conferência |
| `TelaBloqueios.html` | Tela de envio do relatório e quadro de bloqueios |
| `Componentes.html` | Menu suspenso do design system (substitui o visual dos selects) |
| `Logo.html` | Logo oficial Soreparos (data URI) |
| `tests/rodar.js` | Roda `testarRegras` no Node (não vai para o Apps Script) |

## Instalação

### 1. Deixar os XMLs no Google Drive
O bot grava os XMLs em `C:\Users\Só Reparos\Downloads\XMLs` (subpastas `entrada`, `importados`, …).
O Apps Script não lê o disco do computador, então essa pasta precisa ser sincronizada com o Drive:

1. Instale o **Google Drive para computador** com a **mesma conta Google que vai implantar o Web App**.
2. Em *Preferências → Meu computador → Adicionar pasta*, escolha `Downloads\XMLs` e marque **Sincronizar com o Google Drive**.
3. No bot (Configurações), **zere ou aumente** "apagar importados após N dias" (`apagar_importados_dias`, hoje 5).
   Se não fizer isso, o XML some do Drive alguns dias depois de importado no Santri. Nesse caso a nota ainda pode ser registrada **anexando o XML** ou **sem XML**.
4. Abra a pasta no drive.google.com e copie o link ou o ID dela.

### 2. Publicar o código
Com o [clasp](https://github.com/google/clasp) (o `.clasp.json` já aponta para o projeto):

```bash
clasp push
```

Ou copie cada arquivo `.js` (como `.gs`) e `.html` para o editor do Apps Script, com os mesmos nomes, e substitua o `appsscript.json` (*Configurações do projeto → Mostrar arquivo de manifesto*).

**Planilha:** o script precisa estar **vinculado** à planilha (*Extensões → Apps Script*). Se for um projeto independente, em *Configurações do projeto → Propriedades do script* crie `PLANILHA_ID` com o ID da planilha (o trecho entre `/d/` e `/edit` da URL).

### 3. Rodar o setup
No editor do Apps Script, selecione a função **`setup`** e clique em *Executar*. Autorize os acessos pedidos: planilha, Drive (ler os XMLs e criar as pastas de fotos) e e-mail.

Ele cria três abas **ocultas** e não altera nenhuma aba existente:

| Aba | Para quê |
|---|---|
| `CONFIG_APP` | Conferentes, tipos de ocorrência, apelidos de fornecedor e parâmetros. As listas são copiadas das validações atuais das colunas Conferente e Tipo. |
| `INDICE_XML` | Número da nota → arquivo XML no Drive. Refeito sozinho. |
| `LOG_APP` | Quem gravou quais linhas, e os erros (com código). |

Depois preencha **`PASTA_XML_ID`** na `CONFIG_APP` (o link da pasta também serve) e rode `setup` de novo. Ele indexa os XMLs e informa quantas notas encontrou.

### 4. Testar antes de liberar
1. **`testarRegras`**: precisa terminar com "30/30 testes OK". Não toca na planilha.
2. **`testarIntegracaoLeitura`**: mostra colunas encontradas, próxima linha livre, quantidade de conferentes, cadastro, registros e XMLs, e abre a nota mais recente. **Só lê.**
3. Teste pela tela, usando *Implantar → Testar implantações*:

| Cenário | O que conferir |
|---|---|
| Nota de 1 item | O item já vem marcado; registrar; conferir a linha nova na DATABASE (Produto e Marca preenchidos pela fórmula). |
| Nota com vários itens | Filtrar, marcar 2 itens, "Aplicar aos marcados" para o tipo, registrar: 2 linhas seguidas. |
| Quantidade parcial | Nota com qtd 60, informar 20 → grava 20. Informar 61 → a tela recusa. |
| Dados ausentes | Nota sem "PED" no XML → pedido vazio e editável. Item sem código SR, ou faltando pedido, bloqueio ou valor → a tela bloqueia e mostra o que falta; "Buscar no cadastro" resolve o código SR. |
| Nota não encontrada | Número inexistente → opções "Anexar arquivo XML" e "Registrar sem XML". |
| Duplicidade | Registrar de novo o mesmo item com o mesmo tipo → aviso "Possível duplicidade" com a linha existente. Com outro tipo → grava normal. |
| Clique duplo | Clicar várias vezes em "Confirmar" → só um conjunto de linhas gravado (veja a `LOG_APP`). |

Para não sujar a planilha nos testes, faça-os numa **cópia** da planilha: defina `PLANILHA_ID` com o ID da cópia e remova a propriedade depois.

Fora do Google, `node tests/rodar.js "C:\Users\Só Reparos\Downloads\XMLs"` roda os mesmos testes e lê todos os XMLs reais da pasta.

### 5. Implantar
*Implantar → Nova implantação → Tipo: App da Web*:
- **Executar como:** Eu (a conta dona da planilha e da pasta de XMLs).
- **Quem pode acessar:** *Qualquer pessoa em soreparos.com.br* (já definido no manifesto).

Copie a URL `/exec` e distribua (ex.: atalho no celular/computador do recebimento).
Para publicar alterações: *Implantar → Gerenciar implantações → editar → Nova versão*. A URL continua a mesma.

Os conferentes **não precisam** de acesso de edição à planilha: o app grava com a conta de quem implantou, e a `LOG_APP` registra o e-mail de quem usou.

## Manutenção

| Quero… | Onde |
|---|---|
| Incluir conferente | Na própria tela: lista Conferente → "＋ Cadastrar novo conferente…". Vai para o fim da coluna A da `CONFIG_APP` e fica registrado na `LOG_APP`. |
| Remover conferente ou mudar tipo de ocorrência | Aba `CONFIG_APP` (reexiba: *clique direito nas abas → Mostrar*). Uma opção por linha. Para valer na hora, rode `limparCache`; senão, em até 5 min. |
| Novo fornecedor com nome curto | `CONFIG_APP`, colunas E/F: CNPJ completo ou raiz de 8 dígitos → nome usado na planilha. |
| Trocar a pasta dos XMLs | `PASTA_XML_ID` na `CONFIG_APP`. |
| Trocar a pasta das fotos | `PASTA_FOTOS_ID` na `CONFIG_APP` (ID ou link). Padrão: a pasta definida em `Config.js`. |
| Mudar o valor gravado no Status | `STATUS_INICIAL` na `CONFIG_APP`. |
| Renomearam um cabeçalho da DATABASE | `CONFIG.COLUNAS` em `Config.js`. O app procura pelo texto, não pela posição; se não achar, avisa qual falta e não grava nada. |
| Cabeçalho mudou de linha | `LINHA_CABECALHO` / `PRIMEIRA_LINHA_DADOS` em `Config.js`. |
| Ignorar outra subpasta de XMLs | `PASTAS_IGNORADAS` em `Config.js` (hoje: `canceladas`). |
| Investigar um erro | A tela mostra "(código xxxxxxxx)". Procure o código na `LOG_APP` ou em *Execuções* no Apps Script. |

### Cuidados com a planilha
- **Não apague** as fórmulas da linha 9 (A, K, L, M, T). Produto e Marca dependem delas.
- A próxima linha livre é a seguinte à **última "Data da Ocorrência" preenchida**. Linhas digitadas à mão continuam funcionando junto com o app.
- O `Cod produto` é gravado como **número** (o PROCV do cadastro exige). Códigos com zero à esquerda ou letras (ex.: cod. integração de outros fornecedores) são gravados como **texto**, sem perder zeros.
