# Plano da Caixa 2 — Coletor Externo

> **Desenho de arquitetura. Nada foi implementado, alterado ou migrado.**
> Base: `docs/AUDITORIA_CAIXA_2_COLETOR.md` (evidência) e `docs/CAIXA_1_FONTES.md`
> (contrato). Este documento não repete a auditoria.
> Onde uma decisão depende de fator ainda não verificado, está marcado **[PENDENTE]**.

## 1. Objetivo

Definir a Caixa 2 antes de escrevê-la: o que ela é, onde começa e termina, qual
contrato consome da Caixa 1 e qual contrato entrega ao RAW.

**A Caixa 2 não existe hoje.** Nenhum arquivo importa `scripts/fontes/`. A coleta
atual é feita por 13 adapters e 9 scripts que não conhecem o catálogo. Este plano
descreve o que deve existir, não o que existe.

Resultado esperado: um coletor **fino**, que executa o que o catálogo declara e
preserva bytes, sem decidir nada sobre o significado dos dados.

## 2. Definição da Caixa 2

```text
FONTES              declara: "o que existe e como se coleta"     (Caixa 1, pronta)
  ↓
COLETOR EXTERNO     executa: "faço a requisição e trago bytes"   (esta caixa)
  ↓
RAW                 preserva: "estes são os bytes e sua procedência"
  ↓
ORGANIZAÇÃO         interpreta: "isto significa tais campos"
  ↓
RELACIONAMENTOS     cruza      CÁLCULOS     deriva      PUBLICAÇÃO   publica
```

**A Caixa 2 faz exatamente três coisas:**

1. Lê a declaração de um recurso na Caixa 1.
2. Monta e executa a requisição (ou o download por navegador).
3. Entrega **bytes + procedência** ao RAW.

**A Caixa 2 não faz:**

- não interpreta o conteúdo (não faz `json()` para decidir nada);
- não transforma, normaliza, converte encoding nem renomeia campo;
- não conhece domínio, indicador nem regra de negócio;
- não decide o que é dado válido — apenas se a **coleta** teve sucesso;
- não grava em `data/` (isso é PUBLICAÇÃO) nem cria relacionamentos.

**Fronteira com a ORGANIZAÇÃO:** o coletor responde "trouxe 4 388 287 bytes, com
estes headers, neste instante". A ORGANIZAÇÃO responde "isto é um CSV latin1 com
separador `;` e tais colunas". O catálogo já registra essa segunda parte como
`peculiaridade` — e o coletor **apenas a transporta adiante, sem agir sobre ela**.

## 3. Contrato consumido da Caixa 1

O coletor **não redescobre fontes**. Ele lê o catálogo via os helpers já
exportados em `scripts/fontes/catalogo.ts`:

| Do catálogo | Uso no coletor |
|---|---|
| `FONTES` / `buscarFonte` / `buscarRecurso` | localizar a declaração |
| `recursosUsados()` | enumerar o que coletar |
| `urlBaseEfetiva(fonte, recurso)` | **montar a URL** — nunca ler `fonte.baseUrl` direto |
| `recurso.caminho` | path com placeholders `{nome}` |
| `recurso.metodo` | `GET` \| `POST` |
| `recurso.transporte` | escolher o mecanismo |
| `recurso.formato` | rótulo do que se espera; **não** guia parsing |
| `recurso.parametros[]` | substituir placeholders e expandir fan-out |
| `parametro.dimensao` | quantas chamadas fazer |
| `parametro.valores` | valor fixo (não gera fan-out) |
| `recurso.paginacao` | estratégia de continuação |
| `recurso.rateLimit` | restrição real a respeitar |
| `recurso.peculiaridades` | fatos a repassar ao RAW |
| `fonte.credencial.env` | **qual** variável de ambiente ler |
| `fonte.credencial.header` / `esquema` | como enviar |
| `fonte.id` + `recurso.id` | identidade da coleta |

### Redeclarar política é proibido

A Caixa 1 deliberadamente **não** tem timeout, retry, delay nem concorrência. O
coletor os define **em um único lugar** (ver §6), não por call site — hoje esses
valores estão repetidos literalmente em ~30 pontos.

### O que a Caixa 1 NÃO entrega (o coletor resolve)

