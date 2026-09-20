/**
 * Caixa 7 — formatador: indicadores, ranking, orçamento e eleições.
 *
 * Um arquivo por domínio, cada um recebendo os dados já calculados e devolvendo
 * a estrutura exata que o frontend consome.
 */

import type { EstadoOrganizado, MunicipioCalculado, OrcamentoOrganizado } from '../leitura.js'
import type { MunicipioPublicado } from '../tipos.js'
import type { Coordenada } from './municipios.js'

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

/** Indicador de uma localidade, no formato consumido pelo frontend. */
export interface IndicadoresLocalidade {
  codarea: string
  nome: string
  populacao: { total: number | null; anoReferencia: number; fonte: string } | null
  pib: {
    valorTotalMilReais: number | null
    valorPerCapitaReais: number | null
    anoReferencia: number
    fonte: string
  } | null
}

/** Extrai os indicadores de um município calculado. */
export function formatarIndicadores(
  calculado: MunicipioCalculado,
): IndicadoresLocalidade {
  const pop = calculado.metricas['populacao']
  const pib = calculado.metricas['pib_mil_reais']
  const perCapita = calculado.metricas['pib_per_capita']

  return {
    codarea: calculado.codarea,
    nome: calculado.nome,
    populacao: pop
      ? {
          total: pop.valor,
          anoReferencia: pop.ano ?? 0,
          fonte: 'IBGE — SIDRA Tabela 6579',
        }
      : null,
    pib: pib
      ? {
          valorTotalMilReais: pib.valor,
          valorPerCapitaReais: perCapita?.valor ?? null,
          anoReferencia: pib.ano ?? 0,
          fonte: 'IBGE — SIDRA Tabela 5938',
        }
      : null,
  }
}

/** Indicadores de uma UF, agregando seus municípios. */
export function formatarIndicadoresUf(
  uf: string,
  municipios: readonly MunicipioCalculado[],
): { uf: string; municipios: IndicadoresLocalidade[] } {
  return {
    uf,
    municipios: municipios
      .map(formatarIndicadores)
      .sort((a, b) => a.codarea.localeCompare(b.codarea)),
  }
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** Linha do ranking nacional. */
export interface LinhaRanking {
  codarea: string
  nome: string
  uf: string
  populacao: number | null
  pib: number | null
  pibPerCapita: number | null
  receitaTotal: number | null
  despesaTotal: number | null
  lng: number | null
  lat: number | null
}

/** Ranking nacional: Brasil por UF + todos os municípios. */
export interface RankingPublicado {
  geradoEm: string
  anos: { populacao: number | null; pib: number | null; orcamento: number | null }
  ufs: LinhaRanking[]
  municipios: LinhaRanking[]
}

/**
 * Monta o ranking a partir dos municípios publicados.
 *
 * O ranking das UFs é agregado dos municípios — mas apenas para métricas
 * ADITIVAS. Somar `pibPerCapita` não significaria nada, então ele fica `null`
 * nas UFs (o frontend já trata esse caso).
 */
export function formatarRanking(
  municipios: readonly MunicipioPublicado[],
  estados: Map<string, EstadoOrganizado>,
  geradoEm: string,
): RankingPublicado {
  const porUf = new Map<string, MunicipioPublicado[]>()
  for (const m of municipios) {
    const lista = porUf.get(m.uf)
    if (lista) lista.push(m)
    else porUf.set(m.uf, [m])
  }

  const ufs: LinhaRanking[] = []
  for (const [ufCodigo, lista] of porUf) {
    const estado = estados.get(ufCodigo)
    const soma = (f: (m: MunicipioPublicado) => number | null): number | null => {
      let total = 0
      let contribuicoes = 0
      for (const m of lista) {
        const v = f(m)
        if (v === null) continue
        total += v
        contribuicoes++
      }
      return contribuicoes > 0 ? Number(total.toFixed(2)) : null
    }

    ufs.push({
      codarea: ufCodigo,
      nome: estado?.nome ?? ufCodigo,
      uf: estado?.sigla ?? ufCodigo,
      populacao: soma((m) => m.metricas.populacao),
      pib: soma((m) => m.metricas.pib),
      // Métrica relativa NÃO é somada — recalcular exigiria PIB/pop da UF.
      pibPerCapita: null,
      receitaTotal: soma((m) => m.metricas.receita),
      despesaTotal: soma((m) => m.metricas.despesa),
      lng: null,
      lat: null,
    })
  }

  const primeira = municipios[0]

  return {
    geradoEm,
    anos: {
      populacao: primeira?.anos.populacao ?? null,
      pib: primeira?.anos.pib ?? null,
      orcamento: primeira?.anos.orcamento ?? null,
    },
    ufs: ufs.sort((a, b) => a.codarea.localeCompare(b.codarea)),
    municipios: municipios
      .map((m) => ({
        codarea: m.codarea,
        nome: m.nome,
        uf: m.uf,
        populacao: m.metricas.populacao,
        pib: m.metricas.pib,
        pibPerCapita: m.metricas.pibPerCapita,
        receitaTotal: m.metricas.receita,
        despesaTotal: m.metricas.despesa,
        lng: m.lng,
        lat: m.lat,
      }))
      .sort((a, b) => a.codarea.localeCompare(b.codarea)),
  }
}

// ---------------------------------------------------------------------------
// Orçamento
// ---------------------------------------------------------------------------

/** Ente no payload de orçamento. */
export interface OrcamentoEntePublicado {
  codarea: string
  nome: string
  exercicio: number
  receitaTotal: number | null
  despesaTotal: number | null
  gastosPorArea: { saude: number | null; educacao: number | null }
  fonte: string
}

/** Formata um ente orçamentário. */
export function formatarOrcamento(
  orcamento: OrcamentoOrganizado,
  nome: string,
): OrcamentoEntePublicado {
  return {
    codarea: orcamento.codarea,
    nome,
    exercicio: orcamento.exercicio,
    receitaTotal: orcamento.receitaTotal,
    despesaTotal: orcamento.despesaTotal,
    gastosPorArea: {
      saude: orcamento.gastoSaude,
      educacao: orcamento.gastoEducacao,
    },
    fonte: 'Secretaria do Tesouro Nacional — Siconfi (DCA)',
  }
}

// ---------------------------------------------------------------------------
// Eleições
// ---------------------------------------------------------------------------

/** Mandato no payload de eleições. */
export interface MandatoPublicado {
  cargo: string
  nomeUrna: string
  nomeCompleto: string
  partido: string
  numeroCandidato: number
  anoEleicao: number
}

/**
 * Formata as candidaturas de um município.
 *
 * A agregação da Caixa 6 dá as CONTAGENS; os nomes dos eleitos vêm do
 * organizado do TSE (Caixa 4). Enquanto essa junção não for feita, publicamos
 * apenas as contagens — que é o que o dado atual sustenta sem inventar.
 */
export interface CandidaturasMunicipioPublicado {
  codarea: string
  totalCandidatos: number
  candidatosPrefeito: number
  candidatosVereador: number
  partidosDistintos: number
  anoEleicao: number | null
}

/** Coordenadas exportadas para uso em outros formatadores. */
export type { Coordenada }
