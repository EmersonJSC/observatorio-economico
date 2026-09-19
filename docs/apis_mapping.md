# Mapeamento de APIs Externas — Observatório Econômico

> **Princípio arquitetural:** Nenhuma destas APIs é consultada em runtime pelo servidor Express.
> Todos os adaptadores são executados **exclusivamente pelos scripts de ingestão** em `scripts/`,
> gerando datasets locais em `data/`. O backend serve apenas arquivos do disco.

---

## Sumário

| Fonte | Domínio | Adaptador | Status |
|---|---|---|---|
| IBGE Malhas v3 | Território (GeoJSON) | `scripts/adapters/ibge/ibge-malhas.adapter.ts` | ✅ Funcional |
| IBGE Localidades v1 | Território (nomes oficiais) | `scripts/adapters/ibge/ibge-localidades.adapter.ts` | ✅ Funcional |
| IBGE SIDRA v3 | Indicadores (Pop. + PIB) | `scripts/adapters/ibge/ibge-sidra.adapter.ts` | ✅ Funcional |
| Siconfi / Tesouro Nacional | Finanças Públicas | `scripts/adapters/siconfi/siconfi.adapter.ts` | ✅ Funcional |
| TSE DivulgaCandContas | Eleições / Mandatos | `scripts/adapters/tse/tse.adapter.ts` | ⚠️ Ver notas |

---

## 1. IBGE — API de Malhas Territoriais v3

**URL base:** `https://servicodados.ibge.gov.br/api/v3/malhas`
**Documentação:** https://servicodados.ibge.gov.br/api/docs/malhas?versao=3

### Endpoints Utilizados

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/malhas/paises/BR?formato=application/vnd.geo+json&intrarregiao=UF` | GeoJSON das 27 UFs |
| `GET` | `/malhas/estados/{uf}?formato=application/vnd.geo+json&intrarregiao=municipio` | GeoJSON dos municípios de uma UF |

### Parâmetros Obrigatórios

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `formato` | string | Deve ser `application/vnd.geo+json` para retorno GeoJSON |
| `intrarregiao` | string | `UF` (estados) ou `municipio` (municípios) |

### Características da Resposta

- Cada `Feature` no GeoJSON contém apenas `properties.codarea` (código IBGE numérico)
- **Nomes oficiais não são incluídos** — requer enriquecimento via API de Localidades

### Rate Limit & Estabilidade

- Sem documentação oficial de rate limit
- API estável, mas pode apresentar lentidão (response time: 5–30s por UF grande como SP/MG)
- **Recomendação:** execução sequencial com delay de 800ms entre UFs

### Chave de Junção Territorial

```
GeoJSON.features[].properties.codarea → IBGE código de 2 dígitos (UF) ou 7 dígitos (município)
```

---

## 2. IBGE — API de Localidades v1

**URL base:** `https://servicodados.ibge.gov.br/api/v1/localidades`
**Documentação:** https://servicodados.ibge.gov.br/api/docs/localidades

### Endpoints Utilizados

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/localidades/estados` | Lista de todas as 27 UFs com id, sigla e nome |
| `GET` | `/localidades/estados/{uf}/municipios` | Lista de municípios de uma UF com id e nome |
| `GET` | `/localidades/municipios/{codarea}` | Dados de um município específico |

### Parâmetros Obrigatórios

| Parâmetro | Onde | Tipo | Descrição |
|---|---|---|---|
| `uf` | Path | string | Código IBGE de 2 dígitos da UF |
| `codarea` | Path | string | Código IBGE de 7 dígitos do município |

### Estrutura de Resposta (Estado)

```json
[
  {
    "id": 31,
    "sigla": "MG",
    "nome": "Minas Gerais",
    "regiao": { "id": 3, "sigla": "SE", "nome": "Sudeste" }
  }
]
```

### Rate Limit & Estabilidade

- API leve e estável; não há rate limit documentado
- Tempo de resposta: < 1s para estados, 1–5s para municípios por UF

### Chave de Junção Territorial

```
Localidade.id (number) === GeoJSON.properties.codarea (string) — após String(id)
```

---

## 3. IBGE — API de Agregados (SIDRA) v3

**URL base:** `https://servicodados.ibge.gov.br/api/v3/agregados`
**Documentação:** https://servicodados.ibge.gov.br/api/docs/agregados?versao=3

### Tabelas Utilizadas

| Tabela | Variável | Descrição |
|---|---|---|
| `6579` | `9324` | Estimativa de população residente |
| `5938` | `37` | PIB a preços correntes (em mil R$) |
| `5938` | `593` | PIB per capita (em R$) |

