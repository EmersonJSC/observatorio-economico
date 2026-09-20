# Auditoria da Caixa 1 — Fontes

> Documento de levantamento. **Nada foi implementado, refatorado ou corrigido.**
> Base para as próximas etapas (Coletor Externo → RAW → Organização → …).
> Toda afirmação abaixo foi verificada em código ou documentação do repositório.
> Onde não foi possível confirmar, está escrito **não identificado**.

## 1. Objetivo

Descobrir como o projeto obtém dados externos hoje e registrar um inventário curto
e verificável de **FONTES**, distinguindo **USADO**, **DOCUMENTADO** e **FUTURO**.

Escopo desta etapa: apenas a Caixa 1 (FONTES). Sem coletor novo, sem banco, sem
refatoração. O frontend foi consultado somente onde revelou uma fonte ou fluxo.

## 2. Fontes encontradas

Legenda: **USADO** = executado pelo pipeline atual · **DOCUMENTADO** = descrito na
documentação, mas não exercitado pelo código de ingestão · **FUTURO** = apenas
mencionado como possibilidade.

| # | Fonte | Órgão | Tipo | Status | Adapter / script |
|---|---|---|---|---|---|
| 1 | Malhas Territoriais v3 | IBGE | API REST (GeoJSON) | USADO | `ibge-malhas.adapter.ts` (via `update-territorial-data.ts` — ver §11) |
| 2 | Localidades v1 | IBGE | API REST (JSON) | USADO | `ibge-localidades.adapter.ts` |
| 3 | Agregados / SIDRA v3 | IBGE | API REST (JSON) | USADO | `ibge-sidra.adapter.ts` |
| 4 | Siconfi — DCA | Tesouro Nacional (STN) | API REST (JSON) | USADO | `siconfi.adapter.ts` |
| 5 | Siconfi — RREO | Tesouro Nacional (STN) | API REST (JSON) | DOCUMENTADO | nenhum |
| 6 | CDN Dados Abertos (ZIPs CSV) | TSE | ZIP + CSV, scraping via Playwright | USADO | `scrape-tse.ts` + `tse-csv-parser.ts` |
| 7 | DivulgaCandContas REST + foto oficial | TSE | API REST / `<img>` | USADO (foto) · DOCUMENTADO (REST) | `tse.adapter.ts`, `electionsApi.ts` |
| 8 | Portal de Dados Abertos TSE | TSE | Portal HTML (download humano) | DOCUMENTADO (fallback) | nenhum |
| 9 | Dados Abertos v2 | Câmara dos Deputados | API REST (JSON) | USADO | `camara.adapter.ts` |
| 10 | API de Dados | Portal da Transparência (CGU) | API REST (JSON, com chave) | USADO | `portal-transparencia.adapter.ts` |
| 11 | Brasil.io (`eleicoes-brasil`) | Brasil.io (espelho do TSE) | API REST (JSON, com token) | USADO (fallback) | `brasilio.adapter.ts` |
| 12 | Base dos Dados / BigQuery | Base dos Dados (espelho IBGE) | BigQuery REST (SQL, com token) | USADO parcialmente (fallback) | `basedosdados.adapter.ts` |
| 13 | Banco Central (SGS) | BCB | API REST | FUTURO | nenhum |
| 14 | INEP, DATASUS, SNIS, Atlas Brasil, IPEAdata, INMET, Compras.gov, filiaweb.tse.jus.br | diversos | diversos | FUTURO | nenhum |

13 e 14 estão catalogados em `docs/APIS.md` §13 ("Outras possibilidades de endpoints").
O `docs/data-sources/README.md` cita "IBGE / Banco Central" como fonte **planejada** —
o Banco Central nunca foi implementado.

## 3. IBGE

### 3.1 Malhas Territoriais v3 — USADO

- **Órgão:** IBGE · **Tipo:** API REST, resposta GeoJSON
- **Base URL:** `https://servicodados.ibge.gov.br/api/v3/malhas`
- **Doc:** `https://servicodados.ibge.gov.br/api/docs/malhas?versao=3`
- **Recursos:**
  - `GET /paises/BR?formato=application/vnd.geo+json&intrarregiao=UF` → 27 UFs
  - `GET /estados/{uf}?formato=application/vnd.geo+json&intrarregiao=municipio` → municípios da UF
- **Identificadores:** `features[].properties.codarea` (2 dígitos UF / 7 dígitos município).
  A malha **não traz nome** — os nomes são enriquecidos pela Localidades v1.
- **Período/ano:** não se aplica (malha é a vigente).
- **Paginação:** não há. Uma requisição por UF.
- **Autenticação:** nenhuma.
- **Rate limit:** não documentado; o código alerta que paralelismo excessivo pode gerar HTTP 429.
- **Adapter:** `scripts/adapters/ibge/ibge-malhas.adapter.ts` (timeout 60 s, delay 800 ms).
- **Salvo em:** `data/maps/brasil.geojson`, `data/maps/ufs/{uf}.geojson`, `data/maps/metadata.json`.
- **Observação:** `update-territorial-data.ts` **não usa o adapter** — reimplementa as
  mesmas duas URLs com `fetch` cru (ver §11).

### 3.2 Localidades v1 — USADO

