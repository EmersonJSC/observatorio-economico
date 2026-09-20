# Observatório Econômico

Explorador de dados públicos brasileiros orientado por mapa: escolha um estado ou
município e veja, no mesmo lugar, população, PIB, orçamento, resultado eleitoral e quem
ocupa cada cargo.

Site 100% estático — sem servidor, sem banco de dados, sem custo de hospedagem.
Publicado no Cloudflare Pages.

---

## O que o site faz

Ao selecionar um território no mapa, um painel lateral se abre com cinco abas:

| Aba | O que mostra |
|---|---|
| **Retrato** | População, PIB total e PIB per capita, com ano de referência e fonte |
| **Gestão** | Receitas, despesas e gastos por área (saúde, educação) do exercício |
| **Pessoas** | Prefeito, vice e a lista nominal de vereadores — ou, no estado, governador, senadores e deputados |
| **Cadeiras** | Composição partidária das casas legislativas em gráfico de rosca |
| **Comparar** | Compara o território escolhido com um segundo território, lado a lado |

Além do painel:

- **Camada "força política"** — escolha um partido na legenda e o mapa colore cada
  território conforme a fatia de cadeiras que aquele partido ocupa ali. Serve para
  responder "onde este partido é forte", não "quem manda aqui".
- **Camada "Informação"** — lentes para PIB, PIB por habitante, receita,
  despesa, população, densidade, saúde e educação. Totais usam áreas hexagonais
  3D; taxas e valores por habitante usam a cor de cada território. O tooltip do
  hover mostra o valor real da lente ativa e o ano de referência, ou "sem dado"
  quando não há valor. As lentes de orçamento hoje só têm dado em Minas Gerais.
- **Ranking** — todos os 27 estados e 5.571 municípios ordenados por PIB, PIB per
  capita, população, receita ou despesa, agrupados em faixas de escala. Clicar em uma
  linha leva o mapa até o território.
- **Politicopédia** — 46 verbetes explicando cargos, poderes, eleições, orçamento e
  indicadores. Cada termo técnico da interface abre a explicação correspondente.

Todo texto é escrito para público geral, respondendo *o que é*, *como funciona* e
*qual a função*.

Um mapa visual de tudo isso, com o que já existe e o que ainda falta, está em
[docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md).

---

## Dados já obtidos

Os números abaixo foram **medidos** sobre os artefatos publicados, não estimados.

### Resumo

| Bloco | Fonte | Cobertura | Período |
|---|---|---|---|
| Malhas territoriais | IBGE | 27 UFs + 5.570 municípios | — |
| Localidades | IBGE | 27 UFs + 5.571 municípios | — |
| População | IBGE SIDRA 6579 | 5.570 de 5.571 municípios | **2021** |
| PIB (total e per capita) | IBGE SIDRA 5938 | 5.570 de 5.571 municípios | **2021** |
| Receita, despesa, saúde e educação | Tesouro / Siconfi DCA | **851 a 853 municípios** | **2023** |
| Candidaturas municipais | TSE | 5.569 municípios | **2024** |

### Cobertura do orçamento: por que só 15%

O recurso `siconfi/dca` faz fan-out por `id_ente` — **uma chamada HTTP por ente**
(5.570 municípios + 27 estados), com rate limit `critico` (bloqueio de IP).

O estado de **Minas Gerais foi coletado como prova de conceito**, com 853
municípios mais o governo estadual. Dentro de MG a cobertura é de **99,8% a 100%**
por indicador:

| Indicador | MG | Brasil |
|---|---|---|
| Receita total | 851 de 853 (99,8%) | 851 de 5.571 (15,3%) |
| Despesa total | 853 de 853 (100,0%) | 853 de 5.571 (15,3%) |
| Gasto em saúde | 852 de 853 (99,9%) | 852 de 5.571 (15,3%) |
| Gasto em educação | 853 de 853 (100,0%) | 853 de 5.571 (15,3%) |

Para estender às outras 26 UFs não é necessário alterar código: basta preencher
`data/raw/_parametros/ente.json` com a lista de entes e repetir a coleta.

A lista de entes de MG foi derivada do próprio cadastro do IBGE já publicado
(`data/published/municipios/bloco-*.json`), não de uma lista digitada à mão.

### Indicadores deliberadamente bloqueados

