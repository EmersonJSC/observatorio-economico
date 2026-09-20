/**
 * Caixa 2 — COLETOR EXTERNO: orquestração.
 *
 * Fluxo de uma coleta (docs/PLANO_CAIXA_2_COLETOR.md §4):
 *
 *   1. resolver URL base (`urlBaseEfetiva`) + substituir placeholders
 *   2. resolver credencial pelo NOME declarado → falha ANTES se ausente
 *   3. escolher transporte pelo `transporte` declarado
 *   4. executar, respeitando `rateLimit` e a política central
 *   5. paginar conforme a estratégia declarada
 *   6. ler o corpo como BYTES (nunca `json()` aqui)
 *   7. calcular hash sobre os bytes
 *   8. emitir `ResultadoColeta` com bytes + procedência
 *
 * Este módulo NÃO interpreta o conteúdo, NÃO transforma, NÃO grava em `data/`.
 */

import { createHash } from 'node:crypto'

import { urlBaseEfetiva } from '../fontes/catalogo.js'
import type { Fonte, Parametro, Recurso } from '../fontes/tipos.js'
import { politicaPara } from './politicas.js'
import { decidirProximaPagina, parametrosDePagina, type PaginaBruta } from './paginacao.js'
import { requisitar } from './transportes/http.js'
import { consultarBigQuery } from './transportes/bigquery.js'
import { baixarComNavegador, resultadoManual } from './transportes/navegador.js'
import type {
  ChamadaResolvida,
  DependenciasColetor,
  MotivoFalha,
  PaginaColeta,
  Procedencia,
  RequisicaoColeta,
  ResultadoColeta,
} from './tipos.js'
import { VERSAO_COLETOR } from './tipos.js'

// ---------------------------------------------------------------------------
// Erros de declaração
// ---------------------------------------------------------------------------

/** Erro de declaração: o catálogo não descreve o que a coleta precisa. */
export class ErroDeclaracao extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErroDeclaracao'
  }
}

// ---------------------------------------------------------------------------
// Resolução de parâmetros e fan-out
// ---------------------------------------------------------------------------

/**
 * Resolve o valor de um parâmetro para uma chamada.
 *
 * Precedência: `parametros` explícitos → valor da dimensão → `exemplo` do
 * catálogo → valor fixo (`valores` com 1 item).
 */
function valorDoParametro(
  p: Parametro,
  req: RequisicaoColeta,
  valorDaDimensao?: string,
): string | undefined {
  const explicito = req.parametros?.[p.nome]
  if (explicito !== undefined) return explicito
  if (p.dimensao && valorDaDimensao !== undefined) return valorDaDimensao
  if (p.exemplo !== undefined) return p.exemplo
  if (p.valores && p.valores.length === 1) return p.valores[0]
  return undefined
}

/**
 * Expande um recurso em chamadas concretas.
 *
 * Fan-out: cada parâmetro com `dimensao` gera N valores. Um recurso com mais de
 * uma dimensão produz o produto cartesiano (docs/PLANO_CAIXA_2_COLETOR.md §5).
 */
