# Estado da Arquitetura — Caixas 1 a 5

> **Checkpoint de arquitetura.** Documento de referência para economizar contexto:
> descreve as regras de negócio, as analogias e as responsabilidades de cada caixa
> já implementada, para que o trabalho continue sem precisar reler o código.
>
> Atualizado após a conclusão da Caixa 5. Caixas 6 e 7 ainda não existem.

## Visão geral — pipeline *archive-first*

```
FONTES → COLETOR EXTERNO → RAW → ORGANIZAÇÃO → RELACIONAMENTOS → CÁLCULOS → PUBLICAÇÃO
Caixa 1     Caixa 2      Caixa 3   Caixa 4        Caixa 5        Caixa 6     Caixa 7
                        (+ Orquestrador entre 1 e 3)
                            ✅            ✅             ✅            ⬜          ⬜
```

**O princípio central é "archive-first":** guardar o dado público original intacto
antes de transformá-lo. A razão é prática — se a regra de negócio mudar (e ela
muda), o dado original permite reprocessar tudo sem recoletar. Sem RAW, uma
correção exige nova ida à fonte, que pode estar fora do ar, ter mudado de layout
ou simplesmente não ter mais o histórico.

**A regra de ouro que separa as caixas:** cada caixa só pode responder à sua
própria pergunta. Se uma decisão exige **conhecer o significado** do dado, ela
pertence a uma caixa posterior. Se exige apenas **mover, interpretar ou cruzar**
o que já está lá, pertence à caixa atual.

### Estado das implementações

| Caixa | Diretório | Arquivos | Testes | Saída |
|---|---|---|---|---|
| 1 — Fontes | `scripts/fontes/` | 2 | — (validado em runtime) | catálogo em memória |
| 2 — Coletor | `scripts/coletor/` | 6 | 37 | bytes + procedência |
| 3 — RAW | `scripts/raw/` | 6 | 27 | `data/raw/` (66 MB) |
| Orquestrador | `scripts/orquestrador/` | 2 | — | dispara 1→2→3 |
| 4 — Organização | `scripts/organizacao/` | 6 | 44 | `data/organized/` (262 MB) |
| 5 — Relacionamentos | `scripts/relacionamentos/` | 6 | 27 | `data/related/` (1,5 MB) |

**Total: 135 testes, 0 falhas.** Comandos: `coletar`, `organizar`, `relacionar`
e `test:coletor`, `test:raw`, `test:organizacao`, `test:relacionamentos`.

---

## Caixa 1 — FONTES (o Catálogo)

**Analogia:** a lista telefônica oficial. Diz de quem é cada número e qual o
horário permitido para ligar — mas não liga para ninguém.

**Onde:** `scripts/fontes/tipos.ts` e `scripts/fontes/catalogo.ts`.

**Responsabilidade:** descrever **de onde** o dado vem, **como** se coleta e
**quais restrições** existem. É um catálogo estritamente declarativo.

**Conceitos:**
- **Fonte** = provedor/órgão (`ibge-sidra`, `tse`, `siconfi`). Carrega órgão,
  URL base, documentação, credencial e papel.
- **Recurso** = operação coletável dentro da fonte. **Não** é uma linha de dado
  nem um recorte — é a operação. `siconfi/dca` é **um** recurso, mesmo gerando
  5.570 chamadas.
- **Fan-out** = os parâmetros que geram N chamadas (`dimensao: 'ente'`).

**Regras que a Caixa 1 impõe:**
1. **Nada de política de execução.** Sem timeout, retry, delay ou concorrência —
   isso é decisão do coletor. A Caixa 1 declara a *restrição real*
   ("≈90 requisições/minuto"); o coletor decide *como obedecê-la*.
2. **`urlBaseEfetiva(fonte, recurso)`**, nunca `fonte.baseUrl` direto — o TSE
   serve 3 recursos em 3 hosts diferentes.
3. **Credencial é só o nome da variável** (`PORTAL_API_KEY`), nunca o valor.
4. **9 fontes, 25 recursos** (20 usados). `status: 'nao-usado'` marca o que existe
   mas o projeto não exercita.

---

## Caixa 2 — COLETOR EXTERNO (o Motoboy)

**Analogia:** o entregador. Recebe o endereço, vai buscar o pacote e traz **sem
abrir**. Não importa o que tem dentro — se é bolo ou tijolo, ele só entrega.

**Onde:** `scripts/coletor/`. Porta pública: `coletar()` e `coletarRecurso()`.

**Responsabilidade:** executar a coleta e devolver **bytes + procedência**.

**As quatro decisões que definem esta caixa:**

1. **Bytes antes do parse.** O corpo é lido com `arrayBuffer()` **antes** de
   qualquer interpretação. O legado fazia `res.json()` primeiro e descartava o
   original — a resposta crua era irrecuperável. Aqui `json()` nunca acontece:
   interpretar é da ORGANIZAÇÃO.

2. **Tri-estado explícito.** `sucesso` / `sem-dado` / `falha`.
   **Regra dura: `sem-dado` nunca é `falha`.** No legado, "o município não tem
   programa social" e "a requisição caiu" produziam o mesmo `null`.

