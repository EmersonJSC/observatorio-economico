/**
 * Adaptador: IBGE — API de Agregados / SIDRA v3
 *
 * Fonte oficial: https://servicodados.ibge.gov.br/api/v3/agregados
 * Documentação: https://servicodados.ibge.gov.br/api/docs/agregados?versao=3
 *
 * Responsabilidade: consultar tabelas de indicadores socioeconômicos
 * do IBGE (População Estimada e PIB Municipal/Estadual) para ingestão
 * offline no dataset local `data/indicators/`.
 *
 * Tabelas utilizadas:
 *   - 6579 → Estimativa de população (Variável 9324)
 *   - 5938 → PIB a preços correntes (Variável 37, em Mil Reais)
 *
 *   ⚠️ PIB per capita: a tabela 5938 NÃO possui variável de "PIB per capita"
 *      (a variável 593 retorna HTTP 500). O valor per capita é CALCULADO
 *      localmente como: PIB total (Mil Reais) × 1000 ÷ População.
 *
 * Níveis territoriais (localidades):
 *   - N1 → Brasil
 *   - N3 → Unidades Federativas
 *   - N6 → Municípios (requer N3[uf] como filtro pai)
 *
 * Uso:
 *   import { IbgeSidraAdapter } from './ibge-sidra.adapter.js'
 *   const adapter = new IbgeSidraAdapter()
 *   const pop = await adapter.baixarPopulacaoUfs(2024)
 *   const pib = await adapter.baixarPibUfs(2021)
 *   const municipios = await adapter.baixarIndicadoresMunicipios('31', 2024, 2021)
 */

import { fetchJsonComRetry } from '../http-client.js'

const BASE_URL = 'https://servicodados.ibge.gov.br/api/v3/agregados'

// ---------------------------------------------------------------------------
// Constantes das tabelas e variáveis do SIDRA
// ---------------------------------------------------------------------------

const TABELA_POPULACAO = '6579'
const VARIAVEL_POPULACAO = '9324'
const TABELA_PIB = '5938'
const VARIAVEL_PIB_TOTAL = '37'

// ---------------------------------------------------------------------------
// Interfaces de resposta da API SIDRA
// ---------------------------------------------------------------------------

/** Formato JSON retornado pela API de Agregados do IBGE */
export interface SidraAgregadoItem {
  id: string
  variavel: string
  unidade: string
  resultados: Array<{
    classificacoes: unknown[]
    series: Array<{
      localidade: {
        id: string
        nivel: { id: string; nome: string }
        nome: string
      }
      /** Dicionário: { "2021": "123456", "2022": "..." } */
      serie: Record<string, string>
    }>
  }>
}

/** Métricas consolidadas de uma localidade após processamento */
export interface IndicadoresLocalidade {
  /** Código IBGE (2 dígitos para UF, 7 dígitos para município) */
  codarea: string
  nome: string
  populacao: {
    total: number | null
    anoReferencia: number
    fonte: string
  } | null
  pib: {
    valorTotalMilReais: number | null
    valorPerCapitaReais: number | null
    anoReferencia: number
    fonte: string
  } | null
}

// ---------------------------------------------------------------------------
// Helpers de parsing
// ---------------------------------------------------------------------------

/**
 * Converte o valor em string do IBGE para number ou null.
 * O IBGE pode retornar "-", "...", "X" ou "C" para dados suprimidos/indisponíveis.
 */
function parseValorIbge(valorStr: string | undefined): number | null {
  if (!valorStr || ['-', '...', 'X', 'C', ''].includes(valorStr.trim())) return null
  const num = Number(valorStr.replace(',', '.'))
  return Number.isNaN(num) ? null : num
}

/**
 * Extrai o valor de um período específico da série temporal.
 * Se o ano exato não existir, usa o último período disponível.
 */
function extrairDaSerie(serie: Record<string, string>, ano: number): number | null {
  const chave = String(ano)
  const valorStr = serie[chave] ?? serie[Object.keys(serie).at(-1) ?? '']
  return parseValorIbge(valorStr)
}

