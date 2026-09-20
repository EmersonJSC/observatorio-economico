/**
 * Caixa 2 — COLETOR EXTERNO: política de execução.
 *
 * ÚNICO lugar onde vivem timeout, retry, backoff, pausa, concorrência e
 * User-Agent. A Caixa 1 deliberadamente NÃO tem esses campos; antes da Caixa 2
 * eles estavam repetidos literalmente em ~30 call sites.
 *
 * Os valores abaixo preservam o comportamento que já funciona em produção
 * (ver docs/AUDITORIA_CAIXA_2_COLETOR.md §4) — não são valores novos.
 *
 * A política é DERIVADA de `recurso.rateLimit`: a Caixa 1 declara a restrição
 * real ("rate limit crítico"), o coletor decide como obedecê-la.
 */

import type { Recurso } from '../fontes/tipos.js'
import type { PoliticaExecucao } from './tipos.js'

/** Versão do coletor e identificação enviada às fontes. */
export const USER_AGENT =
  'ObservatorioEconomico/1.0 (coletor de dados publicos; +https://github.com/observatorio-economico)'

/** Códigos HTTP que valem nova tentativa (mesma lista do http-client legado). */
export const CODIGOS_RETENTAVEIS: readonly number[] = [408, 429, 500, 502, 503, 504]

/** Base da política, independente do recurso. */
const BASE = {
  timeoutMs: 30_000,
  maxRetries: 3,
  baseDelayMs: 500,
  respeitarRetryAfter: true,
  pausaEntreChamadasMs: 0,
  maxPaginas: 100,
} as const

/**
 * Ajustes por transporte.
 *
 * Derivados do que cada adapter já usava: GeoJSON demora mais (malhas grandes)
 * e o Portal da Transparência tinha backoff de 1s.
 */
const POR_TRANSPORTE: Partial<Record<Recurso['transporte'], Partial<PoliticaExecucao>>> = {
  'http-geojson': { timeoutMs: 60_000, baseDelayMs: 800 },
  'bigquery-sql': { timeoutMs: 60_000, baseDelayMs: 1000 },
  'browser-download': { timeoutMs: 300_000 },
}

/**
 * Ajustes por severidade de rate limit.
 *
 * `critico` é o caso do Siconfi: bloqueio por IP. `moderado` é o Portal da
 * Transparência (~90 req/min).
 */
const POR_RATE_LIMIT: Record<
  Recurso['rateLimit']['nivel'],
  Partial<PoliticaExecucao> & { concorrencia?: number }
> = {
  desconhecido: {},
  brando: {},
  moderado: { pausaEntreChamadasMs: 350, baseDelayMs: 1000 },
  critico: { pausaEntreChamadasMs: 300, baseDelayMs: 600, maxRetries: 4, concorrencia: 2 },
}

/**
 * Resolve a política efetiva de um recurso.
 *
 * Precedência: base → transporte → rate limit.
 */
export function politicaPara(recurso: Recurso): PoliticaExecucao {
  const porTransporte = POR_TRANSPORTE[recurso.transporte] ?? {}
  const porRateLimit = POR_RATE_LIMIT[recurso.rateLimit.nivel] ?? {}

  return {
    timeoutMs: porRateLimit.timeoutMs ?? porTransporte.timeoutMs ?? BASE.timeoutMs,
    maxRetries: porRateLimit.maxRetries ?? porTransporte.maxRetries ?? BASE.maxRetries,
    baseDelayMs: porRateLimit.baseDelayMs ?? porTransporte.baseDelayMs ?? BASE.baseDelayMs,
    codigosRetentaveis: CODIGOS_RETENTAVEIS,
    respeitarRetryAfter:
      porRateLimit.respeitarRetryAfter ?? porTransporte.respeitarRetryAfter ?? BASE.respeitarRetryAfter,
    pausaEntreChamadasMs:
      porRateLimit.pausaEntreChamadasMs ??
      porTransporte.pausaEntreChamadasMs ??
      BASE.pausaEntreChamadasMs,
    maxPaginas: porRateLimit.maxPaginas ?? porTransporte.maxPaginas ?? BASE.maxPaginas,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
    },
  }
}

/**
 * Concorrência máxima recomendada para um recurso.
 *
 * O coletor executa sequencialmente por padrão. Este valor existe para que
 * quem orquestra várias coletas saiba o limite que a fonte impõe.
 */
export function concorrenciaPara(recurso: Recurso): number {
  return POR_RATE_LIMIT[recurso.rateLimit.nivel]?.concorrencia ?? 1
}
