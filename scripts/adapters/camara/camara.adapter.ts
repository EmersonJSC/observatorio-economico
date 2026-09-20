/**
 * Adaptador: Câmara dos Deputados — Dados Abertos v2
 *
 * Fonte oficial: https://dadosabertos.camara.leg.br/api/v2/
 * Documentação:  https://dadosabertos.camara.leg.br/swagger/api.html
 * OpenAPI:       https://dadosabertos.camara.leg.br/api/v2/api-docs
 *
 * Responsabilidade: ingerir a representação federal na Câmara — deputados em
 * exercício, seus partidos, e as despesas da cota parlamentar (CEAP).
 *
 * ✅ NÃO EXIGE AUTENTICAÇÃO. É a única fonte nova sem chave.
 *
 * Convenções da API:
 *   - Toda listagem devolve `{ dados: [...], links: [{ rel, href }] }`.
 *   - Paginação por `pagina` (a partir de 1) e `itens` (máximo 100; padrão 15).
 *   - O `links` traz `next`/`last` — usamos `next` como condição de parada.
 *   - `/deputados/{id}/despesas` usa `ano` e `mes` como filtros.
 *
 * ⚠️  DIFERENÇA EM RELAÇÃO AO TSE:
 *   A Câmara identifica deputados por `id` próprio (ex.: 204554), que NÃO é o
 *   `sqCandidato` do TSE nem o `codarea` do IBGE. A ponte com o restante do
 *   projeto é feita por **nome civil + sigla da UF** contra
 *   `data/elections/de-para-tse-ibge.json` e os mandatos já ingeridos.
 *   O casamento é heurístico e pode falhar — por isso gravamos o `id` da Câmara
 *   como chave primária e deixamos a vinculação como enriquecimento opcional.
 *
 * Uso:
 *   import { CamaraAdapter } from './camara.adapter.js'
 *   const adapter = new CamaraAdapter()
 *   const deputados = await adapter.listarDeputados({ idLegislatura: 57 })
 */

import { fetchJsonComRetry } from '../http-client.js'

const BASE_URL = 'https://dadosabertos.camara.leg.br/api/v2'

// ---------------------------------------------------------------------------
// Interfaces de resposta
// ---------------------------------------------------------------------------

/** Envelope padrão de toda listagem da API da Câmara. */
export interface RespostaCamara<T> {
  dados: T[]
  links: Array<{ rel: string; href: string }>
}

/** Deputado na listagem (`/deputados`). */
export interface DeputadoCamara {
  id: number
  uri: string
  nome: string
  siglaPartido: string
  uriPartido: string
  siglaUf: string
  idLegislatura: number
  urlFoto: string
  email: string
}

/** Detalhe do deputado (`/deputados/{id}`) — traz nome civil e CPF. */
export interface DeputadoDetalhe {
  id: number
  uri: string
  nomeCivil: string
  ultimoStatus: {
    id: number
    uri: string
    nome: string
    siglaPartido: string
    uriPartido: string
    siglaUf: string
    idLegislatura: number
    urlFoto: string
    email: string
    data: string
    nomeEleitoral: string
    situacao: string
    condicaoEleitoral: string
    gabinete?: {
      nome: string
      predio: string
      sala: string
      andar: string
      telefone: string
      email: string
    }
  }
  cpf?: string
  sexo?: string
  dataNascimento?: string
  municipioNascimento?: string
  ufNascimento?: string
  escolaridade?: string
}

/** Partido (`/partidos`). */
export interface PartidoCamara {
  id: number
  sigla: string
  nome: string
  uri: string
  /** Presentes apenas quando o filtro por legislatura/data é usado. */
  dataInicio?: string
  dataFim?: string
  lider?: {
    uri: string
    nome: string
    siglaPartido: string
    uriPartido: string
    siglaUf: string
    idLegislatura: number
    urlFoto: string
    email: string
  }
}

/** Linha de despesa da cota parlamentar (`/deputados/{id}/despesas`). */
export interface DespesaCamara {
  ano: number
  mes: number
  tipoDespesa: string
  codDocumento: number
  tipoDocumento: string
  dataDocumento: string
  numDocumento: string
  valorDocumento: number
  valorGlosa: number
  valorLiquido: number
  nomeFornecedor: string
  cnpjCpfFornecedor: string
  urlDocumento?: string
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Máximo aceito pela API — valores maiores são ignorados. */
const MAX_ITENS = 100

/** Trava de segurança: uma paginação que não termina indica bug, não dado. */
const MAX_PAGINAS = 200

// ---------------------------------------------------------------------------
// Adaptador
// ---------------------------------------------------------------------------

export class CamaraAdapter {
  private readonly timeoutMs: number
  private readonly itens: number

