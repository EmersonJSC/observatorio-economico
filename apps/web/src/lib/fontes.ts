/**
 * Leitura dos datasets estáticos.
 *
 * O site é publicado como arquivos estáticos: nada de servidor. Os datasets
 * ficam em `/dados/...` (em desenvolvimento, o Vite serve a pasta `data/`).
 *
 * `import.meta.env.BASE_URL` respeita o `base` do Vite, permitindo publicar em
 * subpasta (ex.: GitHub Pages: /observatorio-economico/).
 */

export const DADOS = `${import.meta.env.BASE_URL}dados`

/** Cache em memória: os datasets não mudam durante a sessão. */
const cache = new Map<string, unknown>()
const emAndamento = new Map<string, Promise<unknown>>()

export async function lerDados<T>(caminho: string): Promise<T | null> {
  const url = `${DADOS}/${caminho}`

  if (cache.has(url)) return cache.get(url) as T

  const pendente = emAndamento.get(url)
  if (pendente) return pendente as Promise<T | null>

  const promessa = (async (): Promise<T | null> => {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const dados = (await res.json()) as T
      cache.set(url, dados)
      return dados
    } catch {
      return null
    } finally {
      emAndamento.delete(url)
    }
  })()

  emAndamento.set(url, promessa)
  return promessa
}

/** Codarea IBGE (7 dígitos) → código da UF (2 primeiros dígitos). */
export const ufDoCodarea = (codarea: string) => codarea.slice(0, 2)
