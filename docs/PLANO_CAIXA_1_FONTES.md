# Plano da Caixa 1 — Fontes

> Desenho de arquitetura. **Nada foi implementado, refatorado ou movido.**
> Base: `docs/AUDITORIA_CAIXA_1_FONTES.md`. Este documento não reproduz a auditoria.

## 1. Objetivo

Definir o que é a Caixa 1 (FONTES), o que ela contém e onde termina — separando
com precisão três responsabilidades que hoje estão misturadas nos mesmos
arquivos:

```
FONTES              COLETOR EXTERNO              RAW
"de onde vem e      "executa a coleta            "preserva o que
 como se obtém"      descrita"                    foi recebido"
```

A Caixa 1 é **declarativa**: descreve fontes e recursos. Ela não faz requisição,
não interpreta resposta e não grava dado.

Resultado esperado desta etapa: uma **fonte única de verdade** sobre as fontes
externas do Observatório, que o coletor futuro consulte em vez de carregar
constantes espalhadas por 8 adapters.

## 2. Arquitetura geral

```
┌─────────────────────────────────────────────────────────────┐
│ CAIXA 1 — FONTES                          (declarativo)     │
│                                                             │
│  catálogo: fonte → recursos                                 │
│  cada recurso diz: endpoint, parâmetros, formato,           │
│  periodicidade, identificadores, auth, paginação,           │
│  rate limit, peculiaridades, status                         │
└───────────────────────────┬─────────────────────────────────┘
                            │  "este recurso pode ser
                            │   coletado desta maneira"
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ COLETOR EXTERNO                           (imperativo)      │
│                                                             │
│  lê o catálogo → escolhe o transporte certo → executa       │
│  → devolve bytes + procedência                              │
└───────────────────────────┬─────────────────────────────────┘
                            │  "esta foi a resposta obtida"
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ RAW                                                         │
│                                                             │
│  bytes originais + envelope de procedência, imutável        │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
      ORGANIZAÇÃO → RELACIONAMENTOS → CÁLCULOS → PUBLICAÇÃO
                  (fora do escopo desta etapa)
```

Três regras que sustentam a separação:

1. **A Caixa 1 nunca executa.** Se um campo da Caixa 1 precisar de rede para ser
   lido, ele está no lugar errado.
2. **O coletor nunca decide sozinho.** Ele escolhe *como* executar, mas a
   decisão *o que* e *com quais parâmetros* vem do catálogo.
3. **O RAW recebe bytes, não objetos.** Interpretar a resposta é trabalho da
   ORGANIZAÇÃO, não do coletor.

## 3. O que é uma Fonte

Uma **fonte** é o **órgão/provedor** e o **sistema publicador** de onde os dados
vêm. Ela agrupa recursos e carrega o que é comum a todos eles: órgão,
documentação, se exige credencial, se é primária ou fallback.

Exemplos reais: `IBGE SIDRA`, `TSE CDN`, `Câmara dos Deputados`,
`Portal da Transparência`, `Brasil.io`, `Base dos Dados`.

Uma fonte **não** é:
- um endpoint (isso é recurso);
- um arquivo de saída (isso é PUBLICAÇÃO);
- um script (isso é o coletor).

**Regra prática para o Observatório:** se dois recursos compartilham órgão,
autenticação e forma de coleta, são recursos da **mesma** fonte. Se diferem em
transporte ou em credencial, são fontes diferentes — mesmo sendo o mesmo órgão.
É exatamente o caso do TSE, que aparece como **três fontes distintas**
(`tse-cdn`, `tse-divulgacandcontas`, `tse-portal`) porque os três exigem
transportes diferentes (Playwright, HTTP simples, humano).

## 4. O que é um Recurso

Um **recurso** é uma **unidade coletável** dentro de uma fonte: o que se busca,
para quê, por qual chamada, com qual recorte temporal e sob quais restrições.

```
IBGE SIDRA
├── população municipal        (USADO)
├── PIB municipal              (USADO)
├── PIB per capita (593)       (NÃO USADO — retorna HTTP 500)
└── Censo 2022 / CEMPRE        (FUTURO)
```

Um recurso é delimitado por **uma forma de coleta com parâmetros declarados**.
Não por um endpoint literal: `/6579/periodos/{ano}/...` e
`/5938/periodos/{ano}/...` são dois recursos porque respondem a perguntas
diferentes, ainda que a mecânica seja a mesma.