  constructor(options: { timeoutMs?: number; itens?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.itens = Math.min(options.itens ?? MAX_ITENS, MAX_ITENS)
  }

  /** GET tipado com retry, timeout e paginação automática. */
  private async buscarPaginado<T>(
    caminho: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T[]> {
    const itens: T[] = []
    let pagina = 1
    let url: string | null = this.montarUrl(caminho, { ...params, itens: this.itens, pagina })

    while (url && pagina <= MAX_PAGINAS) {
      const atual: string = url
      const resposta = await fetchJsonComRetry<RespostaCamara<T>>(atual, {
        timeoutMs: this.timeoutMs,
        maxRetries: 3,
        baseDelayMs: 500,
      })

      const lote: T[] = resposta.data?.dados ?? []
      itens.push(...lote)

      // A própria API informa a próxima página; sem `next`, terminou.
      const links: Array<{ rel: string; href: string }> = resposta.data?.links ?? []
      const proximo: string | null = links.find((l) => l.rel === 'next')?.href ?? null
      if (!proximo || lote.length === 0) break

      url = proximo
      pagina++
    }

    if (pagina > MAX_PAGINAS) {
      console.warn(`    [Câmara] ⚠ paginação interrompida em ${MAX_PAGINAS} páginas (${caminho})`)
    }

    return itens
  }

  private montarUrl(caminho: string, params: Record<string, string | number | undefined>): string {
    const query = new URLSearchParams()
    for (const [chave, valor] of Object.entries(params)) {
      if (valor === undefined || valor === '') continue
      query.set(chave, String(valor))
    }
    const qs = query.toString()
    return `${BASE_URL}${caminho}${qs ? `?${qs}` : ''}`
  }

  /**
   * Lista deputados.
   *
   * Endpoint: GET /deputados
   *
   * Sem filtro de tempo/legislatura a API devolve apenas os deputados **em
   * exercício no momento da requisição** — que é o comportamento desejado para
   * a fotografia atual, mas não serve para legislaturas passadas.
   *
   * @param filtros.idLegislatura Ex.: 57 (2023-2027)
   * @param filtros.siglaUf        Ex.: 'MG'
   */
  async listarDeputados(
    filtros: { idLegislatura?: number; siglaUf?: string; siglaPartido?: string } = {},
  ): Promise<DeputadoCamara[]> {
    console.log('  [Câmara] → Baixando deputados…')
    const deputados = await this.buscarPaginado<DeputadoCamara>('/deputados', {
      idLegislatura: filtros.idLegislatura,
      siglaUf: filtros.siglaUf,
      siglaPartido: filtros.siglaPartido,
      ordem: 'ASC',
      ordenarPor: 'nome',
    })
    console.log(`  [Câmara] ✓ ${deputados.length} deputados`)
    return deputados
  }

  /** Detalhe de um deputado (nome civil, CPF, sexo, escolaridade). */
  async obterDeputado(id: number): Promise<DeputadoDetalhe | null> {
    const url = `${BASE_URL}/deputados/${id}`
    const { data } = await fetchJsonComRetry<{ dados: DeputadoDetalhe }>(url, {
      timeoutMs: this.timeoutMs,
      maxRetries: 3,
      baseDelayMs: 500,
    })
    return data?.dados ?? null
  }

  /**
   * Lista os partidos com representação na Câmara.
   *
   * Endpoint: GET /partidos
   *
   * ⚠️ A mesma sigla pode ter sido usada por partidos diferentes em
   * legislaturas distintas — por isso o `id` é a chave, e a sigla é rótulo.
   */
  async listarPartidos(filtros: { idLegislatura?: number } = {}): Promise<PartidoCamara[]> {
    console.log('  [Câmara] → Baixando partidos…')
    const partidos = await this.buscarPaginado<PartidoCamara>('/partidos', {
      idLegislatura: filtros.idLegislatura,
      ordem: 'ASC',
      ordenarPor: 'sigla',
    })
    console.log(`  [Câmara] ✓ ${partidos.length} partidos`)
    return partidos
  }

  /**
   * Despesas da cota parlamentar (CEAP) de um deputado.
   *
   * Endpoint: GET /deputados/{id}/despesas?ano={ano}
   *
   * Sem `ano`/`mes` a API devolve apenas os **seis meses anteriores** — o que
   * silenciosamente truncaria a série. Passamos o ano explicitamente.
   */
  async listarDespesas(idDeputado: number, ano: number, mes?: number): Promise<DespesaCamara[]> {
    return this.buscarPaginado<DespesaCamara>(`/deputados/${idDeputado}/despesas`, {
      ano,
      mes,
      ordem: 'ASC',
      ordenarPor: 'mes',
    })
  }

  /**
   * Smoke test de conectividade — usado por `scripts/test-adapters.ts`.
   *
   * Consulta os dois endpoints que sustentam a ingestão. Não valida
   * `/despesas` porque ele é instável no servidor da Câmara e devolveria
   * falso negativo (ver docs/APIS.md).
   */
  async testarConectividade(): Promise<boolean> {
    console.log('\n[Câmara] Testando conectividade…')
    try {
      const deputados = await this.buscarPaginado<DeputadoCamara>('/deputados', { itens: 1 })
      const partidos = await this.buscarPaginado<PartidoCamara>('/partidos', { itens: 1 })

      console.log(`  ✓ /deputados respondeu (${deputados.length} item(ns) na amostra)`)
      console.log(`  ✓ /partidos respondeu (${partidos.length} item(ns) na amostra)`)
      console.log('  ✓ Autenticação: não exigida')
      return deputados.length > 0 && partidos.length > 0
    } catch (err) {
      console.error(`  ✗ Falha: ${(err as Error).message}`)
      return false
    }
  }
}
