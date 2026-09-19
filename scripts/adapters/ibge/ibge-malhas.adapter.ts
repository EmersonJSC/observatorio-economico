/**
 * Adaptador: IBGE — API de Malhas Territoriais v3
 *
 * Fonte oficial: https://servicodados.ibge.gov.br/api/v3/malhas
 *
 * Responsabilidade: baixar polígonos GeoJSON das malhas territoriais
 * (estados e municípios) diretamente da API do IBGE.
 *
 * Rate Limit conhecido: não há documentação oficial de limite, mas
 * requisições paralelas excessivas podem gerar HTTP 429. Recomenda-se
 * execução sequencial por UF com delay entre requisições.
 *
 * Uso:
 *   import { IbgeMalhasAdapter } from './ibge-malhas.adapter.js'
 *   const adapter = new IbgeMalhasAdapter()
 *   const geojson = await adapter.baixarMalhaPaises('BR') // malha nacional de UFs
 *   const uf31 = await adapter.baixarMalhaEstado('31')   // municípios de MG
 */

import { fetchJsonComRetry } from '../http-client.js'

const BASE_URL = 'https://servicodados.ibge.gov.br/api/v3/malhas'
const FORMATO = 'application/vnd.geo+json'

export interface GeoJsonFeature {
  type: 'Feature'
  properties?: Record<string, unknown>
  geometry?: unknown
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

export class IbgeMalhasAdapter {
  private readonly timeoutMs: number

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  /**
   * Baixa a malha das Unidades Federativas do Brasil (intrarregião=UF).
   * Retorna um FeatureCollection com as 27 UFs e seus polígonos.
   *
   * Endpoint: GET /malhas/paises/BR?formato=geo+json&intrarregiao=UF
   */
  async baixarMalhaPaises(pais: 'BR' = 'BR'): Promise<GeoJsonFeatureCollection> {
    const url = `${BASE_URL}/paises/${pais}?formato=${FORMATO}&intrarregiao=UF`
    console.log(`  [IBGE Malhas] → Baixando malha de UFs (${pais})…`)

    const { data, durationMs } = await fetchJsonComRetry<GeoJsonFeatureCollection>(url, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
      baseDelayMs: 800,
    })

    console.log(
      `  [IBGE Malhas] ✓ ${data.features?.length ?? 0} UFs recebidas (${durationMs}ms)`,
    )
    return data
  }

  /**
   * Baixa a malha dos municípios de uma UF específica (intrarregião=municipio).
   *
   * @param uf - Código IBGE de 2 dígitos da UF (ex: '31' para MG)
   * Endpoint: GET /malhas/estados/{uf}?formato=geo+json&intrarregiao=municipio
   */
  async baixarMalhaEstado(uf: string): Promise<GeoJsonFeatureCollection> {
    const url = `${BASE_URL}/estados/${uf}?formato=${FORMATO}&intrarregiao=municipio`
    console.log(`  [IBGE Malhas] → Baixando malha de municípios da UF ${uf}…`)

    const { data, durationMs } = await fetchJsonComRetry<GeoJsonFeatureCollection>(url, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
      baseDelayMs: 800,
    })

    console.log(
      `  [IBGE Malhas] ✓ UF ${uf}: ${data.features?.length ?? 0} municípios recebidos (${durationMs}ms)`,
    )
    return data
  }

  /**
   * Valida a conectividade com a API de Malhas do IBGE.
   * Baixa apenas a malha nacional (leve) e exibe o resultado no console.
   */
  async testarConectividade(): Promise<boolean> {
    console.log('\n[IBGE Malhas] Testando conectividade…')
    try {
      const geojson = await this.baixarMalhaPaises('BR')
      const count = geojson.features?.length ?? 0
      console.log(`[IBGE Malhas] ✅ OK — ${count} UFs retornadas.`)
      if (count > 0) {
        const primeiraUf = geojson.features[0].properties?.codarea
        console.log(`[IBGE Malhas]    Exemplo: codarea=${primeiraUf}`)
      }
      return true
    } catch (err) {
      console.error(`[IBGE Malhas] ❌ Falha: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }
}