Um recurso **não** é:
- uma linha de dado coletado;
- um passo de transformação (`PIB per capita = PIB × 1000 ÷ população` é CÁLCULO);
- um recorte de um recurso maior.

> ⚠️ O recorte fino dos recursos é uma **decisão ainda pendente** (§11.1). O
> exemplo acima trata "população" e "PIB" como recursos distintos; a alternativa
> seria um único recurso "agregado SIDRA" parametrizado por tabela/variável.

## 5. Estrutura proposta

**Um único arquivo, com um registro por fonte.** Não um arquivo por endpoint —
isso fragmentaria 20+ recursos em 20+ arquivos para um catálogo que cabe em
algumas centenas de linhas.

```
scripts/fontes/
├── catalogo.ts          ← o catálogo: FONTES[] (fonte única de verdade)
└── tipos.ts             ← os tipos Fonte / Recurso / status (§6), sem lógica
```

Por que ficar em `scripts/fontes/` e não em `packages/contracts/`:
`packages/contracts/README.md` diz explicitamente para **não** colocar contratos
lá antes de haver consumo pelos dois apps. O catálogo é consumido só pelo
coletor (que vive em `scripts/`), então `packages/` seria premature.

Por que **TypeScript tipado e não JSON/YAML**: o projeto já é TS puro, sem
dependência de parser de YAML, e os tipos dão autocomplete e erro de compilação
quando um campo obrigatório falta. Justamente a "integridade" pedida como
primeira prioridade.

O formato interno usa `recurso.parametros` para o que varia por execução, e
`recurso.peculiaridades` só para o que é declarativo e verificável — não para
receitas de execução.

## 6. Campos necessários

Campos derivados da auditoria: cada um existe porque um caso real do projeto
precisa dele. Nada foi incluído "por completude".

### Fonte

| Campo | Obrigatório | Por quê (caso real) |
|---|---|---|
| `id` | sim | chave estável, usada pelo coletor e nos caminhos de RAW |
| `nome` | sim | rótulo legível ("IBGE SIDRA") |
| `orgao` | sim | atribuição; hoje aparece solto em cada `metadata.json` |
| `tipo` | sim | `api-rest` · `api-sql` · `arquivo-zip` · `portal` |
| `baseUrl` | sim | hoje repetida como constante em 12 adapters |
| `documentacao` | sim | URL da doc/swagger; hoje só em comentário de código |
| `credencial` | não | declara **qual** variável de `.env` (não o valor) |
| `papel` | sim | `primaria` · `fallback` · `somente-foto` · `somente-documentacao` · `futura` |
| `recursos` | sim | lista; uma fonte sem recurso não é coletável |

### Recurso

| Campo | Obrigatório | Por quê (caso real) |
|---|---|---|
| `id` | sim | chave estável dentro da fonte |
| `finalidade` | sim | para que serve, em uma frase — evita recurso "órfão" |
| `status` | sim | `usado` · `nao-usado` · `futuro` (substitui a separação USADO/DOCUMENTADO/FUTURO da auditoria) |
| `transporte` | sim | `http-json` · `http-geojson` · `bigquery-sql` · `browser-download` · `manual` |
| `metodo` | não | `GET` (padrão) · `POST` (BigQuery) |
| `caminho` | sim | path ou template, ex. `/dca`, `/{tabela}/{ano}.zip` |
| `parametros` | não | descreve o que varia: nome, tipo, obrigatoriedade, exemplo |
| `formato` | sim | `json` · `json-envelope` · `geojson` · `zip-csv` · `imagem` |
| `periodicidade` | sim | `anual` · `mensal` · `eventual` · `unica-vigente` |
| `recorteTemporal` | não | ano/exercício/mês; **e se o recurso é histórico ou um retrato** |
| `identificadores` | sim | o que a fonte usa para nomear as coisas |
| `paginacao` | sim | `nenhuma` · `pagina-numerada` · `link-next` · `envelope-offset` |
| `rateLimit` | sim | `desconhecido` ou a restrição declarada |
| `peculiaridades` | não | lista de fatos declarativos que o coletor deve respeitar |
| `fonteDeIdentidade` | não | se o recurso serve para montar um DE-PARA |
| `salvoHojeEm` | não | onde o pipeline atual grava — ponte para a migração |
| `observacoes` | não | divergências conhecidas (ex.: doc de 6 vs 7 dígitos) |

### Vocabulários fechados (poucos e curtos)