- **Valores dos parâmetros de fan-out.** O catálogo diz `dimensao: 'ente'`; a
  lista concreta dos ~5.570 entes vem de fora (§5).
- **Ordem de execução** entre recursos e dependências entre coletas.
- **Estratégia de paginação**, apenas o nome dela.

## 4. Anatomia do coletor

Quatro peças, todas pequenas e sem herança:

```
scripts/coletor/
├── tipos.ts        ResultadoColeta, RequisicaoColeta, Procedencia
├── politicas.ts    timeouts, retry, concorrência, User-Agent (ÚNICO lugar)
├── transportes/
│   ├── http.ts         http-json + http-geojson (GET e POST)
│   ├── bigquery.ts     bigquery-sql (POST)
│   └── navegador.ts    browser-download (Playwright) + manual
├── paginacao.ts    as 4 estratégias
└── coletar.ts      orquestra: catálogo → requisições → resultados
```

**Sem** classes abstratas, registry, plugin system ou DSL. Um `switch` sobre
`transporte` e outro sobre `paginacao` bastam — são 5 e 4 valores, fechados.

### Fluxo de uma coleta

```
para cada recurso (parametrizado):
  1. resolver URL base (urlBaseEfetiva) + substituir placeholders
  2. resolver credencial pelo NOME declarado  → falha ANTES se ausente
  3. escolher transporte pelo `transporte` declarado
  4. executar, respeitando rateLimit e política central
  5. paginar conforme a estratégia declarada
  6. ler o corpo como BYTES (nunca json() para decidir)
  7. calcular hash sobre os bytes
  8. emitir ResultadoColeta com bytes + procedência
```

O passo 6 é a inversão central em relação a hoje: `res.json()` deixa de ser a
primeira operação e passa a ser responsabilidade da ORGANIZAÇÃO.

## 5. Fan-out — o que é parâmetro e o que é chamada

O catálogo distingue três tipos de parâmetro, e o coletor deve tratá-los
diferentemente:

| Tipo no catálogo | Exemplo real | Comportamento |
|---|---|---|
| **Valor fixo** (`valores` com 1 item) | `formato`, `intrarregiao`, `tabela`, `variavel`, `conjunto`, `cdCargo` | substitui uma vez, **não** gera chamadas |
| **Placeholder no caminho, sem `dimensao`** | `{pais}`, `{projeto}` | substitui uma vez |
| **Com `dimensao`** | `ano`(11), `uf`(4), `ente`, `municipio`, `deputado`, `exercicio`, `localidade`, `unidade-eleitoral`, `mes-ano`, `mes`, `eleicao`, `candidato` | **expande em N chamadas** |

As dimensões reais somam 12 nomes distintos. O coletor recebe de fora o
**conjunto de valores** de cada dimensão (uma "lista de expansão" por dimensão):
`ente` → 5.570 códigos; `uf` → 27; `deputado` → 513. **De onde essa lista vem é
decisão de quem chama o coletor, não do coletor.**

**Consequência prática:** `siconfi/dca` com `dimensao: 'ente'` = 5.570 chamadas
de **um** recurso. Isso é fan-out, não 5.570 recursos — a distinção que a Caixa 1
já fixou e que o coletor deve respeitar.

**[PENDENTE] Produto cartesiano.** Recurso com mais de uma dimensão (ex.: `ano` ×
`deputado` em `camara/despesas-deputado`) gera N×M chamadas. O desenho assume
produto cartesiano; confirmar caso a caso na implementação.

## 6. Política de execução (central, única)

Valores iniciais derivados do que já funciona em produção hoje — **preservar o
comportamento conhecido**, não inventar novos:

| Parâmetro | Valor inicial | Origem |
|---|---|---|
| `timeoutMs` padrão | 30 000 | maioria dos adapters |
| `maxRetries` padrão | 3 | maioria |
| `backoff` | exponencial sobre `baseDelayMs` | `http-client.ts` |
| `baseDelayMs` | 500 (HTTP), 800 (GeoJSON), 1000 (Portal) | por transporte |
| `respeitarRetryAfter` | sim | já implementado |
| `concorrencia` padrão | 1 (sequencial) | conservador |
| `concorrencia` Siconfi | 2 | único caso com rate limit crítico |
| `pausaEntreChamadas` | 300 ms Siconfi, 350 ms Portal | já implementado |
| `User-Agent` | identificar o projeto | **novo** — hoje ausente |