- **Base URL:** `https://servicodados.ibge.gov.br/api/v1/localidades`
- **Recursos:**
  - `GET /estados` → UFs com `id`, `sigla`, `nome`, `regiao`
  - `GET /estados/{uf}/municipios` → municípios com `id`, `nome`, microrregião/região imediata
  - `GET /municipios/{codarea}` → um município (usado só na API do adapter)
- **Identificadores:** `id` = `codarea` (2 ou 7 dígitos). **É a fonte dos nomes oficiais.**
- **Paginação / autenticação / rate limit:** não há / nenhuma / não documentado.
- **Adapter:** `scripts/adapters/ibge/ibge-localidades.adapter.ts` (timeout 20 s).
- **Salvo em:** não grava arquivo — é enriquecimento em memória de `data/maps/`,
  `data/indicators/`, `data/budget/` e do DE-PARA TSE↔IBGE.
- **Consumidores:** `update-territorial-data.ts`, `update-indicators-data.ts`,
  `update-budget-data.ts`, `tse-depara-builder.ts`, `brasilio.adapter.ts`.

### 3.3 Agregados / SIDRA v3 — USADO

- **Base URL:** `https://servicodados.ibge.gov.br/api/v3/agregados`
- **Recursos:**
  - `GET /6579/periodos/{ano}/variaveis/9324?localidades=N1[all]|N3[all]` → população Brasil + UFs
  - `GET /5938/periodos/{ano}/variaveis/37?localidades=N1[all]|N3[all]` → PIB Brasil + UFs
  - `GET /6579/periodos/{ano}/variaveis/9324?localidades=N6[N3[{uf}]]` → população municipal
  - `GET /5938/periodos/{ano}/variaveis/37?localidades=N6[N3[{uf}]]` → PIB municipal
- **Tabelas/variáveis:** `6579`/`9324` (população estimada) e `5938`/`37` (PIB a preços
  correntes, em **mil R$**). Municípios exigem o filtro pai `N6[N3[uf]]`.
- **Identificadores:** `series[].localidade.id` = `codarea` (níveis N1=1, N3=2 dígitos, N6=7 dígitos).
- **Ano:** padrão `ANO_POPULACAO=2024`, `ANO_PIB=2021` (defaults no código e no `.env.example`).
- **Paginação:** não há. **Autenticação:** nenhuma. **Rate limit:** não documentado; delay 600–700 ms.
- **Valores especiais:** `-`, `...`, `X`, `C` são convertidos para `null` (`parseValorIbge`).
- **Não usado:** a variável `593` (PIB per capita) — o adapter registra que ela retorna HTTP 500;
  o per capita é **calculado localmente** (`pibMilReais * 1000 / populacao`), com a população
  do **mesmo ano do PIB** para paridade temporal.
- **Salvo em:** `data/indicators/brasil.json`, `data/indicators/ufs/{uf}.json`, `data/indicators/metadata.json`.

## 4. SICONFI / Tesouro

- **Órgão:** Secretaria do Tesouro Nacional (STN)
- **Tipo:** API REST (Oracle ORDS), resposta JSON envelopada
- **Base URL:** `https://apidatalake.tesouro.gov.br/ords/siconfi/tt`
- **Doc:** `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/swagger-ui/index.html`
- **Recursos:**
  - `GET /dca?an_exercicio={ano}&id_ente={codareaIbge}` — **USADO**. Declaração de Contas
    Anuais completa do ente. Filtra-se no cliente:
    - Receita Total → `anexo = "DCA-Anexo I-C"`, `cod_conta = "ReceitasExcetoIntraOrcamentarias"`, `coluna = "Receitas Brutas Realizadas"`
    - Despesa Total → `anexo = "DCA-Anexo I-D"`, `cod_conta = "TotalDespesas"`, `coluna = "Despesas Liquidadas"`
    - Saúde → `anexo = "DCA-Anexo I-E"`, `conta` iniciando em `"10 - Saúde"`
    - Educação → `anexo = "DCA-Anexo I-E"`, `conta` iniciando em `"12 - Educação"`
  - `GET /rreo?an_exercicio={ano}&id_ente={...}&nr_periodo=6` — **DOCUMENTADO, não usado**
    (aparece em `docs/apis_mapping.md` e `docs/APIS.md` §13; nenhum código chama `/rreo`).
- **Identificadores:** `id_ente` = código IBGE **completo** (7 dígitos para município,
  2 para estado). A resposta traz `cod_ibge`, `instituicao`, `uf`, `populacao`.
- **Exercício:** padrão **2023** (`--ano=`, default no script).
- **Paginação:** a resposta tem envelope `{ items, hasMore, limit, offset, count }`; o adapter
  **lê apenas `items` e ignora `hasMore`/`limit`/`offset`**.
- **Autenticação:** nenhuma.
- **Rate limit:** crítico. Documentado como bloqueio por IP com HTTP 429. O código usa
  `concurrency = 2` e `delay = 300 ms` por padrão; `maxRetries: 4`, `baseDelayMs: 600`.
