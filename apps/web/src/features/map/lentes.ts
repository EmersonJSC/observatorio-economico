/**
 * "Lentes" do mapa — o mesmo Brasil visto por indicadores diferentes.
 *
 * Cada lente escolhe o layer do deck.gl mais adequado ao dado:
 *   - agregacao   → HexagonLayer (soma um valor por área)
 *   - coropletico → GeoJsonLayer (pinta o polígono por um valor)
 *   - partido     → GeoJsonLayer com a cor do partido dominante
 *   - composicao  → GeoJsonLayer com a concentração da casa legislativa
 *   - executivo   → GeoJsonLayer com a cor do partido do prefeito/governador
 *
 * A regra de fundo: valores que SOMAM (PIB, população, receita…) viram
 * hexágonos; taxas e proporções (per capita, densidade…) viram coroplético.
 */

import { getIndicator } from '../explorer/explorerApi'
import type { IndicadorExplorer, PontoExplorer } from '../explorer/explorerApi'

export type CategoriaLente = 'economia' | 'pessoas' | 'politica' | 'gestao'

export type TipoLente = 'agregacao' | 'coropletico' | 'partido' | 'composicao' | 'executivo'

/** Métricas numéricas expostas pela camada Explorer. */
export type CampoNumerico =
  | 'pib'
  | 'pib_per_capita'
  | 'populacao'
  | 'receita'
  | 'despesa'
  | 'receita_per_capita'
  | 'despesa_per_capita'
  | 'saude'
  | 'educacao'
  | 'densidade'
  | 'disponibilidade'

export interface Lente {
  id: string
  categoria: CategoriaLente
  rotulo: string
  tipo: TipoLente
  campo?: CampoNumerico
  /** Chave do verbete explicativo (opcional — some sem entrada). */
  explicacao?: string
  /** O que a lente mostra, em uma linha. */
  ajuda: string
  fonte: string
  /**
   * Multiplicador aplicado ao elevationScale do HexagonLayer para esta lente.
   * Permite ajustar a escala visual por lente sem alterar o valor armazenado.
   * Ex.: PIB está em R$ na camada Explorer (não mil R$), então escaladorElevacao=0.001
   * mantém a altura proporcional às demais lentes financeiras (receita, despesa).
   */
  escaladorElevacao?: number
}

export interface Categoria {
  id: CategoriaLente
  rotulo: string
}

export const CATEGORIAS: Categoria[] = [
  { id: 'economia', rotulo: 'Economia' },
  { id: 'pessoas', rotulo: 'Pessoas' },
  { id: 'politica', rotulo: 'Política' },
  { id: 'gestao', rotulo: 'Gestão' },
]

const FONTE_IBGE = 'IBGE'
const FONTE_SICONFI = 'Tesouro Nacional · Siconfi'
const FONTE_TSE = 'Justiça Eleitoral (TSE)'

