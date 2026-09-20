/**
 * Caixa 7 — contrato de nomes publicados.
 *
 * ⚠️ ÚNICO lugar que sabe que `pibMilReais` vira `pib`.
 *
 * A Caixa 6 usa nomes descritivos; o frontend usa nomes curtos e estáveis.
 * Sem um mapa central, cada formatador inventaria o seu — e o frontend
 * quebraria ao consumir um artefato gerado por outro formatador.
 *
 * Este módulo é DECLARATIVO e testável: é o análogo, na publicação, do
 * catálogo de métricas da Caixa 6.
 */

import type { MapeamentoCampo } from './tipos.js'

/**
 * Rotas que o frontend consome.
 *
 * Esta lista é o CONTRATO: `validar.ts` cruza estas rotas com o que existe em
 * `data/published/` e falha se alguma não tiver sido gerada. Antes da Caixa 7
 * nada detectava esse descasamento — o erro só aparecia no navegador.
 */
export const ROTAS_FRONTEND = {
  /** Índice leve de municípios (sem métricas). */
  municipiosIndice: 'municipios/indice.json',
  /** Bloco de municípios, por número. */
  municipiosBloco: (bloco: number) => `municipios/bloco-${bloco}.json`,
  /** Brasil + UFs com indicadores. */
  indicadoresBrasil: 'indicadores/brasil.json',
  /** Indicadores de uma UF (shard por UF). */
  indicadoresUf: (uf: string) => `indicadores/${uf}.json`,
  /** Ranking nacional (UFs + municípios). */
  ranking: 'indicadores/ranking.json',
  /** Malha nacional (UFs). */
  territoriosBrasil: 'territorios/brasil.geojson',
  /** Malha municipal de uma UF. */
  territoriosUf: (uf: string) => `territorios/${uf}.geojson`,
  /** Orçamento consolidado (Brasil + UFs). */
  orcamentoBrasil: 'orcamento/brasil.json',
  /** Orçamento de uma UF. */
  orcamentoUf: (uf: string) => `orcamento/${uf}.json`,
  /** Mandatos: Brasil, estados e municípios. */
  eleicoesBrasil: 'eleicoes/brasil.json',
  eleicoesEstado: (uf: string) => `eleicoes/estados/${uf}.json`,
  eleicoesUf: (uf: string) => `eleicoes/ufs/${uf}.json`,
} as const

/**
 * Mapeamento de nomes: calculado (Caixa 6) → publicado (Caixa 7).
 *
 * `null` no destino significa **descartar**: o campo existe nos cálculos mas
 * não é consumido pelo frontend. Publicar campo não consumido é peso morto.
 */
export const MAPA_METRICAS: readonly MapeamentoCampo[] = [
  { origem: 'populacao', destino: 'populacao' },
  { origem: 'pib_mil_reais', destino: 'pib' },
  { origem: 'pib_per_capita', destino: 'pibPerCapita' },
  { origem: 'densidade', destino: 'densidade' },
  { origem: 'receita_total', destino: 'receita' },
  { origem: 'despesa_total', destino: 'despesa' },
  { origem: 'saude_per_capita', destino: 'saudePerCapita' },
  { origem: 'totalCandidatos', destino: 'candidatos' },
  { origem: 'partidosDistintos', destino: 'partidos' },
]

/**
 * Aliases que existiam no payload antigo e foram ELIMINADOS.
 *
 * O arquivo `explorer/municipios.json` trazia 13 chaves de métrica, das quais
 * 6 eram duplicatas exatas (`populacao` == `populacao_2024`,
 * `pib` == `pib_2021_reais`, …). Metade do maior arquivo publicado era
 * chave repetida. A Caixa 7 mantém só o nome canônico.
 *
 * Documentado aqui para que ninguém reintroduza os sufixos "por
 * compatibilidade": não há compatibilidade a preservar.
 */
export const ALIASES_ELIMINADOS: Readonly<Record<string, string>> = {
  populacao_2024: 'populacao',
  pib_2021_reais: 'pib',
  pib_mil_reais: 'pib',
  receita_2023_reais: 'receita',
  despesa_2023_reais: 'despesa',
  saude_2023_reais: 'saude',
  educacao_2023_reais: 'educacao',
}

/** As 27 UFs, em código IBGE de 2 dígitos. */
export const UFS: readonly string[] = [
  '11', '12', '13', '14', '15', '16', '17',
  '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '31', '32', '33', '35',
  '41', '42', '43',
  '50', '51', '52', '53',
]

/** Código IBGE da UF a partir do codarea do município. */
export function ufDoCodarea(codarea: string): string {
  return codarea.slice(0, 2)
}

/** Localiza o nome publicado de uma métrica. */
export function nomePublicado(origem: string): string | undefined {
  return MAPA_METRICAS.find((m) => m.origem === origem)?.destino
}