`receita_per_capita`, `despesa_per_capita`, `saude_per_capita` e
`educacao_per_capita` **não são publicados com valor**. O orçamento é de 2023 e a
população disponível é de 2021 — dividir um pelo outro produziria um número sem
significado. A Caixa 6 registra o motivo `ano-divergente` e devolve `null`.

Os valores de saúde e educação publicados são **absolutos** (R$).

### Detalhe por bloco

**Território** (`data/published/territorios/`)
Malhas do IBGE em GeoJSON, uma por UF, mais a malha nacional. As propriedades são
enriquecidas na publicação: o IBGE devolve apenas `codarea`, e sem `nome` e
`sigla` o mapa desenha polígonos sem identificação.

**Municípios** (`data/published/municipios/`)
`indice.json` traz as 5.571 entradas leves (código, nome, UF, coordenadas) e
`bloco-N.json` as métricas. Separar o índice dos blocos permite listar e buscar
municípios sem carregar as métricas — o índice é ~5% do peso do bloco completo.

**Orçamento** (`data/published/orcamento/`)
`brasil.json` traz os entes; `{SIGLA}.json` é o shard por UF. O nome do arquivo é
a **sigla**, não o código IBGE.

**Eleições** (`data/published/eleicoes/`)
Hoje só `brasil.json`, com o total de candidaturas por município. As rotas por UF
e os mandatos eleitos ainda não são publicados — ver
`docs/FUNCIONALIDADES.md` §7.

**Ponte TSE ↔ IBGE** (`data/related/municipio.jsonl`)
5.569 unidades eleitorais do TSE ligadas ao `codarea` do IBGE — 5.562 por nome
normalizado e 7 por exceção auditada, com 2 órfãos legítimos. Sem essa ponte não
haveria como cruzar eleição com população e PIB.

### A chave de junção

Todo cruzamento entre bases usa o código de área do IBGE (`codarea`): 2 dígitos para
UF, 7 para município. É o que permite, por exemplo, mostrar o PIB de um município ao
lado dos vereadores dele, que vêm de uma base com código completamente diferente.

---

## Como os dados são construídos

Nada é digitado à mão. O dado atravessa sete caixas, cada uma com seu comando:

```bash
npm run coletar -- --tudo      # 1+2+3 · catálogo, coleta e RAW (objetos por hash)
npm run organizar -- --tudo    # 4 · traduz o RAW para JSONL tipado
npm run relacionar -- --tudo   # 5 · constrói a ponte IBGE × TSE
npm run calcular -- --tudo     # 6 · aplica os motores de cálculo
npm run publicar               # 7 · formata para o contrato do frontend
npm run validar:publicacao     # confere se o contrato foi atendido
```

Cada caixa lê apenas a saída da anterior. Nenhuma delas chama a fonte oficial
diretamente nem recalcula o que pertence a outra.

**Ordem importa.** Publicar sem recalcular reaproveita métricas antigas; por isso o
build completo (`npm run build:site`) roda a publicação antes de empilhar o
frontend.

### Comandos úteis de coleta

```bash
# Uma fonte específica
npm run coletar -- --fonte siconfi --recurso dca

# Simular sem gravar (mostra as chamadas que seriam feitas)
npm run coletar -- --fonte siconfi --simular

# Definir o fan-out explicitamente
npm run coletar -- --recurso dca --param ente=3136702,3100104
```

O fan-out de uma dimensão é resolvido nesta ordem: `--param` do operador, cache em
`data/raw/_parametros/`, tabela estática, e por fim o `exemplo` declarado no
catálogo. **Não há lista de anos padrão** — o default vem do catálogo, por recurso,
para o orquestrador nunca inventar um parâmetro que a fonte não publica.

### Ferramentas de build

```bash
npm run build:site    # caixa 7 + build do Vite + cópia dos dados + validação
npm run dev:web       # servidor de desenvolvimento do frontend
npm run preview:site  # serve o dist já construído
```

Os testes são separados por caixa (não há um `npm test` que rode todos):

```bash
npm run test:coletor   npm run test:raw          npm run test:organizacao
npm run test:relacionamentos  npm run test:calculos   npm run test:publicacao
```

---

## Rodando localmente

Requisitos: Node 22+.

