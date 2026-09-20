# Auditoria da Caixa 2 — Coletor Externo

> **Auditoria somente-leitura. Nada foi implementado, alterado, refatorado ou corrigido.**
> Objetivo: descobrir como os dados são obtidos HOJE, com evidência no código, para
> embasar o desenho do COLETOR EXTERNO (Caixa 2).
> Onde não foi possível verificar, está escrito **não verificável**.

## 1. Objetivo e método

Levantar o estado atual da coleta: quem faz requisição, por qual transporte, com
qual política, o que acontece com a resposta e o que é registrado.

Evidência primária: código em `scripts/`. A Caixa 1 (`scripts/fontes/`) foi lida
como contrato de referência, não como implementação.

**Achado estrutural que define toda esta auditoria:** a Caixa 2 **não existe**.

```
$ grep -rn "fontes/catalogo|fontes/tipos" scripts/ apps/ --include=*.ts | grep -v "^scripts/fontes/"
  (nenhum resultado — exceto apps/web/src/lib/fontes.ts, que é o leitor de
   datasets do frontend e não tem relação com scripts/fontes/)
```

Nenhum arquivo importa o catálogo. `scripts/coletor/` e `scripts/raw/` não
existem. A coleta de hoje é feita por **13 adapters e 9 scripts**, escritos antes
da Caixa 1 e **sem nenhuma ligação com ela**.

## 2. Superfície de coleta real

Cinco pontos fazem rede em todo o projeto (`fetch` ou Playwright):

| Arquivo | Mecanismo | Papel |
|---|---|---|
| `scripts/adapters/http-client.ts` | `fetch` + retry | cliente HTTP compartilhado (**JSON apenas**) |
| `scripts/adapters/brasilio/brasilio.adapter.ts` | `fetch` cru | ignora o cliente compartilhado |
| `scripts/adapters/basedosdados/basedosdados.adapter.ts` | `fetch` cru (POST) | ignora o cliente compartilhado |
| `scripts/update-territorial-data.ts` | `fetch` cru | ignora o cliente compartilhado |
| `scripts/scrape-tse.ts` | Playwright/Chromium | único transporte não-HTTP |

7 adapters usam `http-client.ts`; **3 pontos fazem `fetch` cru**, cada um
reimplementando (ou omitindo) retry e timeout.

## 3. Como a coleta é disparada hoje

Não há coletor. O que existe é um **orquestrador de subprocessos**:

```
ingest-all.ts
  └─ spawn(tsx, scripts/update-*.ts)   → stdio herdado → exit code
       └─ cada script instancia seus adapters e grava em data/
```

- `runScript()` usa `spawn` e só olha o **exit code** (0 = sucesso).
- Ordem fixa e linear: territorial → centróides → indicadores → orçamento →
  eleições → mandatos → congresso → transparência.
- Filtros `--only=` / `--skip=`; `--resumo` só lista o que rodaria.
- **Não há paralelismo entre etapas** e **não há dependências declaradas** entre
  elas (ex.: transparência depende de `data/indicators/pontos.json`, gerado por
  `gerar-derivados.ts`, que o orquestrador não executa).

**Fallback** (`runAlternativa`): mapa domínio → módulo, via `import()` dinâmico,
exigindo que o módulo exporte `ingestirComoFonteAlternativa(dominio)`.

## 4. Política de execução real (o que a Caixa 1 deliberadamente não tem)

A Caixa 1 proíbe timeout/retry/delay/concorrência. Hoje esses valores estão
**hardcoded dentro de cada adapter e repetidos a cada chamada**:

| Adapter | timeoutMs | maxRetries | baseDelayMs | delay entre chamadas | concorrência |
|---|---|---|---|---|---|
| ibge-localidades | 20 000 | 3 | (padrão 500) | — | — |
| ibge-malhas | 60 000 | 3 | 800 | — | — |
| ibge-sidra | 45 000 | 3 | 600 / 700 | — | — |
| siconfi | 30 000 | **4** | 600 | **300 ms** | **2** (`processarEmLote`) |
| tse (adapter) | 30 000 | 3 | 500 | — | — |
| camara | 30 000 | 3 | 500 | — | — |
| portal-transparencia | 45 000 | 3 | 1000 | **350 ms** | — |
| update-territorial (cru) | **nenhum** | **nenhum** | — | — | — |
| brasilio (cru) | **nenhum** | **nenhum** | — | — | — |
| basedosdados (cru) | **nenhum** | **nenhum** | — | — | — |
| scrape-tse (Playwright) | 300 000 (nav/download) | 2 tentativas/arquivo | 3 000 ms entre tentativas | — | — |