export const LENTES: Lente[] = [
  // ---- Economia ----
  {
    id: 'pib', categoria: 'economia', rotulo: 'PIB', tipo: 'agregacao', campo: 'pib',
    explicacao: 'pib',
    ajuda: 'Soma o PIB dos municípios que caem dentro de cada hexágono.',
    fonte: FONTE_IBGE,
    // PIB está em R$ na camada Explorer; escalador 0.001 mantém proporção visual
    // equivalente às demais lentes (receita, despesa) que também estão em R$.
    escaladorElevacao: 0.001,
  },
  {
    id: 'pib_per_capita', categoria: 'economia', rotulo: 'PIB per capita', tipo: 'coropletico', campo: 'pib_per_capita',
    explicacao: 'pibPerCapita',
    ajuda: 'Pinta cada município pela riqueza produzida por habitante.',
    fonte: FONTE_IBGE,
  },
  {
    id: 'receita', categoria: 'economia', rotulo: 'Receita', tipo: 'agregacao', campo: 'receita',
    explicacao: 'receitaTotal',
    ajuda: 'Soma tudo que os municípios arrecadaram no exercício, por área.',
    fonte: FONTE_SICONFI,
  },
  {
    id: 'despesa', categoria: 'economia', rotulo: 'Despesa', tipo: 'agregacao', campo: 'despesa',
    explicacao: 'despesaTotal',
    ajuda: 'Soma tudo que os municípios pagaram no exercício, por área.',
    fonte: FONTE_SICONFI,
  },

  // ---- Pessoas ----
  {
    id: 'populacao', categoria: 'pessoas', rotulo: 'População', tipo: 'agregacao', campo: 'populacao',
    explicacao: 'populacao',
    ajuda: 'Soma a população dos municípios que caem dentro de cada hexágono.',
    fonte: FONTE_IBGE,
  },
  {
    id: 'densidade', categoria: 'pessoas', rotulo: 'Densidade', tipo: 'coropletico', campo: 'densidade',
    ajuda: 'Habitantes por km² — pinta onde as pessoas se concentram.',
    fonte: FONTE_IBGE,
  },
  {
    id: 'disponibilidade', categoria: 'pessoas', rotulo: 'Dados disponíveis', tipo: 'coropletico', campo: 'disponibilidade',
    ajuda: 'Quantos dos nossos indicadores existem para cada município.',
    fonte: 'IBGE · Tesouro · TSE',
  },

  // ---- Política ----
  {
    id: 'forca', categoria: 'politica', rotulo: 'Força política', tipo: 'partido',
    explicacao: 'forcaPolitica',
    ajuda: 'Cor do partido com mais cadeiras na casa legislativa de cada lugar.',
    fonte: FONTE_TSE,
  },
  {
    id: 'composicao', categoria: 'politica', rotulo: 'Composição partidária', tipo: 'composicao',
    explicacao: 'cadeiras',
    ajuda: 'Quão concentrada é a casa: a fatia de cadeiras do partido mais forte.',
    fonte: FONTE_TSE,
  },
  {
    id: 'eleicoes', categoria: 'politica', rotulo: 'Eleições', tipo: 'executivo',
    ajuda: 'Cor do partido do prefeito eleito — no nível estadual, o partido que mais venceu prefeituras.',
    fonte: FONTE_TSE,
  },

  // ---- Gestão ----
  {
    id: 'receita_per_capita', categoria: 'gestao', rotulo: 'Receita/habitante', tipo: 'coropletico', campo: 'receita_per_capita',
    explicacao: 'receitaTotal',
    ajuda: 'Quanto o poder público arrecada por habitante em cada município.',
    fonte: FONTE_SICONFI,
  },
  {
    id: 'despesa_per_capita', categoria: 'gestao', rotulo: 'Despesa/habitante', tipo: 'coropletico', campo: 'despesa_per_capita',
    explicacao: 'despesaTotal',
    ajuda: 'Quanto o poder público gasta por habitante em cada município.',
    fonte: FONTE_SICONFI,
  },
  {
    id: 'saude', categoria: 'gestao', rotulo: 'Saúde', tipo: 'agregacao', campo: 'saude',
    explicacao: 'saude',
    ajuda: 'Soma do gasto com saúde dos municípios, por área.',
    fonte: FONTE_SICONFI,
  },
  {
    id: 'educacao', categoria: 'gestao', rotulo: 'Educação', tipo: 'agregacao', campo: 'educacao',
    explicacao: 'educacao',
    ajuda: 'Soma do gasto com educação dos municípios, por área.',
    fonte: FONTE_SICONFI,
  },
]

export const lentePorId = (id: string | null): Lente | null =>
  LENTES.find((l) => l.id === id) ?? null

// ---------------------------------------------------------------------------
// Escala de cor sequencial (do azul frio ao amarelo quente)
// ---------------------------------------------------------------------------

export const CORES_SEQUENCIAL: [number, number, number][] = [
  [26, 52, 78], [32, 74, 102], [34, 98, 120], [40, 124, 134], [56, 150, 138],
  [90, 174, 128], [136, 194, 110], [190, 208, 90], [234, 212, 72], [255, 204, 58],
]

/** Cor da escala sequencial para um valor normalizado entre 0 e 1. */
export function corSequencial(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t))
  const idx = Math.round(clamped * (CORES_SEQUENCIAL.length - 1))
  return CORES_SEQUENCIAL[idx]
}

