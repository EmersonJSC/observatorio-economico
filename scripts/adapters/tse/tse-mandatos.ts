/**
 * Tipos dos mandatos eleitorais consolidados (TSE) — compartilhados pelos
 * scripts de ingestão municipal (2024) e geral (2022).
 *
 * Os arquivos gerados ficam em:
 *   data/elections/ufs/{uf}.json     → mandatos municipais (prefeito, vice, vereadores)
 *   data/elections/estados/{uf}.json → mandatos estaduais (governador, senadores, deputados)
 *   data/elections/brasil.json       → mandatos nacionais (presidente, vice)
 */

import { CARGO } from './tse-csv-parser.js'

export type NomeCargo =
  | 'Presidente'
  | 'Vice-Presidente'
  | 'Governador'
  | 'Vice-Governador'
  | 'Senador'
  | 'Deputado Federal'
  | 'Deputado Estadual'
  | 'Deputado Distrital'
  | 'Prefeito'
  | 'Vice-Prefeito'
  | 'Vereador'

/** Mapa código de cargo do TSE → nome canônico do mandato. */
export function cdCargoParaNome(cdCargo: number): NomeCargo | null {
  switch (cdCargo) {
    case CARGO.PRESIDENTE: return 'Presidente'
    case CARGO.VICE_PRESIDENTE: return 'Vice-Presidente'
    case CARGO.GOVERNADOR: return 'Governador'
    case CARGO.VICE_GOVERNADOR: return 'Vice-Governador'
    case CARGO.SENADOR: return 'Senador'
    case CARGO.DEPUTADO_FEDERAL: return 'Deputado Federal'
    case CARGO.DEPUTADO_ESTADUAL: return 'Deputado Estadual'
    case CARGO.DEPUTADO_DISTRITAL: return 'Deputado Distrital'
    case CARGO.PREFEITO: return 'Prefeito'
    case CARGO.VICE_PREFEITO: return 'Vice-Prefeito'
    case CARGO.VEREADOR: return 'Vereador'
    default: return null
  }
}

/** Duração do mandato (anos) por cargo (todos os cargos eletivos atuais = 4 anos). */
export function duracaoMandato(_cdCargo: number): number {
  return 4
}

export function calcularPeriodoMandato(anoEleicao: number, cdCargo: number): string {
  const inicio = anoEleicao + 1
  const fim = inicio + duracaoMandato(cdCargo) - 1
  return `${inicio}–${fim}`
}

/** Um representante eleito, já consolidado para exibição. */
export interface MandatoRepresentante {
  cargo: NomeCargo
  /** Código do cargo no TSE (1=Presidente ... 13=Vereador) */
  codigoCargoTse: number
  nomeUrna: string
  nomeCompleto: string
  partido: string
  numeroCandidato: number
  anoEleicao: number
  mandatoPeriodo: string
  situacaoEleicao: string
  /** Sequencial único do candidato (SQ_CANDIDATO) — usado para localizar a foto */
  sqCandidato?: string
  /** Total de votos nominais, quando disponível */
  totalVotos?: number
}

/** Mandatos de um município: prefeito, vice e a câmara de vereadores. */
export interface MandatoMunicipio {
  codareaIbge: string
  codigoTse: string
  nomeMunicipio: string
  uf: string
  prefeito?: MandatoRepresentante
  vicePrefeito?: MandatoRepresentante
  vereadores: MandatoRepresentante[]
}

/** Mandatos de uma UF: governo estadual e bancada no Congresso/Assembleia. */
export interface MandatoEstado {
  uf: string
  sigla: string
  anoEleicao: number
  governador?: MandatoRepresentante
  viceGovernador?: MandatoRepresentante
  senadores: MandatoRepresentante[]
  deputadosFederais: MandatoRepresentante[]
  deputadosEstaduais: MandatoRepresentante[]
}

/** Mandatos nacionais (presidente, vice e composição do Congresso). */
export interface MandatoBrasil {
  updatedAt: string
  anoEleicao: number
  presidente?: MandatoRepresentante
  vicePresidente?: MandatoRepresentante
  congresso: {
    senadores: number
    deputadosFederais: number
  }
}

/** Metadados de auditoria do dataset eleitoral. */
export interface MetadataEleicoes {
  updatedAt: string
  source: string
  anoEleicaoEstadual?: number
  anoEleicaoMunicipal?: number
  estados: number
  municipios: number
  ufs: string[]
  version: number
}
