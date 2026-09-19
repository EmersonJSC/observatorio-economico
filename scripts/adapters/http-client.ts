/**
 * Cliente HTTP compartilhado para todos os adaptadores de ingestão.
 *
 * Funcionalidades:
 *  - Retry automático com backoff exponencial em falhas transitórias (429, 5xx, erros de rede)
 *  - Timeout configurável por requisição
 *  - Logging estruturado de tentativas, falhas e sucesso
 *  - Tratamento explícito de rate limit (HTTP 429) com respeito ao header Retry-After
 */

export interface HttpClientOptions {
  /** Timeout em milissegundos por tentativa. Padrão: 30000 (30s) */
  timeoutMs?: number
  /** Número máximo de tentativas (incluindo a primeira). Padrão: 3 */
  maxRetries?: number
  /** Delay base em ms para backoff exponencial. Padrão: 500 */
  baseDelayMs?: number
  /** Headers adicionais a serem enviados */
  headers?: Record<string, string>
}

export interface HttpResponse<T> {
  data: T
  status: number
  /** Tempo total de resposta em ms (primeira tentativa bem-sucedida) */
  durationMs: number
}

/** Codigos HTTP que devem ser retentados automaticamente */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Executa uma requisição GET com JSON como resposta, com retry automático
 * e backoff exponencial.
 *
 * @throws {Error} Se todas as tentativas falharem ou o status for um erro
 *                 não-retentável (ex: 400, 401, 403, 404).
 */
export async function fetchJsonComRetry<T>(
  url: string,
  opts: HttpClientOptions = {},
): Promise<HttpResponse<T>> {
  const {
    timeoutMs = 30_000,
    maxRetries = 3,
    baseDelayMs = 500,
    headers = {},
  } = opts

  let ultimoErro: Error | null = null

  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const inicio = Date.now()

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      let res: Response
      try {
        res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json', ...headers },
        })
      } finally {
        clearTimeout(timeoutId)
      }

      const durationMs = Date.now() - inicio

      // Rate limit: respeitar Retry-After se presente
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After')
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : baseDelayMs * 2 ** tentativa
        console.warn(
          `    [HTTP] Rate limit (429) em ${url}. Aguardando ${waitMs}ms antes da tentativa ${tentativa + 1}/${maxRetries}…`,
        )
        if (tentativa < maxRetries) {
          await sleep(waitMs)
          continue
        }
      }

      // Erro não-retentável: lançar imediatamente sem mais tentativas
      if (!res.ok && !RETRYABLE_STATUS_CODES.has(res.status)) {
        throw new Error(
          `[HTTP ${res.status}] Falha não-retentável em ${url}`,
        )
      }

      // Erro retentável (5xx)
      if (!res.ok) {
        throw new Error(`[HTTP ${res.status}] Falha transitória em ${url}`)
      }

      const data = (await res.json()) as T
      if (tentativa > 1) {
        console.log(`    [HTTP] ✓ Sucesso na tentativa ${tentativa}/${maxRetries} (${durationMs}ms): ${url}`)
      }

      return { data, status: res.status, durationMs }
    } catch (err) {
      ultimoErro = err instanceof Error ? err : new Error(String(err))

      const isAbortError =
        ultimoErro.name === 'AbortError' || ultimoErro.message.includes('aborted')

      if (isAbortError) {
        ultimoErro = new Error(`[TIMEOUT ${timeoutMs}ms] Requisição expirou: ${url}`)
      }

      const ehUltimaTentativa = tentativa >= maxRetries
      if (!ehUltimaTentativa) {
        const waitMs = baseDelayMs * 2 ** (tentativa - 1)
        console.warn(
          `    [HTTP] ✗ Tentativa ${tentativa}/${maxRetries} falhou: ${ultimoErro.message}. Retentando em ${waitMs}ms…`,
        )
        await sleep(waitMs)
      }
    }
  }

  throw ultimoErro ?? new Error(`Todas as ${maxRetries} tentativas falharam para: ${url}`)
}

/**
 * Utilitário de pausa assíncrona para controle manual de cadência entre
 * requisições em lote (rate limiting preventivo).
 */
export const pausar = (ms: number) => sleep(ms)