- **Adapter:** `scripts/adapters/siconfi/siconfi.adapter.ts`.
- **Script:** `scripts/update-budget-data.ts`.
- **Salvo em:** `data/budget/brasil.json`, `data/budget/ufs/{uf}.json`, `data/budget/metadata.json`.
- **Conflito documentado:** `docs/apis_mapping.md` afirma que o Siconfi usa **6 dígitos**
  (sem DV) e traz um exemplo `substring(0, 6)`. O código faz o **oposto** e diz que validou
  empiricamente: `ibgeParaSiconfi()` retorna o código inalterado, e o comentário afirma que
  6 dígitos retorna `count: 0`. **A documentação está desatualizada**; o código é a referência.
  O campo `siconfiId` na interface ainda é descrito como "6 dígitos" — comentário obsoleto.

## 5. TSE

### 5.1 CDN Dados Abertos (ZIP/CSV) — USADO, é a fonte primária real

- **Órgão:** Tribunal Superior Eleitoral · **Tipo:** download de ZIP contendo CSVs
- **Base URL:** `https://cdn.tse.jus.br/estatistica/sead/odsele/`
- **Recursos:**
  - `votacao_candidato_munzona` + `/{arquivo}_{ano}.zip` → votos + situação de eleito
  - `consulta_cand` + `/{arquivo}_{ano}.zip` → candidaturas (nome, partido, cargo, resultado)
- **Estrutura desde 2024:** o TSE **não publica mais ZIP por UF** — publica 2 arquivos
  **nacionais**, e cada ZIP contém um CSV por UF (`..._RO.csv`, `..._MG.csv`, `..._BRASIL.csv`).
- **Formato do CSV:** separador `;`, aspas duplas, encoding **latin1 (ISO-8859-1)**,
  convertido para UTF-8 pelo parser; cabeçalho na primeira linha.
- **Colunas usadas:** `SG_UE` (fallback `CD_MUNICIPIO`), `NM_UE` (fallback `NM_MUNICIPIO`),
  `SG_UF`, `CD_CARGO`, `DS_CARGO`, `NM_URNA_CANDIDATO`, `NM_CANDIDATO`, `SG_PARTIDO`,
  `NR_CANDIDATO`, `SQ_CANDIDATO`, `NR_TURNO`, `DS_SIT_TOT_TURNO` (resultado eleitoral),
  `DS_SITUACAO_CANDIDATURA` (status cadastral — usada só como fallback).
- **Códigos de cargo:** 1 Presidente, 2 Vice-Presidente, 3 Governador, 4 Vice-Governador,
  5 Senador, 6 Deputado Federal, 7 Deputado Estadual, 8 Deputado Distrital, 11 Prefeito,
  12 Vice-Prefeito, 13 Vereador.
- **Situações aceitas como eleito:** `ELEITO`, `ELEITO POR QP`, `ELEITO POR MÉDIA`,
  `ELEITO NO 2º TURNO`, `ELEITO POR QUOCIENTE PARTIDÁRIO`, entre outras variações.
- **Identificadores:** `SQ_CANDIDATO` (sequencial do candidato), `SG_UE`/`CD_MUNICIPIO`
  (código TSE de 5 dígitos do município, ou sigla da UF / `BRASIL` nas eleições gerais).
- **Ano:** municipal padrão **2024** (`--ano=`), geral padrão **2022** (`--ano=`).
- **Paginação / autenticação:** não há.
- **Restrição crítica:** WAF (Akamai) bloqueia `curl`/headless com HTTP 403.
- **Coletor:** `scripts/scrape-tse.ts` — **Playwright em modo headful**, com warm-up no portal
  para passar pelo desafio do WAF, `userAgent` de Chrome real, `navigator.webdriver=false`,
  locale `pt-BR`, timezone `America/Sao_Paulo`. Salva em `data/elections/raw/`.
- **Parsers:** `tse-csv-parser.ts` (lê CSV de dentro do ZIP via `adm-zip`).
- **Scripts:** `update-elections-data.ts` (municipal), `update-mandatos-gerais.ts`
  (estadual/nacional — usa **apenas** `consulta_cand`, porque já traz o resultado final).
- **Salvo em:** `data/elections/ufs/{uf}.json`, `data/elections/estados/{uf}.json`,
  `data/elections/brasil.json`, `data/elections/metadata.json`.

### 5.2 DivulgaCandContas (REST) — DOCUMENTADO, não exercitado no pipeline

- **Base URL:** `https://divulgacandcontas.tse.jus.br/divulga/rest/v1`
- **Recurso:** `GET /eleicoes/eleitos/{ano}/{uf}/{codigoUe}/{cdCargo}`
- **Identificadores:** `sqCandidato`, `nrCandidato`, `cdCargo`, `sgUe`.
- **Situação real:** implementado em `tse.adapter.ts`, mas **nenhum script de ingestão o chama** —
  `testarConectividade()` apenas imprime um aviso de intervenção manual e `return true`
  (não faz requisição). `buscarEleitosUe()` só é exercitado se invocado manualmente.
  O adapter também **não trata paginação**, embora a resposta possa trazer `paginacao`.

### 5.3 Foto oficial do candidato — USADO (exceção consciente)

- **Base URL:** `https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img`
- **Recurso:** `/{idEleicao}/{sqCandidato}/{sgUe}`
- **Mapa `ID_ELEICAO`:** 2020→2030402020, 2022→2040602022, 2024→2045202024, 2026→20322002026
  (definido em `apps/web/src/features/elections/electionsApi.ts` e replicado em
  `apps/api/src/modules/elections/foto-candidato.ts`).
