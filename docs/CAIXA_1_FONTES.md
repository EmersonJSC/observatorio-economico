# Caixa 1 — Fontes

> Documento de arquitetura. Explica o que é a Caixa 1, como ela se separa do
> COLETOR e do RAW, e as regras para estendê-la.
> Contexto detalhado: `docs/AUDITORIA_CAIXA_1_FONTES.md` (levantamento) e
> `docs/PLANO_CAIXA_1_FONTES.md` (desenho).

## O que é a Caixa 1

A Caixa 1 é o **catálogo declarativo das fontes externas** do Observatório.
Ela responde quatro perguntas:

- de onde vem o dado;
- qual recurso pode ser coletado;
- como esse recurso é acessado;
- quais restrições externas existem.

Ela **não** executa requisições, não baixa arquivos, não interpreta respostas,
não transforma dados, não cria relacionamentos, não calcula indicadores, não
grava RAW e não altera o frontend.

O pipeline conceitual:

```
FONTES → COLETOR EXTERNO → RAW → ORGANIZAÇÃO → RELACIONAMENTOS → CÁLCULOS → PUBLICAÇÃO
   ↑
 esta etapa
```

## Fonte ≠ Recurso ≠ Endpoint

```
FONTE     "TSE"                       provedor/órgão + seus recursos
RECURSO   "CDN de dados abertos"      unidade coletável dentro da fonte
ENDPOINT  "GET /estatistica/.../x.zip"  a chamada concreta
```

- **Fonte** é o provedor. Carrega o que é comum a todos os recursos: órgão,
  URL base, documentação, credencial, papel.
- **Recurso** é a **operação coletável**, delimitada por uma forma de coleta com
  parâmetros declarados. Não é uma linha de dado nem um recorte.
- **Endpoint** é detalhe do recurso (`caminho` + `metodo`).

**Diferença de transporte NÃO cria uma fonte nova.** O TSE é **uma única fonte**
com recursos de transportes diferentes: o CDN exige navegador real
(`browser-download`), o DivulgaCandContas é HTTP simples (`http-json`) e o portal
é download humano (`manual`).

## Recurso ≠ Fan-out

O recurso representa a **operação**; os parâmetros representam o **fan-out**.

```
SICONFI
└── recurso: dca                 ← UM recurso
    └── parâmetro: id_ente        ← o fan-out são os ~5.570 entes
```

**Errado:** criar `DCA-RO-001`, `DCA-RO-002`, `DCA-MG-001`… como recursos.

O mesmo vale para o IBGE SIDRA (um recurso por indicador, parametrizado por ano
e território), a Câmara (um recurso de despesas, parametrizado por deputado) e o
Portal da Transparência (um recurso por município, parametrizado por código IBGE
e mês).

## Fonte ≠ Coletor ≠ RAW

| | Papel | Exemplo |
|---|---|---|
| **FONTES** (Caixa 1) | declara | "este recurso pode ser coletado desta maneira, com até ~90 req/min" |
| **COLETOR** | executa | "vou usar uma estratégia que não ultrapasse isso" |
| **RAW** | preserva | "esta foi a resposta obtida, neste instante, com este hash" |

A Caixa 1 declara a **restrição real**; o coletor decide **como obedecê-la**.
Por isso o catálogo **não** contém timeout, retries, delays fixos, concorrência,
ordem de execução nem backoff — isso é política do coletor.

O RAW recebe **bytes + procedência** (URL final, instante da coleta, hash,
headers relevantes, resultado). Interpretar a resposta é da ORGANIZAÇÃO.

## Onde está o catálogo

```
scripts/fontes/
├── tipos.ts      tipos Fonte / Recurso e vocabulários fechados
└── catalogo.ts   o catálogo + acesso + validação
```

Fica em `scripts/` (perto do consumidor, o futuro coletor) e **não** em
`packages/contracts/`, porque aquele pacote não deve receber contratos antes de
haver consumo pelos dois apps — regra do próprio `packages/contracts/README.md`.

É TypeScript tipado, e não JSON/YAML, para que um campo obrigatório ausente
quebre a compilação em vez de passar silenciosamente.

### API de acesso

```ts
import { FONTES, buscarFonte, buscarRecurso, recursosUsados, urlBaseEfetiva, validarCatalogo } from './scripts/fontes/catalogo.js'

buscarFonte('tse')                       // Fonte | undefined
buscarRecurso('siconfi', 'dca')          // Recurso | undefined
recursosUsados()                          // recursos com status 'usado'
urlBaseEfetiva(fonte, recurso)            // URL base do recurso (ver abaixo)
validarCatalogo()                         // string[] — vazio quando íntegro
```