export function expandirChamadas(
  fonte: Fonte,
  recurso: Recurso,
  req: RequisicaoColeta,
): ChamadaResolvida[] {
  const base = urlBaseEfetiva(fonte, recurso)

  // Dimensões usadas por este recurso, na ordem declarada no catálogo.
  const dimensoes = (recurso.parametros ?? []).filter((p) => p.dimensao)

  // Cada combinação de valores de dimensão vira uma chamada.
  let combinacoes: Array<Record<string, string>> = [{}]

  for (const dim of dimensoes) {
    const nomeDim = dim.dimensao as string
    const valores = req.dimensoes?.[nomeDim]

    if (!valores || valores.length === 0) {
      // Sem lista de expansão, cai no `exemplo` declarado (uma única chamada).
      if (dim.exemplo === undefined) {
        throw new ErroDeclaracao(
          `recurso ${fonte.id}/${recurso.id}: dimensão "${nomeDim}" não tem valores e ` +
            `o parâmetro "${dim.nome}" não declara exemplo`,
        )
      }
      continue
    }

    const proximas: Array<Record<string, string>> = []
    for (const combinacao of combinacoes) {
      for (const valor of valores) {
        proximas.push({ ...combinacao, [nomeDim]: valor })
      }
    }
    combinacoes = proximas
  }

  return combinacoes.map((combinacao) => {
    const parametros: Record<string, string> = {}

    for (const p of recurso.parametros ?? []) {
      const valor = valorDoParametro(p, req, p.dimensao ? combinacao[p.dimensao] : undefined)
      if (valor === undefined) {
        if (p.obrigatorio && !recurso.caminho.includes(`{${p.nome}}`)) {
          throw new ErroDeclaracao(
            `recurso ${fonte.id}/${recurso.id}: parâmetro obrigatório "${p.nome}" sem valor`,
          )
        }
        continue
      }
      parametros[p.nome] = valor
    }

    // Substitui placeholders do caminho. Placeholder sem valor é erro de
    // declaração — melhor falhar alto do que montar URL errada.
    const caminho = recurso.caminho.replace(/\{([^}]+)\}/g, (_m, nome: string) => {
      const valor = parametros[nome]
      if (valor === undefined) {
        throw new ErroDeclaracao(
          `recurso ${fonte.id}/${recurso.id}: placeholder "{${nome}}" do caminho sem valor`,
        )
      }
      return encodeURIComponent(valor)
    })

    if (!base) {
      throw new ErroDeclaracao(
        `recurso ${fonte.id}/${recurso.id}: sem URL base (nem própria nem herdada da fonte)`,
      )
    }

    // Parâmetros que não estão no caminho vão para a query string.
    const naQuery = Object.entries(parametros).filter(
      ([nome]) => !recurso.caminho.includes(`{${nome}}`),
    )
    const query = new URLSearchParams(naQuery).toString()
    const url = query ? `${base}${caminho}?${query}` : `${base}${caminho}`

    return {
      recurso,
      fonteId: fonte.id,
      url,
      metodo: recurso.metodo ?? 'GET',
      parametros,
      ...(req.corpo ? { corpo: req.corpo } : {}),
      ...(req.maxPaginas !== undefined ? { maxPaginas: req.maxPaginas } : {}),
    }
  })
}

// ---------------------------------------------------------------------------
// Credenciais
// ---------------------------------------------------------------------------

/** Resultado da resolução de credencial. */
export type CredencialResolvida =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; mensagem: string }

/**
 * Resolve a credencial pelo NOME declarado na Caixa 1.
 *
 * Nunca lê valor do catálogo — só o nome da variável de ambiente. Falha ANTES
 * de qualquer requisição, evitando varreduras longas que terminariam em 401.
 */
export function resolverCredencial(
  fonte: Fonte,
  ambiente: Readonly<Record<string, string | undefined>>,
): CredencialResolvida {
  const cred = fonte.credencial
  if (!cred) return { ok: true, headers: {} }

  const valor = ambiente[cred.env]
  if (!valor || valor.trim() === '') {
    return {
      ok: false,
      mensagem:
        `credencial ausente: a variável ${cred.env} não está definida.\n` +
        (cred.comoObter ? `  Como obter: ${cred.comoObter}` : ''),
    }
  }

  const headers: Record<string, string> = {}
  if (cred.header) {
    headers[cred.header] = cred.esquema ? cred.esquema.replace('{valor}', valor) : valor
  }
  return { ok: true, headers }
}

// ---------------------------------------------------------------------------
// Coleta
// ---------------------------------------------------------------------------

/** Calcula o hash `sha256` dos bytes exatos. */
export function hashDosBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function montarProcedencia(
  fonteId: string,
  recursoId: string,
  transporte: Recurso['transporte'],
  parametros: Readonly<Record<string, string>>,
  peculiaridades: readonly string[],
  extras: Partial<Procedencia> = {},
): Procedencia {
  return {
    fonteId,
    recursoId,
    transporte,
    parametros,
    tentativas: 0,
    versaoColetor: VERSAO_COLETOR,
    peculiaridades,
    ...extras,
  }
}

