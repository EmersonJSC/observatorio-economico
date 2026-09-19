/**
 * Serviço de dados de indicadores socioeconômicos (IBGE).
 *
 * Lê o dataset distribuído em `data/indicators/` (gerado por
 * `scripts/update-indicators-data.ts`). O IBGE nunca é consultado em runtime.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir } from 'node:fs/promises'

import { lerJsonComCache } from '../../lib/cached-dataset.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// apps/api/src/modules/indicators → raiz do monorepo (idem após o build).
const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const DATA_DIR = join(ROOT, 'data', 'indicators')
const UFS_DIR = join(DATA_DIR, 'ufs')
// Centróides geográficos (gerados por scripts/update-centroides.ts)
const MAPS_DIR = join(ROOT, 'data', 'maps')

export interface IndicadorPopulacao {
  total: number | null
  anoReferencia: number
  fonte: string
}

export interface IndicadorPib {
  valorTotalMilReais: number | null
  valorPerCapitaReais: number | null
  anoReferencia: number
  fonte: string
}

export interface IndicadorLocalidade {
  codarea: string
  nome: string
  populacao: IndicadorPopulacao | null
  pib: IndicadorPib | null
}

export interface IndicadoresBrasil {
  updatedAt: string
  anoPopulacao: number
  anoPib: number
  brasil: IndicadorLocalidade | null
  estados: IndicadorLocalidade[]
}

export interface IndicadoresUf {
  uf: string
  anoPopulacao: number
  anoPib: number
  municipios: IndicadorLocalidade[]
}

export interface MetadataIndicadores {
  updatedAt: string
  source: string
  anoPopulacao: number
  anoPib: number
  estados: number
  municipios: number
  ufs: string[]
  version: number
}

/** Indicadores consolidados do Brasil e das 27 UFs. */
export async function getIndicadoresBrasil(): Promise<IndicadoresBrasil> {
  return lerJsonComCache<IndicadoresBrasil>(join(DATA_DIR, 'brasil.json'), 'indicators:brasil')
}

/** Indicadores de todos os municípios de uma UF. */
export async function getIndicadoresUf(uf: string): Promise<IndicadoresUf> {
  return lerJsonComCache<IndicadoresUf>(join(UFS_DIR, `${uf}.json`), `indicators:uf:${uf}`)
}

/** Indicadores de um município (busca pelo codarea de 7 dígitos). */
export async function getIndicadorMunicipio(codarea: string): Promise<IndicadorLocalidade | null> {
  const uf = codarea.slice(0, 2)
  const arquivo = await getIndicadoresUf(uf)
  return arquivo.municipios.find((m) => m.codarea === codarea) ?? null
}

// ---------------------------------------------------------------------------
// Pontos georreferenciados (para camadas de agregação, ex.: hexágonos de PIB)
// ---------------------------------------------------------------------------

export interface PontoPib {
  codarea: string
  nome: string
  lng: number
  lat: number
  /** PIB a preços correntes, em Mil Reais */
  pib: number | null
  pibPerCapita: number | null
  populacao: number | null
}

interface Centroides {
  ufs: Record<string, [number, number]>
  municipios: Record<string, [number, number]>
}

/**
 * Todos os municípios com PIB e centroide geográfico — base para a camada de
 * hexágonos. Gerado por `npx tsx scripts/update-centroides.ts`.
 */
export async function getPontosPib(): Promise<PontoPib[]> {
  const centroides = await lerJsonComCache<Centroides>(
    join(MAPS_DIR, 'centroides.json'),
    'maps:centroides',
  )
  const arquivos = (await readdir(UFS_DIR)).filter((f) => f.endsWith('.json')).sort()
  const pontos: PontoPib[] = []

  for (const arquivo of arquivos) {
    const uf = arquivo.replace('.json', '')
    const dados = await getIndicadoresUf(uf)
    for (const m of dados.municipios) {
      const centro = centroides.municipios[m.codarea]
      if (!centro) continue
      pontos.push({
        codarea: m.codarea,
        nome: m.nome,
        lng: centro[0],
        lat: centro[1],
        pib: m.pib?.valorTotalMilReais ?? null,
        pibPerCapita: m.pib?.valorPerCapitaReais ?? null,
        populacao: m.populacao?.total ?? null,
      })
    }
  }

  return pontos
}

/** Metadados de auditoria do dataset de indicadores. */
export async function getMetadataIndicadores(): Promise<MetadataIndicadores> {
  return lerJsonComCache<MetadataIndicadores>(
    join(DATA_DIR, 'metadata.json'),
    'indicators:metadata',
  )
}
