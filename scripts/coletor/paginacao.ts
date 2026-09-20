/**
 * Caixa 2 — paginação.
 *
 * Implementa as 4 estratégias que a Caixa 1 declara. Hoje `envelope-offset`
 * NÃO existe no pipeline (`siconfi.adapter.ts` lê só `items` e ignora
 * `hasMore`/`offset`), o que trunca o DCA em silêncio.
 *
 * IMPORTANTE — fronteira com a ORGANIZAÇÃO:
 * Para saber se há próxima página é preciso olhar o conteúdo da resposta. Isso
 * é feito aqui de forma MÍNIMA e mecânica: ler o campo que a própria fonte
 * declara como controle de paginação (`next`, `hasMore`, contagem do lote).
 * Nenhum dado é interpretado, transformado ou armazenado — apenas decide-se se
 * há mais uma chamada a fazer.
 */

import type { Paginacao } from '../fontes/tipos.js'

/** Uma resposta paginada, já em bytes, com a URL que a produziu. */
export interface PaginaBruta {
  bytes: Uint8Array
  url: string
  status: number
}

/** Decisão mecânica sobre continuar ou parar. */
export interface DecisaoPagina {
  continuar: boolean
  /** URL literal da próxima página (estratégia `link-next`). */
  proximaUrl?: string
  /** Parâmetro de página a incrementar (estratégias numéricas). */
  proximoOffset?: number
}

/**
 * Lê o JSON de controle de uma página.
 *
 * Devolve `null` quando o corpo não é JSON — nesse caso a paginação para, e
 * quem decide o que fazer com o conteúdo é a ORGANIZAÇÃO.
 */
function lerJsonControle(bytes: Uint8Array): unknown {
  try {
    const texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    return JSON.parse(texto)
  } catch {
    return null
  }
}

/** Conta itens em formatos de envelope conhecidos. */
function contarItens(json: unknown): number | null {
  if (Array.isArray(json)) return json.length
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    for (const chave of ['dados', 'items', 'results', 'candidatos']) {
      const valor = obj[chave]
      if (Array.isArray(valor)) return valor.length
    }
  }
  return null
}

/**
 * Decide se há próxima página, conforme a estratégia e a resposta recebida.
 *
 * @param estrategia Estratégia declarada na Caixa 1.
 * @param paginaAtual Resposta recém-obtida.
 * @param numeroPagina Número da página atual (1-based).
 * @param offsetAtual Offset usado nesta chamada, quando aplicável.
 */
export function decidirProximaPagina(
  estrategia: Paginacao,
  paginaAtual: PaginaBruta,
  numeroPagina: number,
  offsetAtual = 0,
): DecisaoPagina {
  if (estrategia === 'nenhuma') return { continuar: false }

  const json = lerJsonControle(paginaAtual.bytes)
  const itens = contarItens(json)

  // Lote vazio encerra em qualquer estratégia — a fonte não tem mais nada.
  if (itens === 0) return { continuar: false }

  switch (estrategia) {
    case 'link-next': {
      if (!json || typeof json !== 'object') return { continuar: false }
      const obj = json as Record<string, unknown>

      // Formato Brasil.io: `next` é a URL literal da próxima página.
      if (typeof obj.next === 'string' && obj.next.length > 0) {
        return { continuar: true, proximaUrl: obj.next }
      }

      // Formato Câmara: `links: [{ rel: 'next', href }]`.
      const links = obj.links
      if (Array.isArray(links)) {
        const proximo = links.find(
          (l) => l && typeof l === 'object' && (l as Record<string, unknown>).rel === 'next',
        ) as Record<string, unknown> | undefined
        const href = proximo?.href
        if (typeof href === 'string' && href.length > 0) {
          return { continuar: true, proximaUrl: href }
        }
      }
      return { continuar: false }
    }

    case 'pagina-numerada': {
      // Sem total informado pela fonte (caso do Portal), a parada é a página
      // vazia — já tratada acima. Um lote não vazio significa continuar.
      if (itens === null) return { continuar: false }
      return { continuar: true, proximoOffset: numeroPagina + 1 }
    }

    case 'envelope-offset': {
      if (!json || typeof json !== 'object') return { continuar: false }
      const obj = json as Record<string, unknown>

      // `hasMore` explícito é a fonte da verdade quando existe.
      if (typeof obj.hasMore === 'boolean') {
        if (!obj.hasMore) return { continuar: false }
        const limit = typeof obj.limit === 'number' ? obj.limit : (itens ?? 0)
        return { continuar: true, proximoOffset: offsetAtual + limit }
      }

      // Sem `hasMore`, avança pelo tamanho do lote enquanto ele vier cheio.
      const limit = typeof obj.limit === 'number' ? obj.limit : null
      if (limit !== null && itens !== null && itens < limit) return { continuar: false }
      if (itens === null) return { continuar: false }
      return { continuar: true, proximoOffset: offsetAtual + (limit ?? itens) }
    }

    default:
      return { continuar: false }
  }
}

/**
 * Monta os parâmetros de paginação de uma página.
 *
 * Não altera a declaração da Caixa 1: apenas acrescenta os parâmetros de
 * controle que a estratégia exige (`pagina` ou `offset`/`limit`).
 */
export function parametrosDePagina(
  estrategia: Paginacao,
  numeroPagina: number,
  offset: number,
  limiteSugerido?: number,
): Record<string, string> {
  switch (estrategia) {
    case 'pagina-numerada':
      return { pagina: String(numeroPagina) }
    case 'envelope-offset':
      return {
        offset: String(offset),
        ...(limiteSugerido ? { limit: String(limiteSugerido) } : {}),
      }
    default:
      return {}
  }
}
