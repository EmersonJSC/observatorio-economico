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

/**
 * Código IBGE da UF (2 dígitos) → sigla.
 *
 * A Caixa 7 publica alguns shards por SIGLA (`indicadores/MG.json`,
 * `orcamento/MG.json`) e outros por CÓDIGO (`territorios/31.geojson`,
 * `eleicoes/ufs/31.json`). Quem monta a rota precisa converter, e a conversão
 * mora aqui para não existir uma tabela por feature — foi a divergência entre
 * duas cópias dela que fez o painel pedir `indicadores/31.json` (404).
 *
 * A lista é fixa por definição legal: as 27 UFs não mudam.
 */
const SIGLA_POR_CODIGO_UF: Readonly<Record<string, string>> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
  '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
  '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
  '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
  '52': 'GO', '53': 'DF',
}

/**
 * Sigla da UF a partir de um `codarea` (município de 7 dígitos ou UF de 2).
 *
 * @returns A sigla, ou `null` quando o código não corresponde a uma UF.
 */
export function siglaDaUf(codarea: string): string | null {
  return SIGLA_POR_CODIGO_UF[ufDoCodarea(codarea)] ?? null
}