```bash
npm install          # sempre na raiz — é um monorepo npm workspaces
npm run dev:web      # http://localhost:5173
```

O `apps/api` existe para desenvolvimento local e **não é necessário em produção**:

```bash
npm run dev:api      # http://localhost:3001
```

### Publicando

```bash
npm run build:site     # gera apps/web/dist (~85 MB) — é esta a pasta publicada
npm run preview:site   # confere o resultado em http://localhost:4173
```

Instruções completas de hospedagem gratuita em [DEPLOY.md](DEPLOY.md).

---

## Estrutura do projeto

```
apps/web/          interface React + deck.gl; contém o site publicado
apps/api/          API Express, apenas para desenvolvimento local
scripts/           as sete caixas do pipeline
  fontes/          1 · catálogo das fontes oficiais
  coletor/         2 · HTTP, paginação e transporte
  raw/             3 · objetos endereçados por hash + manifesto
  organizacao/     4 · tradutores para JSONL tipado
  relacionamentos/ 5 · ponte IBGE × TSE
  calculos/        6 · motores puros de métrica
  publicacao/      7 · contrato do frontend
  orquestrador/    resolver de fan-out e execução da coleta
data/              os dados, em camadas
  raw/             objetos coletados (não versionados)
  organized/       JSONL tipado por recurso
  related/         ponte territorial e órfãos
  calculated/      métricas por entidade
  published/       artefatos finais que o navegador lê
docs/              arquitetura, fontes de dados e decisões
  FUNCIONALIDADES.md  comportamento entregue, cobertura e limites
  README.md           índice da documentação
```

### Configuração

O Siconfi e o IBGE não exigem chave. O Portal da Transparência, usado por scripts
legados de congresso, exige:

```bash
cp .env.example .env   # preencha PORTAL_API_KEY
```

---

## Limitações conhecidas

Vale saber antes de tirar conclusões dos números:

- **Os anos de referência não coincidem.** População é 2024, PIB é 2021, orçamento é
  2023. Comparar PIB com orçamento do mesmo território é comparar anos diferentes.
- **Os anos de referência não coincidem.** População e PIB são de 2021; o orçamento é
  de 2023. Comparar PIB com orçamento do mesmo território é comparar anos diferentes —
  e é por isso que os indicadores *per capita* de orçamento ficam **bloqueados** em vez
  de serem calculados.
- **O PIB é de 2021** porque é o último ano divulgado pelo IBGE. Não há como atualizar.
- **O orçamento só cobre Minas Gerais** (851 a 853 dos 853 municípios). As outras 26
  UFs ainda não foram coletadas; ver a seção de cobertura acima.
- **A contagem de municípios varia entre fontes** (5.569 a 5.571). Isso é esperado:
  cada base tem sua própria data de corte, e Fernando de Noronha aparece em algumas
  como município e em outras como distrito estadual.
- **O orçamento cobre saúde e educação**, não todas as funções de governo. São as duas
  com piso constitucional, o que as torna comparáveis entre entes.
- **Dois municípios de MG têm defeito na fonte.** Itaguara (3132206) e São João
  Nepomuceno (3162906) chegam do Tesouro com valores contábeis idênticos ao centavo,
  apesar de populações diferentes, e sem o anexo de receita. O site não corrige isso:
  reporta sem dado onde não há dado.
- **As cores de partido são escolha visual**, não identidade oficial. Não existe
  padronização oficial de cores por partido.
- **Municípios pequenos podem ter dados ausentes** em uma ou outra fonte, quando a
  base de origem não publica o valor. A interface mostra "sem dado", nunca zero.
- **Câmara e Portal da Transparência são fontes novas, ainda sem uso na interface.**
  Os scripts de ingestão existem, mas são legados: não participam do pipeline das
  sete caixas e nenhuma tela os exibe.

---

## Fontes

Todos os dados vêm de bases públicas oficiais:

- **IBGE** — malhas territoriais (API v3), população e PIB (SIDRA, tabelas 6579 e 5938)
- **Secretaria do Tesouro Nacional** — Siconfi, Declaração de Contas Anuais (DCA)
- **Tribunal Superior Eleitoral** — Portal de Dados Abertos

O código de análise é aberto; os dados pertencem às suas fontes. Consulte
`docs/data-sources/` para periodicidade e ressalvas de cada base.