- `tipo`: `api-rest` · `api-sql` · `arquivo-zip` · `portal`
- `transporte`: `http-json` · `http-geojson` · `bigquery-sql` · `browser-download` · `manual`
- `status`: `usado` · `nao-usado` · `futuro`
- `paginacao`: `nenhuma` · `pagina-numerada` · `link-next` · `envelope-offset`
- `periodicidade`: `anual` · `mensal` · `eventual` · `unica-vigente`

Campos de **execução** (timeout, retry, `maxPaginas`, delay entre chamadas,
concorrência) **não entram na Caixa 1**: são política do coletor, iguais para
todos os recursos. A Caixa 1 declara apenas a *restrição* (`rateLimit`), não a
*espera*.

## 7. Relação entre Fonte, Recurso e Coletor

O contrato é de mão única, sem código ainda:

**Caixa 1 informa ao coletor:**

| Informação | Uso pelo coletor |
|---|---|
| `fonte.id` + `recurso.id` | identificar a coleta e nomear o RAW |
| `baseUrl` + `caminho` + `metodo` | montar a requisição |
| `parametros` (com valores) | substituir ano, UF, ente, legislatura |
| `credencial` | saber **qual** variável de `.env` ler (e falhar cedo se faltar) |
| `transporte` | escolher `fetch` / BigQuery / Playwright / nenhum |
| `paginacao` | saber quando parar |
| `rateLimit` | decidir concorrência e pausa |
| `formato` | saber o que foi recebido, para a ORGANIZAÇÃO |
| `peculiaridades` | respeitar restrições específicas |

**O coletor devolve ao RAW:**

| Informação | Por quê |
|---|---|
| `fonteId` + `recursoId` | rastreabilidade: de qual declaração isto veio |
| URL final resolvida (com query) | prova do que foi pedido |
| status HTTP e headers relevantes (`ETag`, `Last-Modified`, `Retry-After`) | diagnóstico e revalidação |
| instante da coleta (ISO 8601) | ausente hoje em todo o projeto |
| bytes originais, sem reescrita | é o objeto da preservação |
| hash do conteúdo (ex.: `sha256`) | prova de integridade |
| resultado da coleta | distingue **sucesso**, **sem-dado** e **falha** — hoje indistinguíveis |
| transporte e parâmetros usados | saber se veio de Playwright, de fallback ou de download manual |

O RAW **não** recebe: dados interpretados, nomes de campo normalizados nem
valores convertidos. Ele guarda bytes + procedência.

**Ponto de atenção:** os identificadores da Caixa 1 (§6 `identificadores`)
**não** são DE-PARA. A Caixa 1 diz "o TSE usa código de 5 dígitos e o IBGE usa
7". Construir e manter a tabela de correspondência é RELACIONAMENTOS.

## 8. Casos especiais encontrados no projeto

A estrutura de §6 representa todos estes casos **sem código novo**:

| Caso real | Como fica representado |
|---|---|
| TSE exige Playwright (WAF Akamai, HTTP 403) | `transporte: browser-download` + peculiaridade `exige navegador real (headful)` |
| Coleta não é automatizável | `transporte: manual` + `status: usado` (o humano baixa; o RAW recebe o arquivo) |
| SICONFI com rate limit forte | `rateLimit: { nivel: 'critico', concorrenciaMaxima: 2 }` |
| Portal da Transparência com API key | `fonte.credencial: { env: 'PORTAL_API_KEY', header: 'chave-api-dados' }` |
| API com paginação | `paginacao: pagina-numerada` (Portal) · `link-next` (Câmara, Brasil.io) · `envelope-offset` (Siconfi) |
| Endpoint sem paginação | `paginacao: nenhuma` (IBGE Malhas, SIDRA) |
| Download de ZIP | `transporte: http-json`? não — `formato: zip-csv` com `caminho` `.zip` |
| Arquivo CSV | `formato: zip-csv` + peculiaridade `separador ';', encoding latin1` |
| Recurso com histórico por ano | `recorteTemporal: { tipo: 'ano', historico: true }` (SIDRA, Siconfi DCA) |
| Recurso que é um retrato | `recorteTemporal: { tipo: 'vigente', historico: false }` (IBGE Malhas) |
| Fonte fallback | `fonte.papel: fallback` (Brasil.io, Base dos Dados) |
| Endpoint implementado e não chamado | `recurso.status: nao-usado` (`/rreo`, `GET /deputados/{id}`, DivulgaCandContas REST) |
| Recurso que só serve imagem | `transporte: http-json` + `formato: imagem` + `papel: somente-foto` |
| Parâmetro que muda por execução | `parametros` com `exemplo` e `obrigatorio` |
| Recursos com mecânica igual e recorte diferente | recursos distintos na mesma fonte (SIDRA população × PIB) |