### URL base: fonte define o padrão, recurso pode sobrescrever

`Fonte.baseUrl` é a URL base **padrão** dos seus recursos. Um recurso pode
declarar a **sua própria** `baseUrl`, que tem precedência.

Isso existe porque um mesmo provedor pode servir recursos em hosts diferentes.
O TSE é o caso real:

| Recurso | Host |
|---|---|
| `tse/cdn-dados-abertos` | `https://cdn.tse.jus.br` |
| `tse/divulgacandcontas-eleitos` | `https://divulgacandcontas.tse.jus.br` |
| `tse/foto-candidato` | `https://divulgacandcontas.tse.jus.br` |
| `tse/portal-dados-abertos` | `https://dadosabertos.tse.jus.br` (padrão da fonte) |

> **Ao montar uma URL, use `urlBaseEfetiva(fonte, recurso)` — nunca leia
> `fonte.baseUrl` diretamente.** A partir de `baseUrl: 'https://dadosabertos.tse.jus.br'`
> sozinha, 3 das 4 URLs do TSE sairiam erradas.

## Fontes catalogadas

| id | Fonte | Papel | Recursos (usados/total) |
|---|---|---|---|
| `ibge-malhas` | IBGE — Malhas Territoriais | primária | 2/2 |
| `ibge-localidades` | IBGE — Localidades | primária | 2/3 |
| `ibge-sidra` | IBGE — Agregados / SIDRA | primária | 2/2 |
| `siconfi` | Siconfi — Tesouro Nacional | primária | 1/2 |
| `tse` | TSE | primária | 2/4 |
| `camara` | Câmara dos Deputados | primária | 3/4 |
| `portal-transparencia` | Portal da Transparência (CGU) | primária | 5/5 |
| `brasilio` | Brasil.io | **fallback** | 1/1 |
| `basedosdados` | Base dos Dados (BigQuery) | **fallback** | 2/2 |

**9 fontes, 25 recursos** (20 usados, 5 não usados).

Papéis possíveis (`PapelFonte`): `primaria`, `fallback`, `somente-foto`,
`somente-documentacao`.

Status possíveis (`StatusRecurso`): `usado`, `nao-usado`. O status descreve se o
**projeto** já exercita o recurso, não se ele funciona.

### Recursos marcados como não usados

- `ibge-localidades/municipio-por-codigo` — existe no adaptador, nenhum script usa.
- `siconfi/rreo` — documentado, nenhum código consome.
- `tse/divulgacandcontas-eleitos` — implementado no adaptador, nunca chamado pela ingestão.
- `tse/portal-dados-abertos` — entrada manual, nenhum código baixa.
- `camara/deputado-detalhe` — existe no adaptador, a ingestão não invoca.

### Fontes futuras

Banco Central, INEP, DATASUS, SNIS, Atlas Brasil, IPEAdata, INMET, Compras.gov e
`filiaweb.tse.jus.br` **não** estão no catálogo. São possibilidades citadas em
`docs/APIS.md` §13, sem implementação. A estrutura suporta acrescentá-las, mas
elas só entram quando houver informação verificada.

## O que NÃO pertence ao catálogo

- dados coletados e respostas RAW;
- conversão de encoding, parsing, renomeação de campos, tratamento de valores
  especiais (`-`, `...`, `X`);
- joins, DE-PARA e tabelas de correspondência;
- soma de colunas e fórmulas de indicadores (PIB per capita, densidade, % do total);
- dados de pessoas (nomes de mandatários, partidos, fotos como conteúdo);
- armazenamento histórico e política de retenção;
- valores de credenciais — **somente o nome da variável de ambiente**;
- regras de apresentação do frontend;
- lógica de negócio;
- política de execução: timeout, retries, delay fixo, concorrência, ordem, backoff;
- caminhos de publicação dos datasets (`data/*.json`) como definição arquitetural.

**Regra de desempate:** se o campo descreve **o que a fonte oferece e sob quais
restrições**, pertence à Caixa 1. Se descreve **o que fazemos com isso**, não.

> O campo `salvoHojeEm` é a **única** exceção, e é explicitamente **transitório**:
> existe só para orientar a migração para RAW/ORGANIZAÇÃO. Nada deve depender dele.

