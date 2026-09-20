/**
 * Indicadores socioeconômicos (IBGE) — lidos dos arquivos estáticos.
 *
 * ── Contrato publicado ────────────────────────────────────────────────────
 *
 *   indicadores/brasil.json   { brasil, estados: [...] }   (Brasil + 27 UFs)
 *   indicadores/{SIGLA}.json  { uf, municipios: [...] }
 *
 * O shard é nomeado por **SIGLA** (`MG.json`), não pelo código IBGE (`31.json`).
 * O campo `uf` DENTRO do arquivo, porém, é o código de 2 dígitos — assimetria
 * da própria publicação. Quem monta a rota converte código → sigla; quem lê o
 * conteúdo compara com o código.
 */

import { lerDados, siglaDaUf } from '../../lib/fontes'

export interface IndicadorPopulacao {
  total: number | null
  anoReferencia: number
  fonte: string
}

export interface IndicadorPib {
  valorTotalMilReais: number | null
  valorPerCapitaReais: number | null
  anoReferencia: number
  fonte: string
}

export interface IndicadorLocalidade {
  codarea: string
  nome: string
  populacao: IndicadorPopulacao | null
  pib: IndicadorPib | null
}

interface ArquivoBrasil {
  brasil: IndicadorLocalidade | null
  estados: IndicadorLocalidade[]
}

interface ArquivoUf {
  uf: string
  municipios: IndicadorLocalidade[]
}

/** Município com coordenadas e todas as métricas — base da camada de informação. */
export interface PontoMapa {
  codarea: string
  nome: string
  /** Sigla da UF (ex.: "SP"). */
  uf: string
  lng: number
  lat: number
  pib: number | null
  pibPerCapita: number | null
  populacao: number | null
  receitaTotal: number | null
  despesaTotal: number | null
  saude: number | null
  educacao: number | null
  /** Área em km². */
  area: number | null
  /** Sigla do partido do prefeito eleito em 2024. */
  prefeitoPartido: string | null
}

/**
 * Indicadores de um território.
 * - Brasil: consolidado nacional.
 * - Estado: consolidado da UF.
 * - Município: busca no arquivo da UF.
 */
export async function buscarIndicadores(
  nivel: 'brasil' | 'estado' | 'municipio',
  codigo: string,
): Promise<IndicadorLocalidade | null> {
  if (nivel === 'municipio') {
    // A rota é por SIGLA; o código de 2 dígitos não é nome de arquivo válido.
    const sigla = siglaDaUf(codigo)
    if (!sigla) return null

    const arquivo = await lerDados<ArquivoUf>(`indicadores/${sigla}.json`)
    return arquivo?.municipios.find((m) => m.codarea === codigo) ?? null
  }

  const dados = await lerDados<ArquivoBrasil>('indicadores/brasil.json')
  if (!dados) return null
  if (nivel === 'brasil') return dados.brasil
  return dados.estados.find((e) => e.codarea === codigo) ?? null
}

/**
 * Municípios com coordenadas e métricas, para a camada de informação do mapa.
 *
 * Lê o ÍNDICE (leve, sem métricas) e depois os BLOCOS, que trazem as métricas.
 * Antes devolvia `pontos` de um arquivo monolítico; a Caixa 7 publica
 * `municipios/indice.json` + `municipios/bloco-N.json`.
 */
export async function buscarPontosMapa(): Promise<PontoMapa[]> {
  const indice = await lerDados<{ municipios?: Array<{ codarea: string; nome: string; uf: string; lng: number; lat: number }> }>(
    'municipios/indice.json',
  )
  if (!indice?.municipios) return []

  // As métricas vivem nos blocos; o índice só localiza.
  const porCodarea = new Map<string, PontoMapa>()
  for (const entrada of indice.municipios) {
    porCodarea.set(entrada.codarea, {
      codarea: entrada.codarea,
      nome: entrada.nome,
      uf: entrada.uf,
      lng: entrada.lng,
      lat: entrada.lat,
      pib: null,
      pibPerCapita: null,
      populacao: null,
      receitaTotal: null,
      despesaTotal: null,
      saude: null,
      educacao: null,
      area: null,
      prefeitoPartido: null,
    })
  }

  for (let i = 0; i < 64; i++) {
    const bloco = await lerDados<{
      municipios?: Array<{
        codarea: string
        metricas: Record<string, number | null>
      }>
    }>(`municipios/bloco-${i}.json`)
    if (!bloco?.municipios || bloco.municipios.length === 0) break

    for (const m of bloco.municipios) {
      const ponto = porCodarea.get(m.codarea)
      if (!ponto) continue
      ponto.pib = m.metricas['pib'] ?? null
      ponto.pibPerCapita = m.metricas['pibPerCapita'] ?? null
      ponto.populacao = m.metricas['populacao'] ?? null
      ponto.receitaTotal = m.metricas['receita'] ?? null
      ponto.despesaTotal = m.metricas['despesa'] ?? null
      ponto.saude = m.metricas['saude'] ?? null
      ponto.educacao = m.metricas['educacao'] ?? null
      ponto.area = m.metricas['densidade'] !== null && m.metricas['populacao'] !== null && m.metricas['densidade'] !== 0
        ? Number((m.metricas['populacao'] / m.metricas['densidade']).toFixed(2))
        : null
    }
  }

  return [...porCodarea.values()]
}
