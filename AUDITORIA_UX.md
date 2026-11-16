# Auditoria de UX/UI — Devoluções · Logística

Data: 14/11/2026 · Nenhum código foi alterado nesta etapa.

## Status das correções (16/11/2026)

Corrigidos e **reverificados no navegador (desktop)**: UX-01, 02, 03, 04, 05, 06 (opt-in: só nos modais "Revisar ocorrência" e "Corrija antes de registrar"), 07*, 08, 09, 10, 13, 19, 21, 22.
Resumo da solução: `SR.travar/soltar` (trava de rolagem por camada) + `scrollbar-gutter: stable`; no modal, armadilha de foco, Esc só fecha a camada de cima, foco devolvido ao gatilho e rodapé de ações fixo; overlay "carregando" tira o foco do botão e bloqueia Tab; perfis de e-mail avisam sobre alterações não salvas e a exclusão é em dois passos (botão `.perigo`).
\* UX-07: no teste o foco voltou ao último elemento focado antes do modal; com clique real do mouse o botão clicado recebe o foco, então volta a ele.

**Não corrigidos (continuam abertos):** UX-11, 12, 14, 15 (só encurtei a ajuda do "De"), 16, 17, 18, 20.

## Como foi feita

- Leitura de `Index.html`, `Estilo.html`, `App.html`, `Home.html`, `ConfigEmail.html` e trechos de `Componentes.html`.
- A interface foi montada **fora do Apps Script**, com um `google.script.run` simulado (46 ocorrências de teste), e testada no navegador em desktop (1280×800). Cliques, teclado (Tab, Esc) e rolagem foram reais; medições de layout foram feitas por script.
- Cada achado abaixo tem a marca **[testado]** (reproduzido na tela) ou **[código]** (visto no código, não reproduzido).

### O que NÃO foi verificado
- **Celular/tablet reais:** o emulador do painel reportou largura de 981 px em vez de 375 px, então os resultados em tela pequena não são confiáveis. Os itens de responsividade abaixo são só leitura de CSS.
- Rolagem por toque, orientação, leitor de tela, contraste numérico, modo escuro, impressão.
- Tela **Bloqueios** e fluxo **Nova ocorrência** (formulário, fotos, revisão): lidos só por CSS/trechos, não percorridos.
- Arrastar cartões no **Quadro** (e se há alternativa por teclado).
- Dados reais: a lista usou dados simulados, então não avaliei skeleton × conteúdo final nem textos reais longos.

## Resumo

A base visual é boa: tokens de espaçamento e cor, estados de foco (`:focus-visible`), `prefers-reduced-motion` respeitado, painel lateral com armadilha de foco e retorno de foco, popovers com fechamento por Esc e clique fora. O principal ponto fraco é o **modal central** (`#modal`), que foi construído com menos cuidado que o painel lateral e hoje é a origem de quase todos os problemas de comportamento. Os perfis de e-mail (feature recente) herdam esses problemas e ainda têm um editor longo com botão Salvar escondido no fim.

Total: **22 achados** — 0 críticos, 4 altos, 8 médios, 6 baixos, 4 cosméticos.

## Ranking

