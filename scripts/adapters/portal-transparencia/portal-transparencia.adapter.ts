/**
 * Adaptador: Portal da Transparência — API de Dados
 *
 * Fonte oficial: https://portaldatransparencia.gov.br/api-de-dados
 * Documentação:  https://api.portaldatransparencia.gov.br/swagger-ui/
 * OpenAPI:       https://api.portaldatransparencia.gov.br/v3/api-docs  (106 endpoints)
 *
 * 🔑 AUTENTICAÇÃO OBRIGATÓRIA
 *   Header `chave-api-dados`. Cadastro gratuito em:
 *     https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email
 *   Configure em `.env`:
 *     PORTAL_API_KEY="sua_chave"
 *
 *   Sem chave a API responde HTTP 401 com corpo JSON `{ "Erro na API": "..." }`.
 *
 * ⚠️  RATE LIMIT
 *   O limite é por chave e por período (documentado como ~90 req/min para o
 *   plano gratuito, podendo variar). Os endpoints *por município* exigem uma
 *   requisição por município — varrer os 5.570 é lento por construção. Este
 *   adaptador pausa entre chamadas e aceita um limite explícito.
 *
 * Escopo deste adaptador (subconjunto essencial do projeto):
 *   - Despesas por órgão            → escala do gasto federal
 *   - Emendas parlamentares         → liga o Congresso ao orçamento
 *   - Programas sociais por município → cruza com codarea IBGE
 *   - Órgãos SIAFI/SIAPE            → dicionário de códigos de órgão
 *
 * Os demais endpoints (contratos, licitações, servidores, sanções, viagens,
 * imóveis, notas fiscais…) estão catalogados em docs/APIS.md.
 *
 * Uso:
 *   import { PortalTransparenciaAdapter } from './portal-transparencia.adapter.js'
 *   const adapter = new PortalTransparenciaAdapter({ chave: process.env.PORTAL_API_KEY })
 *   const despesas = await adapter.despesasPorOrgao(2024)
 */

import { fetchJsonComRetry, pausar } from '../http-client.js'
import { exigirEnv, lerEnv } from '../../lib/env.js'

const BASE_URL = 'https://api.portaldatransparencia.gov.br/api-de-dados'

// ---------------------------------------------------------------------------
// Interfaces de resposta
// ---------------------------------------------------------------------------

/** Despesa agregada por órgão (`/despesas/por-orgao`). */
export interface DespesaPorOrgao {
  ano: number
  mes?: number
  orgao: string
  orgaoSuperior?: string
  /** Valor empenhado, em reais. */
  empenhado: number | string
  liquidado: number | string
  pago: number | string
}

/** Emenda parlamentar (`/emendas`). */
export interface EmendaParlamentar {
  codigoEmenda: string
  numeroEmenda: string
  ano: number
  tipoEmenda: string
  autor: string
  nomeAutor?: string
  localidadeDoGasto?: string
  funcao?: string
  subfuncao?: string
  valorEmpenhado?: number | string
  valorLiquidado?: number | string
  valorPago?: number | string
  valorRestoInscrito?: number | string
  valorRestoCancelado?: number | string
  valorRestoPago?: number | string
}

/**
 * Parcela de programa social por município.
 *
 * Os campos variam por programa (Bolsa Família, BPC, Auxílio Brasil…), então
 * mantemos os campos conhecidos e um índice para o restante. `codigoIbge` é o
 * `codarea` do projeto — é a chave de junção com o mapa.
 */
export interface ProgramaSocialMunicipio {
  codigoIbge: string
  nomeMunicipio?: string
  uf?: string
  mesAno?: string
  valor?: number | string
  quantidadeBeneficiados?: number | string
  [campo: string]: unknown
}

/** Órgão no SIAFI (`/orgaos-siafi`) ou SIAPE (`/orgaos-siape`). */
export interface OrgaoPortal {
  codigo: string
  descricao: string
  [campo: string]: unknown
}

// ---------------------------------------------------------------------------
// Adaptador
// ---------------------------------------------------------------------------

export interface PortalOptions {
  /** Chave da API. Se omitida, é lida de PORTAL_API_KEY. */
  chave?: string
  timeoutMs?: number
  /** Pausa entre requisições, em ms. Protege contra o rate limit. */
  delayMs?: number
}