## 9. Fontes atuais e como seriam representadas

Papéis: **P** = primária · **F** = fallback · **FOTO** = somente foto ·
**DOC** = somente documentação · **FUT** = futura.

| Fonte (id) | Órgão | Papel | Transporte | Recursos |
|---|---|---|---|---|
| `ibge-malhas` | IBGE | P | `http-geojson` | malha de UFs; malha municipal por UF |
| `ibge-localidades` | IBGE | P | `http-json` | UFs; municípios por UF; município por código |
| `ibge-sidra` | IBGE | P | `http-json` | população (6579/9324); PIB (5938/37); PIB per capita (593 — não usado) |
| `siconfi` | Tesouro Nacional | P | `http-json` | DCA (usado); RREO (não usado); RGF, entes, extrato de entregas (futuros) |
| `tse-cdn` | TSE | P | `browser-download` | `consulta_cand`; `votacao_candidato_munzona` |
| `tse-divulgacandcontas` | TSE | FOTO (rest já DOC) | `http-json` | foto oficial (usado); eleitos por UE (não usado) |
| `tse-portal` | TSE | DOC | `manual` | datasets por ano; municípios (insumo do DE-PARA) |
| `camara` | Câmara dos Deputados | P | `http-json` | deputados; partidos; despesas CEAP; detalhe do deputado (não usado) |
| `portal-transparencia` | CGU | P | `http-json` | despesas por órgão; emendas; programa social por município; órgãos SIAFI/SIAPE |
| `brasilio` | Brasil.io | F | `http-json` | candidaturas (usado); votações, bens, filiados (futuros) |
| `basedosdados` | Base dos Dados | F | `bigquery-sql` | população municipal; PIB municipal |
| `bcb` | Banco Central | FUT | — | SGS (futuro) |

Não representadas como fonte nesta etapa (futuras, citadas apenas como
possibilidade em `docs/APIS.md` §13): INEP, DATASUS, SNIS, Atlas Brasil,
IPEAdata, INMET, Compras.gov, `filiaweb.tse.jus.br`. O catálogo deve ter lugar
para elas, mas **nenhuma entra com recurso usado**.

Observações de representação que o catálogo precisa capturar:

- **TSE é três fontes, não uma** — o transporte difere (navegador, HTTP, humano).
- **Brasil.io grava hoje nos mesmos arquivos do TSE** — o catálogo marca
  `papel: fallback`, e é a ORGANIZAÇÃO/PUBLICAÇÃO que precisa distinguir a origem.
- **O `ID_ELEICAO` do TSE está duplicado** em `apps/web/.../electionsApi.ts` e
  `apps/api/.../foto-candidato.ts`. O catálogo teria o lugar natural para ele.
- **Base dos Dados rejeita qualquer domínio que não seja `indicadores`** — no
  catálogo, isso é simplesmente a lista de recursos que ela declara ter.

## 10. O que não pertence à Caixa 1

A Caixa 1 **descreve a fonte**. Fica explicitamente de fora:

- **dados coletados** e qualquer resposta RAW;
- **indicadores calculados** (PIB per capita, densidade, % do total) — é CÁLCULOS;
- **joins e DE-PARA** (a tabela `de-para-tse-ibge.json` e suas 8 exceções) — é RELACIONAMENTOS;
- **dados de pessoas** (nomes de mandatários, partidos, fotos como conteúdo) — é dado, não fonte;
- **armazenamento histórico** e política de retenção — é RAW;
- **transformação e normalização** (converter latin1, tratar `-`/`...`/`X` como nulo) — é ORGANIZAÇÃO;
- **valores de credencial** — a Caixa 1 declara *qual* variável de `.env`, nunca o valor;
- **regras de apresentação do frontend** (cores, faixas, tooltip, fallback de iniciais);
- **lógica de negócio** (o que o painel mostra, cobertura mínima, ranking);
- **política de execução** (timeout, retry, concorrência, ordem do pipeline);
- **caminhos de saída dos datasets publicados** (`data/*/…json`) — pertence a PUBLICAÇÃO;
- **contagens e totais publicados** (`"municipios": 5558`).