Regras:
- **Códigos retentáveis** já definidos: `408, 429, 500, 502, 503, 504`.
- **Erro não-retentável** (400/401/403/404) falha imediatamente — como hoje.
- **User-Agent:** incluir identificação e contato. Hoje nenhuma requisição se
  identifica, o que é ruim para todas as fontes públicas.
- A política é **derivada de `recurso.rateLimit`**, não fixa: `nivel: 'critico'`
  ⇒ concorrência 2 e pausa obrigatória.

## 7. Resultado da coleta — tri-estado

Hoje "sem dado" e "falha" colapsam no mesmo valor em 4 das 6 fontes
(`null`, `[]` ou ausência). O coletor deve emitir **um estado explícito**:

| Estado | Significado | Como se reconhece |
|---|---|---|
| `sucesso` | resposta obtida e íntegra | HTTP 2xx + corpo não vazio |
| `sem-dado` | a fonte respondeu legitimamente "não há" | HTTP 2xx + coleção vazia / 404 documentado como ausência |
| `falha` | não foi possível coletar | timeout, 5xx após retries, 401/403, corpo corrompido |

**Regra dura:** `sem-dado` **nunca** é `falha`, e ambos **nunca** viram `null`
silencioso. Essa distinção é o que hoje falta para saber se um município não tem
programa social ou se a requisição caiu.

**[PENDENTE] Quem decide `sem-dado`.** O coletor pode detectar "corpo vazio", mas
"HTTP 404 significa ausência" é conhecimento de fonte. Proposta: declarar isso na
Caixa 1 como peculiaridade do recurso, se necessário — **sem alterar a Caixa 1
nesta etapa**.

### Procedência a anexar a cada coleta

O que a auditoria mostrou estar ausente hoje, e que o RAW exige:

| Campo | Hoje |
|---|---|
| `fonteId` + `recursoId` | ❌ |
| URL final resolvida (com query) | ❌ |
| instante da coleta (ISO 8601) | ❌ (só `updatedAt` global no fim) |
| status HTTP | ❌ |
| headers relevantes (`ETag`, `Last-Modified`, `Retry-After`) | ❌ |
| `content-type` e tamanho | ❌ |
| hash do conteúdo | ❌ |
| parâmetros usados (o ente, o ano) | ❌ |
| transporte efetivo (http/browser/manual) | ❌ |
| estado (`sucesso`/`sem-dado`/`falha`) e motivo | ❌ |
| tentativas realizadas | ❌ |
| versão do coletor | ❌ |

## 8. Transportes

Cinco valores declarados na Caixa 1; o coletor implementa quatro mecanismos
(o `manual` não executa nada):

| `transporte` | Mecanismo | Recursos reais |
|---|---|---|
| `http-json` | `fetch` GET/POST, corpo lido como **bytes** | 19 |
| `http-geojson` | idem (é JSON) | 2 (IBGE Malhas) |
| `bigquery-sql` | POST com corpo SQL | 2 (Base dos Dados) |
| `browser-download` | Playwright headful + evento `download` | 1 (TSE CDN) |
| `manual` | **não executa**; registra que depende de humano | 1 (TSE Portal) |

**`browser-download`** preserva o que já funciona: Chromium headful, warm-up no
portal antes do download, `userAgent` real, `navigator.webdriver = false`,
locale `pt-BR`. O coletor deve manter exatamente essa receita — ela é o que passa
pelo WAF (Akamai) hoje.

**`manual`** não é caso excepcional: é um estado de primeira classe. O coletor
apenas reporta "este recurso requer intervenção humana" e não tenta rede.

**`bigquery-sql`** hoje usa `fetch` cru sem timeout nem retry — o coletor deve
aplicar a política central também aqui.

## 9. Paginação

As 4 estratégias declaradas, com a forma real de cada uma:

| Estratégia | Como continua | Recursos |
|---|---|---|
| `nenhuma` | uma requisição | 13 |
| `link-next` | seguir `links[rel=next]` / `json.next` até ausente | 4: camara(3), brasilio(1) |
| `pagina-numerada` | incrementar `pagina` até lote vazio | 6: portal(5), tse-divulgacandcontas(1) |
| `envelope-offset` | usar `hasMore`/`offset`/`limit` do envelope | 2: siconfi(2) |

