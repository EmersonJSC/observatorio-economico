/**
 * Caixa 2 — COLETOR EXTERNO: tipos.
 *
 * A Caixa 2 EXECUTA o que a Caixa 1 declara. Ela faz exatamente três coisas:
 *
 *   1. lê a declaração de um recurso no catálogo (`scripts/fontes/`);
 *   2. monta e executa a requisição (ou o download por navegador);
 *   3. entrega BYTES + PROCEDÊNCIA.
 *
 * Ela NÃO interpreta o conteúdo, NÃO transforma, NÃO normaliza, NÃO converte
 * encoding, NÃO renomeia campo, NÃO cria relacionamento, NÃO calcula indicador
 * e NÃO grava em `data/`.
 *
 * Fronteira:
 *   FONTES   declara   "o que existe e como se coleta"   (Caixa 1, pronta)
 *   COLETOR  executa   "faço a requisição e trago bytes"  (este módulo)
 *   RAW      preserva  "estes são os bytes e sua origem"  (fora da Caixa 2)
 *
 * Referências: docs/PLANO_CAIXA_2_COLETOR.md e docs/AUDITORIA_CAIXA_2_COLETOR.md.
 */

import type { Recurso, Transporte } from '../fontes/tipos.js'

// ---------------------------------------------------------------------------
// Versão do coletor (vai na procedência de toda coleta)
// ---------------------------------------------------------------------------

/** Versão do coletor, registrada em cada coleta para rastreabilidade. */
export const VERSAO_COLETOR = '1.0.0'

// ---------------------------------------------------------------------------
// Estados da coleta (tri-estado explícito)
// ---------------------------------------------------------------------------

/**
 * Resultado de uma coleta.
 *
 * Antes da Caixa 2, "sem dado" e "falha" colapsavam no mesmo valor (`null`,
 * `[]` ou ausência) em 4 das 6 fontes. Aqui eles são estados distintos:
 *
 *   - `sucesso`  → resposta obtida e íntegra
 *   - `sem-dado` → a fonte respondeu legitimamente "não há"
 *   - `falha`    → não foi possível coletar
 *
 * `sem-dado` NUNCA é `falha`.
 */
export type EstadoColeta = 'sucesso' | 'sem-dado' | 'falha'

/** Por que a coleta não produziu dado. Presente quando o estado é `falha`. */
export type MotivoFalha =
  | 'credencial-ausente'
  | 'url-invalida'
  | 'parametro-faltando'
  | 'timeout'
  | 'http-erro'
  | 'http-nao-retentavel'
  | 'pagina-limite-excedido'
  | 'transporte-nao-suportado'
  | 'erro-rede'
  | 'erro-navegador'
  | 'manual'

// ---------------------------------------------------------------------------
// Procedência (o que hoje não existe em lugar nenhum)
// ---------------------------------------------------------------------------

/** Cabeçalhos relevantes preservados da resposta. */
export interface HeadersRelevantes {
  contentType?: string
  contentLength?: string
  etag?: string
  lastModified?: string
  retryAfter?: string
}