- **Exceção ao princípio "sem chamadas externas no navegador":** são **imagens `<img>`**, não dados.
  Se falhar, a interface mostra as iniciais. É a **única chamada externa em runtime** do projeto.

### 5.4 Portal de Dados Abertos — DOCUMENTADO (fallback humano)

- `https://dadosabertos.tse.jus.br/` e `https://dadosabertos.tse.jus.br/dataset/resultados-{ano}`,
  `/dataset/municipios`. Citado como plano B em `tse.adapter.ts`, `docs/APIS.md` e
  `docs/apis_mapping.md`. **Nenhum código baixa dessas URLs.**

### 5.5 DE-PARA TSE ↔ IBGE — USADO

- **Problema:** TSE usa código de **5 dígitos**; IBGE usa **7**. Incompatíveis.
- **Solução:** tabela `data/elections/de-para-tse-ibge.json`, gerada por
  `tse-depara-builder.ts` a partir do CSV do TSE + API de Localidades do IBGE.
- **Estratégia:** normalizar nome (lowercase, sem acento, sem artigos) → filtrar por UF →
  match exato → match por prefixo com similaridade ≥ 0.85 (Jaro-Winkler simplificado) →
  dicionário auditável `EXCECOES_CONHECIDAS` com **8 exceções** (ex.: `MG:53031` São Thomé →
  São Tomé das Letras).
- **Formato:** `[{ codigoTse, codareaIbge, nome, nomeIbge, uf }]`.
- **Sem match:** apenas avisado no console (amostra de 20). Não há revisão humana obrigatória
  no fluxo — o aviso diz "adicione manualmente se necessário".

## 6. Câmara

- **Órgão:** Câmara dos Deputados · **Tipo:** API REST (JSON e XML, via header `Accept`)
- **Base URL:** `https://dadosabertos.camara.leg.br/api/v2`
- **Doc:** `https://dadosabertos.camara.leg.br/swagger/api.html` ·
  OpenAPI `https://dadosabertos.camara.leg.br/api/v2/api-docs` — **79 endpoints**, 4 implementados
- **Recursos USADOS:**
  - `GET /deputados?idLegislatura={n}&siglaUf=&siglaPartido=&ordem=ASC&ordenarPor=nome`
    → deputados com `id`, `nome`, `siglaPartido`, `siglaUf`, `urlFoto`, `email`
  - `GET /partidos?idLegislatura={n}` → partidos com representação
  - `GET /deputados/{id}/despesas?ano={ano}&mes={mes}` → cota parlamentar (CEAP)
- **Recurso implementado mas NÃO chamado pela ingestão:** `GET /deputados/{id}` (detalhe com
  `nomeCivil`, `CPF`, `sexo`, `escolaridade`) — existe em `camara.adapter.ts`, mas
  `update-congresso-data.ts` nunca o invoca.
- **Envelope:** `{ dados: [...], links: [{ rel, href }] }`.
- **Paginação:** `pagina` (a partir de 1) e `itens` (máx. **100**; padrão 15). O adapter segue
  `links[rel=next]` como condição de parada, com trava de 200 páginas.
- **Identificadores:** `id` do deputado (ex.: `204554`) — **não é** o `sqCandidato` do TSE
  nem o `codarea` do IBGE. **Não há DE-PARA**; o casamento com o resto do projeto seria
  heurístico por **nome civil + sigla da UF**.
- **Período:** `CAMARA_ID_LEGISLATURA=57` (2023-2027), anos de despesa via `CAMARA_ANO_DESPESA=2024`.
- **Autenticação:** **nenhuma** (única fonte nova sem chave).
- **Restrição conhecida:** `/deputados/{id}/despesas` é **instável** — durante a implementação
  retornou `dados: []` para todos os deputados e anos testados, enquanto `/deputados` e
  `/partidos` respondiam. O smoke test **não valida** esse endpoint justamente para evitar
  falso negativo.
- **Agregação na ingestão:** as linhas individuais de despesa **não são publicadas** — o script
  agrega por deputado/ano (`totalLiquido`, `totalGlosa`, `quantidadeDocumentos`, `porTipo`).
- **Adapter / script:** `camara.adapter.ts` / `update-congresso-data.ts`.
- **Salvo em:** `data/congresso/deputados.json`, `partidos.json`, `despesas.json`, `metadata.json`.

## 7. Portal da Transparência

- **Órgão:** Controladoria-Geral da União (CGU) · **Tipo:** API REST (JSON)
- **Base URL:** `https://api.portaldatransparencia.gov.br/api-de-dados`
- **Doc:** `https://api.portaldatransparencia.gov.br/swagger-ui/` ·
  OpenAPI `https://api.portaldatransparencia.gov.br/v3/api-docs` — **106 endpoints**, 5 implementados
- **Recursos USADOS:**
  - `GET /despesas/por-orgao?ano={ano}&orgaoSuperior=&pagina=` → despesa federal por órgão
    (`empenhado`, `liquidado`, `pago`)
  - `GET /emendas?ano={ano}&nomeAutor=&tipoEmenda=&pagina=` → emendas parlamentares
    (`codigoEmenda`, `autor`, `valorEmpenhado`, `localidadeDoGasto`, …)
  - `GET /{programa}-por-municipio?mesAno={MM/AAAA}&codigoIbge={codarea}&pagina=` → parcelas
    por município. Programas: `bolsa-familia`, `novo-bolsa-familia`, `auxilio-brasil`,
    `auxilio-emergencial`, `bpc`, `peti`, `safra`, `seguro-defeso`.
  - `GET /orgaos-siafi?pagina=` e `GET /orgaos-siape?pagina=` → dicionários de órgãos