### Endpoints Utilizados

| Nível | Endpoint |
|---|---|
| UFs (N3) e Brasil (N1) | `/agregados/6579/periodos/{ano}/variaveis/9324?localidades=N1[all]\|N3[all]` |
| UFs (N3) — PIB | `/agregados/5938/periodos/{ano}/variaveis/37\|593?localidades=N1[all]\|N3[all]` |
| Municípios (N6) de uma UF | `/agregados/6579/periodos/{ano}/variaveis/9324?localidades=N6[N3[{uf}]]` |
| Municípios (N6) — PIB | `/agregados/5938/periodos/{ano}/variaveis/37\|593?localidades=N6[N3[{uf}]]` |

### Estrutura de Resposta

```json
[
  {
    "id": "9324",
    "variavel": "Pessoas residentes estimadas",
    "unidade": "Pessoas",
    "resultados": [
      {
        "classificacoes": [],
        "series": [
          {
            "localidade": { "id": "3136702", "nome": "São João del-Rei (MG)" },
            "serie": { "2024": "89218" }
          }
        ]
      }
    ]
  }
]
```

### Valores Especiais (Dados Suprimidos)

O IBGE usa os seguintes valores quando dados são indisponíveis ou sigilosos:

| Valor | Significado |
|---|---|
| `"-"` | Dado não disponível |
| `"..."` | Dado não divulgado |
| `"X"` | Dado sigiloso |
| `"C"` | Dado confidencial |

> **Todos estes valores devem ser convertidos para `null`** no processamento.

### Anos de Referência Disponíveis

| Indicador | Anos disponíveis | Recomendado |
|---|---|---|
| População estimada (Tabela 6579) | 2001–2024 | 2024 |
| PIB municipal (Tabela 5938) | 2002–2021 | 2021 (última consolidação municipal) |

### Rate Limit & Estabilidade

- Sem rate limit documentado; evitar mais de 5 requisições simultâneas
- Tempo de resposta: 3–15s por requisição de município por UF
- **Recomendação:** execução sequencial por UF com delay de 600ms

### Chave de Junção Territorial

```
series[].localidade.id === IBGE codarea (string) — 2 dígitos para UF, 7 para município
```

---

## 4. Siconfi — Secretaria do Tesouro Nacional

**URL base:** `https://apidatalake.tesouro.gov.br/ords/siconfi/tt`
**Documentação:** https://apidatalake.tesouro.gov.br/ords/siconfi/tt/swagger-ui/index.html

### Endpoints Utilizados

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/dca?an_exercicio={ano}&id_ente={siconfiId}` | Declaração de Contas Anuais completa |
| `GET` | `/rreo?an_exercicio={ano}&id_ente={siconfiId}&nr_periodo=6` | Relatório Resumido de Execução Orçamentária |

### ⚠️ Conversão Obrigatória de Código IBGE → Siconfi

O Siconfi usa código IBGE de **6 dígitos** para municípios (sem o dígito verificador):

```typescript
// Correto:
const siconfiId = codareaIbge.length === 7
  ? codareaIbge.substring(0, 6)  // '3136702' → '313670'
  : codareaIbge                   // '31' → '31' (estados não mudam)
```

| Código IBGE (7 dígitos) | Código Siconfi (6 dígitos) | Município |
|---|---|---|
| `3136702` | `313670` | São João del-Rei/MG |
| `3550308` | `355030` | São Paulo/SP |
| `3304557` | `330455` | Rio de Janeiro/RJ |

> **Ao armazenar localmente, sempre use 7 dígitos** para compatibilidade com mapas e indicadores.

### Filtros de Extração do DCA

| Dado | Anexo | Rótulo/Conta | Coluna |
|---|---|---|---|
| Receita Total | `DCA Anexo I-C` | `Receitas Orçamentárias` | `Valor` |
| Despesa Total | `DCA Anexo I-D` | `Despesas Liquidadas` | `Valor` |
| Gasto Saúde | `DCA Anexo I-E` | `Saúde` | `Valor` |
| Gasto Educação | `DCA Anexo I-E` | `Educação` | `Valor` |

### ⚠️ Rate Limit — CRÍTICO

- A API do Tesouro Nacional **bloqueia IPs por abuso** (HTTP 429 ou bloqueio silencioso)
- **Máximo recomendado:** 2 requisições simultâneas, delay de 300ms entre requisições
- Para 5.570 municípios: estimativa de ~14h em modo sequencial a 300ms/requisição
- **Recomendação:** executar por UF em horários fora de pico (noite/madrugada)

### Chave de Junção Territorial

```
SiconfiDcaItem.cod_ibge (number, 6 dígitos) → converter para 7 dígitos para junção com mapas
```

---

## 5. TSE — Portal de Dados Abertos / DivulgaCandContas

**URL base (DivulgaCandContas):** `https://divulgacandcontas.tse.jus.br/divulga/rest/v1`
**Portal de Dados Abertos:** `https://dadosabertos.tse.jus.br/`

