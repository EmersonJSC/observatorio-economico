/**
 * Fonte ALTERNATIVA de dados socioeconômicos e fiscais: Base dos Dados.
 *
 * Usada como fallback quando as fontes primárias (IBGE SIDRA / Siconfi) falham.
 * A Base dos Dados (https://basedosdados.org) espelha e padroniza dados oficiais
 * brasileiros (IBGE, Tesouro, etc.) em um datalake público no BigQuery.
 *
 * ⚠️ ACESSO VIA BIGQUERY (não há API REST simples de download):
 *   É necessário um projeto no Google Cloud com a BigQuery API habilitada e um
 *   token de acesso OAuth. Configure:
 *     export BD_BILLING_PROJECT="seu-projeto-gcp"
 *     export BD_ACCESS_TOKEN="$(gcloud auth print-access-token)"
 *   Sem essas variáveis, esta fonte é ignorada (o orquestrador mantém os dados locais).
 *
 * Tabelas utilizadas (datalake público `basedosdados`):
 *   - br_ibge_populacao.municipio  (id_municipio, ano, populacao)
 *   - br_ibge_pib.municipio        (id_municipio, ano, pib)
 *
 * Chave de junção: `id_municipio` (codarea IBGE de 7 dígitos).
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..', '..')
const INDICATORS_DIR = join(ROOT, 'data', 'indicators')
const INDICATORS_UFS_DIR = join(INDICATORS_DIR, 'ufs')

// Anos de referência (mesmos defaults do pipeline primário)
const ANO_POPULACAO = Number(process.env.ANO_POPULACAO ?? 2024)
const ANO_PIB = Number(process.env.ANO_PIB ?? 2021)

// Todas as UFs (código IBGE de 2 dígitos) — para separar municípios por UF
const TODAS_UFS = [
  '11', '12', '13', '14', '15', '16', '17', '21', '22', '23', '24', '25',
  '26', '27', '28', '29', '31', '32', '33', '35', '41', '42', '43', '50',
  '51', '52', '53',
]

// ---------------------------------------------------------------------------
// Cliente BigQuery (REST)
// ---------------------------------------------------------------------------

interface LinhaBigQuery {
  f: Array<{ v: string | null }>
}

interface RespostaBigQuery {
  jobComplete: boolean
  schema?: { fields: Array<{ name: string }> }
  rows?: LinhaBigQuery[]
  errors?: Array<{ message: string }>
}

/**
 * Executa uma query no BigQuery e retorna as linhas como objetos simples.
 * Usa o endpoint síncrono `queries` (adequado para resultados pequenos/médios).
 */