- **Identificadores:** `codigoIbge` = `codarea` (cruzamento **direto** com o mapa, sem DE-PARA);
  `nomeAutor` (casa com o nome parlamentar da Câmara — heurístico);
  `codigoEmenda`; códigos SIAFI/SIAPE de órgão.
- **Período:** `PORTAL_ANO=2024`, `PORTAL_MES_ANO=08/2024`.
- **Paginação:** parâmetro `pagina` (a partir de 1). A API **não informa total nem última
  página** — a parada é a página vazia, com `maxPaginas = 100` como trava.
- **Autenticação:** **obrigatória** — header `chave-api-dados`, de `PORTAL_API_KEY` no `.env`.
  Sem chave: HTTP 401. Cadastro gratuito em `.../api-de-dados/cadastrar-email`.
- **Rate limit:** por chave e por período, documentado como ~90 req/min no plano gratuito.
  O adapter pausa **350 ms** entre chamadas (`baseDelayMs: 1000` no retry). Varredura por
  município = **1 requisição por município** (até 5.570) — lentidão por construção.
  `PORTAL_LIMITE_MUNICIPIOS` permite amostrar.
- **Erro de dados:** o comentário em `programaSocialPorMunicipio` alerta que `codigoIbge`
  vem com 6 dígitos em algumas respostas e diz "normalizamos para 7 quando possível" —
  **mas não há normalização**: o valor é repassado como está.
- **Adapter / script:** `portal-transparencia.adapter.ts` / `update-transparencia-data.ts`.
- **Salvo em:** `data/transparencia/despesas-orgaos.json`, `emendas.json`,
  `programas-sociais.json`, `orgaos.json`, `metadata.json`.
  Os arquivos usam `JSON.stringify(..., null, 0)` — **sem indentação**.

## 8. Outras fontes

### 8.1 Brasil.io — USADO (fallback eleitoral)

- **Tipo:** API REST (Django REST Framework), token gratuito
- **Base URL:** `https://api.brasil.io/v1` · Dataset `eleicoes-brasil`
- **Recurso:** `GET /dataset/eleicoes-brasil/{tabela}/data/?{filtros}` — tabela usada: `candidatos`
  (existem `votacoes`, `bens_candidatos`, `filiados` — não usadas)
- **Resposta:** `{ count, next, previous, results }`; paginação seguindo `next` até `null`
- **Autenticação:** header `Authorization: Token {BRASILIO_TOKEN}` — obrigatória
- **Identificadores:** `sigla_ue` (código TSE de 5 dígitos) → DE-PARA local → `codarea` IBGE.
  Se o DE-PARA não existir, cai para um índice por `sigla_uf + nome normalizado` via IBGE Localidades.
- **Ano:** `ELECTION_YEAR=2024`. **Limitação:** o código fixa `iniciais = 2025` e
  `mandatoPeriodo = 2025–2028` — **hardcoded**, quebra para outros anos.
- **Disparo:** apenas via `ingest-all.ts` quando `update-elections-data.ts` falha
  (`ingestirComoFonteAlternativa('eleicoes')`). **Não é chamado pelo fluxo normal.**
- **Salvo em:** mesmos arquivos do TSE — `data/elections/ufs/{uf}.json`, `metadata.json`
  (com `viaFallback: true`). **Sobrescreve o resultado do TSE.**

### 8.2 Base dos Dados / BigQuery — USADO parcialmente (fallback socioeconômico)

- **Tipo:** BigQuery REST (SQL), não há API REST simples de download
- **Endpoint:** `POST https://bigquery.googleapis.com/bigquery/v2/projects/{projeto}/queries`
- **Tabelas:** `basedosdados.br_ibge_populacao.municipio`, `basedosdados.br_ibge_pib.municipio`
- **Identificador:** `id_municipio` = `codarea` (7 dígitos)
- **Autenticação:** `BD_BILLING_PROJECT` + `BD_ACCESS_TOKEN` (OAuth, via
  `gcloud auth print-access-token`). Sem elas, a fonte é ignorada.
- **Limitação de código:** o adapter **rejeita explicitamente** qualquer domínio que não seja
  `indicadores` (`throw` se `dominio !== 'indicadores'`). Portanto o fallback de **orçamento**
  declarado no cabeçalho de `ingest-all.ts` (`orcamento → basedosdados.adapter`) **não funciona**:
  a chamada lança erro. O mapa `modulos` em `ingest-all.ts` aponta para o arquivo, mas o
  arquivo não aceita esse domínio.
- **Salvo em:** `data/indicators/ufs/{uf}.json` e `data/indicators/metadata.json`
  (`viaFallback: true`). Grava `nome: codarea` (o nome real não vem desta fonte).

### 8.3 Fontes FUTURO (apenas citadas)

Citadas em `docs/APIS.md` §13 e `docs/data-sources/README.md`, **sem nenhum código**:

- **Banco Central (SGS)** — `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados`
  (IPCA, Selic, câmbio). Citado como "planejada" em `docs/data-sources/README.md`.
