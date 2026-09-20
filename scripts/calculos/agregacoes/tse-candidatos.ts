/**
 * Caixa 6 — agregação: candidatos do TSE por município.
 *
 * ⚠️ DESAFIO DE MEMÓRIA. O organizado do TSE tem 463.859 linhas (candidatos).
 * Carregá-las para depois agrupar custaria centenas de MB.
 *
 * A técnica: percorrer o JSONL em STREAM, linha a linha, acumulando em um
 * `Map<codarea, Acumulador>`. Ao final, o mapa tem ~5.569 entradas (uma por
 * município), não 463.859. Memória O(municípios), não O(candidatos).
 *
 * O vínculo com o IBGE vem da tabela-ponte da Caixa 5: o TSE identifica a
 * unidade eleitoral por um código próprio de 5 dígitos, e a ponte traduz
 * `(ufSigla, codigoUe) → codarea`. Sem ela, não haveria como agrupar por
 * município.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { iterarJsonl } from '../leitura.js'

/** Métricas agregadas de candidaturas por município. */
export interface CandidatosMunicipio {
  codarea: string
  ufSigla: string
  /** Total de candidaturas registradas no município. */
  totalCandidatos: number
  /** Candidaturas ao cargo de Prefeito (código TSE 11). */
  candidatosPrefeito: number
  /** Candidaturas ao cargo de Vice-Prefeito (código TSE 12). */
  candidatosVicePrefeito: number
  /** Candidaturas ao cargo de Vereador (código TSE 13). */
  candidatosVereador: number
  /**
   * Número de partidos distintos com candidatura no município.
   *
   * É uma contagem de DISTINTOS, não uma soma — o acumulador guarda o conjunto
   * de siglas por município durante a passagem.
   */
  partidosDistintos: number
  /** Ano da eleição agregada. */
  anoEleicao: number | null
  /** Sigla do partido do prefeito eleito. */
  partidoPrefeito?: string | null
  /** Nome do prefeito eleito. */
  nomePrefeito?: string | null
  /** Contagem de vereadores eleitos por partido. */
  vereadoresPorPartido?: Record<string, number>
}

/** Códigos de cargo do TSE, conforme o `consulta_cand`. */
export const CARGO_TSE = {
  PREFEITO: 11,
  VICE_PREFEITO: 12,
  VEREADOR: 13,
} as const

/** Acumulador por município. */
interface Acumulador {
  ufSigla: string
  total: number
  prefeito: number
  vicePrefeito: number
  vereador: number
  /** Siglas de partido vistas — o tamanho do conjunto é a contagem distinta. */
  partidos: Set<string>
  ano: number | null
  /** Dados do prefeito eleito. */
  prefeitoEleito?: { nome: string; partido: string } | null
  /** Contagem de vereadores eleitos por partido. */
  vereadoresEleitosPorPartido: Record<string, number>
}

/** Registro do TSE, no formato que a Caixa 4 produziu. */
interface CandidatoTse {
  ufSigla?: string
  unidadeEleitoral?: string
  codigoCargo?: number
  partidoSigla?: string | null
  anoEleicao?: number
  situacaoTotalizacao?: string | null
  nomeUrna?: string | null
}

/** Linha da tabela-ponte da Caixa 5 (só o que interessa aqui). */
interface LinhaPonte {
  codarea?: string
  ufSigla?: string
  origens?: { tse?: { id?: string } }
}

/** Chave do vínculo: UF + código da unidade eleitoral. */
function chaveUnidade(ufSigla: string, codigoUe: string): string {
  return `${ufSigla.toUpperCase()}|${codigoUe}`
}

/**
 * Carrega a ponte da Caixa 5 como `Map<"UF|codigoUe", codarea>`.
 *
 * O mapa tem ~5.569 entradas — cabe folgadamente em memória. É ele que permite
 * agrupar por município do IBGE em vez de por unidade eleitoral do TSE.
 */
export async function carregarPonte(
  caminhoPonte: string,
): Promise<Map<string, string>> {
  const ponte = new Map<string, string>()
  if (!existsSync(caminhoPonte)) return ponte

  for await (const linha of iterarJsonl<LinhaPonte>(
    caminhoPonte,
    'related/municipio.jsonl',
  )) {
    const codarea = linha.codarea
    const uf = linha.ufSigla
    const codigoUe = linha.origens?.tse?.id
    if (!codarea || !uf || !codigoUe) continue
    ponte.set(chaveUnidade(uf, codigoUe), codarea)
  }

  return ponte
}