3. **Política central única** (`politicas.ts`), derivada de `recurso.rateLimit`:
   `critico` → concorrência 2 + pausa 300 ms + retry 4. Antes esses valores
   estavam repetidos literalmente em ~30 call sites.

4. **Paginação completa** — as 4 estratégias, incluindo `envelope-offset`
   (`hasMore`/`offset`), que o legado ignorava e truncava o Siconfi em silêncio.
   Estourar o limite de páginas é **`falha`**, não sucesso parcial.

**Transportes:** `http-json`, `http-geojson`, `bigquery-sql`,
`browser-download` (Playwright headful para o WAF do TSE) e `manual`
(primeira classe — reporta intervenção humana, não tenta rede).

---

## Caixa 3 — RAW (o Almoxarifado)

**Analogia:** o almoxarifado com protocolo. Cada pacote recebe um número de
registro (o hash), uma ficha de origem, e **nunca** é alterado depois de
arquivado. Entregar o mesmo pacote duas vezes não duplica o estoque.

**Onde:** `scripts/raw/`. Porta pública: `persistirColeta()`.

```
data/raw/<fonteId>/<recursoId>/
├── objetos/<sha256>.<ext>    ← conteúdo endereçado por hash
├── manifest.json             ← índice append-only
└── tentativas.jsonl          ← log append-only de TODA coleta
```

**As regras de negócio:**

1. **Nome do arquivo = hash do conteúdo.** Isso dá imutabilidade *estrutural*:
   conteúdo diferente nunca colide, o mesmo conteúdo nunca ocupa dois arquivos.
2. **Deduplicação que preserva histórico.** Se o hash já existe, **nada é
   gravado** — mas a **tentativa é registrada mesmo assim**. Disco economizado,
   histórico de execução preservado. Recoletar o IBGE 10 vezes = 1 objeto e 10
   tentativas.
3. **Gravação atômica.** Escreve `.tmp` e renomeia. Um processo interrompido
   nunca deixa objeto parcial com nome de hash válido.
4. **Imutabilidade.** Objeto existente nunca é sobrescrito nem removido.
5. **Manifesto append-only.** `objetos` só cresce — sem isso não há auditoria.
6. **Só `sucesso` grava bytes.** `sem-dado` e `falha` apenas registram tentativa.
7. **Paginação:** cada página é **um objeto separado**. Nunca concatena.
8. **A caixa é cega.** Nenhum `JSON.parse` no conteúdo coletado — só no manifesto
   que ela mesma escreveu.

---

## Orquestrador (o Despachante)

**Analogia:** o despachante de uma central de entregas. Lê a lista de serviços do
catálogo, monta as rotas e despacha — mas **não inventa endereço**.

**Onde:** `scripts/orquestrador/`. Comando: `npm run coletar`.

**Responsabilidade:** ligar Caixas 1 → 2 → 3, resolvendo fan-out e respeitando
concorrência.

**Regras:**

1. **Seleção:** `--tudo`, `--fonte`, `--recurso`. Ignora `status: 'nao-usado'`.
2. **Concorrência controlada:** fila em lotes de `concorrenciaPara(recurso)`, com
   pausa da política. Nunca dispara 5.570 promessas de uma vez.
3. **Nunca inventa parâmetro (fail-fast).** Dimensão sem valor resolvível →
   **erro explícito**, não coleta vazia em silêncio.
4. **Tolerância zero a inventar domínio temporal.** Não existe lista genérica de
   anos. O default vem do `exemplo` declarado na Caixa 1, **por recurso**
   (TSE→2024, Siconfi→2023). Para varrer vários anos: `--anos` explícito.
   *Motivo:* uma lista genérica fez o orquestrador pedir `consulta_cand_2023.zip`
   → **404**, porque 2023 não teve eleição.

**Precedência de parâmetros:** `--param` > `--anos` > cache em
`data/raw/_parametros/` > tabela estática (`uf`) > `exemplo` da Caixa 1 >
bootstrap transitório do legado.

---

## Caixa 4 — ORGANIZAÇÃO (o Fiscal Tradutor)

**Analogia:** o tradutor juramentado. Lê o documento estrangeiro, traduz para o
idioma da casa e **recusa o documento** se o layout mudou — em vez de traduzir
errado e deixar passar.

**Onde:** `scripts/organizacao/`. Comando: `npm run organizar`.

```
data/organized/<fonteId>/<recursoId>.jsonl     ← registros limpos
data/organized/<fonteId>/<recursoId>.meta.json ← contagens e versão do esquema
data/organized/<fonteId>/<recursoId>.quarentena.jsonl
```

**Responsabilidade:** interpretar, validar, tipar e renomear — **linha a linha**.
Não cruza fontes (Caixa 5) nem calcula (Caixa 6).

**As regras de negócio:**

1. **Leitura em stream (anti-OOM).** O maior CSV do TSE tem **234 MB**
   comprimido → **936 MB** descompactado. O legado materializava ~1,4 GB
   (`getData().toString()` + `split()`). Aqui: `node:readline` + decodificação
   incremental. **Pico medido: 69 MB** processando 463.859 candidatos.