Observações verificadas:
- Os valores são repetidos literalmente em **cada call site**, não em um lugar só.
- `siconfi` é o único com retry 4 e o único com concorrência controlada.
- `--delay` e `--concurrency` são CLI em `update-budget-data.ts`; o restante é fixo.
- Os três `fetch` crus **não têm timeout nem retry** — uma requisição pendurada
  trava indefinidamente.

## 5. Tratamento de resposta — onde o RAW se perde

**Todo corpo de resposta é consumido e descartado.** Não há gravação de bytes em
nenhum ponto:

| Local | O que faz com o corpo |
|---|---|
| `http-client.ts:98` | `await res.json()` → devolve objeto tipado |
| `update-territorial-data.ts:87` | `await res.json()` → objeto |
| `brasilio.adapter.ts:103` | `await res.json()` → objeto |
| `basedosdados.adapter.ts:81` | `await res.json()` → objeto |
| `basedosdados.adapter.ts:77` | `await res.text()` — **só em erro**, e truncado em 300 chars |

Consequências verificadas:
- Não existe RAW para nenhuma API. A resposta original é irrecuperável.
- Não há hash/checksum em nenhum arquivo (`grep` por `sha256|md5|checksum` → 0).
- Não há `ETag` / `Last-Modified` sendo lido ou guardado (só `Retry-After`).
- Não há `User-Agent` do projeto: `http-client.ts` envia apenas `Accept`.

**Exceção parcial:** `scrape-tse.ts` grava bytes reais (ZIP) em
`data/elections/raw/` — ver §7.

## 6. Semântica de sucesso/falha — ambígua por construção

Não existe contrato de "coleta bem-sucedida". Cada adapter decide sozinho:

| Fonte | Falha de rede | Sem dado | Distingue? |
|---|---|---|---|
| siconfi | `catch` → `null` + `console.warn` | `items.length === 0` → `null` + `console.warn` | **Não** — mesmo valor |
| tse (adapter) | `catch` → `[]` + warn | sem candidatos → `[]` | **Não** |
| portal (programa) | `catch` → ignora, só loga os 3 primeiros | lista vazia → ignora | **Não** |
| camara (despesas) | `catch` → conta `falhasDespesa`, não aborta | `length === 0` → `continue` | parcial: conta falhas, não as registra |
| brasilio | `throw` | `eleitos.length === 0` → `throw` | **Não** — ambos lançam |
| basedosdados | `throw` | — | sim (só lança) |

Um município sem programa social e um município cuja requisição falhou produzem
**o mesmo resultado**: ausência no arquivo de saída.

## 7. O caso TSE — o único RAW que existe hoje

`scripts/scrape-tse.ts` é o único ponto que preserva bytes originais.

Evidência verificada em disco (`data/elections/raw/`):
```
consulta_cand_2022.zip                4 388 287 bytes   2026-09-19 00:08
consulta_cand_2024.zip               63 961 506 bytes   2026-09-18 20:00
votacao_candidato_munzona_2024.zip   48 474 271 bytes   2026-09-18 20:00
```

Características:
- **Transporte:** Chromium headful; o download é capturado por evento
  (`page.waitForEvent('download')`), não por `fetch`. Warm-up no portal antes.
- **Retomada:** se o arquivo existe **e** tem assinatura `PK` **e** tamanho >
  10 KB, é **pulado** (`resumo.skip++`).
- **Validação:** apenas assinatura e tamanho mínimo. **Não compara com a fonte**,
  não valida integridade do conteúdo, não detecta ZIP truncado no meio.
- **Tentativas:** 2 por arquivo, 3 s entre elas.
- **Preservação:** `data/elections/raw/` está no `.gitignore` (raiz e
  `data/elections/.gitignore`). **Os ZIPs não são versionados** e
  `build-site.ts` não os publica.
- **Sem data de coleta, sem hash, sem URL de origem** registrados junto ao arquivo.
  A única evidência de quando foi baixado é o `mtime` do sistema de arquivos.

## 8. Paginação — cobertura real vs. declarada

A Caixa 1 declara 4 estratégias. O que está implementado:

| Estratégia | Recursos que a declaram | Implementação real |
|---|---|---|
| `nenhuma` | 12 | correto (nada a fazer) |
| `link-next` | camara (3), brasilio (1) | ✅ segue `links[rel=next]` / `json.next` até acabar |
| `pagina-numerada` | portal (5), tse/divulgacandcontas | ✅ portal: incrementa `pagina` até lote vazio, trava 100 páginas. TSE: **não implementado** (recurso não usado) |
| `envelope-offset` | siconfi/dca, siconfi/rreo | ❌ **NÃO implementado** |

**Achado relevante:** `siconfi.adapter.ts:184` faz `return data.items ?? []` e
**ignora `hasMore`, `limit` e `offset`** — embora a interface os declare
(linhas 99–101) e a Caixa 1 marque o recurso como `envelope-offset`. A URL
consultada não envia `offset` nem `limit` (linha 176). Se a resposta do DCA vier
paginada, **o excedente é perdido silenciosamente** e o pipeline soma apenas o
primeiro lote.