/**
 * Agrega as candidaturas do TSE por município do IBGE.
 *
 * Faz UMA passagem no JSONL de 463.859 linhas, mantendo apenas um acumulador
 * por município. Linhas cuja unidade eleitoral não está na ponte são contadas
 * em `naoVinculados` e descartadas — nunca inventamos um codarea.
 *
 * @returns Os acumuladores por codarea e o total de linhas não vinculadas.
 */
export async function agregarCandidatosPorMunicipio(
  caminhoTse: string,
  ponte: Map<string, string>,
): Promise<{ porMunicipio: Map<string, CandidatosMunicipio>; naoVinculados: number }> {
  const acumuladores = new Map<string, Acumulador>()
  let naoVinculados = 0

  for await (const linha of iterarJsonl<CandidatoTse>(
    caminhoTse,
    'tse/cdn-dados-abertos.jsonl',
  )) {
    const uf = linha.ufSigla
    const codigoUe = linha.unidadeEleitoral
    if (!uf || !codigoUe) {
      naoVinculados++
      continue
    }

    const codarea = ponte.get(chaveUnidade(uf, codigoUe))
    if (!codarea) {
      // Sem vínculo na ponte não há município canônico: descarta e conta.
      naoVinculados++
      continue
    }

    let acc = acumuladores.get(codarea)
    if (!acc) {
      acc = {
        ufSigla: uf.toUpperCase(),
        total: 0,
        prefeito: 0,
        vicePrefeito: 0,
        vereador: 0,
        partidos: new Set<string>(),
        ano: null,
        prefeitoEleito: null,
        vereadoresEleitosPorPartido: {},
      }
      acumuladores.set(codarea, acc)
    }

    acc.total++

    // Verifica se o candidato foi eleito
    const situacao = linha.situacaoTotalizacao?.toUpperCase()
    const eEleito = situacao?.includes('ELEITO') ?? false
    const sigla = linha.partidoSigla
    const nomeUrna = linha.nomeUrna

    switch (linha.codigoCargo) {
      case CARGO_TSE.PREFEITO:
        acc.prefeito++
        // Se for prefeito eleito, guarda os dados
        if (eEleito && sigla && nomeUrna) {
          acc.prefeitoEleito = { nome: nomeUrna, partido: sigla }
        }
        break
      case CARGO_TSE.VICE_PREFEITO:
        acc.vicePrefeito++
        break
      case CARGO_TSE.VEREADOR:
        acc.vereador++
        // Se for vereador eleito, conta por partido
        if (eEleito) {
          const partidoVereador = sigla || '—'
          acc.vereadoresEleitosPorPartido[partidoVereador] = (acc.vereadoresEleitosPorPartido[partidoVereador] ?? 0) + 1
        }
        break
      default:
        break
    }

    if (typeof sigla === 'string' && sigla.trim() !== '') {
      acc.partidos.add(sigla.trim())
    }

    if (typeof linha.anoEleicao === 'number' && Number.isFinite(linha.anoEleicao)) {
      acc.ano = acc.ano === null ? linha.anoEleicao : Math.max(acc.ano, linha.anoEleicao)
    }
  }

  // Consolida: converte os acumuladores (com Set) em saída serializável.
  const porMunicipio = new Map<string, CandidatosMunicipio>()
  for (const [codarea, acc] of acumuladores) {
    porMunicipio.set(codarea, {
      codarea,
      ufSigla: acc.ufSigla,
      totalCandidatos: acc.total,
      candidatosPrefeito: acc.prefeito,
      candidatosVicePrefeito: acc.vicePrefeito,
      candidatosVereador: acc.vereador,
      partidosDistintos: acc.partidos.size,
      anoEleicao: acc.ano,
      partidoPrefeito: acc.prefeitoEleito?.partido ?? null,
      nomePrefeito: acc.prefeitoEleito?.nome ?? null,
      vereadoresPorPartido: Object.keys(acc.vereadoresEleitosPorPartido).length > 0 ? acc.vereadoresEleitosPorPartido : undefined,
    })
  }

  return { porMunicipio, naoVinculados }
}

/** Caminho padrão do JSONL do TSE na Caixa 4. */
export function caminhoTseOrganizado(raizOrganizada: string): string {
  return join(raizOrganizada, 'tse', 'cdn-dados-abertos.jsonl')
}

/** Caminho padrão da ponte da Caixa 5. */
export function caminhoPonte(raizRelacionada: string): string {
  return join(raizRelacionada, 'municipio.jsonl')
}
