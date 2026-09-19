/**
 * Indicadores socioeconômicos (IBGE) — lidos dos arquivos estáticos.
 */

import { lerDados, ufDoCodarea } from '../../lib/fontes'

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

interface ArquivoBrasil {
  brasil: IndicadorLocalidade | null
  estados: IndicadorLocalidade[]
}

interface ArquivoUf {
  uf: string
  municipios: IndicadorLocalidade[]
}

/** Município com coordenadas e todas as métricas — base da camada de informação. */
export interface PontoMapa {
  codarea: string
  nome: string
  /** Sigla da UF (ex.: "SP"). */
  uf: string
  lng: number
  lat: number
  pib: number | null
  pibPerCapita: number | null
  populacao: number | null
  receitaTotal: number | null
  despesaTotal: number | null
  saude: number | null
  educacao: number | null
  /** Área em km². */
  area: number | null
  /** Sigla do partido do prefeito eleito em 2024. */
  prefeitoPartido: string | null
}

/**
 * Indicadores de um território.
 * - Brasil: consolidado nacional.
 * - Estado: consolidado da UF.
 * - Município: busca no arquivo da UF.
 */
export async function buscarIndicadores(
  nivel: 'brasil' | 'estado' | 'municipio',
  codigo: string,
): Promise<IndicadorLocalidade | null> {
  if (nivel === 'municipio') {
    const arquivo = await lerDados<ArquivoUf>(`indicators/ufs/${ufDoCodarea(codigo)}.json`)
    return arquivo?.municipios.find((m) => m.codarea === codigo) ?? null
  }

  const dados = await lerDados<ArquivoBrasil>('indicators/brasil.json')
  if (!dados) return null
  if (nivel === 'brasil') return dados.brasil
  return dados.estados.find((e) => e.codarea === codigo) ?? null
}

/** Todos os municípios com métricas e centroide (arquivo derivado, gerado no build). */
export async function buscarPontosMapa(): Promise<PontoMapa[]> {
  const dados = await lerDados<{ pontos: PontoMapa[] }>('indicators/pontos.json')
  return dados?.pontos ?? []
}