/**
 * Constrói um Map<codarea, valor> a partir de um item da resposta SIDRA.
 */
function construirMapaDeSeries(
  item: SidraAgregadoItem,
  ano: number,
): Map<string, number | null> {
  const mapa = new Map<string, number | null>()
  for (const resultado of item.resultados) {
    for (const serie of resultado.series) {
      mapa.set(serie.localidade.id, extrairDaSerie(serie.serie, ano))
    }
  }
  return mapa
}

/**
 * Calcula o PIB per capita a partir do PIB total (em Mil Reais) e da população.
 * Retorna `null` quando qualquer um dos insumos está indisponível ou é zero.
 */
export function calcularPibPerCapita(
  pibMilReais: number | null,
  populacao: number | null,
): number | null {
  if (pibMilReais === null || populacao === null || populacao === 0) return null
  return Number(((pibMilReais * 1000) / populacao).toFixed(2))
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class IbgeSidraAdapter {
  private readonly timeoutMs: number

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 45_000
  }

  /**
   * Baixa estimativas de população para todas as UFs (N3) e Brasil (N1).
   *
   * @returns Map<codarea_string, populacao_total>
   */
  async baixarPopulacaoUfs(ano: number): Promise<Map<string, number | null>> {
    const url = `${BASE_URL}/${TABELA_POPULACAO}/periodos/${ano}/variaveis/${VARIAVEL_POPULACAO}?localidades=N1[all]|N3[all]`
    console.log(`  [IBGE SIDRA] → Baixando população UFs (Tabela ${TABELA_POPULACAO}, ano ${ano})…`)

    const { data, durationMs } = await fetchJsonComRetry<SidraAgregadoItem[]>(url, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
      baseDelayMs: 600,
    })

    const mapa = construirMapaDeSeries(data[0], ano)
    console.log(`  [IBGE SIDRA] ✓ População UFs: ${mapa.size} localidades (${durationMs}ms)`)
    return mapa
  }

  /**
   * Baixa dados de PIB total (a preços correntes, em Mil Reais) para todas as
   * UFs (N3) e Brasil (N1).
   *
   * @returns Map<codarea_string, pib_total_mil_reais>
   */
  async baixarPibUfs(ano: number): Promise<Map<string, number | null>> {
    const url = `${BASE_URL}/${TABELA_PIB}/periodos/${ano}/variaveis/${VARIAVEL_PIB_TOTAL}?localidades=N1[all]|N3[all]`
    console.log(`  [IBGE SIDRA] → Baixando PIB UFs (Tabela ${TABELA_PIB}, ano ${ano})…`)

    const { data, durationMs } = await fetchJsonComRetry<SidraAgregadoItem[]>(url, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
      baseDelayMs: 600,
    })

    const mapa = construirMapaDeSeries(data[0], ano)
    console.log(`  [IBGE SIDRA] ✓ PIB UFs: ${mapa.size} localidades (${durationMs}ms)`)
    return mapa
  }

  /**
   * Baixa indicadores de população e PIB para todos os municípios de uma UF.
   *
   * O PIB per capita é calculado com a população do MESMO ano do PIB
   * (`anoPib`), garantindo consistência temporal.
   *
   * @param uf - Código IBGE de 2 dígitos (ex: '31' para MG)
   * @param anoPopulacao - Ano de referência para população (ex: 2024)
   * @param anoPib - Ano de referência para PIB (ex: 2021)
   */
  async baixarIndicadoresMunicipios(
    uf: string,
    anoPopulacao: number,
    anoPib: number,
  ): Promise<IndicadoresLocalidade[]> {
    console.log(`  [IBGE SIDRA] → Baixando indicadores dos municípios da UF ${uf}…`)

    // População (ano de referência da população)
    const urlPop = `${BASE_URL}/${TABELA_POPULACAO}/periodos/${anoPopulacao}/variaveis/${VARIAVEL_POPULACAO}?localidades=N6[N3[${uf}]]`
    const { data: dataPop } = await fetchJsonComRetry<SidraAgregadoItem[]>(urlPop, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
      baseDelayMs: 700,
    })
    const mapaPopulacao = construirMapaDeSeries(dataPop[0], anoPopulacao)

    // População do ano do PIB (para calcular per capita com anos consistentes)
    let mapaPopulacaoPibAno = mapaPopulacao
    if (anoPib !== anoPopulacao) {
      const urlPopPib = `${BASE_URL}/${TABELA_POPULACAO}/periodos/${anoPib}/variaveis/${VARIAVEL_POPULACAO}?localidades=N6[N3[${uf}]]`
      const { data: dataPopPib } = await fetchJsonComRetry<SidraAgregadoItem[]>(urlPopPib, {
        timeoutMs: this.timeoutMs,
        maxRetries: 3,
        baseDelayMs: 700,
      })
      mapaPopulacaoPibAno = construirMapaDeSeries(dataPopPib[0], anoPib)
    }

    // PIB total (ano de referência do PIB)
    const urlPib = `${BASE_URL}/${TABELA_PIB}/periodos/${anoPib}/variaveis/${VARIAVEL_PIB_TOTAL}?localidades=N6[N3[${uf}]]`
    const { data: dataPib } = await fetchJsonComRetry<SidraAgregadoItem[]>(urlPib, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
      baseDelayMs: 700,
    })
    const mapaPibTotal = construirMapaDeSeries(dataPib[0], anoPib)

    // Consolidar por município: unir pelo codarea
    const codareas = new Set([...mapaPopulacao.keys(), ...mapaPibTotal.keys()])
    const indicadores: IndicadoresLocalidade[] = []

    for (const codarea of codareas) {
      const nomeMunicipio =
        dataPop[0]?.resultados[0]?.series.find((s) => s.localidade.id === codarea)
          ?.localidade.nome ?? codarea

      const pibTotal = mapaPibTotal.get(codarea) ?? null
      const populacaoPibAno = mapaPopulacaoPibAno.get(codarea) ?? null

      indicadores.push({
        codarea,
        nome: nomeMunicipio,
        populacao: {
          total: mapaPopulacao.get(codarea) ?? null,
          anoReferencia: anoPopulacao,
          fonte: `IBGE — Tabela SIDRA ${TABELA_POPULACAO}`,
        },
        pib: {
          valorTotalMilReais: pibTotal,
          valorPerCapitaReais: calcularPibPerCapita(pibTotal, populacaoPibAno),
          anoReferencia: anoPib,
          fonte: `IBGE — Tabela SIDRA ${TABELA_PIB}`,
        },
      })
    }

    console.log(
      `  [IBGE SIDRA] ✓ UF ${uf}: ${indicadores.length} municípios com indicadores consolidados`,
    )
    return indicadores
  }

  /**
   * Valida a conectividade com a API SIDRA do IBGE.
   * Busca a população do Brasil (N1) para o ano mais recente disponível.
   */
  async testarConectividade(): Promise<boolean> {
    console.log('\n[IBGE SIDRA] Testando conectividade…')
    try {
      const url = `${BASE_URL}/${TABELA_POPULACAO}/periodos/2024/variaveis/${VARIAVEL_POPULACAO}?localidades=N1[all]`
      const { data, durationMs } = await fetchJsonComRetry<SidraAgregadoItem[]>(url, {
        timeoutMs: this.timeoutMs,
        maxRetries: 3,
      })

      const series = data[0]?.resultados[0]?.series ?? []
      const brasil = series[0]
      const valorBrasil = brasil?.serie?.['2024'] ?? '—'
      console.log(`[IBGE SIDRA] ✅ OK — Resposta em ${durationMs}ms`)
      console.log(
        `[IBGE SIDRA]    Exemplo: ${brasil?.localidade?.nome ?? 'Brasil'} | População 2024: ${valorBrasil}`,
      )
      return true
    } catch (err) {
      console.error(`[IBGE SIDRA] ❌ Falha: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }
}