**Travas de segurança existentes:** `MAX_PAGINAS = 200` (Câmara),
`maxPaginas = 100` (Portal, parâmetro com default). Ambas emitem aviso ao estourar.

## 9. Credenciais

Lidas sempre do ambiente, nunca do catálogo:

| Fonte | Variável | Como é obtida | Falha se ausente |
|---|---|---|---|
| portal-transparencia | `PORTAL_API_KEY` | `lerEnv()` no construtor; `exigirEnv()` na 1ª requisição | erro com instruções; `update-transparencia-data.ts` valida antes com `verificarChave()` |
| brasilio | `BRASILIO_TOKEN` | `process.env` direto | `throw` com instruções |
| basedosdados | `BD_BILLING_PROJECT` + `BD_ACCESS_TOKEN` | `process.env` direto | `throw` |
| camara | — | não exige | — |

O carregador é `scripts/lib/env.ts` (próprio, sem `dotenv`): lê `.env` e
`.env.local`, com **precedência do shell**. `ingest-all.ts` chama `carregarEnv()`
uma vez e os subprocessos herdam `process.env`.

Nenhum segredo foi encontrado em código.

## 10. O que é gravado ao final da coleta

Toda saída vai direto para `data/`, **sobrescrevendo** o arquivo anterior
(31 chamadas de `writeFile`; **zero** `appendFile`, zero backup, zero versionamento).

Cada `data/<área>/metadata.json` registra apenas:

```
maps:        updatedAt, source, estados, municipios, ufs, version
indicators:  updatedAt, source, anoPopulacao, anoPib, estados, municipios, ufs, version
budget:      updatedAt, source, exercicio, estados, municipios, ufs, version
elections:   updatedAt, source, anoEleicaoEstadual, anoEleicaoMunicipal, estados, municipios, ufs, version
```

O que **não** existe em nenhum metadata:
- URL efetivamente consultada; status HTTP; headers;
- data de publicação na fonte (só o instante da execução);
- hash/checksum; contagem de falhas; lista de recursos que falharam;
- versão do código/adapter que coletou;
- distinção de qual fonte respondeu (primária ou fallback).

**Fallback é indistinguível no resultado:** `brasilio.adapter.ts` grava nos
**mesmos arquivos** do TSE, alterando só `source` e um `viaFallback: true` no
metadata global. Não há marca por registro.

## 11. Divergências Catálogo (Caixa 1) ↔ coleta real

| # | Caixa 1 declara | Realidade no código | Situação |
|---|---|---|---|
| 1 | 20 recursos `usado` | 20 exercitados por 9 scripts | ✅ coerente |
| 2 | `siconfi/dca` = `envelope-offset` | lê só `items`; ignora `hasMore`/`offset` | ❌ não implementado |
| 3 | `tse/cdn-dados-abertos` = `browser-download` | Playwright headful, download por evento | ✅ coerente |
| 4 | `tse/foto-candidato` = `http-json`, usado | consumido pelo **navegador** (`<img>`), não por script | ⚠️ coleta fora do pipeline |
| 5 | `camara/deputados`, `partidos`, `despesas` | usa `link-next` corretamente | ✅ |
| 6 | `portal-transparencia/*` = `pagina-numerada` | implementado, trava 100 páginas | ✅ |
| 7 | `brasilio/candidatos` = `link-next` | implementado | ✅ |
| 8 | `basedosdados/*` = `bigquery-sql`, POST | implementado (fetch cru, sem retry) | ⚠️ sem política |
| 9 | `papel: fallback` (brasilio, basedosdados) | acionados só por `ingest-all.ts` após exit≠0 | ✅ coerente |
| 10 | `ibge-malhas/malha-*` via catálogo | `update-territorial-data.ts` **ignora o adapter** e usa `fetch` cru | ❌ rota duplicada |
| 11 | — | fallback `orcamento → basedosdados` **quebra**: o adapter lança para domínio ≠ `indicadores` | ❌ bug funcional |
| 12 | `tse/portal-dados-abertos` = `manual` | nenhum código baixa | ✅ coerente |

## 12. Problemas atuais (não corrigidos)

**Preservação**
1. Resposta original descartada em 100% das APIs — não há RAW.
2. Sem hash, sem ETag, sem data de coleta por registro.
3. `data/` sobrescrito a cada execução; não há histórico nem retenção.
4. ZIPs do TSE existem localmente mas são **gitignored** — perdem-se se o CDN mudar.
5. Retomada do TSE valida só `PK` + 10 KB: ZIP truncado passa como válido.