Regra de desempate: se o campo descreve **o que a fonte oferece e sob quais
restrições**, é Caixa 1. Se descreve **o que fazemos com isso**, não é.

## 11. Decisões ainda pendentes

1. **Granularidade do recurso.** "população" e "PIB" do SIDRA como dois recursos,
   ou um recurso "agregado SIDRA" parametrizado por tabela/variável? A primeira
   é mais explícita e legível; a segunda é mais curta. **Recomendação:** recursos
   distintos — são 4 chamadas com parâmetros diferentes e propósitos diferentes.
2. **Formato do catálogo.** TS tipado em `scripts/fontes/catalogo.ts`
   (**recomendado**, por integridade e zero dependência nova) versus JSON puro
   (inspecionável por qualquer linguagem, mas sem verificação em compile time).
3. **Onde vive a Caixa 1.** `scripts/fontes/` (**recomendado**, perto do
   consumidor) versus `packages/contracts/` (contraria o README do pacote hoje).
4. **Recursos por ente são um ou N?** O Siconfi DCA é chamado uma vez por
   município (até 5.570 chamadas). É **um recurso** com parâmetro `id_ente`
   (**recomendação**), não 5.570 recursos.
5. **Onde declara o fan-out de entes.** A lista de municípios vem hoje do IBGE
   Localidades e de `data/indicators/pontos.json`. Isso é insumo de execução do
   coletor, ou um parâmetro de recurso? **Recomendação:** parâmetro, com a
   origem da lista explicitada.
6. **Onde mora `ID_ELEICAO`** (TSE): no catálogo da fonte
   (**recomendação**) ou continua duplicado no frontend e na API.
7. **`salvoHojeEm` fica no catálogo?** É informação de migração, não de fonte.
   **Recomendação:** manter temporariamente, marcado como transitório.
8. **Fonte `tse-portal` entra agora?** É `manual` e não usada por nenhum código.
   **Recomendação:** entra como `somente-documentacao`, para que o insumo do
   DE-PARA tenha procedência declarada.
9. **Como marcar recurso que retorna HTTP 500** (SIDRA variável 593):
   `status: nao-usado` + peculiaridade, ou um status próprio `indisponivel`?
   **Recomendação:** `nao-usado` com observação — não criar status novo para um caso.
10. **Idioma dos identificadores.** `fonteId`/`recursoId` em português
    (coerente com o resto do código) versus inglês. **Recomendação:** português,
    como todo o domínio do projeto.
11. **Quem decide "coleta bem-sucedida".** Definir no contrato do coletor (§7) o
    que é sucesso, sem-dado e falha — hoje cada adapter decide sozinho.
12. **Licença/atribuição por fonte.** `docs/data-sources/README.md` exige o
    campo; hoje nenhuma fonte o tem. Incluir em `fonte` ou manter só em docs?

## 12. Resumo para a próxima etapa

A Caixa 1 é um **catálogo declarativo** de fontes e recursos, em um único
arquivo tipado, sob `scripts/fontes/`. Ele responde "de onde vem, como se
obtém, com que restrição, com que recorte" e **não executa nada**.

A fronteira fica assim:

- **FONTES** declara → **COLETOR** executa e escolhe o transporte →
  **RAW** guarda bytes + procedência (URL final, instante, hash, headers,
  resultado). Interpretar é da ORGANIZAÇÃO; cruzar é de RELACIONAMENTOS;
  calcular é de CÁLCULOS.

Ganhos diretos esperados quando o coletor for construído:

- fim das constantes de URL espalhadas por 8 adapters;
- um só lugar para declarar rate limit, autenticação e peculiaridades;
- adicionar a Câmara ou o Portal da Transparência deixa de exigir editar
  vários scripts;
- distinção explícita entre primário, fallback, somente-foto e não-usado —
  que hoje só existe em prosa na documentação;
- base pronta para o RAW registrar instante de coleta e hash, hoje ausentes.

**Antes de implementar, resolver as pendências de §11** — em especial a
granularidade do recurso (11.1) e o formato do catálogo (11.2), porque as duas
determinam o tamanho e a forma de tudo o que vier depois.

**Fora de escopo, para as próximas etapas:** o coletor, o formato do RAW, a
política de retenção histórica, o DE-PARA e a unificação do acesso HTTP
(`http-client.ts` já existe e deve ser reaproveitado, não reescrito).
