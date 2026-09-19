/**
 * Serviço de dados de orçamento e finanças públicas (Siconfi/Tesouro).
 *
 * Lê o dataset distribuído em `data/budget/` (gerado por
 * `scripts/update-budget-data.ts`). O Tesouro nunca é consultado em runtime.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { lerJsonComCache } from '../../lib/cached-dataset.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const DATA_DIR = join(ROOT, 'data', 'budget')
const UFS_DIR = join(DATA_DIR, 'ufs')

export interface GastosPorArea {
  saude: number | null
  educacao: number | null
}

export interface OrcamentoEnte {
  /** Código IBGE (2 dígitos para estado, 7 para município) */
  codarea: string
  nome: string
  exercicio: number
  /** Receita orçamentária total realizada, em R$ */
  receitaTotal: number | null
  /** Despesa orçamentária total liquidada, em R$ */
  despesaTotal: number | null
  gastosPorArea: GastosPorArea
  fonte: string
  atualizadoEm: string
}

export interface OrcamentoBrasil {
  updatedAt: string
  exercicio: number
  estados: OrcamentoEnte[]
}

export interface OrcamentoUf {
  uf: string
  exercicio: number
  municipios: OrcamentoEnte[]
}

export interface MetadataOrcamento {
  updatedAt: string
  source: string
  exercicio: number
  estados: number
  municipios: number
  ufs: string[]
  version: number
}

/** Finanças consolidadas dos 26 estados + DF. */
export async function getOrcamentoBrasil(): Promise<OrcamentoBrasil> {
  return lerJsonComCache<OrcamentoBrasil>(join(DATA_DIR, 'brasil.json'), 'budget:brasil')
}

/** Finanças de todos os municípios de uma UF. */
export async function getOrcamentoUf(uf: string): Promise<OrcamentoUf> {
  return lerJsonComCache<OrcamentoUf>(join(UFS_DIR, `${uf}.json`), `budget:uf:${uf}`)
}

/** Finanças de um município (busca pelo codarea de 7 dígitos). */
export async function getOrcamentoMunicipio(codarea: string): Promise<OrcamentoEnte | null> {
  const uf = codarea.slice(0, 2)
  const arquivo = await getOrcamentoUf(uf)
  return arquivo.municipios.find((m) => m.codarea === codarea) ?? null
}

/** Metadados de auditoria do dataset orçamentário. */
export async function getMetadataOrcamento(): Promise<MetadataOrcamento> {
  return lerJsonComCache<MetadataOrcamento>(join(DATA_DIR, 'metadata.json'), 'budget:metadata')
}