- **IBGE** — Censo 2022 (agregados `4709`, `9605`), CEMPRE (`6449`, `6450`),
  `intrarregiao=mesorregiao|microrregiao|regiao`, `https://servicodados.ibge.gov.br/api/v1/pesquisas`,
  `ftp.ibge.gov.br`.
- **Siconfi** — `/rgf`, `/entes`, `/extrato_entregas`.
- **Câmara** — os outros 75 endpoints (`/votacoes`, `/proposicoes`, `/deputados/{id}/discursos`, …).
- **Portal da Transparência** — os outros 101 endpoints (`/contratos`, `/licitacoes`, `/sancoes/*`,
  `/servidores`, `/viagens`, `/peps`, …).
- **TSE** — `/candidatura/{ano}/{uf}/{cargo}`, votação por seção, filiados
  (`https://filiaweb.tse.jus.br`), prestação de contas, bens de candidatos, perfil do eleitorado.
- **Sociais/setoriais** — INEP, DATASUS/TabNet, SNIS, Atlas Brasil/PNUD, IPEAdata, INMET.
- **Sem API** — Compras.gov, outras tabelas da Base dos Dados, Brasil.io (`empresas`, `socios`).

## 9. Identificadores

| Identificador | Formato | Origem | Liga a | Situação |
|---|---|---|---|---|
| `codarea` | 2 dígitos (UF) / 7 (município) | IBGE | **chave mestra de todo o projeto** | sólido |
| `id` (Localidades) | número | IBGE | = `codarea` após `String(id)` | sólido |
| `id_ente` | 7 / 2 dígitos | Siconfi (DCA) | = `codarea` sem transformação | código contradiz doc (§4) |
| `codigoTse` / `SG_UE` / `sigla_ue` | 5 dígitos (município) ou sigla UF / `BRASIL` | TSE | → `codarea` via **DE-PARA** | heurístico, 8 exceções manuais |
| `SQ_CANDIDATO` | string | TSE | candidato → URL da foto | sólido |
| `id` (deputado) | número (ex.: 204554) | Câmara | **sem ponte** para TSE/IBGE | **lacuna** |
| `codigoIbge` | 6 ou 7 dígitos | Portal Transparência | → `codarea` | normalização **não implementada** |
| `id_municipio` | 7 dígitos | Base dos Dados | = `codarea` | sólido |
| `idLegislatura` | número (57 = 2023-2027) | Câmara | recorte temporal | sólido |
| `ID_ELEICAO` | número | TSE | foto oficial | mapa fixo no frontend e na API |
| `codigoEmenda` | string | Portal Transparência | emenda ↔ autor | sem DE-PARA com Câmara |

## 10. Dificuldades de coleta

1. **WAF (Akamai) no TSE** — `dadosabertos.tse.jus.br` e `cdn.tse.jus.br` devolvem HTTP 403
   para `curl`/headless. Contornado com **Playwright headful** + warm-up no portal +
   `userAgent` de Chrome real + `navigator.webdriver=false`. Depende de rede/IP com boa
   reputação; o próprio código avisa "tente outra rede ou o download manual".
2. **Coleta depende de navegador real** — `scrape-tse.ts` precisa de Chromium instalado e,
   segundo o comentário do arquivo, **não funciona dentro do sandbox de execução**.
3. **Mudança de layout do TSE** — desde 2024 não há ZIP por UF; a URL antiga por UF
   ainda aparece na documentação de `update-elections-data.ts` (cabeçalho), mas o código
   já usa os arquivos nacionais.
4. **Rate limit do Siconfi** — bloqueio por IP; obriga concorrência ≤ 2 e delay de 300 ms.
   A varredura completa é estimada em ~14 h em modo sequencial.
5. **Rate limit do Portal da Transparência** — ~90 req/min por chave; endpoints por município
   exigem 1 requisição por município (até 5.570).
6. **Instabilidade da Câmara** — `/deputados/{id}/despesas` retornou vazio em todos os testes;
   o adapter deliberadamente **não** valida esse endpoint no smoke test.
7. **Encoding latin1 nos CSVs do TSE** — exige conversão explícita para UTF-8.
8. **ZIPs nacionais grandes** — o `votacao_candidato_munzona` é citado como "gigante" e é
   evitado nas eleições gerais (usa-se só o `consulta_cand`).
9. **Divergência de nomes TSE ↔ IBGE** — exige normalização, fuzzy match e 8 exceções auditadas.
10. **Divergência de contagem de municípios** entre fontes (5.546 a 5.571) — documentada
    como esperada; não é bug.
11. **Anos de referência diferentes por fonte** — população 2024, PIB 2021, orçamento 2023,
    eleições 2022/2024. Sem alinhamento temporal automático entre caixas.
12. **Headless sem fallback automático** — se o WAF bloquear mesmo em headful, o script
    apenas encerra com erro pedindo download manual; não há caminho alternativo automático
    além do Brasil.io (que só cobre eleições).

## 11. Problemas atuais

> Nenhum item abaixo foi corrigido — são achados para as próximas etapas.

**Preservação do dado original**

- **A resposta bruta das APIs é descartada.** Todos os adaptadores fazem `res.json()` e
  gravam apenas o JSON derivado em `data/`. Exceto pelos ZIPs do TSE, **não existe RAW**.