| ID | Sev. | Onde | Resumo | Prova |
|---|---|---|---|---|
| UX-01 | Alto | Modal | A página de fundo rola junto com o modal | testado |
| UX-02 | Alto | Modal | Tab sai do modal para a página de fundo (sem armadilha de foco) | testado |
| UX-03 | Alto | Painel + modal | Um único Esc fecha o modal **e** o painel, perdendo o que estava sendo editado | testado |
| UX-04 | Alto | Perfis de e-mail | Editor longo: Salvar/Cancelar só aparecem no fim da rolagem | testado |
| UX-05 | Médio | Painel | Conteúdo salta ~7 px ao abrir o painel (some a barra de rolagem) | testado |
| UX-06 | Médio | Modal | Clicar no fundo escuro não fecha (painel e popover fecham) | testado |
| UX-07 | Médio | Modal | Foco não volta ao botão que abriu o modal | testado |
| UX-08 | Médio | Modal | `overscroll-behavior` ausente: rolagem "vaza" para a página no fim do modal | testado |
| UX-09 | Médio | Carregando | Overlay de carregamento não bloqueia o teclado | código |
| UX-10 | Médio | Perfis de e-mail | Fechar (Esc/Cancelar) descarta edições sem aviso; excluir usa `confirm()` nativo | código |
| UX-11 | Médio | Formalizar | Salvar perfis com o painel aberto regenera assunto/texto e descarta edições do e-mail | código |
| UX-12 | Médio | Global | `100vh`/`88vh`/`92vh`/`85vh` em vez de `dvh` (barra do navegador no celular) | código |
| UX-13 | Baixo | Perfis de e-mail | "Excluir este perfil" tem o mesmo peso visual de "Remover assinatura" | testado |
| UX-14 | Baixo | Global | Alvos de toque abaixo de 44 px (Lista/Quadro 36, Atualizar 32, crédito 24, `.link` 32) | testado |
| UX-15 | Baixo | Perfis de e-mail | Texto de ajuda do "De" (3 linhas) repetido em cada perfil; cartões sem título | testado |
| UX-16 | Baixo | Global | `body { overflow-x: hidden }` esconde estouros horizontais em vez de corrigi-los | código |
| UX-17 | Baixo | Formalizar | "Abrir rascunho no Gmail" não tem trava contra clique duplo | código |
| UX-18 | Baixo | Toast | Mensagem some em 3,5 s fixos, sem pausa ao passar o mouse | código |
| UX-19 | Cosmético | Lista | `.grupo-dia` sticky com `top: 56px`, mas a barra tem 57 px (1 px de diferença) | testado |
| UX-20 | Cosmético | Toast | Sem animação de saída; reaparece sem reiniciar a animação | código |
| UX-21 | Cosmético | Modal | Dois scrollbars lado a lado (página + modal) | testado |
| UX-22 | Cosmético | Painel | Esc/overlay: o painel restaura o foco, o modal não (inconsistência entre componentes) | testado |

## Detalhe dos achados

### UX-01 · A página rola atrás do modal — Alto [testado]
- **Passos:** abrir a engrenagem (modal) → girar a roda do mouse sobre o fundo escuro.
- **Atual:** `scrollY` foi de 0 para 500 com o modal aberto. O painel lateral trava (`document.body.style.overflow = 'hidden'`, `Home.html:623`), o modal não.
- **Esperado:** fundo imóvel enquanto qualquer camada estiver aberta.
- **Correção:** um contador de camadas abertas (painel, modal, popover móvel) que liga/desliga `overflow: hidden` no `html`; ligar também em `abrirModal` (`App.html:819`) e desligar em `fecharModal`.

### UX-02 · Sem armadilha de foco no modal — Alto [testado]
- **Passos:** abrir o modal → focar "Salvar" → Tab.
- **Atual:** o foco vai para "Pular para o conteúdo", na página de fundo. O painel tem armadilha (`Home.html:960`); o modal não, apesar de `aria-modal="true"`.
- **Correção:** reaproveitar a lógica do painel num helper único; ou usar o elemento `<dialog>` com `showModal()` (traz armadilha, Esc e fundo inerte de graça). Opcional: `inert` no `<main>`.

### UX-03 · Esc fecha tudo de uma vez — Alto [testado]
- **Passos:** abrir ocorrência → Formalizar e-mail → "Configurar perfis" → Esc.
- **Atual:** modal **e** painel fecharam com um Esc (`App.html:827` e `Home.html:953` escutam o mesmo evento).
- **Esperado:** Esc fecha só a camada de cima.
- **Correção:** pilha de camadas com um único listener de Esc que fecha apenas o topo; os demais ignoram quando há camada acima.