async function consultarBigQuery(
  projeto: string,
  token: string,
  sql: string,
): Promise<Array<Record<string, string | null>>> {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projeto}/queries`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql, useLegacySql: false }),
  })

  if (!res.ok) {
    const texto = await res.text().catch(() => '')
    throw new Error(`[Base dos Dados] BigQuery HTTP ${res.status}: ${texto.slice(0, 300)}`)
  }

  const json = (await res.json()) as RespostaBigQuery
  if (json.errors && json.errors.length > 0) {
    throw new Error(`[Base dos Dados] BigQuery: ${json.errors.map((e) => e.message).join('; ')}`)
  }

  const campos = json.schema?.fields.map((f) => f.name) ?? []
  return (json.rows ?? []).map((linha) => {
    const obj: Record<string, string | null> = {}
    campos.forEach((nome, i) => {
      obj[nome] = linha.f[i]?.v ?? null
    })
    return obj
  })
}

// ---------------------------------------------------------------------------
// Entrada pública (chamada pelo orquestrador)
// ---------------------------------------------------------------------------

export async function ingestirComoFonteAlternativa(dominio: string): Promise<void> {
  if (dominio !== 'indicadores') {
    // Este adaptador cobre apenas indicadores (população + PIB) por enquanto.
    throw new Error(`[Base dos Dados] domínio "${dominio}" não suportado por esta fonte alternativa`)
  }

  const projeto = process.env.BD_BILLING_PROJECT
  const token = process.env.BD_ACCESS_TOKEN
  if (!projeto || !token) {
    throw new Error(
      'Base dos Dados não configurada. Defina BD_BILLING_PROJECT e BD_ACCESS_TOKEN ' +
      '(ex: export BD_ACCESS_TOKEN="$(gcloud auth print-access-token)").',
    )
  }

  console.log(`\n[Base dos Dados] Buscando indicadores (pop ${ANO_POPULACAO} / PIB ${ANO_PIB})…`)

  const linhasPop = await consultarBigQuery(
    projeto,
    token,
    `SELECT id_municipio, populacao
     FROM \`basedosdados.br_ibge_populacao.municipio\`
     WHERE ano = ${ANO_POPULACAO}`,
  )
  console.log(`[Base dos Dados] ✓ ${linhasPop.length} registros de população`)

  const linhasPib = await consultarBigQuery(
    projeto,
    token,
    `SELECT id_municipio, pib
     FROM \`basedosdados.br_ibge_pib.municipio\`
     WHERE ano = ${ANO_PIB}`,
  )
  console.log(`[Base dos Dados] ✓ ${linhasPib.length} registros de PIB`)

  const popPorCod = new Map(linhasPop.map((l) => [l.id_municipio ?? '', Number(l.populacao)]))
  const pibPorCod = new Map(linhasPib.map((l) => [l.id_municipio ?? '', Number(l.pib)]))

  const codareas = new Set([...popPorCod.keys(), ...pibPorCod.keys()])
  codareas.delete('')

  // Agrupa por UF (2 primeiros dígitos do código de 7)
  const porUf = new Map<string, Array<Record<string, unknown>>>()
  for (const codarea of codareas) {
    const uf = codarea.substring(0, 2)
    if (!TODAS_UFS.includes(uf)) continue
    const pop = popPorCod.get(codarea) ?? null
    const pib = pibPorCod.get(codarea) ?? null
    const perCapita = pop && pib && pop > 0 ? Number(((pib * 1000) / pop).toFixed(2)) : null

    if (!porUf.has(uf)) porUf.set(uf, [])
    porUf.get(uf)!.push({
      codarea,
      nome: codarea, // nome real vem da fonte primária/mapas; mantido o código aqui
      populacao: { total: pop, anoReferencia: ANO_POPULACAO, fonte: 'Base dos Dados — br_ibge_populacao.municipio' },
      pib: {
        valorTotalMilReais: pib,
        valorPerCapitaReais: perCapita,
        anoReferencia: ANO_PIB,
        fonte: 'Base dos Dados — br_ibge_pib.municipio',
      },
    })
  }

  await mkdir(INDICATORS_UFS_DIR, { recursive: true })
  let total = 0
  for (const [uf, municipios] of porUf) {
    municipios.sort((a, b) => String(a.codarea).localeCompare(String(b.codarea)))
    await writeFile(
      join(INDICATORS_UFS_DIR, `${uf}.json`),
      JSON.stringify({ uf, anoPopulacao: ANO_POPULACAO, anoPib: ANO_PIB, fonte: 'Base dos Dados', municipios }, null, 2),
      'utf-8',
    )
    total += municipios.length
  }

  await writeFile(
    join(INDICATORS_DIR, 'metadata.json'),
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        source: 'Base dos Dados — br_ibge_populacao / br_ibge_pib (BigQuery)',
        anoPopulacao: ANO_POPULACAO,
        anoPib: ANO_PIB,
        ufs: [...porUf.keys()].sort(),
        municipios: total,
        version: 2,
        viaFallback: true,
      },
      null,
      2,
    ),
    'utf-8',
  )

  console.log(`\n[Base dos Dados] ✓ Fonte alternativa concluída: ${total} municípios em ${porUf.size} UFs`)
}