- **Não existe arquivo histórico.** Cada execução **sobrescreve** o arquivo anterior
  (`writeFile` em `data/<área>/...`). Não há versionamento, cópia datada nem append.
- **`data/elections/raw/` está no `.gitignore`** (ZIPs do TSE não são versionados) e
  `build-site.ts` não os publica. Se o CDN mudar, o dado de origem se perde.
- **O scrape-TSE considera "arquivo já baixado" suficiente** — valida apenas a assinatura
  ZIP (`PK`) e tamanho > 10 KB. **Não valida contra a fonte** e não há re-download
  automático se o arquivo estiver corrompido no meio.

**Metadados de auditoria**

- **Não há data de coleta por registro.** Existe apenas `updatedAt` global em
  `metadata.json` (ISO 8601). O `atualizadoEm` por ente do Siconfi é o **horário da
  execução**, não a data de publicação da fonte.
- **Não há hash.** Nenhum `sha256`/`md5`/`checksum`/`etag` em nenhum ponto do código.
  Não é possível provar que um arquivo não foi alterado.
- **Não há registro da URL exata consultada** em nenhum arquivo de saída (sem
  `query`/`params`/`headers` de origem, sem versão do adaptador).
- **Não há `User-Agent` nem identificação do projeto** nas requisições — a fonte não
  consegue distinguir o Observatório de um cliente anônimo.
- O `metadata.json` de `data/maps` e `data/indicators` tem `version: 1/2` fixo no código;
  `data/congresso` e `data/transparencia` usam `version: 1` fixo. Não há versionamento real.

**Inconsistências de código**

- **`update-territorial-data.ts` duplica o adapter**: reimplementa as URLs do IBGE com
  `fetch` cru e **sem retry/timeout**, apesar de o comentário afirmar que é "o ÚNICO ponto
  do projeto que conversa com o IBGE". `update-indicators-data.ts` e `update-budget-data.ts`
  também chamam a API de Localidades diretamente. **A rota real das fontes IBGE é duplicada.**
- **`ibge-malhas.adapter.ts` é órfão do pipeline** — só é usado pelo smoke test, não pela
  ingestão.
- **`tse.adapter.ts` é órfão do pipeline** — só usado pelo smoke test, que não faz requisição real.
- **Fallback de orçamento não funciona**: `ingest-all.ts` mapeia `orcamento → basedosdados`,
  mas o adapter lança erro para qualquer domínio diferente de `indicadores`.
- **Brasil.io sobrescreve silenciosamente o TSE**: grava nos mesmos arquivos, sem distinguir
  a origem por registro (apenas `viaFallback: true` no metadata global).
- **Documentação desatualizada** sobre o `id_ente` do Siconfi (6 vs 7 dígitos) e sobre a
  estrutura de arquivos do TSE (por UF vs nacional).
- **Interface `SiconfiDcaItem` não bate com a resposta real**: o campo declarado é
  `cod_ibge: number`, e o comentário do adapter diz "6 dígitos"; a prática é 7.
- **`update-mandatos-gerais.ts` marca `estados: 27` sempre**, mesmo quando `--only` restringe
  a execução — o metadata fica incorreto.
- **`ingest-all.ts` não encadeia dependências**: `update-transparencia-data.ts` depende de
  `data/indicators/pontos.json` (gerado por `gerar-derivados.ts`), mas o orquestrador não
  garante essa ordem; sem o arquivo, a etapa de programas sociais é silenciosamente pulada.
- **Câmara e Portal da Transparência são publicados mas não consumidos**: estão em `PASTAS`
  no `build-site.ts`, mas não têm camada de leitura no frontend nem entram em `gerar-derivados.ts`.

**Restrições de ambiente**

- `update-elections-data.ts` precisa dos ZIPs já baixados; se faltarem, **falha com `throw`**
  e o orquestrador cai para o Brasil.io, que pode não cobrir o ano.
- A foto oficial do candidato é a **única** chamada externa feita pelo navegador do usuário.
- `.env` não é versionado; `.env.example` documenta as chaves, mas não há validação
  de presença no início do orquestrador para as fontes opcionais.

## 12. Lacunas

1. **Não existe camada RAW.** Não há arquivo do que a fonte devolveu, nem para APIs nem
   para CSVs (fora os ZIPs do TSE, não versionados). Sem RAW não há reprocessamento
   offline, nem auditoria, nem comparação entre execuções.
2. **Não existe histórico/temporalidade.** Nenhuma série é preservada; o projeto tem
   exatamente um retrato por indicador, sobrescrito a cada execução.
3. **Não há data de coleta por registro nem hash de integridade.**
4. **Não há catálogo de fontes em formato de dados** — a informação existe em Markdown
   (`docs/APIS.md`, `docs/apis_mapping.md`) e em constantes espalhadas por 8 adapters,
   sem uma fonte única de verdade.
5. **Não há tratamento uniforme de falha.** Cada adapter decide sozinho entre lançar,
   retornar `[]`, retornar `null` ou logar aviso. `http-client.ts` cobre retry/429/timeout,
   mas não é usado por `update-territorial-data.ts` nem pelo Brasil.io (que usa `fetch` cru).
