# APIs do Observatório Econômico

Documento único de referência sobre **todas** as APIs do projeto: as APIs
públicas externas consumidas na ingestão e os *endpoints* estáticos consumidos
pelo site em tempo de execução.

> **Princípio arquitetural (ADR 0001):** o site publicado é **100 % estático**.
> Nenhuma API externa é chamada pelo navegador. Os adaptadores rodam apenas nos
> scripts de ingestão (`scripts/`) e gravam JSON em `data/`; o build copia
> `data/` para `apps/web/dist/dados/`. O runtime lê apenas esses arquivos.

Base de leitura no navegador: `` `${import.meta.env.BASE_URL}dados` `` — ver
`apps/web/src/lib/fontes.ts`.

---

## Sumário

**Camada A — ingestão (build-time, Node):**
1. [IBGE — Malhas Territoriais v3](#1-ibge--malhas-territoriais-v3)
2. [IBGE — Localidades v1](#2-ibge--localidades-v1)
3. [IBGE — Agregados / SIDRA v3](#3-ibge--agregados--sidra-v3)
4. [Siconfi / Tesouro Nacional](#4-siconfi--tesouro-nacional)
5. [TSE — DivulgaCandContas, CDN e Dados Abertos](#5-tse--divulgacandcontas-cdn-e-dados-abertos)
6. [Brasil.io (fallback eleitoral)](#6-brasilio-fallback-eleitoral)
7. [Base dos Dados / BigQuery (fallback socioeconômico)](#7-base-dos-dados--bigquery-fallback-socioeconômico)
8. [Câmara dos Deputados — Dados Abertos v2](#8-câmara-dos-deputados--dados-abertos-v2)
9. [Portal da Transparência — API de Dados](#9-portal-da-transparência--api-de-dados)

**Camada B — leitura (runtime, navegador):**
10. [Endpoints estáticos e a camada `*Api.ts`](#10-endpoints-estáticos-e-a-camada-apits)
11. [Relação entre os endpoints (chaves de junção)](#11-relação-entre-os-endpoints-chaves-de-junção)
12. [Onde cada dado é salvo](#12-onde-cada-dado-é-salvo)
13. [Outras possibilidades de endpoints](#13-outras-possibilidades-de-endpoints)
14. [Configuração: `.env`](#14-configuração-env)
15. [Como executar e testar](#15-como-executar-e-testar)

---

# Camada A — Ingestão (build-time)

Orquestradores em `scripts/update-*.ts` chamam os adaptadores de
`scripts/adapters/` e gravam os arquivos base. Depois
`scripts/gerar-derivados.ts` produz os arquivos prontos para o frontend.

```
API externa ──► adapters/*.adapter.ts ──► update-*.ts ──► data/<área>/*.json
                                                              │
                                          gerar-derivados.ts ─┤ (arquivos derivados)
                                                              ▼
                        data/{maps,indicators,budget,elections,explorer,congresso,transparencia}/
                                                              │
                                              build-site.ts ──► apps/web/dist/dados/
```

O `.env` (carregado por `scripts/lib/env.ts`) fornece as chaves das fontes que
exigem autenticação — ver [seção 14](#14-configuração-env).

---

## 1. IBGE — Malhas Territoriais v3

- **URL base:** `https://servicodados.ibge.gov.br/api/v3/malhas`
- **Adaptador:** `scripts/adapters/ibge/ibge-malhas.adapter.ts`
- **Consumido por:** `scripts/update-territorial-data.ts`
- **Docs:** https://servicodados.ibge.gov.br/api/docs/malhas?versao=3

### Endpoints usados

| Método | Endpoint | Retorna |
| --- | --- | --- |
| `GET` | `/paises/BR?formato=application/vnd.geo+json&intrarregiao=UF` | `FeatureCollection` com as 27 UFs |
| `GET` | `/estados/{uf}?formato=application/vnd.geo+json&intrarregiao=municipio` | `FeatureCollection` dos municípios da UF |

### Parâmetros

| Parâmetro | Valor | Efeito |
| --- | --- | --- |
| `formato` | `application/vnd.geo+json` | Retorno em GeoJSON (sem ele, retorna SVG) |
| `intrarregiao` | `UF` \| `municipio` | Nível das subdivisões dentro da malha pedida |

### Como retorna

`GeoJSON.FeatureCollection`. Cada `Feature` traz **somente**
`properties.codarea` (código IBGE numérico) — **não traz nome**. Os nomes são
enriquecidos pelo adaptador de Localidades (seção 2).

### Onde é salvo

- `data/maps/brasil.geojson` — malha das 27 UFs, enriquecida com `nome` e `sigla`
- `data/maps/ufs/{uf}.geojson` — malha de uma UF (municípios)
- `data/maps/metadata.json` — contagem e data de atualização

### Notas

- Sem rate limit documentado; respostas de SP/MG chegam a 5–30 s.
- Execução **sequencial** com ~800 ms entre UFs para evitar HTTP 429.

---

## 2. IBGE — Localidades v1

- **URL base:** `https://servicodados.ibge.gov.br/api/v1/localidades`
- **Adaptador:** `scripts/adapters/ibge/ibge-localidades.adapter.ts`
- **Consumido por:** `update-territorial-data.ts`, `update-indicators-data.ts`,
  `update-budget-data.ts`, `update-elections-data.ts` e o fallback Brasil.io
- **Docs:** https://servicodados.ibge.gov.br/api/docs/localidades

### Endpoints usados

| Método | Endpoint | Retorna |
| --- | --- | --- |
| `GET` | `/estados` | Lista das 27 UFs: `{ id, sigla, nome, regiao }` |
| `GET` | `/estados/{uf}/municipios` | Municípios da UF: `{ id, nome, microrregiao, regiao-imediata }` |
| `GET` | `/municipios/{codarea}` | Um município pelo código de 7 dígitos |

### Como retorna

Array JSON (ou objeto único no terceiro). `id` é o `codarea` IBGE
(2 dígitos p/ UF, 7 p/ município) — é a **chave de junção** de todo o projeto.

### Relação com os outros endpoints

É o dicionário de nomes. Sem ele, `maps/*.geojson` (que só tem `codarea`) não
teria nomes para exibir. Também é a fonte da lista de UFs usada para iterar
sobre os 27 arquivos de cada área.

---

## 3. IBGE — Agregados / SIDRA v3

- **URL base:** `https://servicodados.ibge.gov.br/api/v3/agregados`
- **Adaptador:** `scripts/adapters/ibge/ibge-sidra.adapter.ts`
- **Consumido por:** `scripts/update-indicators-data.ts`
- **Docs:** https://servicodados.ibge.gov.br/api/docs/agregados?versao=3

### Tabelas e variáveis

| Tabela | Variável | Indicador | Unidade |
| --- | --- | --- | --- |
| `6579` | `9324` | População residente estimada | pessoas |
| `5938` | `37` | PIB a preços correntes | **Mil Reais** |

> ⚠️ A tabela `5938` **não** tem variável de PIB per capita (a `593` retorna
> HTTP 500). O per capita é calculado localmente:
> `pibMilReais × 1000 ÷ populacao` (ver `calcularPibPerCapita`).

### Endpoints usados

| Método | Endpoint | Retorna |
| --- | --- | --- |
| `GET` | `/{tabela}/periodos/{ano}/variaveis/{variavel}?localidades=N1[all]\|N3[all]` | Brasil + todas as UFs |
| `GET` | `/{tabela}/periodos/{ano}/variaveis/{variavel}?localidades=N6[N3[{uf}]]` | Municípios de uma UF |
| `GET` | `/6579/periodos/2024/variaveis/9324?localidades=N1[all]` | Só o Brasil |

### Níveis territoriais

`N1` = Brasil · `N3` = UF · `N6` = Município (exige `N3[uf]` como pai).

### Como retorna

`[{ id, variavel, unidade, resultados: [{ classificacoes, series: [{ serie: { "2024": "..." }, localidade: { id, nivel, nome } }] }] }]`

O adaptador achata `resultados[].series[]` em `Map<codarea, valor>`. Valores
especiais (`-`, `..`, `...`, `X`) viram `null` — nunca zero.

### Onde é salvo

- `data/indicators/brasil.json` — consolidado nacional + 27 estados
- `data/indicators/ufs/{uf}.json` — municípios de uma UF
- `data/indicators/metadata.json` — anos de referência e contagens

### Anos de referência atuais

População **2024**, PIB **2021** (`data/indicators/metadata.json`).

---

## 4. Siconfi / Tesouro Nacional

- **URL base:** `https://apidatalake.tesouro.gov.br/ords/siconfi/tt`
- **Adaptador:** `scripts/adapters/siconfi/siconfi.adapter.ts`
- **Consumido por:** `scripts/update-budget-data.ts`
- **Docs:** https://apidatalake.tesouro.gov.br/ords/siconfi/tt/swagger-ui/index.html

### Endpoints usados

| Método | Endpoint | Retorna |
| --- | --- | --- |
| `GET` | `/dca?an_exercicio={ano}&id_ente={codigoIbge}` | Declaração de Contas Anuais do ente (formato *wide*, paginado) |

`/rreo` e `/rgf` estão documentados mas **não são usados**.

### Como retorna

JSON `{ items: [...], hasMore, limit, offset, count }`. Cada item é uma linha do
anexo com `anexo`, `conta`, `coluna` e `valor`. O adaptador filtra:

| Anexo | Conta | Campo extraído |
| --- | --- | --- |
| `DCA-Anexo I-C` | Receitas Orçamentárias | `receitaTotal` |
| `DCA-Anexo I-D` | Despesas Liquidadas | `despesaTotal` |
| `DCA-Anexo I-E` | Função 10 / Função 12 | `gastosPorArea.saude` / `.educacao` |

> ⚠️ O nome do anexo usa **hífen** (`DCA-Anexo I-C`), não espaço.

### Relação com os outros endpoints

Junta por `id_ente` = mesmo `codarea` IBGE. O Siconfi exige o código IBGE
**completo** (7 dígitos no município, 2 na UF) — ver `normalizarIdEnte`.

### Onde é salvo

- `data/budget/brasil.json` — 27 estados + exercício
- `data/budget/ufs/{uf}.json` — municípios da UF
- `data/budget/metadata.json` — exercício (atual: **2023**) e contagens

### Notas

- **Rate limit rigoroso:** bloqueia IPs com muitas requisições (HTTP 429).
  Delay padrão de **300 ms**, no máximo 2 requisições simultâneas.
- Cobertura atual: 5.558 municípios (abaixo dos 5.570 do IBGE — entes sem DCA
  entregue permanecem ausentes).

---

## 5. TSE — DivulgaCandContas, CDN e Dados Abertos

- **Adaptadores:** `scripts/adapters/tse/tse.adapter.ts`,
  `tse-csv-parser.ts`, `tse-depara-builder.ts`, `tse-mandatos.ts`
- **Consumido por:** `scripts/update-elections-data.ts`,
  `scripts/update-mandatos-gerais.ts`, `scripts/scrape-tse.ts`
- **Frontend:** `apps/web/src/features/elections/electionsApi.ts` (só URLs de foto)

### Fontes e endpoints

**5.1 DivulgaCandContas (REST)** — `https://divulgacandcontas.tse.jus.br/divulga/rest/v1`

| Método | Endpoint | Retorna |
| --- | --- | --- |
| `GET` | `/eleicoes/eleitos/{ano}/{uf}/{codigoUe}/{cdCargo}` | Candidatos eleitos do cargo na UE |

Cargos: `3` Governador · `4` Vice-Governador · `11` Prefeito · `12` Vice-Prefeito.
Situações aceitas: `ELEITO`, `ELEITO POR QP`, `ELEITO POR MÉDIA`, `ELEITO NO 2º TURNO`.

**5.2 Foto oficial** — `https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/{idEleicao}/{sqCandidato}/{sgUe}`

> Exceção consciente ao princípio "sem chamadas externas no navegador": são
> **imagens** `<img>`, não dados. A URL é montada em `electionsApi.urlFoto`;
> se falhar, o painel mostra as iniciais. Mapa de eleições em `ID_ELEICAO`.

**5.3 CDN Dados Abertos** — `https://cdn.tse.jus.br/estatistica/sead/odsele/`

| Arquivo | Conteúdo |
| --- | --- |
| `consulta_cand_{ano}.zip` | Candidaturas (nome, partido, cargo, situação) |
| `votacao_candidato_munzona_{ano}.zip` | Votação por candidato/município/zona |

Baixados via Playwright em `scripts/scrape-tse.ts` (o TSE protege com WAF — HTTP 403
para clientes simples). ZIPs brutos ficam em `data/elections/raw/`.

**5.4 Portal de Dados Abertos** — `https://dadosabertos.tse.jus.br` (download humano)

### ⚠️ TSE ≠ IBGE

O TSE usa código de município de **5 dígitos** (ex.: `71072` = São Paulo), o
IBGE usa **7**. A ponte é a tabela local
`data/elections/de-para-tse-ibge.json`, construída por `tse-depara-builder.ts`
(casamento por nome normalizado + UF). Sem ela, prefeito não se liga ao polígono.

### Onde é salvo

- `data/elections/ufs/{uf}.json` — mandatos municipais (prefeito, vice, vereadores)
- `data/elections/estados/{codigoUf}.json` — governador, vice, senadores, deputados
- `data/elections/brasil.json` — presidente, vice e composição do Congresso
- `data/elections/de-para-tse-ibge.json` — ponte TSE ↔ IBGE
- `data/elections/metadata.json` — anos (estadual 2022, municipal 2024)
- `data/elections/raw/*.zip` — bruto do CDN (não vai para o site)

---

## 6. Brasil.io (fallback eleitoral)

- **URL base:** `https://api.brasil.io/v1`
- **Adaptador:** `scripts/adapters/brasilio/brasilio.adapter.ts`
- **Docs:** https://brasil.io/api/v1/

### Endpoints usados

| Método | Endpoint | Retorna |
| --- | --- | --- |
| `GET` | `/dataset/eleicoes-brasil/{tabela}/data/?{filtros}` | Página de resultados + `next` |

Tabelas: `candidatos`, `votacoes` (também existem `bens_candidatos`, `filiados`).

### Como retorna

JSON `{ count, next, previous, results: [...] }`. A paginação é feita seguindo
`next` até `null`. Cabeçalho obrigatório: `Authorization: Token {BRASILIO_TOKEN}`.

### Relação com os outros endpoints

É o **substituto** do TSE/CDN quando o WAF bloqueia. Usa `sigla_ue` (código TSE)
e casa com o IBGE pela **mesma** tabela `de-para-tse-ibge.json`.

### Configuração

```bash
export BRASILIO_TOKEN="..."   # https://brasil.io/auth/tokens-api/
```

Sem o token, o adaptador é ignorado e o pipeline preserva os dados locais.

---

## 7. Base dos Dados / BigQuery (fallback socioeconômico)

- **Adaptador:** `scripts/adapters/basedosdados/basedosdados.adapter.ts`
- **Plataforma:** https://basedosdados.org

### Endpoints usados

| Método | Endpoint | Retorna |
| --- | --- | --- |
| `POST` | `https://bigquery.googleapis.com/bigquery/v2/projects/{projeto}/queries` | Resultado da consulta SQL (`schema` + `rows`) |

Tabelas: `br_ibge_populacao.municipio`, `br_ibge_pib.municipio`.

### Como retorna

`{ jobComplete, schema: { fields }, rows: [{ f: [{ v }] }] }` — o adaptador
converte o formato colunar do BigQuery em objetos simples.

### Relação com os outros endpoints

Substitui o SIDRA (seção 3) quando ele falha, gravando **nos mesmos arquivos**
`data/indicators/`. Chave: `id_municipio` (codarea IBGE, 7 dígitos).

### Configuração

```bash
export BD_BILLING_PROJECT="seu-projeto-gcp"
export BD_ACCESS_TOKEN="$(gcloud auth print-access-token)"
```

Sem as variáveis, é ignorado e o pipeline preserva os dados locais.

---

## 8. Câmara dos Deputados — Dados Abertos v2

- **URL base:** `https://dadosabertos.camara.leg.br/api/v2/`
- **Adaptador:** `scripts/adapters/camara/camara.adapter.ts`
- **Consumido por:** `scripts/update-congresso-data.ts`
- **Docs:** https://dadosabertos.camara.leg.br/swagger/api.html
- **OpenAPI:** https://dadosabertos.camara.leg.br/api/v2/api-docs — **79 endpoints**

✅ **Não exige autenticação.** É a única fonte do projeto sem chave.

### Convenções da API

Toda listagem devolve o mesmo envelope:

```json
{
  "dados": [ { "...": "item" } ],
  "links": [
    { "rel": "self",  "href": "..." },
    { "rel": "next",  "href": "..." },
    { "rel": "first", "href": "..." },
    { "rel": "last",  "href": "..." }
  ]
}
```

| Convenção | Valor |
| --- | --- |
| Paginação | `pagina` (a partir de 1) + `itens` (**máx. 100**, padrão 15) |
| Ordenação | `ordenarPor` (campo) + `ordem` (`asc`/`desc`) |
| Próxima página | o próprio `links[rel=next]` — é a condição de parada |
| Formatos | JSON e XML — selecionados pelo header `Accept` |

### Endpoints usados

| Método | Endpoint | Retorna |
| --- | --- | --- |
| `GET` | `/deputados?idLegislatura={n}&siglaUf={uf}` | Lista de deputados com partido, UF e foto |
| `GET` | `/deputados/{id}` | Detalhe: `nomeCivil`, CPF, sexo, escolaridade |
| `GET` | `/partidos?idLegislatura={n}` | Partidos com representação |
| `GET` | `/deputados/{id}/despesas?ano={ano}` | Cota parlamentar (CEAP) |

### Parâmetros de `/deputados`

`id`, `nome`, `idLegislatura`, `siglaUf`, `siglaPartido`, `siglaSexo`,
`dataInicio`, `dataFim`, `pagina`, `itens`, `ordem`, `ordenarPor`.

> Sem filtro de tempo/legislatura, a API devolve apenas os deputados **em
> exercício no momento da requisição**. Para legislaturas passadas é obrigatório
> passar `idLegislatura` (57 = 2023-2027).

### Como retorna (`/deputados`)

```json
{
  "id": 74646,
  "nome": "Aécio Neves",
  "siglaPartido": "PSDB",
  "siglaUf": "MG",
  "idLegislatura": 57,
  "urlFoto": "https://www.camara.leg.br/internet/deputado/bandep/74646.jpg",
  "email": "dep.aecioneves@camara.leg.br"
}
```

### Estrutura de `/deputados/{id}/despesas`

```json
{
  "ano": 2024, "mes": 3,
  "tipoDespesa": "PASSAGEM AÉREA - SIGEPA",
  "codDocumento": 123456, "tipoDocumento": "Nota Fiscal",
  "dataDocumento": "2024-03-15", "numDocumento": "123",
  "valorDocumento": 1234.56, "valorGlosa": 0, "valorLiquido": 1234.56,
  "nomeFornecedor": "...", "cnpjCpfFornecedor": "..."
}
```

O adaptador **agrega** por deputado/ano (`totalLiquido`, `totalGlosa`,
`quantidadeDocumentos`, `porTipo`) em vez de publicar as milhares de linhas
individuais — o site precisa do total, não do extrato.

### ⚠️ Instabilidade conhecida

Durante a implementação, `/deputados/{id}/despesas` **retornou `dados: []`
para todos os deputados e anos testados**, enquanto `/deputados` e `/partidos`
respondiam normalmente. Também houve HTTP 504 intermitente em `/deputados`
(a mesma URL falhou e depois respondeu em 0,17 s).

Consequências no código:
- O adaptador trata lista vazia como "sem despesa", não como erro — a ingestão
  de deputados e partidos **não é invalidada** por isso.
- O smoke test (`testarConectividade`) **não** consulta `/despesas`, para não
  reportar falso negativo.
- Falhas por deputado são contadas e resumidas, nunca abortam o pipeline.

### Relação com os outros endpoints

Não compartilha chave com TSE nem IBGE: a Câmara identifica deputados por `id`
próprio (`74646`), que **não** é `sqCandidato` do TSE nem `codarea` do IBGE.
A ponte com o resto do projeto é por **nome + sigla da UF**, contra os mandatos
já ingeridos do TSE — casamento heurístico, não determinístico.

---

## 9. Portal da Transparência — API de Dados

- **URL base:** `https://api.portaldatransparencia.gov.br/api-de-dados`
- **Adaptador:** `scripts/adapters/portal-transparencia/portal-transparencia.adapter.ts`
- **Consumido por:** `scripts/update-transparencia-data.ts`
- **Docs:** https://portaldatransparencia.gov.br/api-de-dados
- **OpenAPI:** https://api.portaldatransparencia.gov.br/v3/api-docs — **106 endpoints**

### 🔑 Autenticação — obrigatória

Header `chave-api-dados`. Cadastro gratuito:
https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email

| Situação | Resposta |
| --- | --- |
| Sem o header | `401` — `{"Erro na API":"Chave de API não informada! …"}` |
| Chave inválida | `401` — `{"Erro na API":"Chave de API inválida!"}` |

Configuração em `.env`:

```bash
PORTAL_API_KEY="sua_chave"
```

> O adaptador **não lança no construtor** quando a chave falta — a falha ocorre
> na primeira requisição, com mensagem acionável. Isso permite que o smoke test
> reporte a ausência como diagnóstico em vez de estourar na instanciação.

### Endpoints usados

| Método | Endpoint | Parâmetros | Retorna |
| --- | --- | --- | --- |
| `GET` | `/despesas/por-orgao` | `ano` (**req**), `orgaoSuperior`, `orgao`, `pagina` | Despesa federal por órgão |
| `GET` | `/emendas` | `ano`, `nomeAutor`, `tipoEmenda`, `codigoEmenda`, `codigoFuncao`, `pagina` | Emendas parlamentares |
| `GET` | `/{programa}-por-municipio` | `mesAno` (**req**), `codigoIbge` (**req**), `pagina` | Parcelas por município |
| `GET` | `/orgaos-siafi` | `pagina` | Dicionário de órgãos SIAFI |
| `GET` | `/orgaos-siape` | `pagina` | Dicionário de órgãos SIAPE |

Programas sociais aceitos no `{programa}`: `bolsa-familia`,
`novo-bolsa-familia`, `auxilio-brasil`, `auxilio-emergencial`, `bpc`, `peti`,
`safra`, `seguro-defeso`.

### Como retorna

Array JSON direto (sem envelope). Início de `/despesas/por-orgao`:

```json
[{
  "ano": 2024,
  "orgao": "Ministério da Fazenda",
  "orgaoSuperior": "Presidência da República",
  "empenhado": 1234567890.12,
  "liquidado": 987654321.00,
  "pago": 912345678.90
}]
```

> A API **não informa total nem última página**. A parada da paginação é a
> página vazia; o adaptador impõe `maxPaginas` como trava de segurança.

### ⚠️ Rate limit e custo por endpoint

O limite é por chave e por período. Os endpoints **por município** exigem uma
requisição por município — varrer os 5.570 é lento por construção. O adaptador
pausa `delayMs` (padrão 350 ms) entre chamadas, e `PORTAL_LIMITE_MUNICIPIOS`
permite testar com uma amostra.

### Chave de junção

`codigoIbge` é o `codarea` do projeto — a única fonte nova que **cruza
diretamente** com o mapa, sem tabela de-para. É o que torna esta API
imediatamente útil para colorir o território.

---

# Camada B — Leitura (runtime, navegador)

## 10. Endpoints estáticos e a camada `*Api.ts`

**Não há servidor de API.** O navegador faz `fetch` em arquivos JSON estáticos
sob `dados/` (em dev o Vite serve `data/`; em produção, `apps/web/dist/dados/`).
Toda leitura passa por `lerDados<T>()` em `apps/web/src/lib/fontes.ts`, que
mantém **cache em memória** e **deduplica requisições em andamento**.

### Endpoints internos

| Recurso (GET) | Arquivo de origem | Retorna |
| --- | --- | --- |
| `dados/maps/brasil.geojson` | `data/maps/brasil.geojson` | `FeatureCollection` das UFs |
| `dados/maps/ufs/{uf}.geojson` | `data/maps/ufs/{uf}.geojson` | `FeatureCollection` dos municípios |
| `dados/maps/centroides.json` | `data/maps/centroides.json` | `{ ufs, municipios }` com lng/lat |
| `dados/indicators/brasil.json` | `data/indicators/brasil.json` | `{ brasil, estados[] }` |
| `dados/indicators/ufs/{uf}.json` | `data/indicators/ufs/{uf}.json` | `{ uf, municipios[] }` |
| `dados/indicators/pontos.json` | `data/indicators/pontos.json` | `{ total, pontos[] }` (municípios + métricas + centroide) |
| `dados/indicators/ranking.json` | `data/indicators/ranking.json` | `{ geradoEm, anos, ufs[], municipios[] }` |
| `dados/budget/brasil.json` | `data/budget/brasil.json` | `{ exercicio, estados[] }` |
| `dados/budget/ufs/{uf}.json` | `data/budget/ufs/{uf}.json` | `{ uf, exercicio, municipios[] }` |
| `dados/elections/brasil.json` | `data/elections/brasil.json` | Presidente, vice e Congresso |
| `dados/elections/estados/{uf}.json` | `data/elections/estados/{uf}.json` | Governador, senadores, deputados |
| `dados/elections/ufs/{uf}.json` | `data/elections/ufs/{uf}.json` | Prefeito, vice e vereadores |
| `dados/elections/composicao-brasil.json` | `data/elections/composicao-brasil.json` | Composição do Congresso por UF |
| `dados/explorer/municipios.json` | `data/explorer/municipios.json` | Série histórica por município |
| `dados/explorer/ufs.json` | `data/explorer/ufs.json` | Agregados por UF |
| `dados/*/metadata.json` | `data/*/metadata.json` | Metadados de cobertura e vigência |

### Funções `*Api.ts` (o "contrato" de leitura)

| Função | Arquivo | Endpoint que lê | Retorno | Consumidores |
| --- | --- | --- | --- | --- |
| `lerDados<T>(caminho)` | `lib/fontes.ts` | qualquer `dados/{caminho}` | `T \| null` (cache + dedupe) | todas as `*Api` |
| `buscarIndicadores(nivel, codigo)` | `features/indicators/indicatorsApi.ts` | `indicators/brasil.json`, `indicators/ufs/{uf}.json` | `IndicadorLocalidade \| null` | `useTerritoryData` |
| `buscarPontosMapa()` | `features/indicators/indicatorsApi.ts` | `indicators/pontos.json` | `PontoMapa[]` | mapa (lentes) |
| `buscarOrcamento(nivel, codigo)` | `features/budget/budgetApi.ts` | `budget/brasil.json`, `budget/ufs/{uf}.json` | `OrcamentoEnte \| null` | `useTerritoryData` |
| `buscarMandatoMunicipio(codarea)` | `features/elections/electionsApi.ts` | `elections/ufs/{uf}.json` | `MandatoMunicipio \| null` | `useTerritoryData` |
| `buscarMandatoEstado(codigoUf)` | `features/elections/electionsApi.ts` | `elections/estados/{uf}.json` | `MandatoEstado \| null` | `useTerritoryData` |
| `buscarMandatoBrasil()` | `features/elections/electionsApi.ts` | `elections/brasil.json` | `MandatoBrasil \| null` | `useTerritoryData` |
| `buscarComposicao(nivel, codigo)` | `features/elections/electionsApi.ts` | `elections/composicao-brasil.json`, `estados/{uf}.json`, `ufs/{uf}.json` | `Composicao \| null` | `MapExplorer`, `useTerritoryData` |
| `buscarRanking()` | `features/ranking/rankingApi.ts` | `indicators/ranking.json` | `RankingNacional \| null` | `Ranking` |
| `getMunicipios()` / `getMunicipio()` | `features/explorer/explorerApi.ts` | `explorer/municipios.json` | `MunicipioExplorer[]` | Explorador, mapa |
| `getIndicator(municipio, indicador)` | `features/explorer/explorerApi.ts` | — (memória) | `ValorTemporal` | Explorador |
| `getPontosExplorer()` | `features/explorer/explorerApi.ts` | `explorer/municipios.json` | `PontoExplorer[]` | mapa |
| `ufDoCodarea(codarea)` | `lib/fontes.ts` | — (puro) | `string` (2 dígitos) | todas as `*Api` |

> A agregação de **composição de cadeiras** é feita no navegador
> (`agregarPorPartido`, `territorioDe`), porque o site é estático — não há
> endpoint que já devolva o total por partido.

---

## 11. Relação entre os endpoints (chaves de junção)

A espinha dorsal é o **`codarea` IBGE** (2 dígitos = UF, 7 = município). Todo
arquivo se cruza por ele; nomes vêm das Localidades; o resto é enriquecimento.

```
                    IBGE Localidades v1 (nomes oficiais)
                              │  id = codarea
                              ▼
   IBGE Malhas v3 ────► codarea ◄──── IBGE SIDRA v3      Siconfi DCA
   (geometria)              │          (população/PIB)   (receita/despesa/saúde/educação)
                            │                │                    │
                            │                └────────┬───────────┘
                            │                         ▼
                            │              data/indicators/*.json
                            │              data/budget/*.json
                            │                         │
                            │        gerar-derivados.ts │ (cruza tudo por codarea)
                            │                         ▼
                            │      pontos.json · ranking.json · explorer/*.json
                            │
                            └──────► data/maps/*.geojson  (só codarea)
                                            │
                            TSE (codigoTse 5 díg.) ── de-para-tse-ibge.json ──┘
                                            │
                                            ▼
                                 data/elections/ufs|estados|brasil.json
                                            │
                            sqCandidato ────► URL da foto oficial
```

| Chave | Formato | Liga | Definida em |
| --- | --- | --- | --- |
| `codarea` | 2 ou 7 dígitos | **todas** as áreas e o SIDRA | `lib/fontes.ts` |
| `ufDoCodarea(codarea)` | 2 dígitos | município → arquivo da UF | `lib/fontes.ts` |
| `codigoTse` / `sigla_ue` | 5 dígitos | TSE ↔ IBGE | `de-para-tse-ibge.json` |
| `id_ente` (Siconfi) | = `codarea` | Siconfi ↔ IBGE | `siconfi.adapter.ts` |
| `id_municipio` (BigQuery) | = `codarea` | fallback ↔ IBGE | `basedosdados.adapter.ts` |
| `sqCandidato` | string TSE | candidato → foto | `electionsApi.urlFoto` |

---

## 12. Onde cada dado é salvo

Fluxo de gravação (todos os caminhos são relativos à raiz do repositório):

| Fonte (endpoint) | Script | Arquivo(s) gravado(s) | Contagem atual |
| --- | --- | --- | --- |
| IBGE Malhas v3 | `update-territorial-data.ts` | `data/maps/brasil.geojson`, `data/maps/ufs/{uf}.geojson`, `data/maps/metadata.json` | 27 UFs / 5.570 municípios |
| IBGE Malhas v3 | `update-centroides.ts` | `data/maps/centroides.json` | centroides de UFs e municípios |
| IBGE SIDRA v3 | `update-indicators-data.ts` | `data/indicators/brasil.json`, `data/indicators/ufs/{uf}.json`, `data/indicators/metadata.json` | pop. 2024, PIB 2021 |
| Siconfi DCA | `update-budget-data.ts` | `data/budget/brasil.json`, `data/budget/ufs/{uf}.json`, `data/budget/metadata.json` | exercício 2023, 5.558 municípios |
| TSE (CDN + DivulgaCandContas) | `update-elections-data.ts` | `data/elections/ufs/{uf}.json`, `data/elections/de-para-tse-ibge.json`, `data/elections/metadata.json` | 2024 municipal |
| TSE (DivulgaCandContas) | `update-mandatos-gerais.ts` | `data/elections/estados/{uf}.json`, `data/elections/brasil.json` | 2022 estadual/federal |
| TSE (CDN, bruto) | `scrape-tse.ts` | `data/elections/raw/*.zip` | não publicado |
| Câmara v2 | `update-congresso-data.ts` | `data/congresso/deputados.json` | 513 deputados (leg. 57) |
| Câmara v2 | `update-congresso-data.ts` | `data/congresso/partidos.json` | 22–27 partidos |
| Câmara v2 | `update-congresso-data.ts` | `data/congresso/despesas.json` | agregado por deputado/ano |
| Câmara v2 | `update-congresso-data.ts` | `data/congresso/metadata.json` | cobertura e anos |
| Portal da Transparência | `update-transparencia-data.ts` | `data/transparencia/despesas-orgaos.json` | despesa federal por órgão |
| Portal da Transparência | `update-transparencia-data.ts` | `data/transparencia/emendas.json` | emendas do ano |
| Portal da Transparência | `update-transparencia-data.ts` | `data/transparencia/programas-sociais.json` | parcelas por município |
| Portal da Transparência | `update-transparencia-data.ts` | `data/transparencia/orgaos.json` | dicionário SIAFI/SIAPE |
| Portal da Transparência | `update-transparencia-data.ts` | `data/transparencia/metadata.json` | cobertura e vigência |
| — (derivado) | `gerar-derivados.ts` | `data/indicators/pontos.json` | 5.571 pontos |
| — (derivado) | `gerar-derivados.ts` | `data/indicators/ranking.json` | UFs + municípios |
| — (derivado) | `gerar-derivados.ts` | `data/elections/composicao-brasil.json` | 27 estados |
| — (derivado) | `gerar-derivados.ts` | `data/explorer/municipios.json`, `data/explorer/ufs.json`, `data/explorer/metadata.json` | séries históricas |
| — (build) | `build-site.ts` | `apps/web/dist/dados/{maps,indicators,budget,elections,explorer,congresso,transparencia}/` | cópia de `data/` |
| — (build) | `build-site.ts` | `apps/web/dist/_headers`, `.nojekyll` | cache e GitHub Pages |

`build-site.ts` **não copia** `data/elections/raw/` para o site.

> ⚠️ `data/congresso/` e `data/transparencia/` são pastas novas: estão em
> `PASTAS` no `build-site.ts`, mas **ainda não têm camada de leitura no
> frontend** (`*Api.ts`) nem entrada no `gerar-derivados.ts`. Os arquivos são
> publicados, porém nada os consome na interface ainda.

---

## 13. Outras possibilidades de endpoints

Sugestões de expansão, agrupadas por fonte. Todas seguem o mesmo padrão: novo
adaptador em `scripts/adapters/`, novo `update-*.ts` e derivado em
`gerar-derivados.ts` — o runtime continua lendo só arquivos estáticos.

### IBGE

- **Censo 2022** — agregado `4709` (população por sexo/idade), `9605` (domicílios).
- **PIB per capita** — variável `593` (hoje indisponível: HTTP 500); alternativa
  é `pib ÷ população`, já implementada localmente.
- **CEMPRE** — agregados `6449`, `6450` (empresas e pessoal ocupado por município).
- **Malhas** — `intrarregiao=mesorregiao|microrregiao|regiao` para agregações regionais.
- **Dados abertos** — `https://servicodados.ibge.gov.br/api/v1/pesquisas` (metadados).
- **FTP** — `ftp.ibge.gov.br` para séries completas e arquivos grandes.

### Banco Central

- **SGS** — `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados` (IPCA,
  Selic, câmbio). Bom para deflacionar valores nominais.
- **PIB municipal** — via SGS/IBGE para alinhar ano-base do PIB.

### Tesouro / Siconfi

- `/rreo` — execução orçamentária bimestral (mais atual que o DCA anual).
- `/rgf` — Relatório de Gestão Fiscal (limites de despesa com pessoal).
- `/entes` — lista oficial de entes e seus códigos (evita erro de `id_ente`).
- `/extrato_entregas` — quais entes entregaram declaração (mede cobertura).

### Câmara dos Deputados

Dos 79 endpoints, 4 estão implementados. Candidatos naturais:

- `/deputados/{id}/discursos` — produção discursiva por parlamentar.
- `/deputados/{id}/orgaos`, `/deputados/{id}/frentes` — comissões e frentes.
- `/proposicoes` + `/proposicoes/{id}/autores`, `/temas`, `/tramitacoes` — produção legislativa.
- `/votacoes` + `/votacoes/{id}/votos` — como cada deputado votou (alto valor analítico).
- `/partidos/{id}/membros`, `/partidos/{id}/lideres` — organograma partidário.
- `/legislaturas`, `/legislaturas/{id}/mesa` — histórico de legislaturas.
- `/orgaos`, `/eventos` — estrutura e agenda da Casa.
- `/referencias/*` — 20 tabelas de domínio (tipos de despesa, situações, temas).
- ⚠️ `/deputados/{id}/despesas` — **implementado, mas instável no servidor** (ver seção 8).

### Portal da Transparência

Dos 106 endpoints, 5 estão implementados. Candidatos naturais:

- `/despesas/documentos` + `/despesas/favorecidos-finais-por-documento` — quem recebeu o dinheiro.
- `/despesas/por-funcional-programatica` — gasto por função (casa com saúde/educação do Siconfi).
- `/emendas/documentos/{codigo}` — detalhamento da execução de cada emenda.
- `/licitacoes`, `/contratos`, `/contratos/itens-contratados` — compras públicas.
- `/convenios` — transferências voluntárias (útil por município).
- `/servidores`, `/servidores/remuneracao` — folha do Executivo Federal.
- `/sancoes`: `/ceis`, `/cnep`, `/cepim`, `/ceaf`, `/acordos-leniencia` — empresas punidas.
- `/viagens`, `/viagens-por-cpf` — diárias e passagens.
- `/imoveis`, `/permissionarios`, `/cartoes` — patrimônio e cartões corporativos.
- `/renuncias-fiscais-*` — renúncia fiscal por empresa/benefício.
- **Programas sociais** — além do Bolsa Família: `/bpc-por-municipio`,
  `/peti-por-municipio`, `/safra-por-municipio`, `/seguro-defeso-por-municipio`,
  `/auxilio-emergencial-por-municipio`, `/novo-bolsa-familia-por-municipio`.
- `/peps` — Pessoas Expostas Politicamente (cruzamento com mandatos do TSE).
- `/pessoa-fisica`, `/pessoa-juridica` — enriquecimento por CPF/CNPJ.

### TSE

- `/candidatura/{ano}/{uf}/{cargo}` — perfil completo do candidato.
- **Votação por seção eleitoral** — granularidade maior que município/zona.
- **Filiados** — `https://filiaweb.tse.jus.br` (base de filiados por partido).
- **Prestação de contas** — receitas/despesas de campanha.
- **Bens de candidatos** — patrimônio declarado.
- **Perfil do eleitorado** — `https://dadosabertos.tse.jus.br/dataset/eleitorado`.

### Sociais / setoriais

- **INEP** — Censo Escolar (taxa de aprovação, IDEB): `https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos`.
- **DATASUS/TabNet** — saúde: `http://tabnet.datasus.gov.br/cgi/tabcgi.exe`.
- **SNIS** — saneamento: `https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/snis`.
- **Atlas Brasil / PNUD** — IDHM: `http://www.atlasbrasil.org.br`.
- **IPEAdata** — séries econômicas: `http://www.ipeadata.gov.br/api`.
- **INMET** — clima: `https://portal.inmet.gov.br/dadoshistoricos`.

### Complementos sem API (dados abertos)

- **Compras.gov** — CSV/JSON de licitações federais.
- **Base dos Dados** — outras tabelas do datalake (`br_inep_*`, `br_tse_*`).
- **Brasil.io** — `empresas`, `socios`, `salarios`, `covid19`.

---

## 14. Configuração: `.env`

O projeto **não usa `dotenv`** nem qualquer dependência nova. O carregador é
próprio: `scripts/lib/env.ts` (~150 linhas), que lê `.env` e `.env.local` e
popula `process.env` — o contrato que todos os adaptadores já consumiam.

### Como usar

```bash
cp .env.example .env
# edite .env e preencha as chaves
```

### Regras do carregador

| Regra | Comportamento |
| --- | --- |
| Precedência | `process.env` (shell/CI) **vence** o arquivo |
| Ordem | `.env` é lido primeiro; `.env.local` sobrescreve |
| Ausência | Arquivo inexistente é ignorado — o projeto funciona sem `.env` |
| Comentários | `#` no início e ao fim de valores sem aspas |
| `export CHAVE=valor` | Aceito |
| Aspas | `"valor"` e `'valor'`; `\n` é interpretado em aspas duplas |
| Variável vazia | Tratada como **ausente** por `temEnv()`/`lerEnv()` |

### API do módulo

| Função | Para que serve |
| --- | --- |
| `carregarEnv()` | Lê `.env`/`.env.local` para `process.env`. Idempotente. |
| `lerEnv(chave)` | Valor ou `null` se ausente/vazio. |
| `exigirEnv(chave, instrucoes)` | Valor ou **lança** com instruções de como obtê-lo. |
| `temEnv(chave)` | `true`/`false` — para pular fontes opcionais. |
| `parseEnv(texto)` | Parse puro (exportado para testes). |
| `RAIZ` | Caminho absoluto da raiz do repositório. |

> `carregarEnv()` é chamado no início de `ingest-all.ts`, `test-adapters.ts` e
> dos dois scripts novos. Como os scripts filhos são subprocessos, herdam o
> `process.env` já populado — uma chave no `.env` vale para toda a cadeia.

### Variáveis

| Variável | Fonte | Obrigatória? |
| --- | --- | --- |
| `PORTAL_API_KEY` | Portal da Transparência | ✅ para essa fonte |
| `BRASILIO_TOKEN` | Brasil.io | para o fallback eleitoral |
| `BD_BILLING_PROJECT` | Base dos Dados | para o fallback socioeconômico |
| `BD_ACCESS_TOKEN` | Base dos Dados | idem |
| `CAMARA_ANO_DESPESA` | Câmara | não (padrão `2024`) |
| `CAMARA_ID_LEGISLATURA` | Câmara | não (padrão `57`) |
| `CAMARA_ITENS_POR_PAGINA` | Câmara | não (padrão `100`) |
| `PORTAL_ANO` | Portal | não (padrão `2024`) |
| `PORTAL_MES_ANO` | Portal | não (padrão `08/2024`) |
| `PORTAL_PROGRAMA_SOCIAL` | Portal | não (padrão `bolsa-familia`) |
| `PORTAL_LIMITE_MUNICIPIOS` | Portal | não (`0` = todos) |
| `ANO_POPULACAO` / `ANO_PIB` | IBGE SIDRA | não |
| `ELECTION_YEAR` | TSE | não |
| `VITE_BASE` | build | não (padrão `/`) |

`.env` e `.env.local` estão no `.gitignore`; `.env.example` **é versionado** e
documenta cada variável com comentários.

---

## 15. Como executar e testar

```bash
# Preparar credenciais (uma vez)
cp .env.example .env

# Smoke test de conectividade dos adaptadores
npx tsx scripts/test-adapters.ts
npx tsx scripts/test-adapters.ts --only=ibge-malhas,siconfi
npx tsx scripts/test-adapters.ts --only=camara,portal

# Ingestão por área
npx tsx scripts/update-territorial-data.ts   # IBGE malhas + localidades
npx tsx scripts/update-indicators-data.ts    # IBGE SIDRA
npx tsx scripts/update-budget-data.ts        # Siconfi
npx tsx scripts/update-elections-data.ts     # TSE (municipal)
npx tsx scripts/update-mandatos-gerais.ts    # TSE (estadual/federal)
npx tsx scripts/update-congresso-data.ts     # Câmara (não exige chave)
npx tsx scripts/update-transparencia-data.ts # Portal (exige PORTAL_API_KEY)

# Atalhos npm equivalentes
npm run ingest:congresso
npm run ingest:transparencia

# Tudo de uma vez (as fontes sem chave são puladas com aviso)
npx tsx scripts/ingest-all.ts
npx tsx scripts/ingest-all.ts --resumo
npx tsx scripts/ingest-all.ts --only=congresso,transparencia

# Derivados e build do site
npx tsx scripts/gerar-derivados.ts
npm run build:site                            # frontend + dados → apps/web/dist/
```

### Opções específicas das fontes novas

```bash
# Câmara: outro ano de despesa e outra legislatura
npx tsx scripts/update-congresso-data.ts --ano=2023
CAMARA_ANO_DESPESA=2023,2024 npx tsx scripts/update-congresso-data.ts

# Portal: outro ano, sem a varredura por município (muito mais rápido)
npx tsx scripts/update-transparencia-data.ts --ano=2023 --sem-programas

# Portal: testar com 20 municípios antes de varrer o Brasil
PORTAL_LIMITE_MUNICIPIOS=20 npx tsx scripts/update-transparencia-data.ts
```

### Verificação de integridade

```bash
npx tsx scripts/validar-dados.ts
```

### Variáveis de ambiente

Tabela completa na [seção 14](#14-configuração-env). As obrigatórias:

| Variável | Fonte | Padrão |
| --- | --- | --- |
| `PORTAL_API_KEY` | Portal da Transparência | **obrigatória** para essa fonte |
| `BRASILIO_TOKEN` | Brasil.io | obrigatório para o fallback |
| `BD_BILLING_PROJECT` | Base dos Dados | obrigatório para o fallback |
| `BD_ACCESS_TOKEN` | Base dos Dados | obrigatório para o fallback |
| `ANO_POPULACAO` | IBGE SIDRA | `2024` |
| `ANO_PIB` | IBGE SIDRA | `2021` |

### Referências

- Mapeamento detalhado das APIs externas: [apis_mapping.md](apis_mapping.md)
- Decisão de arquitetura estática: [adr/](adr/)
- Fontes oficiais e critérios de integração: [data-sources/README.md](data-sources/README.md)
