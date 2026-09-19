/**
 * Script de atualização do dataset territorial.
 *
 * Este é o ÚNICO ponto do projeto que conversa com o IBGE.
 * Ele baixa as malhas territoriais e as persiste em `data/maps/`,
 * transformando o IBGE em uma dependência de build/atualização —
 * e não uma dependência de runtime.
 *
 * Uso:
 *   npx tsx scripts/update-territorial-data.ts
 *   npx tsx scripts/update-territorial-data.ts --only=11,31   # apenas algumas UFs
 *   npx tsx scripts/update-territorial-data.ts --skip-municipios
 *
 * Estrutura gerada:
 *   data/maps/
 *   ├── brasil.geojson        (malha das 27 UFs, com nome/sigla)
 *   ├── metadata.json         (data de atualização, contagens, versão)
 *   └── ufs/
 *       ├── 11.geojson        (municípios de RO, com nome/uf)
 *       ├── 12.geojson        (municípios do AC, com nome/uf)
 *       └── ...
 *
 * Enriquecimento: a malha do IBGE traz apenas `codarea`. Os nomes oficiais
 * são obtidos da API de Localidades e embutidos no dataset, para que o
 * frontend nunca precise consultar o IBGE em runtime (inclusive no hover).
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'maps')
const UFS_DIR = join(DATA_DIR, 'ufs')

const IBGE_BASE = 'https://servicodados.ibge.gov.br/api/v3/malhas'
const IBGE_LOCALIDADES = 'https://servicodados.ibge.gov.br/api/v1/localidades'
const FORMATO = 'application/vnd.geo+json'

// Códigos IBGE das 27 UFs (fallback caso a API de UFs falhe)
const UFS_FALLBACK = [
  '11', '12', '13', '14', '15', '16', '17',
  '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '31', '32', '33', '35',
  '41', '42', '43',
  '50', '51', '52', '53',
]

interface GeoJsonFeature {
  type: string
  properties?: Record<string, unknown>
  geometry?: unknown
}

interface GeoJsonCollection {
  type: string
  features: GeoJsonFeature[]
}

interface Metadata {
  updatedAt: string
  source: string
  estados: number
  municipios: number
  ufs: string[]
  version: number
}

function parseArgs() {
  const args = process.argv.slice(2)
  const only = args
    .find((a) => a.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const skipMunicipios = args.includes('--skip-municipios')
  return { only, skipMunicipios }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Falha ao buscar ${url}: HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

async function ensureDirs() {
  await mkdir(UFS_DIR, { recursive: true })
}

interface UfLocalidade {
  id: number
  sigla: string
  nome: string
}

interface MunicipioLocalidade {
  id: number
  nome: string
  microrregiao?: { mesorregiao?: { UF?: { id: number; sigla: string } } }
  'regiao-imediata'?: {
    'regiao-intermediaria'?: { UF?: { id: number; sigla: string } }
  }
}

/**
 * A malha do IBGE traz apenas `codarea`. Para exibir nomes no mapa sem
 * consultar a API em runtime, enriquecemos o dataset aqui com os nomes
 * oficiais vindos da API de Localidades.
 */
async function baixarNomesUfs(): Promise<Map<string, UfLocalidade>> {
  const lista = await fetchJson<UfLocalidade[]>(
    `${IBGE_LOCALIDADES}/estados`,
  )
  return new Map(lista.map((uf) => [String(uf.id), uf]))
}

async function baixarNomesMunicipios(
  uf: string,
): Promise<Map<string, MunicipioLocalidade>> {
  const lista = await fetchJson<MunicipioLocalidade[]>(
    `${IBGE_LOCALIDADES}/estados/${uf}/municipios`,
  )
  return new Map(lista.map((m) => [String(m.id), m]))
}

async function baixarEstados(): Promise<GeoJsonCollection> {
  const url = `${IBGE_BASE}/paises/BR?formato=${FORMATO}&intrarregiao=UF`
  console.log('→ Baixando malha dos estados (UFs)…')
  const geojson = await fetchJson<GeoJsonCollection>(url)

  console.log('→ Baixando nomes oficiais das UFs…')
  const nomes = await baixarNomesUfs()

  for (const feature of geojson.features) {
    const codarea = String(feature.properties?.codarea ?? '')
    const uf = nomes.get(codarea)
    feature.properties = {
      ...feature.properties,
      codarea,
      nome: uf?.nome ?? codarea,
      sigla: uf?.sigla ?? '',
    }
  }

  await writeFile(
    join(DATA_DIR, 'brasil.geojson'),
    JSON.stringify(geojson),
    'utf-8',
  )
  console.log(`  ✓ ${geojson.features.length} estados salvos em brasil.geojson`)
  return geojson
}

async function baixarMunicipios(uf: string): Promise<number> {
  const url = `${IBGE_BASE}/estados/${uf}?formato=${FORMATO}&intrarregiao=municipio`
  const geojson = await fetchJson<GeoJsonCollection>(url)

  const nomes = await baixarNomesMunicipios(uf)

  for (const feature of geojson.features) {
    const codarea = String(feature.properties?.codarea ?? '')
    const municipio = nomes.get(codarea)
    const ufInfo =
      municipio?.microrregiao?.mesorregiao?.UF ??
      municipio?.['regiao-imediata']?.['regiao-intermediaria']?.UF
    feature.properties = {
      ...feature.properties,
      codarea,
      nome: municipio?.nome ?? codarea,
      uf: ufInfo?.sigla ?? '',
      ufId: ufInfo?.id ? String(ufInfo.id) : uf,
    }
  }

  await writeFile(
    join(UFS_DIR, `${uf}.geojson`),
    JSON.stringify(geojson),
    'utf-8',
  )
  return geojson.features.length
}

async function main() {
  const { only, skipMunicipios } = parseArgs()

  console.log('Atualizando dataset territorial a partir do IBGE…\n')
  await ensureDirs()

  const estados = await baixarEstados()

  // Descobre as UFs a partir do próprio GeoJSON (fonte da verdade)
  const ufsDoGeojson = estados.features
    .map((f) => String(f.properties?.codarea ?? ''))
    .filter(Boolean)

  const ufs =
    only && only.length > 0
      ? only
      : ufsDoGeojson.length > 0
        ? ufsDoGeojson
        : UFS_FALLBACK

  let totalMunicipios = 0

  if (skipMunicipios) {
    console.log('\n(--skip-municipios) Pulando download dos municípios.')
  } else {
    console.log(`\n→ Baixando municípios de ${ufs.length} UFs…`)
    for (const uf of ufs) {
      try {
        const count = await baixarMunicipios(uf)
        totalMunicipios += count
        console.log(`  ✓ UF ${uf}: ${count} municípios`)
      } catch (err) {
        console.error(
          `  ✗ UF ${uf}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  const metadata: Metadata = {
    updatedAt: new Date().toISOString(),
    source: 'IBGE — API v3 de Malhas Territoriais',
    estados: estados.features.length,
    municipios: totalMunicipios,
    ufs,
    version: 1,
  }

  await writeFile(
    join(DATA_DIR, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8',
  )

  console.log('\n✓ Dataset atualizado com sucesso.')
  console.log(`  Estados: ${metadata.estados}`)
  console.log(`  Municípios: ${metadata.municipios}`)
  console.log(`  UFs: ${metadata.ufs.length}`)
  console.log(`  Local: ${DATA_DIR}`)
}

main().catch((err) => {
  console.error('\n✗ Erro ao atualizar o dataset:', err)
  process.exit(1)
})
