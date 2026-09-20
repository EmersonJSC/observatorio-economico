/**
 * Caixa 2 — transporte BigQuery (`bigquery-sql`).
 *
 * A Base dos Dados não expõe download de arquivo: o acesso é uma consulta SQL
 * enviada por POST. O transporte é o mesmo HTTP, mas com método POST e corpo
 * obrigatório — por isso vive separado, e não como caso especial dentro de
 * `http.ts`.
 *
 * Hoje este caminho usa `fetch` cru sem timeout nem retry
 * (`basedosdados.adapter.ts`). Aqui ele passa a respeitar a política central.
 */

import { requisitar, type RespostaBruta } from './http.js'
import type { Buscar, DependenciasColetor, PoliticaExecucao } from '../tipos.js'
import { ErroHttp } from './http.js'

/** Corpo padrão esperado pela API de queries do BigQuery. */
export interface CorpoBigQuery {
  query: string
  useLegacySql?: boolean
}

/**
 * Monta o corpo JSON esperado pelo BigQuery.
 *
 * O SQL concreto é decisão de quem chama o coletor — o catálogo declara apenas
 * a operação, não a consulta (ver docs/PLANO_CAIXA_2_COLETOR.md §3).
 */
export function montarCorpoBigQuery(sql: string): string {
  const corpo: CorpoBigQuery = { query: sql, useLegacySql: false }
  return JSON.stringify(corpo)
}

/**
 * Executa uma consulta BigQuery e devolve os bytes crus da resposta.
 *
 * Não interpreta `schema` nem `rows` — isso é da ORGANIZAÇÃO.
 */
export async function consultarBigQuery(
  url: string,
  sql: string,
  politica: PoliticaExecucao,
  headers: Readonly<Record<string, string>>,
  deps: Pick<DependenciasColetor, 'buscar' | 'dormir'> = {},
): Promise<RespostaBruta> {
  if (!sql.trim()) {
    throw new ErroHttp(
      'transporte bigquery-sql exige o SQL no campo `corpo` da requisição de coleta',
      'erro-rede',
    )
  }

  // A política central sempre injeta User-Agent; o POST do BigQuery exige
  // Content-Type JSON e recebe os cabeçalhos de credencial já resolvidos.
  const init: RequestInit = {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: montarCorpoBigQuery(sql),
  }

  return requisitar(url, init, politica, deps as { buscar?: Buscar; dormir?: (ms: number) => Promise<void> })
}