Peculiaridade é permitida quando é **fato declarativo**. Pode-se registrar
"o CSV usa separador `;` e encoding latin1" — isso descreve a fonte. Não se pode
registrar o código que converte latin1 para UTF-8 — isso é ORGANIZAÇÃO.

## Como adicionar uma nova fonte

1. Confirme que ela é realmente uma **fonte** (provedor), não um recurso de uma
   fonte existente. Se é o mesmo órgão com o mesmo transporte, provavelmente é
   um recurso novo.
2. Consulte a API/documentação real. Não invente campos — o que não for
   verificável fica de fora.
3. Adicione um objeto `Fonte` em `FONTES`, em `scripts/fontes/catalogo.ts`,
   preenchendo `id`, `nome`, `orgao`, `tipo`, `baseUrl`, `documentacao`,
   `credencial` (se houver), `papel` e `recursos`.
4. Se a coleta for manual ou não automatizável, use `transporte: 'manual'` e
   registre o motivo em `peculiaridades`.
5. Em credencial, informe **apenas** `env` (o nome da variável) e onde ela é
   enviada. Nunca o valor.
6. Rode a validação:

```bash
npx tsx -e "import('./scripts/fontes/catalogo.js').then(m => console.log(m.validarCatalogo()))"
```

## Como adicionar um novo recurso

1. Decida a **operação**, não o recorte. Se o que muda são os parâmetros, é o
   mesmo recurso.
2. Preencha, no mínimo: `id`, `finalidade`, `status`, `transporte`, `metodo`,
   `caminho`, `formato`, `periodicidade`, `recorteTemporal`,
   `identificadores`, `paginacao`, `rateLimit`.
3. **URL base:** herde a da fonte por padrão. Declare `baseUrl` no próprio
   recurso **somente** se ele ficar em host diferente do padrão da fonte.
4. **Identificadores:** registre apenas *o que a fonte usa* (`SG_UE`,
   `SQ_CANDIDATO`, `codarea`, `id_ente`…). A correspondência entre identificadores
   de fontes diferentes é RELACIONAMENTOS e não entra aqui.
5. **Rate limit:** descreva a restrição real ("≈90 requisições/minuto"), não a
   estratégia para cumpri-la.
6. **Parâmetros:** marque `dimensao` quando o parâmetro gera fan-out (`ente`,
   `uf`, `ano`, `municipio`). Um parâmetro obrigatório precisa ser resolvível:
   estar no `caminho`, ter `dimensao`, ou ter valor fixo em `valores`.
7. `peculiaridades` só aceita fatos declarativos. Nada de código de parsing.
8. Rode `validarCatalogo()` — ela acusa id duplicado, recurso duplicado, fonte
   sem recurso, recurso sem identificador, recurso sem URL base (nem própria nem
   herdada), `baseUrl` de recurso não absoluta, `baseUrl` em recurso manual e
   parâmetro obrigatório irresolvível.

## Vocabulários fechados

| Campo | Valores |
|---|---|
| `tipo` (fonte) | `api-rest`, `api-sql`, `arquivo-zip`, `portal` |
| `transporte` (recurso) | `http-json`, `http-geojson`, `bigquery-sql`, `browser-download`, `manual` |
| `status` (recurso) | `usado`, `nao-usado` |
| `papel` (fonte) | `primaria`, `fallback`, `somente-foto`, `somente-documentacao` |
| `paginacao` | `nenhuma`, `pagina-numerada`, `link-next`, `envelope-offset` |
| `periodicidade` | `anual`, `mensal`, `eventual`, `unica-vigente` |
| `formato` | `json`, `json-envelope`, `geojson`, `zip-csv`, `imagem` |

## ID_ELEICAO do TSE

O mapa de identificador da eleição por ano está hoje **duplicado** em
`apps/web/src/features/elections/electionsApi.ts` e em
`apps/api/src/modules/elections/foto-candidato.ts`.

O catálogo é o lugar natural para centralizá-lo e já o exporta como
`TSE_ID_ELEICAO` em `scripts/fontes/tipos.ts`, usado como metadado declarativo do
recurso `tse/foto-candidato`.

**Nesta etapa o frontend e a API não foram alterados e não consomem esse mapa.**
A unificação é uma mudança futura e fora do escopo da Caixa 1.

## Fora de escopo desta etapa

Não foram criados nem alterados: o coletor externo, a camada RAW, o histórico,
hash, banco de dados, `ingest-all.ts`, os scripts `update-*.ts`, os adapters, o
frontend e a API. Nenhum dado existente foi movido.