6. **Não há contrato de "coleta bem-sucedida"** — não se distingue "ente sem dado na fonte"
   de "falha de rede". O Siconfi retorna `null` nos dois casos, com mensagens diferentes no console.
7. **Não há DE-PARA para a Câmara.** O deputado federal não se liga ao `sqCandidato` do TSE
   nem ao `codarea`; sem isso receita/emenda não cruza com território.
8. **Não há DE-PARA entre Câmara e Portal da Transparência** (`nomeAutor` × nome parlamentar
   é heurístico e não auditado).
9. **Normalização de `codigoIbge` do Portal da Transparência** (6 vs 7 dígitos) está
   comentada mas não implementada.
10. **Nenhuma fonte tem coleta incremental.** Sempre varredura completa; não há watermark,
    cursor nem "desde a última coleta".
11. **Nenhuma fonte tem verificação de esquema.** Se a fonte renomear uma coluna ou campo,
    o parser pode gerar vazio silenciosamente.
12. **Não há monitoramento de frescor.** `metadata.json` é gravado, mas nada alerta quando
    um dado fica velho.
13. **Não há licença/atribuição registradas por fonte** — `docs/data-sources/README.md`
    pede esse campo, mas os 14 documentos de fonte previstos **não existem**: o diretório
    contém apenas o `README.md` índice.
14. **Banco Central, INEP, DATASUS, SNIS e demais setoriais** nunca foram iniciados.
15. **O schema do CSV do TSE não é validado** — o parser busca colunas por nome com fallback
    (`SG_UE` → `CD_MUNICIPIO`); colunas ausentes viram índice -1 e o valor silenciosamente vazio.

## 13. Resumo para a próxima etapa

**Situação atual (verificada):** existem **12 fontes efetivamente usadas** ou parcialmente
usadas, distribuídas em 8 adapters e 8 scripts `update-*` mais 1 scraper. Todas as APIs são
chamadas **em tempo de build/ingestão**, nunca pelo navegador — a única exceção é a URL da
foto oficial do TSE, usada em `<img>`. O orquestrador `ingest-all.ts` executa as fontes na
ordem territorial → centróides → indicadores → orçamento → eleições → mandatos → congresso →
transparência, com fallback para Brasil.io (eleições) e Base dos Dados (indicadores — e um
fallback de orçamento **quebrado**).

**O que a Caixa 1 entrega hoje:** dados normalizados gravados diretamente em `data/`, com
`updatedAt` global por dataset. **Não entrega RAW, não entrega histórico, não entrega hash,
não entrega data de coleta por registro e não entrega catálogo de fontes em formato de dados.**

**Prioridades evidentes para a próxima etapa (a definir, não implementadas aqui):**

1. **Definir a fronteira RAW.** Hoje a resposta original é descartada em todas as APIs.
   Sem isso, as caixas seguintes não têm como reprocessar nem auditar.
2. **Unificar o acesso HTTP.** `http-client.ts` já resolve retry/429/timeout, mas dois
   pontos o ignoram (`update-territorial-data.ts` com `fetch` cru; Brasil.io com `fetch` cru).
3. **Materializar o catálogo de fontes como dado**, hoje espalhado entre Markdown e
   constantes em 8 arquivos, incluindo a divergência `id_ente` 6 vs 7 dígitos e a
   estrutura antiga de ZIP por UF.
4. **Tratar identidade de pessoa** — o `id` da Câmara não tem ponte para TSE/IBGE; hoje o
   deputado federal não cruza com território nem com emendas.
5. **Definir política de identificadores por fonte** (DE-PARA explícito e auditável), dado
   que TSE↔IBGE já exige 8 exceções manuais e o Portal da Transparência tem divergência
   de dígitos não tratada.
6. **Registrar, por fonte, o que significa "coleta bem-sucedida"** — hoje "sem dado" e
   "falha de rede" são indistinguíveis em vários adapters.

**Principais arquivos analisados nesta auditoria:**

- Adaptadores: `scripts/adapters/http-client.ts`, `ibge/ibge-malhas.adapter.ts`,
  `ibge/ibge-localidades.adapter.ts`, `ibge/ibge-sidra.adapter.ts`,
  `siconfi/siconfi.adapter.ts`, `tse/tse.adapter.ts`, `tse/tse-csv-parser.ts`,
  `tse/tse-depara-builder.ts`, `tse/tse-mandatos.ts`, `camara/camara.adapter.ts`,
  `portal-transparencia/portal-transparencia.adapter.ts`,
  `brasilio/brasilio.adapter.ts`, `basedosdados/basedosdados.adapter.ts`
- Scripts: `ingest-all.ts`, `scrape-tse.ts`, `update-territorial-data.ts`,
  `update-centroides.ts`, `update-indicators-data.ts`, `update-budget-data.ts`,
  `update-elections-data.ts`, `update-mandatos-gerais.ts`, `update-congresso-data.ts`,
  `update-transparencia-data.ts`, `test-adapters.ts`, `lib/env.ts`
- Documentação: `docs/APIS.md`, `docs/apis_mapping.md`, `docs/architecture/overview.md`,
  `docs/data-sources/README.md`, `docs/adr/0001-dataset-territorial-distribuido.md`,
  `README.md`, `docs/FUNCIONALIDADES.md`, `.env.example`
- Frontend (apenas para identificar fonte): `apps/web/src/features/elections/electionsApi.ts`