**Achado que o plano precisa resolver:** `envelope-offset` **não existe hoje** —
`siconfi.adapter.ts` faz `return data.items ?? []` e ignora `hasMore`/`offset`.
O coletor deve implementá-la, senão o DCA continua truncando em silêncio.

**Travas de segurança** (manter o comportamento atual): limite de páginas com
aviso ao estourar — hoje `MAX_PAGINAS = 200` (Câmara) e `100` (Portal). Estourar
o limite deve produzir **`falha`**, não `sucesso` parcial silencioso.

## 10. Preservação de bytes (fronteira com o RAW)

O coletor **captura**; o RAW **preserva**. O coletor entrega bytes e procedência;
não decide onde nem como são guardados nem por quanto tempo.

Regras de captura:

1. **Ler o corpo uma vez, como bytes.** `arrayBuffer()` (ou stream para arquivos
   grandes) **antes** de qualquer interpretação.
2. **Hash sobre os bytes exatos**, nunca sobre o objeto reinterpretado.
3. **Não reescrever o conteúdo.** Sem re-encode, sem pretty-print, sem normalizar
   quebra de linha.
4. **Arquivos grandes:** o ZIP do TSE chega a 64 MB (verificado em disco). O
   coletor deve **streamar para disco**, não acumular em memória — diferente do
   `adm-zip` + `getData()` atual.

**[PENDENTE] Formato do RAW.** Onde os bytes são gravados, como são nomeados
(por hash? por `fonte/recurso/instante`?) e por quanto tempo são retidos. É
decisão do **desenho do RAW**, não do coletor. O coletor apenas entrega o objeto.

## 11. Retomada e idempotência

Hoje `scrape-tse.ts` pula arquivo existente se tiver assinatura `PK` e > 10 KB —
validação fraca (ZIP truncado passa). O coletor deve:

- **Revalidar por hash**, não por assinatura: se o RAW já tem o mesmo conteúdo,
  a coleta é `sucesso` sem refazer a requisição;
- **Não tratar mtime como prova** de quando o dado foi obtido;
- **Ser idempotente:** rodar duas vezes o mesmo recurso com os mesmos parâmetros
  produz o mesmo resultado lógico.

**[PENDENTE]** Se a fonte oferecer `ETag`/`Last-Modified`, revalidar em vez de
rebaixar. Requer armazenar esses headers no RAW — depende de §10.

## 12. Casos especiais encontrados no projeto

| Caso | Como o coletor trata |
|---|---|
| TSE exige navegador headful (WAF) | transporte `browser-download`; receita preservada (§8) |
| Coleta não automatizável | `manual`: reporta, não tenta |
| Siconfi rate limit crítico | concorrência 2 + pausa 300 ms, derivado de `rateLimit.nivel` |
| Siconfi paginação ignorada | implementar `envelope-offset` (§9) |
| Portal exige API key | ler `credencial.env`, falhar **antes** da varredura |
| Portal sem total/última página | parar na página vazia + trava de páginas |
| Câmara `/despesas` instável (retorna vazio) | `sem-dado` ≠ `falha`; reportar por deputado |
| Brasil.io/Base dos Dados sem timeout hoje | política central cobre os três `fetch` crus |
| ZIP de 64 MB | stream para disco, não memória |
| Fallback (brasilio, basedosdados) | registrar **qual** fonte respondeu, por coleta |
| `tse/foto-candidato` consumido só pelo navegador | fora do coletor; documentar a exceção |
| Base dos Dados só aceita domínio `indicadores` | o coletor não decide isso — é do chamador |
| Vários recursos, hosts diferentes no TSE | `urlBaseEfetiva()` sempre (§3) |

## 13. O que NÃO pertence à Caixa 2

- interpretar, parsear, converter encoding (latin1), renomear campo;
- tratar `-`, `...`, `X` como nulo;
- DE-PARA, joins, chaves de junção;
- cálculo de indicador (PIB per capita, densidade, % do total);
- decidir cobertura, frescor ou qualidade de dado;
- gravar em `data/` ou publicar datasets;
- política de retenção do RAW;
- regras de frontend;
- lógica de negócio.