2. **Descarte de colunas inúteis.** O CSV do TSE tem 50+ colunas; mapeamos 23.
3. **JSONL incremental.** Um registro por linha, `appendFile`, memória O(1) no
   número de linhas (5.571 linhas = 0,4 MB de heap).
4. **Quarentena com botão de pânico.** Valor sujo vai para `*.quarentena.jsonl`
   com motivo e registro bruto. **Se passar de 1%, ABORTA tudo.**
5. **Coluna obrigatória ausente ABORTA na primeira linha** — nomeando a coluna.
   *Motivo:* o legado produzia `uf: ''` silenciosamente quando o TSE renomeava
   uma coluna; publicava dado vazio sem alarme.
6. **Nunca produz `NaN`.** Conversão que falha devolve `null` e sinaliza erro.
7. **Tipo `codigo` preserva zeros à esquerda** (`11` → `"11"`, não `11`).
8. **Mitigação 3a no ZIP:** ignora o `_BRASIL.csv` (234 MB) e lê por UF (máx.
   39 MB). O consolidado é a soma das UFs — processá-lo duplicaria registros.

---

## Caixa 5 — RELACIONAMENTOS (o Casamenteiro)

**Analogia:** o casamenteiro que resolve homônimos. Sabe que o "João Silva" da
ficha A é o mesmo da ficha B, mas **não força o casamento** quando há dúvida —
coloca na lista de pendências para um humano decidir.

**Onde:** `scripts/relacionamentos/`. Comando: `npm run relacionar`.

```
data/related/
├── municipio.jsonl              ← ponte canônica (chave: codarea IBGE 7 dígitos)
├── orfaos.jsonl                 ← entidades sem par, classificadas
└── relacionamentos.meta.json
```

**Responsabilidade:** descobrir quando entidades de fontes diferentes são a
**mesma coisa** e registrar o vínculo. Não calcula nem agrega.

**Achado que simplifica tudo:** das 5 fontes, **apenas o TSE precisa de DE-PARA**.
Siconfi, Transparência e Base dos Dados já emitem `codarea` nativamente.

**As regras de negócio:**

1. **Tabela-ponte canônica**, com `codarea` (7 dígitos) como chave mestra.
   Enriquece 463.859 candidatos com **um** campo sem reescrever 262 MB.
2. **`Map` para reduzir memória.** O JSONL do TSE tem 463.859 linhas mas só
   **5.569 unidades eleitorais distintas**. Reduzir antes de cruzar:
   **pico de 24,6 MB**.
3. **Máquina de lavar palavras** (`normalizarNome()`, função única): minúsculas,
   sem acentos, apóstrofo/hífen → espaço, remove artigos **e o `d` solto**
   (`D'Oeste` → `oeste`). Restrita à **mesma UF** — "Bom Jesus" existe em várias.
4. **`metodoMatch` em toda linha:** `codigo-nativo` / `nome-exato` /
   `excecao-auditada`. É o que distingue vínculo por código idêntico
   (confiança alta) de nome aproximado (revisa).
5. **Exceções auditadas em DADOS, não em código.** 7 divergências históricas,
   cada uma com **motivo obrigatório**. Exceção sem justificativa é dívida.
6. **Isolamento de órfãos legítimos.** `ausente-na-fonte` (Fernando de Noronha,
   Brasília — não têm eleição municipal) **não conta** para o limiar.
   `nao-correspondido` e `ambiguo` exigem revisão.
7. **Nunca escolhe sozinho em ambiguidade** — ligar o município errado colocaria
   um prefeito na cidade errada.
8. **Limiar de 1%** de órfãos a corrigir aborta a construção.

**Resultado atual:** 5.569/5.569 unidades do TSE vinculadas (100%), 2 órfãos
legítimos, 0 a corrigir. **O match exato chegou a 99,87% — fuzzy não é necessário.**

---

## Como estender

| Para adicionar… | Onde mexer |
|---|---|
| Nova fonte | `scripts/fontes/catalogo.ts` (Caixa 1) |
| Novo tradutor | `scripts/organizacao/tradutores/<fonte>.ts` + `indice.ts` |
| Nova estratégia de match | `scripts/relacionamentos/estrategias/` |
| Nova exceção de nome | `scripts/relacionamentos/estrategias/excecoes.ts` (dados) |
| Nova dimensão de fan-out | cache em `data/raw/_parametros/<dim>.json` |

## Política de versionamento no git

| Dado | Versionado? | Motivo |
|---|---|---|
| `data/raw/**/objetos/*` | ❌ | binário volumoso e reprodutível |
| `data/raw/**/manifest.json`, `tentativas.jsonl` | ✅ | procedência pequena e insubstituível |
| `data/organized/**/*.jsonl` | ❌ | derivado, reproduzível do RAW |
| `data/organized/**/*.meta.json` | ✅ | contagens e esquema |
| `data/related/**/*.jsonl` | ❌ | derivado |
| `data/related/**/*.meta.json` | ✅ | contagens e hashes de origem |

**O padrão:** o volume derivado fica fora; a **procedência** fica dentro.
