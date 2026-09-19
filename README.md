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
- **Camada "PIB"** — colunas hexagonais 3D proporcionais ao PIB municipal.
- **Politicopédia** — 46 verbetes explicando cargos, poderes, eleições, orçamento e
  indicadores. Cada termo técnico da interface abre a explicação correspondente.

Todo texto é escrito para público geral, respondendo *o que é*, *como funciona* e
*qual a função*.

---

## Dados já obtidos

### Resumo

| Bloco | Fonte | Recorte territorial | Período | Registros |
|---|---|---|---|---|
| Malhas territoriais | IBGE | 27 UFs + 5.570 municípios | — | 5.597 |
| Centroides | derivado IBGE | 27 UFs + 5.570 municípios | — | 5.597 |
| População | IBGE SIDRA 6579 | 27 UFs + 5.571 | **2024** | 5.598 |
| PIB (total e per capita) | IBGE SIDRA 5938 | 27 UFs + 5.571 | **2021** | 5.598 |
| Receitas e despesas | Tesouro / Siconfi DCA | 27 UFs + 5.558 municípios | **2023** | 5.585 |
| Eleições municipais | TSE | 26 UFs + 5.546 municípios | **2024** | 5.546 prefeitos, 5.546 vices, 57.933 vereadores |
| Eleições gerais | TSE | 27 UFs + Brasil | **2022** | 27 governadores, 27 senadores, 513 dep. federais, 1.059 dep. estaduais |

Total: ~83 MB de JSON, sem os arquivos brutos de origem (~112 MB de ZIPs do TSE, que
ficam fora do versionamento e são baixados por `npm run scrape:tse`).

### Detalhe por bloco

**Território** (`data/maps/`)
Malhas geográficas do IBGE em GeoJSON, uma por UF, mais os centroides de cada
município para posicionar os pontos no mapa e centralizar a câmera na busca.
O maior arquivo isolado é `ufs/31.geojson` (Minas Gerais), com 7,7 MB.

**Indicadores socioeconômicos** (`data/indicators/`)

- População estimada, ano-base 2024.
- PIB a preços correntes e PIB per capita, ano-base 2021 (último disponível).
- O PIB per capita é calculado, não vem pronto: a variável 593 do SIDRA não existe,
  então dividimos o PIB pela população.
- `pontos.json` é um arquivo derivado com os 5.570 municípios já com PIB, usado para
  desenhar os hexágonos.

**Orçamento público** (`data/budget/`)

- Exercício 2023, Declaração de Contas Anuais (DCA) do Siconfi.
- Por ente: receita total, despesa total e gastos por área de governo — hoje
  **saúde** e **educação**, as duas funções obrigatórias constitucionalmente.
- Cobertura: **27 UFs e 5.558 municípios**.

**Eleições** (`data/elections/`)

- **Municipais 2024** — prefeito, vice-prefeito e a lista completa de vereadores
  eleitos, com nome de urna, nome completo, partido, número e período de mandato.
  Cobertura em 26 UFs; o Distrito Federal não tem eleição municipal e por isso não
  aparece (correto, não é lacuna).
- **Gerais 2022** — presidente, vice, governadores, vices, senadores, deputados
  federais e deputados estaduais/distritais eleitos, por UF.
- **Composição partidária** (`composicao-brasil.json`) — quantas cadeiras cada partido
  ocupa em cada casa legislativa, derivada do resultado eleitoral.
- **DE-PARA TSE ↔ IBGE** (`de-para-tse-ibge.json`) — 5.561 entradas ligando o código
  de município do TSE ao `codarea` do IBGE. Sem isso não haveria como cruzar eleição
  com população e PIB. **100% casado.**

### A chave de junção

Todo cruzamento entre bases usa o código de área do IBGE (`codarea`): 2 dígitos para
UF, 7 para município. É o que permite, por exemplo, mostrar o PIB de um município ao
lado dos vereadores dele, que vêm de uma base com código completamente diferente.

---

## Como os dados são construídos

Nada é digitado à mão. Cada bloco tem um script de ingestão que baixa da fonte
oficial, normaliza e grava em `data/`:

```bash
npm run ingest              # tudo, em ordem, com fallback entre fontes
npm run ingest:indicators   # só IBGE/SIDRA
npm run ingest:budget       # só Siconfi
npm run ingest:elections    # só TSE municipal
npm run ingest:mandatos     # só TSE eleições gerais
npm run ingest:centroides   # recalcula centroides
```

O orquestrador (`scripts/ingest-all.ts`) tenta a fonte primária, cai para uma
alternativa se ela falhar, e em último caso preserva o último dado bom em vez de
gravar um arquivo vazio.

O TSE fica atrás de um WAF que bloqueia requisições automatizadas simples, por isso
`npm run scrape:tse` usa Playwright para baixar os ZIPs.

Os arquivos derivados do site (`pontos.json`, `composicao-brasil.json`) são gerados
no build, não versionados como fonte:

```bash
npm run gerar:derivados
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
scripts/           ingestão, transformação e build
data/              datasets versionados — são o conteúdo do site
  maps/            malhas e centroides
  indicators/      população e PIB
  budget/          orçamento (Siconfi)
  elections/       eleições e representação
  elections/raw/   ZIPs originais do TSE (não versionados)
docs/              arquitetura, fontes de dados e decisões
```

---

## Limitações conhecidas

Vale saber antes de tirar conclusões dos números:

- **Os anos de referência não coincidem.** População é 2024, PIB é 2021, orçamento é
  2023. Comparar PIB com orçamento do mesmo território é comparar anos diferentes.
- **O PIB é de 2021** porque é o último ano divulgado pelo IBGE. Não há como atualizar.
- **A contagem de municípios varia entre fontes** (5.546 a 5.571). Isso é esperado:
  cada base tem sua própria data de corte, e Fernando de Noronha aparece em algumas
  como município e em outras como distrito estadual.
- **O orçamento cobre saúde e educação**, não todas as funções de governo. São as duas
  com piso constitucional, o que as torna comparáveis entre entes.
- **Cargos são os eleitos em 2022 e 2024**, não necessariamente quem está no cargo
  hoje: o site não acompanha sucessão, cassação ou renúncia.
- **As cores de partido são escolha visual**, não identidade oficial. Não existe
  padronização oficial de cores por partido.
- **Municípios pequenos podem ter dados ausentes** em uma ou outra fonte, quando a
  base de origem não publica o valor.

---

## Fontes

Todos os dados vêm de bases públicas oficiais:

- **IBGE** — malhas territoriais (API v3), população e PIB (SIDRA, tabelas 6579 e 5938)
- **Secretaria do Tesouro Nacional** — Siconfi, Declaração de Contas Anuais (DCA)
- **Tribunal Superior Eleitoral** — Portal de Dados Abertos

O código de análise é aberto; os dados pertencem às suas fontes. Consulte
`docs/data-sources/` para periodicidade e ressalvas de cada base.