**Regra de desempate:** se a decisão depende de **conhecer o significado** do
dado, não é do coletor. Se depende apenas de **executar a coleta**, é.

## 14. Estratégia de adoção (sem quebrar o que funciona)

O pipeline atual continua sendo a única via de publicação. A adoção deve ser
**paralela e incremental**, nunca uma reescrita:

1. **Fase 1 — coletor isolado.** Adicionar `scripts/coletor/` sem tocar em
   adapter, script ou `ingest-all.ts`. Nada o consome ainda.
2. **Fase 2 — uma fonte piloto.** Escolher **um** recurso simples, sem
   credencial e sem paginação (candidato natural: `ibge-localidades/estados`) e
   comparar bytes coletados com o que o pipeline atual produz.
3. **Fase 3 — validar o RAW.** Só depois de o coletor estar correto, definir o
   formato do RAW (§10). Sem RAW não há como provar que o coletor funciona.
4. **Fase 4 — migrar por recurso**, do mais simples ao mais complexo
   (`envelope-offset` do Siconfi e `browser-download` do TSE por último).
5. **Fase 5 — só então** `ingest-all.ts` passa a chamar o coletor.

**Não migrar adapters em bloco.** Cada recurso migrado deve produzir resultado
equivalente ao atual antes de o próximo começar.

## 15. Decisões pendentes

1. **Formato e local do RAW** — bloqueia a Fase 3. Nomeação, particionamento,
   retenção. **Decisão do desenho do RAW, não do coletor.**
2. **Origem das listas de fan-out** — quem fornece os 5.570 entes, as 27 UFs, os
   513 deputados. Hoje cada script monta a sua.
3. **Produto cartesiano** em recursos multidimensionais (§5).
4. **Quem decide `sem-dado`** — o coletor ou a Caixa 1 (§7).
5. **Streaming vs. memória** para o ZIP de 64 MB (§10).
6. **Revalidação por `ETag`** — depende de o RAW guardar headers (§11).
7. **Concorrência entre recursos independentes** — hoje não há paralelismo algum;
   definir se o coletor paraleliza recursos ou apenas dentro de um recurso.
8. **Onde vive a política** — `politicas.ts` no coletor ou um arquivo de
   configuração. Proposta: constante tipada, como a Caixa 1.
9. **`User-Agent`** — texto e contato.
10. **O que fazer com os 3 adapters órfãos/rotas duplicadas** (`ibge-malhas`,
    `tse.adapter`, `update-territorial-data`). Fora do escopo desta etapa.

## 16. Resumo para a próxima etapa

A Caixa 2 é um **executor fino do catálogo**: lê a declaração, monta e executa a
requisição, pagina conforme declarado, lê o corpo **como bytes** e devolve
bytes + procedência. Não interpreta nada.

Os quatro eixos do desenho:

1. **Inverter a leitura da resposta.** Hoje `json()` é a primeira coisa que
   acontece; precisa ser a última. É a mudança que viabiliza o RAW.
2. **Tri-estado explícito** (sucesso / sem-dado / falha), hoje colapsado em
   `null`/`[]` em 4 das 6 fontes.
3. **Política central única**, substituindo ~30 repetições literais e cobrindo
   os 3 `fetch` crus que hoje não têm timeout nem retry.
4. **Paginação completa**, em especial `envelope-offset`, hoje ausente e
   truncando o DCA do Siconfi em silêncio.

A boa notícia confirmada pela auditoria: **a Caixa 1 já cobre o que o coletor
precisa** — transporte, `dimensao`, paginação, `rateLimit`, credencial por nome
e `urlBaseEfetiva`. O coletor não precisa redescobrir nenhuma fonte.

**Antes de implementar, resolver as pendências 1 e 2** (formato do RAW e origem
das listas de fan-out): as duas determinam a assinatura do coletor. A Fase 1
(adicionar `scripts/coletor/` sem consumidores) pode começar sem elas, mas a
Fase 3 não.

**Fora de escopo:** o RAW, a migração dos adapters, a correção das divergências
apontadas na auditoria e qualquer alteração em `scripts/fontes/`, no frontend,
na API ou em `data/`.