### Endpoints Utilizados

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/eleicoes/eleitos/{ano}/{uf}/{codigoUe}/{cdCargo}` | Candidatos eleitos por UE e cargo |

### Parâmetros Obrigatórios

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `ano` | number | Ano da eleição (2024=municipal, 2022=estadual) |
| `uf` | string | Sigla da UF em maiúsculas (ex: `MG`) |
| `codigoUe` | string | Código TSE da UE (sigla UF para estadual, 5 dígitos para municipal) |
| `cdCargo` | number | Código do cargo (ver tabela abaixo) |

### Códigos de Cargo

| Código | Cargo |
|---|---|
| `3` | Governador |
| `4` | Vice-Governador |
| `11` | Prefeito |
| `12` | Vice-Prefeito |

### Situações de Eleição Aceitas

```
"ELEITO" | "ELEITO POR QP" | "ELEITO POR MÉDIA" | "ELEITO NO 2º TURNO"
```

### ⚠️ Incompatibilidade TSE ↔ IBGE — INTERVENÇÃO HUMANA NECESSÁRIA

O TSE usa **código próprio de 5 dígitos** para municípios — incompatível com os 7 dígitos do IBGE.

```
TSE 41238 → IBGE 3136702  (São João del-Rei/MG)
TSE 75353 → IBGE 4106902  (Curitiba/PR)
TSE 71072 → IBGE 3550308  (São Paulo/SP)
```

**Ação necessária:** criar/obter o arquivo `data/elections/de-para-tse-ibge.json`:

```bash
# Fonte disponível em:
# https://dadosabertos.tse.jus.br/dataset/municipios
# Correlacionar com lista de municípios do IBGE pelo nome+UF
```

Formato esperado do arquivo:
```json
[
  { "codigoTse": "41238", "codareaIbge": "3136702", "nome": "São João del-Rei", "uf": "MG" },
  { "codigoTse": "75353", "codareaIbge": "4106902", "nome": "Curitiba", "uf": "PR" }
]
```

### ⚠️ Instabilidade da API DivulgaCandContas

A API pode apresentar erros 5xx em períodos pós-eleitorais ou manutenção.

**Fallback disponível:** arquivos CSV de resultados no Portal de Dados Abertos:
```
https://dadosabertos.tse.jus.br/dataset/resultados-{ano}
```

### ⚠️ Bloqueio WAF — INTERVENÇÃO HUMANA NECESSÁRIA

O TSE protege ambas as suas APIs com WAF/CDN (Akamai) que bloqueia requisições diretas de servidores:

- **Portal Dados Abertos** (`dadosabertos.tse.jus.br`) → HTTP 403 de servidores
- **DivulgaCandContas** (`divulgacandcontas.tse.jus.br`) → HTTP 403/404 de servidores

**Abordagem recomendada (download manual de CSV):**

```bash
# 1. Em um browser, acesse e baixe os arquivos de resultados:
#    https://dadosabertos.tse.jus.br/dataset/resultados-2024  (Eleições Municipais)
#    https://dadosabertos.tse.jus.br/dataset/resultados-2022  (Eleições Gerais)
#
# 2. Salve os CSVs em:
#    data/elections/raw/resultados_2024_MG.csv (exemplo)
#
# 3. Execute o parser no script de ingestão
```

### Chave de Junção Territorial

```
TseCandidato.sgUe (string, 5 dígitos) → usar tabela DE-PARA → codareaIbge (7 dígitos)
```

---

## Executar Smoke Test de Conectividade

```bash
# Testar todos os adaptadores de uma vez
npx tsx scripts/test-adapters.ts

# Testar apenas fontes específicas
npx tsx scripts/test-adapters.ts --only=ibge-malhas,siconfi
```

## Executar Scripts de Ingestão

```bash
# Ingestão territorial (já funcional)
npx tsx scripts/update-territorial-data.ts

# Ingestão de indicadores (IBGE/SIDRA)
npx tsx scripts/update-indicators-data.ts --only=31

# Ingestão de finanças (Siconfi)
npx tsx scripts/update-budget-data.ts --only=31 --ano=2023

# Ingestão de eleições (TSE)
npx tsx scripts/update-elections-data.ts --only=31 --ano=2024
```