export class PortalTransparenciaAdapter {
  /** `null` quando a chave não foi configurada — ver `exigirChave()`. */
  private readonly chave: string | null
  private readonly timeoutMs: number
  private readonly delayMs: number

  constructor(options: PortalOptions = {}) {
    // A chave é resolvida de forma tardia: o construtor não lança, para que o
    // smoke test consiga reportar a ausência com instruções em vez de estourar
    // durante a instanciação. A falha acontece na primeira requisição.
    this.chave = options.chave ?? lerEnv('PORTAL_API_KEY')
    this.timeoutMs = options.timeoutMs ?? 45_000
    this.delayMs = options.delayMs ?? 350
  }

  /** `true` quando há chave configurada (não valida se ela é aceita pela API). */
  temChave(): boolean {
    return this.chave !== null
  }

  /** Devolve a chave ou lança com instruções de como obtê-la. */
  private exigirChave(): string {
    if (this.chave) return this.chave
    return exigirEnv(
      'PORTAL_API_KEY',
      'Cadastre-se gratuitamente em https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email',
    )
  }

  private montarUrl(caminho: string, params: Record<string, string | number | undefined> = {}): string {
    const query = new URLSearchParams()
    for (const [chave, valor] of Object.entries(params)) {
      if (valor === undefined || valor === '') continue
      query.set(chave, String(valor))
    }
    const qs = query.toString()
    return `${BASE_URL}${caminho}${qs ? `?${qs}` : ''}`
  }

  /** GET autenticado com retry. A API é paginada por `pagina` (a partir de 1). */
  private async buscar<T>(
    caminho: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T[]> {
    const url = this.montarUrl(caminho, params)
    const { data } = await fetchJsonComRetry<T[]>(url, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
      baseDelayMs: 1000,
      headers: { 'chave-api-dados': this.exigirChave() },
    })
    return Array.isArray(data) ? data : []
  }

  /**
   * Busca todas as páginas de um endpoint paginado.
   *
   * A API não informa o total nem a última página; a parada é a página vazia
   * ou menor que o esperado. `maxPaginas` evita loop infinito se o
   * comportamento mudar.
   */
  private async buscarTodasPaginas<T>(
    caminho: string,
    params: Record<string, string | number | undefined> = {},
    maxPaginas = 100,
  ): Promise<T[]> {
    const itens: T[] = []

    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      const lote = await this.buscar<T>(caminho, { ...params, pagina })
      itens.push(...lote)
      if (lote.length === 0) break
      await pausar(this.delayMs)
    }