// ---------------------------------------------------------------------------
// Valor de uma métrica por município e por estado
// ---------------------------------------------------------------------------

/** Campos que fazem sentido somar entre municípios. */
const CAMPOS_SOMAVEIS: CampoNumerico[] = ['pib', 'populacao', 'receita', 'despesa', 'saude', 'educacao']

export function ehSomavel(campo: CampoNumerico): boolean {
  return CAMPOS_SOMAVEIS.includes(campo)
}

const nulo = (v: number | null | undefined): v is null | undefined =>
  v === null || v === undefined || !Number.isFinite(v)

/** Número de indicadores presentes num município (de 0 a 6). */
function disponibilidade(p: PontoExplorer): number {
  let n = 0
  for (const indicador of ['pib', 'populacao', 'receita', 'despesa', 'saude', 'educacao'] as IndicadorExplorer[]) {
    if (!nulo(getIndicator(p, indicador).valor)) n++
  }
  return n
}

/** Valor de uma métrica para UM município. */
export function valorDoPonto(p: PontoExplorer, campo: CampoNumerico): number | null {
  switch (campo) {
    case 'pib': case 'pib_per_capita': case 'populacao': case 'receita': case 'despesa':
    case 'receita_per_capita': case 'despesa_per_capita': case 'saude': case 'educacao':
      return getIndicator(p, campo).valor
    case 'densidade':
      return !nulo(getIndicator(p, 'populacao').valor) && !nulo(p.area) && p.area !== 0
        ? (getIndicator(p, 'populacao').valor as number) / (p.area as number) : null
    case 'disponibilidade': return disponibilidade(p)
  }
}

/**
 * Valor de uma métrica para UM estado, agregado dos seus municípios.
 * Métricas somáveis somam; taxas são recalculadas a partir das somas (a média
 * simples de "per capita" não é o "per capita" do todo).
 */
export function valorDoEstado(pontos: PontoExplorer[], campo: CampoNumerico): number | null {
  const somar = (f: (p: PontoExplorer) => number | null) => {
    let s = 0
    let alguma = false
    for (const p of pontos) { const v = f(p); if (!nulo(v)) { s += v as number; alguma = true } }
    return alguma ? s : null
  }

  switch (campo) {
    case 'pib': case 'populacao': case 'receita': case 'despesa': case 'saude': case 'educacao':
      return somar((p) => valorDoPonto(p, campo))
    // Não recalcula taxas estaduais com componentes de anos diferentes.
    case 'pib_per_capita': case 'receita_per_capita': case 'despesa_per_capita': return null
    case 'densidade': {
      const pop = somar((p) => valorDoPonto(p, 'populacao'))
      const area = somar((p) => p.area)
      return !nulo(pop) && !nulo(area) && area !== 0 ? (pop as number) / (area as number) : null
    }
    case 'disponibilidade': {
      const vals = pontos.map(disponibilidade).filter((v) => v > 0)
      if (vals.length === 0) return null
      return vals.reduce((a, b) => a + b, 0) / vals.length
    }
  }
}

// ---------------------------------------------------------------------------
// Domínio percentil para mapear valor → cor
// ---------------------------------------------------------------------------

/** Devolve [baixo, alto] entre os percentis `lo` e `hi` de uma lista de valores. */
export function dominioPercentil(
  valores: number[],
  lo = 5,
  hi = 95,
): [number, number] | null {
  const validos = valores.filter((v) => !nulo(v))
  if (validos.length < 3) return null
  validos.sort((a, b) => a - b)
  const pct = (p: number) => validos[Math.min(validos.length - 1, Math.floor((p / 100) * (validos.length - 1)))]
  return [pct(lo), pct(hi)]
}

/** Normaliza um valor no domínio [baixo, alto], cortando os extremos. */
export function normalizar(valor: number, dominio: [number, number] | null): number {
  if (!dominio || dominio[1] <= dominio[0]) return 0
  return Math.max(0, Math.min(1, (valor - dominio[0]) / (dominio[1] - dominio[0])))
}
