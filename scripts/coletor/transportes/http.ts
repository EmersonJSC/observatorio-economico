/**
 * Caixa 2 — transporte HTTP (`http-json` e `http-geojson`).
 *
 * Responsabilidade única: executar UMA requisição e devolver os BYTES crus,
 * com status e cabeçalhos relevantes. Não interpreta o conteúdo — nada de
 * `res.json()` aqui. Interpretar é da ORGANIZAÇÃO.
 *
 * Cobre o que o `http-client.ts` legado já fazia (retry com backoff, timeout,
 * respeito a `Retry-After`), e acrescenta o que faltava: leitura como bytes,
 * `User-Agent` identificando o projeto e captura de `ETag`/`Last-Modified`.
 */

import type { Buscar, Dormir, HeadersRelevantes, PoliticaExecucao } from '../tipos.js'
import { VERSAO_COLETOR } from '../tipos.js'

/** Resposta bruta de uma requisição HTTP. */
export interface RespostaBruta {
  bytes: Uint8Array
  status: number
  url: string
  headers: HeadersRelevantes
  tentativas: number
}

/** Falha ao executar uma requisição. */
export class ErroHttp extends Error {
  constructor(
    message: string,
    readonly motivo: 'timeout' | 'http-erro' | 'http-nao-retentavel' | 'erro-rede',
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ErroHttp'
  }
}

const dormirPadrao: Dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Extrai apenas os cabeçalhos que interessam à procedência. */
export function extrairHeaders(res: Response): HeadersRelevantes {
  const h = res.headers
  const relevante: HeadersRelevantes = {}
  const ct = h.get('content-type')
  const cl = h.get('content-length')
  const etag = h.get('etag')
  const lm = h.get('last-modified')
  const ra = h.get('retry-after')
  if (ct) relevante.contentType = ct
  if (cl) relevante.contentLength = cl
  if (etag) relevante.etag = etag
  if (lm) relevante.lastModified = lm
  if (ra) relevante.retryAfter = ra
  return relevante
}

/**
 * Executa uma requisição com retry, backoff exponencial e timeout.
 *
 * O corpo é lido como bytes (`arrayBuffer`) ANTES de qualquer decisão.
 * Lança `ErroHttp` quando todas as tentativas falham.
 */
export async function requisitar(
  url: string,
  init: RequestInit,
  politica: PoliticaExecucao,
  deps: { buscar?: Buscar; dormir?: Dormir } = {},
): Promise<RespostaBruta> {
  const buscar = deps.buscar ?? ((u: string, i: RequestInit) => fetch(u, i))
  const dormir = deps.dormir ?? dormirPadrao

  let ultimoErro: Error | null = null
  let tentativas = 0

  for (let tentativa = 1; tentativa <= politica.maxRetries; tentativa++) {
    tentativas = tentativa
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), politica.timeoutMs)

    try {
      const res = await buscar(url, { ...init, signal: controller.signal })
      clearTimeout(timeoutId)

      // Rate limit: respeitar Retry-After quando presente.
      if (res.status === 429 && politica.respeitarRetryAfter) {
        const retryAfter = res.headers.get('Retry-After')
        const esperaMs = retryAfter
          ? Number(retryAfter) * 1000
          : politica.baseDelayMs * 2 ** tentativa
        if (tentativa < politica.maxRetries) {
          await dormir(esperaMs)
          continue
        }
      }

      // Erro não-retentável: falha imediata, sem novas tentativas.
      if (!res.ok && !politica.codigosRetentaveis.includes(res.status)) {
        throw new ErroHttp(
          `[HTTP ${res.status}] falha não-retentável em ${url}`,
          'http-nao-retentavel',
          res.status,
        )
      }

      if (!res.ok) {
        throw new ErroHttp(`[HTTP ${res.status}] falha transitória em ${url}`, 'http-erro', res.status)
      }

      // Lê o corpo como BYTES — a inversão central em relação ao legado.
      const buffer = await res.arrayBuffer()

      return {
        bytes: new Uint8Array(buffer),
        status: res.status,
        url: res.url || url,
        headers: extrairHeaders(res),
        tentativas,
      }
    } catch (err) {
      clearTimeout(timeoutId)

      const erro = err instanceof Error ? err : new Error(String(err))

      // Erro não-retentável já decidido acima: propaga sem retry.
      if (erro instanceof ErroHttp && erro.motivo === 'http-nao-retentavel') throw erro

      const abortado = erro.name === 'AbortError' || erro.message.includes('aborted')
      ultimoErro = abortado
        ? new ErroHttp(`[TIMEOUT ${politica.timeoutMs}ms] requisição expirou: ${url}`, 'timeout')
        : erro instanceof ErroHttp
          ? erro
          : new ErroHttp(`[REDE] ${erro.message}`, 'erro-rede')

      if (tentativa < politica.maxRetries) {
        await dormir(politica.baseDelayMs * 2 ** (tentativa - 1))
      }
    }
  }

  throw (
    ultimoErro ??
    new ErroHttp(`todas as ${politica.maxRetries} tentativas falharam para ${url}`, 'erro-rede')
  )
}

/** Identificação do coletor, usada nos logs de transporte. */
export const IDENTIFICACAO_TRANSPORTE = `coletor/${VERSAO_COLETOR}`