    return itens
  }

  // -------------------------------------------------------------------------
  // Despesas
  // -------------------------------------------------------------------------

  /**
   * Despesas do Poder Executivo Federal agregadas por órgão.
   *
   * Endpoint: GET /despesas/por-orgao?ano={ano}
   * Parâmetros: `ano` (obrigatório), `orgaoSuperior`, `orgao`, `pagina`.
   */
  async despesasPorOrgao(ano: number, filtros: { orgaoSuperior?: string } = {}): Promise<DespesaPorOrgao[]> {
    console.log(`  [Portal] → Despesas por órgão (${ano})…`)
    const dados = await this.buscarTodasPaginas<DespesaPorOrgao>('/despesas/por-orgao', {
      ano,
      orgaoSuperior: filtros.orgaoSuperior,
    })
    console.log(`  [Portal] ✓ ${dados.length} registros de despesa por órgão`)
    return dados
  }

  // -------------------------------------------------------------------------
  // Emendas parlamentares
  // -------------------------------------------------------------------------

  /**
   * Emendas parlamentares.
   *
   * Endpoint: GET /emendas?ano={ano}
   * Filtros: `codigoEmenda`, `numeroEmenda`, `nomeAutor`, `tipoEmenda`, `ano`,
   *          `codigoFuncao`, `codigoSubfuncao`, `pagina`.
   *
   * É o elo natural com a API da Câmara: `nomeAutor` casa com o nome
   * parlamentar dos deputados ingeridos pelo outro adaptador.
   */
  async listarEmendas(ano: number, filtros: { nomeAutor?: string; tipoEmenda?: string } = {}): Promise<EmendaParlamentar[]> {
    console.log(`  [Portal] → Emendas parlamentares (${ano})…`)
    const dados = await this.buscarTodasPaginas<EmendaParlamentar>('/emendas', {
      ano,
      nomeAutor: filtros.nomeAutor,
      tipoEmenda: filtros.tipoEmenda,
    })
    console.log(`  [Portal] ✓ ${dados.length} emendas`)
    return dados
  }

  // -------------------------------------------------------------------------
  // Programas sociais por município
  // -------------------------------------------------------------------------

  /**
   * Parcelas de um programa social em um município.
   *
   * Endpoint: GET /{programa}-por-municipio?mesAno={mm/aaaa}&codigoIbge={codarea}
   *
   * Programas com esse formato: `bolsa-familia`, `novo-bolsa-familia`,
   * `auxilio-brasil`, `auxilio-emergencial`, `bpc`, `peti`, `safra`,
   * `seguro-defeso`.
   *
   * ⚠️ `codigoIbge` é o código de 6 dígitos sem dígito verificador em algumas
   * respostas — normalizamos para os 7 dígitos do projeto quando possível.
   */
  async programaSocialPorMunicipio(
    programa: string,
    codigoIbge: string,
    mesAno: string,
  ): Promise<ProgramaSocialMunicipio[]> {
    return this.buscar<ProgramaSocialMunicipio>(`/${programa}-por-municipio`, {
      mesAno,
      codigoIbge,
    })
  }

  // -------------------------------------------------------------------------
  // Dicionários de órgãos
  // -------------------------------------------------------------------------

  /** Órgãos no SIAFI. Endpoint: GET /orgaos-siafi */
  async listarOrgaosSiafi(): Promise<OrgaoPortal[]> {
    console.log('  [Portal] → Órgãos SIAFI…')
    const dados = await this.buscarTodasPaginas<OrgaoPortal>('/orgaos-siafi')
    console.log(`  [Portal] ✓ ${dados.length} órgãos SIAFI`)
    return dados
  }

  /** Órgãos no SIAPE. Endpoint: GET /orgaos-siape */
  async listarOrgaosSiape(): Promise<OrgaoPortal[]> {
    console.log('  [Portal] → Órgãos SIAPE…')
    const dados = await this.buscarTodasPaginas<OrgaoPortal>('/orgaos-siape')
    console.log(`  [Portal] ✓ ${dados.length} órgãos SIAPE`)
    return dados
  }

  /**
   * Verifica se a chave é válida antes de iniciar uma ingestão longa.
   * Usa o endpoint mais barato do catálogo.
   */
  async verificarChave(): Promise<boolean> {
    try {
      await this.buscar<OrgaoPortal>('/orgaos-siafi', { pagina: 1 })
      return true
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('401')) {
        console.error('  [Portal] ✗ Chave inválida ou expirada. Gere outra em https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email')
      }
      return false
    }
  }

  /**
   * Smoke test de conectividade — usado por `scripts/test-adapters.ts`.
   *
   * Diferente dos outros adaptadores, a ausência de chave é uma falha
   * legítima: sem ela a API responde 401 e nada pode ser ingerido.
   */
  async testarConectividade(): Promise<boolean> {
    console.log('\n[Portal da Transparência] Testando conectividade…')

    // Sem chave não há o que testar — reporta o motivo em vez de tentar a rede.
    if (!this.temChave()) {
      console.error('  ✗ PORTAL_API_KEY não configurada.')
      console.error('    1. Cadastre-se em: https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email')
      console.error('    2. Copie .env.example para .env e preencha PORTAL_API_KEY')
      return false
    }

    try {
      const orgaos = await this.buscar<OrgaoPortal>('/orgaos-siafi', { pagina: 1 })
      console.log(`  ✓ /orgaos-siafi respondeu com ${orgaos.length} item(ns) na amostra`)
      console.log('  ✓ Autenticação: chave aceita')
      return orgaos.length > 0
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('401')) {
        console.error('  ✗ Chave inválida ou expirada (HTTP 401).')
        console.error('    Gere outra em: https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email')
      } else {
        console.error(`  ✗ Falha: ${msg}`)
      }
      return false
    }
  }
}
