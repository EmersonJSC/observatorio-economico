/**
 * Ranking nacional — leitura do dataset derivado.
 *
 * `indicadores/ranking.json` é gerado pela Caixa 7 (`scripts/publicacao/`) e
 * junta os três blocos em uma lista só: indicadores + orçamento + centroide.
 * É o único arquivo que permite ordenar o Brasil inteiro sem baixar 54 arquivos.
 */

import { lerDados } from '../../lib/fontes'

/** Uma linha do ranking, com todas as métricas comparáveis. */
export interface LinhaRanking {
  codarea: string
  nome: string
  uf: string
  populacao: number | null
  /** PIB em Mil Reais, como publicado pelo IBGE. */
  pib: number | null
  pibPerCapita: number | null
  receitaTotal: number | null
  despesaTotal: number | null
  lng: number | null
  lat: number | null
}

export interface RankingNacional {
  geradoEm: string
  anos: {
    populacao: number | null
    pib: number | null
    orcamento: number | null
  }
  ufs: LinhaRanking[]
  municipios: LinhaRanking[]
}

/** Qual conjunto do ranking está em uso. */
export type NivelRanking = 'ufs' | 'municipios'

export async function buscarRanking(): Promise<RankingNacional | null> {
  return lerDados<RankingNacional>('indicadores/ranking.json')
}
