/**
 * Adaptador: IBGE — API de Localidades v1
 *
 * Fonte oficial: https://servicodados.ibge.gov.br/api/v1/localidades
 *
 * Responsabilidade: retornar nomes oficiais, siglas e metadados de
 * estados e municípios brasileiros. Usado para enriquecer os arquivos
 * GeoJSON da API de Malhas, que fornece apenas o `codarea` numérico.
 *
 * Rate Limit: não documentado oficialmente. A API de Localidades é
 * considerada estável e leve — requisições por estado são seguras.
 *
 * Uso:
 *   import { IbgeLocalidadesAdapter } from './ibge-localidades.adapter.js'
 *   const adapter = new IbgeLocalidadesAdapter()
 *   const estados = await adapter.listarEstados()
 *   const municipiosMG = await adapter.listarMunicipiosPorUf('31')
 */

import { fetchJsonComRetry } from '../http-client.js'

const BASE_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades'

// ---------------------------------------------------------------------------
// Interfaces de resposta da API de Localidades
// ---------------------------------------------------------------------------

export interface UfLocalidade {
  /** Código IBGE de 2 dígitos (ex: 31 para MG) */
  id: number
  sigla: string
  nome: string
  regiao: {
    id: number
    sigla: string
    nome: string
  }
}

export interface MunicipioLocalidade {
  /** Código IBGE de 7 dígitos (ex: 3136702 para São João del-Rei) */
  id: number
  nome: string
  microrregiao?: {
    id: number
    nome: string
    mesorregiao?: {
      id: number
      nome: string
      UF?: { id: number; sigla: string; nome: string }
    }
  }
  'regiao-imediata'?: {
    id: number
    nome: string
    'regiao-intermediaria'?: {
      id: number
      nome: string
      UF?: { id: number; sigla: string; nome: string }
    }
  }
}

export class IbgeLocalidadesAdapter {
  private readonly timeoutMs: number

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 20_000
  }

  /**
   * Retorna a lista completa de Unidades Federativas com siglas e nomes oficiais.
   * Endpoint: GET /localidades/estados
   */
  async listarEstados(): Promise<UfLocalidade[]> {
    const url = `${BASE_URL}/estados`
    console.log('  [IBGE Localidades] → Buscando lista de estados…')

    const { data, durationMs } = await fetchJsonComRetry<UfLocalidade[]>(url, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
    })

    console.log(`  [IBGE Localidades] ✓ ${data.length} estados recebidos (${durationMs}ms)`)
    return data
  }

  /**
   * Retorna todos os municípios de uma UF específica com nomes e referências de UF.
   *
   * @param uf - Código IBGE de 2 dígitos da UF
   * Endpoint: GET /localidades/estados/{uf}/municipios
   */
  async listarMunicipiosPorUf(uf: string): Promise<MunicipioLocalidade[]> {
    const url = `${BASE_URL}/estados/${uf}/municipios`
    console.log(`  [IBGE Localidades] → Buscando municípios da UF ${uf}…`)

    const { data, durationMs } = await fetchJsonComRetry<MunicipioLocalidade[]>(url, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
    })

    console.log(
      `  [IBGE Localidades] ✓ UF ${uf}: ${data.length} municípios recebidos (${durationMs}ms)`,
    )
    return data
  }

  /**
   * Retorna os dados de um único município pelo código IBGE de 7 dígitos.
   * Endpoint: GET /localidades/municipios/{codarea}
   */
  async buscarMunicipio(codarea: string): Promise<MunicipioLocalidade> {
    const url = `${BASE_URL}/municipios/${codarea}`
    const { data } = await fetchJsonComRetry<MunicipioLocalidade>(url, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
    })
    return data
  }

  /**
   * Cria um índice Map<codarea_string, UfLocalidade> para lookup O(1) por código.
   */
  async indexarEstados(): Promise<Map<string, UfLocalidade>> {
    const lista = await this.listarEstados()
    return new Map(lista.map((uf) => [String(uf.id), uf]))
  }

  /**
   * Cria um índice Map<codarea_string, MunicipioLocalidade> para lookup O(1) por código.
   */
  async indexarMunicipiosPorUf(uf: string): Promise<Map<string, MunicipioLocalidade>> {
    const lista = await this.listarMunicipiosPorUf(uf)
    return new Map(lista.map((m) => [String(m.id), m]))
  }

  /**
   * Valida a conectividade com a API de Localidades do IBGE.
   * Busca a lista de estados e exibe uma amostra no console.
   */
  async testarConectividade(): Promise<boolean> {
    console.log('\n[IBGE Localidades] Testando conectividade…')
    try {
      const estados = await this.listarEstados()
      console.log(`[IBGE Localidades] ✅ OK — ${estados.length} estados retornados.`)
      const mg = estados.find((e) => e.sigla === 'MG')
      if (mg) {
        console.log(
          `[IBGE Localidades]    Exemplo: id=${mg.id} | sigla=${mg.sigla} | nome=${mg.nome}`,
        )
      }
      return true
    } catch (err) {
      console.error(
        `[IBGE Localidades] ❌ Falha: ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }
  }
}