function falha(procedencia: Procedencia, motivo: MotivoFalha, mensagem: string): ResultadoColeta {
  return { estado: 'falha', motivo, mensagem, procedencia }
}

/** Resultado vazio legítimo: a fonte respondeu que não há dado. */
function semDado(procedencia: Procedencia): ResultadoColeta {
  return { estado: 'sem-dado', procedencia }
}

/**
 * Coleta UM recurso, com um conjunto de parâmetros.
 *
 * É a operação central da Caixa 2. Devolve sempre um `ResultadoColeta` — nunca
 * lança por falha de rede ou de fonte (lança apenas por declaração inválida).
 */
export async function coletarRecurso(
  fonte: Fonte,
  recurso: Recurso,
  chamada: ChamadaResolvida,
  deps: DependenciasColetor = {},
): Promise<ResultadoColeta> {
  const politica = politicaPara(recurso)
  const peculiaridades = recurso.peculiaridades ?? []
  const ambiente = deps.ambiente ?? process.env
  const agora = deps.agora ?? (() => new Date())

  const procedenciaBase = (extras: Partial<Procedencia> = {}) =>
    montarProcedencia(
      fonte.id,
      recurso.id,
      recurso.transporte,
      chamada.parametros,
      peculiaridades,
      extras,
    )

  // Transporte manual: estado de primeira classe, não exceção.
  if (recurso.transporte === 'manual') {
    return resultadoManual(fonte.id, recurso.id, chamada.url, peculiaridades, chamada.parametros)
  }

  // Credencial resolvida ANTES de qualquer requisição.
  const credencial = resolverCredencial(fonte, ambiente)
  if (!credencial.ok) {
    return falha(procedenciaBase({ url: chamada.url }), 'credencial-ausente', credencial.mensagem)
  }

  const headers = { ...politica.headers, ...credencial.headers }
  const transporte = recurso.transporte

  // --- browser-download: Playwright, uma chamada por vez -------------------
  if (transporte === 'browser-download') {
    try {
      const bruto = await baixarComNavegador(chamada.url)
      const hash = hashDosBytes(bruto.bytes)
      const paginas: PaginaColeta[] = [
        {
          pagina: 1,
          url: bruto.url,
          bytes: bruto.bytes,
          hash,
          tamanho: bruto.bytes.byteLength,
          status: 200,
        },
      ]
      const procedencia = procedenciaBase({
        url: bruto.url,
        coletadoEm: agora().toISOString(),
        status: 200,
        tentativas: bruto.tentativas,
      })

      if (bruto.bytes.byteLength === 0) return semDado(procedencia)

      return {
        estado: 'sucesso',
        bytes: bruto.bytes,
        hash,
        tamanho: bruto.bytes.byteLength,
        paginas,
        procedencia,
      }
    } catch (err) {
      return falha(
        procedenciaBase({ url: chamada.url, coletadoEm: agora().toISOString() }),
        'erro-navegador',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  // --- transportes HTTP (json, geojson, bigquery), com paginação -----------
  const executar = (url: string) => {
    if (transporte === 'bigquery-sql') {
      return consultarBigQuery(url, chamada.corpo ?? '', politica, headers, deps)
    }
    return requisitar(
      url,
      { method: chamada.metodo, headers },
      politica,
      { buscar: deps.buscar, dormir: deps.dormir },
    )
  }

  const maxPaginas = Math.max(1, chamada.maxPaginas ?? politica.maxPaginas)
  const paginas: PaginaColeta[] = []
  let urlAtual = chamada.url
  let offset = 0
  let numeroPagina = 1
  let tentativasTotais = 0
  let ultimaProcedencia = procedenciaBase({ url: chamada.url })
  let limiteExcedido = false

  for (;;) {
    let resposta
    try {
      resposta = await executar(urlAtual)
    } catch (err) {
      const motivo: MotivoFalha =
        err && typeof err === 'object' && 'motivo' in err
          ? ((err as { motivo: MotivoFalha }).motivo ?? 'erro-rede')
          : 'erro-rede'
      return falha(
        procedenciaBase({
          url: urlAtual,
          coletadoEm: agora().toISOString(),
          tentativas: tentativasTotais,
        }),
        motivo,
        err instanceof Error ? err.message : String(err),
      )
    }

    tentativasTotais += resposta.tentativas
    ultimaProcedencia = procedenciaBase({
      url: resposta.url,
      coletadoEm: agora().toISOString(),
      status: resposta.status,
      headers: resposta.headers,
      tentativas: tentativasTotais,
    })

    const pagina: PaginaBruta = {
      bytes: resposta.bytes,
      url: resposta.url,
      status: resposta.status,
    }

    paginas.push({
      pagina: numeroPagina,
      url: resposta.url,
      bytes: resposta.bytes,
      hash: hashDosBytes(resposta.bytes),
      tamanho: resposta.bytes.byteLength,
      status: resposta.status,
    })

    const decisao = decidirProximaPagina(recurso.paginacao, pagina, numeroPagina, offset)
    if (!decisao.continuar) break

    if (numeroPagina >= maxPaginas) {
      limiteExcedido = true
      break
    }

    // Espera entre páginas, quando a fonte impõe rate limit.
    if (politica.pausaEntreChamadasMs > 0) {
      const dormir = deps.dormir ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
      await dormir(politica.pausaEntreChamadasMs)
    }

    numeroPagina++

    if (decisao.proximaUrl) {
      // `link-next`: a própria fonte informa a URL da próxima página.
      urlAtual = decisao.proximaUrl
      continue
    }

    // Estratégias numéricas: reescreve apenas os parâmetros de paginação.
    offset = decisao.proximoOffset ?? offset
    urlAtual = trocarParametrosDePagina(
      chamada.url,
      recurso,
      parametrosDePagina(recurso.paginacao, numeroPagina, offset),
    )
  }

  // Estourar o limite de páginas é FALHA, não sucesso parcial silencioso.
  if (limiteExcedido) {
    return falha(
      ultimaProcedencia,
      'pagina-limite-excedido',
      `paginação interrompida em ${maxPaginas} páginas (limite da política)`,
    )
  }

  const primeira = paginas[0]
  if (!primeira) {
    return semDado(ultimaProcedencia)
  }

  // Corpo vazio ou coleção vazia é ausência legítima, não falha.
  if (todasVazias(paginas)) {
    return { estado: 'sem-dado', procedencia: ultimaProcedencia, paginas }
  }

  return {
    estado: 'sucesso',
    bytes: primeira.bytes,
    hash: primeira.hash,
    tamanho: primeira.tamanho,
    paginas,
    procedencia: ultimaProcedencia,
  }
}

/** `true` quando todas as páginas vieram sem conteúdo. */
function todasVazias(paginas: readonly PaginaColeta[]): boolean {
  return paginas.length > 0 && paginas.every((p) => estaVazia(p.bytes))
}

/**
 * `true` quando o corpo representa ausência legítima de dado.
 *
 * Reconhece apenas o que é mecânico e não ambíguo: corpo sem bytes, ou uma
 * coleção JSON vazia (`[]`) — o caso real do Portal da Transparência, cuja
 * paginação termina em página vazia. NÃO interpreta campos nem decide
 * semântica: isso é da ORGANIZAÇÃO.
 */
function estaVazia(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return true

  // Corpo só com espaços em branco também não traz dado.
  const texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim()
  if (texto === '') return true

  // Coleção JSON vazia (`[]`), sem tentar interpretar o conteúdo.
  if (texto === '[]') return true

  return false
}

/**
 * Reescreve a URL trocando apenas os parâmetros de controle de paginação.
 *
 * Não altera a declaração da Caixa 1 nem os parâmetros de negócio já montados.
 */
function trocarParametrosDePagina(
  urlOriginal: string,
  recurso: Recurso,
  novos: Record<string, string>,
): string {
  const url = new URL(urlOriginal)
  for (const [chave, valor] of Object.entries(novos)) {
    url.searchParams.set(chave, valor)
  }
  void recurso
  return url.toString()
}