**Rastreabilidade**
6. `metadata.json` não guarda URL, status, headers nem contagem de falhas.
7. Origem primária vs. fallback é indistinguível por registro.
8. Sem `User-Agent` identificando o projeto em nenhuma requisição.

**Consistência**
9. Três implementações de HTTP: `http-client.ts` + 3 `fetch` cru sem timeout/retry.
10. Política de execução duplicada literalmente em ~30 call sites.
11. "Sem dado" e "falha" colapsam no mesmo valor em 4 das 6 fontes.
12. Paginação `envelope-offset` do Siconfi ausente → truncamento silencioso.
13. Rota do IBGE Malhas duplicada entre script e adapter; `ibge-malhas.adapter.ts` é órfão do pipeline.
14. `tse.adapter.ts` é órfão: só o smoke test o usa, e ele **não faz requisição** (`testarConectividade` retorna `true` após imprimir aviso).
15. Fallback de orçamento declarado no orquestrador **não funciona**.
16. Sem validação de esquema: coluna renomeada na fonte pode gerar vazio silencioso (o parser do TSE usa fallback `SG_UE` → `CD_MUNICIPIO` e índice -1 vira valor vazio).

**Operação**
17. `scrape-tse.ts` exige Chromium instalado e navegador headful; conforme o próprio arquivo, não roda no sandbox de execução.
18. Sem verificação de frescor: nada alerta quando um dado envelhece.
19. Extração de ZIP do TSE é feita em memória (`adm-zip` + `getData()`), sem streaming — arquivos nacionais são grandes.

## 13. Requisitos que a Caixa 2 precisará satisfazer

Derivados das evidências acima, não de preferência de desenho:

1. **Transporte plugável.** 4 formas reais: HTTP JSON, HTTP GeoJSON, BigQuery POST e download por navegador. `http-client.ts` cobre só JSON.
2. **Capturar bytes antes de interpretar.** Hoje o `json()` é a primeira coisa que acontece; o RAW exige ler o corpo como bytes primeiro.
3. **Resolver `urlBaseEfetiva(fonte, recurso)`.** O catálogo já expõe o helper; 3 das 4 URLs do TSE dependem dele.
4. **Implementar as 4 estratégias de paginação**, em especial `envelope-offset` (hoje ausente).
5. **Política central de execução**, lida do coletor e não repetida por call site.
6. **Resultado tri-estado** por coleta: sucesso / sem-dado / falha — hoje colapsados.
7. **Ler credencial pelo nome declarado** no catálogo (`credencial.env`), com falha antecipada.
8. **Registrar procedência** por coleta: URL final, instante, status, headers, hash.
9. **Suportar `transporte: manual` e `browser-download`** sem tratar como caso excepcional.
10. **Preservar o comportamento de retomada do TSE**, mas com validação mais forte que `PK`.
11. **Fan-out por parâmetro** (`dimensao`): hoje cada script escreve seu próprio laço.
12. **Não quebrar o pipeline atual**, que continua sendo a única via de publicação.

## 14. Resumo

**A Caixa 2 não existe.** O que existe é uma coleta funcional, testada em
produção, distribuída por 13 adapters e 9 scripts que **não conhecem a Caixa 1**:
nenhum arquivo importa `scripts/fontes/`.

O catálogo descreve corretamente a maior parte do que acontece (transporte,
paginação, credencial, fan-out), mas há **duas divergências funcionais**:
a paginação `envelope-offset` do Siconfi não está implementada, e o fallback de
orçamento quebra. Há ainda **uma rota duplicada** (IBGE Malhas) e dois adapters
órfãos.

O ponto mais grave para o desenho da Caixa 2 é que **não há RAW em lugar nenhum,
exceto os ZIPs do TSE** — e mesmo esses não são versionados. Toda resposta de API
é convertida em objeto e descartada na mesma linha. Sem capturar bytes antes de
interpretar, nenhuma caixa posterior (ORGANIZAÇÃO, RELACIONAMENTOS, CÁLCULOS)
terá como reprocessar, auditar ou comparar execuções.

A boa notícia é que a Caixa 1 já cobre o que o coletor precisa saber: transporte,
parâmetros com `dimensao`, paginação, rate limit, credencial por nome e URL base
por recurso. O trabalho da Caixa 2 é **executar esse contrato**, não redescobrir
as fontes — e a primeira decisão de desenho é onde os bytes são capturados.

**Arquivos analisados:** `scripts/fontes/{tipos,catalogo}.ts`,
`scripts/adapters/http-client.ts` e os 13 adapters, `scripts/ingest-all.ts`,
`scripts/scrape-tse.ts`, os 9 `update-*.ts`, `scripts/lib/env.ts`,
`data/*/metadata.json`, `data/elections/.gitignore`, `.gitignore`.