### UX-04 · Salvar escondido no editor de perfis — Alto [testado]
- **Atual:** com 2 perfis o modal já ocupa a altura toda (88vh) e `#modalAcoes` é `position: static`; com 4–5 perfis, quem edita o primeiro precisa rolar tudo para achar Salvar.
- **Correção:** `.modal-acoes { position: sticky; bottom: 0; background: var(--superficie); }` com sombra/borda superior; opcionalmente recolher os perfis (acordeão, um aberto por vez).

### UX-05 · Salto de 7 px ao abrir o painel — Médio [testado]
- **Medição:** com o painel aberto, `h1.left` foi de 57 para 64 px e a largura útil de 1265 para 1280 (a barra de rolagem de 15 px some).
- **Correção:** `html { scrollbar-gutter: stable; }` (e travar o scroll por classe, não por `style` inline).

### UX-06 · Clicar fora não fecha o modal — Médio [testado]
- O painel (`veuPainel`) e o popover de período fecham pelo fundo; o modal não. Comportamento imprevisível entre camadas.
- **Correção:** fechar por clique no fundo **exceto** em modais com dados em edição (UX-10) e durante envio.

### UX-07 · Foco não volta ao gatilho — Médio [testado]
- `abrirModal` não guarda `document.activeElement`; `fecharModal` não restaura. Quem usa teclado perde o lugar na página.
- **Correção:** guardar o elemento ao abrir; devolver o foco ao fechar (se ainda existir).

### UX-08 · Vazamento de rolagem — Médio [testado]
- `.modal-caixa`, `.painel-corpo`, `.resultados-sr` e `.filtro-valores` usam `overflow: auto` sem `overscroll-behavior: contain` (valor medido: `auto`). Ao chegar ao fim da rolagem interna, a página atrás começa a rolar.
- **Correção:** `overscroll-behavior: contain` nesses contêineres.

### UX-09 · Overlay "carregando" não bloqueia o teclado — Médio [código]
- `carregando()` só alterna a classe `oculto` (`App.html:50`). Com o overlay visível, Tab ainda alcança botões da página e Enter dispara a ação de novo (risco de envio duplicado).
- **Correção:** `inert` no conteúdo enquanto carrega, ou levar o foco para o overlay e prender ali.

### UX-10 · Editor de perfis descarta sem avisar — Médio [código]
- Esc, "Cancelar" ou (futuro) clique no fundo fecham o modal sem aviso; "Excluir este perfil" usa `window.confirm` nativo, fora do padrão visual do app.
- **Correção:** marcar o formulário como "sujo" e pedir confirmação ao fechar; trocar o `confirm()` por confirmação no próprio modal.

### UX-11 · Salvar perfis reinicia o e-mail em edição — Médio [código]
- `document.addEventListener('sr-config-email', …)` chama `mostrarFormalizacao` de novo (`Home.html:~836`), recriando assunto e texto. Quem já tinha ajustado o texto perde o ajuste.
- **Correção:** ao receber o evento, atualizar só o seletor de perfil e o resumo de destinatários; regenerar assunto apenas se o usuário ainda não o editou.

### UX-12 · Unidades `vh` — Médio [código]
- `max-height: 88vh` (modal), `92vh` (modal mobile), `85vh` (popover mobile), `calc(100vh - 220px)` (quadro): em navegadores móveis o `vh` inclui a barra de endereço, então o rodapé do modal pode ficar fora da tela.
- **Correção:** `dvh` com `vh` de reserva (`max-height: 88vh; max-height: 88dvh;`). *Não verificado em aparelho.*

### UX-13 · Ação destrutiva sem destaque — Baixo [testado]
- "Excluir este perfil" e "Remover assinatura" são idênticos (`leve pequeno`). **Correção:** variante de perigo (texto vermelho) para a exclusão e separação visual do outro botão.

### UX-14 · Alvos de toque pequenos — Baixo [testado]
- Medidos: Lista 36 px, Quadro 36, Atualizar 32, link do crédito 24, `.link` com `min-height: 32px`. Recomendação 44 px (ou espaçamento que compense).