/** De onde vieram os bytes. Acompanha todo resultado de coleta. */
export interface Procedencia {
  /** Identidade da declaração na Caixa 1. */
  fonteId: string
  recursoId: string
  /** Transporte efetivamente usado (pode diferir do declarado em fallback). */
  transporte: Transporte
  /** URL final resolvida, com query string. Ausente em coleta manual. */
  url?: string
  /** Instante da coleta em ISO 8601. Ausente quando não houve requisição. */
  coletadoEm?: string
  /** Status HTTP, quando houve resposta. */
  status?: number
  /** Cabeçalhos relevantes. */
  headers?: HeadersRelevantes
  /** Parâmetros efetivamente usados nesta chamada (o ente, o ano, …). */
  parametros: Readonly<Record<string, string>>
  /** Quantas tentativas foram necessárias. */
  tentativas: number
  /** Versão do coletor que produziu este resultado. */
  versaoColetor: string
  /** Fatos declarativos da Caixa 1 transportados adiante, sem interpretação. */
  peculiaridades: readonly string[]
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

/**
 * Resultado de UMA coleta (um recurso, um conjunto de parâmetros).
 *
 * `bytes` é a resposta original, sem reescrita. Quando há paginação, `bytes`
 * é o conteúdo da PRIMEIRA página e `paginas` traz as demais — o coletor não
 * concatena nem reescreve o que a fonte devolveu.
 */
export interface ResultadoColeta {
  estado: EstadoColeta
  procedencia: Procedencia
  /** Conteúdo original, byte a byte. Ausente em `falha` e `sem-dado`. */
  bytes?: Uint8Array
  /** Hash do conteúdo (`sha256`), calculado sobre os bytes exatos. */
  hash?: string
  /** Tamanho em bytes. */
  tamanho?: number
  /** Todas as páginas, quando a paginação produziu mais de uma. */
  paginas?: readonly PaginaColeta[]
  /** Motivo, quando `estado === 'falha'`. */
  motivo?: MotivoFalha
  /** Mensagem legível do problema. */
  mensagem?: string
}

/** Uma página coletada dentro de um recurso paginado. */
export interface PaginaColeta {
  /** Número da página (1-based). Em `link-next`, é a ordem de visita. */
  pagina: number
  url: string
  bytes: Uint8Array
  hash: string
  tamanho: number
  status: number
}

// ---------------------------------------------------------------------------
// Entradas do coletor
// ---------------------------------------------------------------------------

/**
 * Valores de fan-out por dimensão.
 *
 * A Caixa 1 declara `dimensao: 'ente'`; ela NÃO entrega a lista dos 5.570
 * entes. Quem chama o coletor fornece os valores — decisão de quem chama.
 */
export type ValoresDimensao = Readonly<Record<string, readonly string[]>>

/** Requisição de coleta de um recurso. */
export interface RequisicaoColeta {
  fonteId: string
  recursoId: string
  /**
   * Valores por dimensão de fan-out (`ente`, `uf`, `ano`, …).
   *
   * Dimensões ausentes usam o `exemplo` declarado no catálogo, quando houver.
   * Recurso com mais de uma dimensão gera produto cartesiano.
   */
  dimensoes?: ValoresDimensao
  /** Sobrescreve parâmetros que não são dimensão (ex.: `projeto` do BigQuery). */
  parametros?: Readonly<Record<string, string>>
  /** Corpo da requisição, para transportes que exigem (BigQuery: o SQL). */
  corpo?: string
  /** Limite de páginas. Sobrescreve o padrão da política. */
  maxPaginas?: number
}

/** Uma chamada concreta já resolvida: URL, método e parâmetros. */
export interface ChamadaResolvida {
  recurso: Recurso
  fonteId: string
  url: string
  metodo: 'GET' | 'POST'
  /** Parâmetros desta chamada, já resolvidos (viram a procedência). */
  parametros: Readonly<Record<string, string>>
  /** Corpo, quando o transporte exige. */
  corpo?: string
  /** Teto de páginas solicitado; sobrepõe o padrão da política. */
  maxPaginas?: number
}

// ---------------------------------------------------------------------------
// Política (definida em politicas.ts, nunca na Caixa 1)
// ---------------------------------------------------------------------------

/** Política de execução efetiva para uma coleta. */
export interface PoliticaExecucao {
  timeoutMs: number
  maxRetries: number
  baseDelayMs: number
  /** Códigos HTTP que devem ser retentados. */
  codigosRetentaveis: readonly number[]
  /** Respeitar o header `Retry-After` em HTTP 429. */
  respeitarRetryAfter: boolean
  /** Pausa entre chamadas do mesmo recurso, em ms. */
  pausaEntreChamadasMs: number
  /** Máximo de páginas antes de considerar falha. */
  maxPaginas: number
  /** Cabeçalhos padrão enviados em toda requisição. */
  headers: Readonly<Record<string, string>>
}

/** Função de sleep injetável — permite testar sem esperar de verdade. */
export type Dormir = (ms: number) => Promise<void>

/** Função de `fetch` injetável — permite testar rede com mocks. */
export type Buscar = (url: string, init: RequestInit) => Promise<Response>

/** Dependências injetáveis do coletor (produção usa os padrões). */
export interface DependenciasColetor {
  buscar?: Buscar
  dormir?: Dormir
  /** Ambiente de onde saem as credenciais. Padrão: `process.env`. */
  ambiente?: Readonly<Record<string, string | undefined>>
  agora?: () => Date
}