### UX-15 · Ruído no editor de perfis — Baixo [testado]
- O texto "Precisa estar cadastrado como 'Enviar e-mail como'…" aparece inteiro em cada perfil; os cartões não têm título (com vários perfis, só o campo "Nome" os distingue).
- **Correção:** mostrar a ajuda uma vez no topo (ou como dica recolhível) e dar um cabeçalho ao cartão com o nome do perfil.

### UX-16 · `overflow-x: hidden` no `body` — Baixo [código]
- `Estilo.html:79`. Qualquer elemento largo demais fica cortado em silêncio. Melhor corrigir a origem e tirar a máscara em desenvolvimento para enxergar os estouros.

### UX-17 · Clique duplo em "Abrir rascunho" — Baixo [código]
- `abrirGmail` não tem variável "em andamento"; o overlay protege na prática, mas só depois de pintado. **Correção:** desabilitar o botão até o retorno.

### UX-18 · Toast — Baixo [código]
- 3,5 s fixos; mensagens longas (ex.: erro de permissão) podem sumir antes da leitura. **Correção:** tempo proporcional ao texto e pausa ao passar o mouse/foco; erros com botão de fechar.

### UX-19 a UX-22 — Cosméticos
- **UX-19** `top: 56px` fixo × barra de 57 px: 1 px de sobreposição ao rolar. Usar uma variável CSS com a altura real da barra.
- **UX-20** `toast` não tem saída animada e não reinicia a animação se disparado em sequência (remover/readicionar classe no mesmo quadro).
- **UX-21** Com o modal aberto, aparecem duas barras de rolagem lado a lado (resolvido por UX-01).
- **UX-22** O painel restaura o foco; o modal não (resolvido por UX-07).

## Problemas recorrentes (causa comum)

1. **Camadas sem gestor central** (UX-01, 02, 03, 06, 07, 08, 09, 21, 22): modal, painel, popover, overlay de carregando e seletor têm cada um sua própria regra de scroll, Esc, foco e fundo.
2. **Unidades de altura de viewport** (UX-12) espalhadas pelo CSS.
3. **Edição sem proteção** (UX-10, 11): nada marca "alterações não salvas".

## Recomendações estruturais

1. Criar um **gestor de camadas** (`SR.camadas`): `abrir(el, opcoes)` / `fechar()`, com pilha, travamento de scroll com contador, Esc só na camada do topo, armadilha de foco, `inert` no fundo e restauração do foco. Painel, modal, popover móvel e seletor passam a usar o mesmo.
2. Migrar o modal para `<dialog>` nativo (ou manter o `div` usando o gestor acima).
3. `html { scrollbar-gutter: stable; }` e trocar `vh` por `dvh`.
4. Modais de formulário: rodapé de ações fixo e proteção de "alterações não salvas".

## Padronização do design system

- Variável `--altura-barra` usada pela barra e por tudo que é sticky abaixo dela.
- Escala de alvos de toque: `--controle` (já existe) como mínimo de 44 px em telas touch.
- Botão de perigo (`.btn.perigo`) e componente de confirmação, em substituição a `confirm()`.
- Padrão único de duração de toast/feedback por tipo (ok, aviso, erro).
- Utilitário `.rolagem-contida { overflow: auto; overscroll-behavior: contain; }`.

## Plano de correção priorizado

1. **Rápido (uma tarde):** UX-05 (`scrollbar-gutter`), UX-08 (`overscroll-behavior`), UX-04 (rodapé sticky), UX-13, UX-19.
2. **Núcleo (1–2 dias):** gestor de camadas → resolve UX-01, 02, 03, 06, 07, 09, 21, 22 de uma vez.
3. **Perfis de e-mail:** UX-10, 11, 15.
4. **Responsividade:** UX-12 e UX-14, **depois de testar em aparelho real** (esta auditoria não conseguiu).
5. **Acabamento:** UX-16, 17, 18, 20.
