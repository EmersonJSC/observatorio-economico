/**
 * Caixa 5 — entidade: unidades eleitorais do TSE.
 *
 * Fonte: `data/organized/tse/cdn-dados-abertos.jsonl` (Caixa 4).
 *
 * ⚠️ GESTÃO DE MEMÓRIA — o ponto crítico desta caixa.
 *
 * O JSONL do TSE tem 463.859 linhas (candidatos), mas apenas ~5.569 unidades
 * eleitorais distintas. Carregar os candidatos em memória desperdiçaria
 * centenas de MB para extrair algo que cabe em poucos.
 *
 * A estratégia é iterar linha a linha e acumular APENAS um
 * `Map<uf|codigoUE, {...}>` com as unidades únicas. A memória consumida é
 * O(nº de municípios), não O(nº de candidatos) — cerca de 80× menos.
 */

import { normalizarCodigoTse } from '../normalizacao.js'
import { iterarJsonl } from '../leitura.js'

/** Uma unidade eleitoral distinta, reduzida do JSONL de candidatos. */
export interface UnidadeTse {
  /** Código TSE da unidade eleitoral (5 dígitos). */
  codigoUe: string
  /** Nome do município como o TSE escreve (grafia original preservada). */
  nome: string
  ufSigla: string
}

/** Registro cru do JSONL da Caixa 4 (só os campos que interessam). */
interface CandidatoJsonl {
  unidadeEleitoral?: string
  nomeUnidadeEleitoral?: string
  ufSigla?: string
}

/** Chave de deduplicação: UF + código da unidade eleitoral. */
function chaveUnidade(ufSigla: string, codigoUe: string): string {
  return `${ufSigla}|${codigoUe}`
}

/**
 * Percorre o JSONL de candidatos e devolve apenas as unidades eleitorais
 * distintas.
 *
 * @returns `Map<"UF|codigoUE", UnidadeTse>`.
 */
export async function carregarUnidadesTse(caminho: string): Promise<Map<string, UnidadeTse>> {
  const unidades = new Map<string, UnidadeTse>()

  for await (const bruto of iterarJsonl<CandidatoJsonl>(
    caminho,
    'tse/cdn-dados-abertos.jsonl',
  )) {
    const ue = bruto.unidadeEleitoral
    const nome = bruto.nomeUnidadeEleitoral
    const uf = bruto.ufSigla

    // Linha sem unidade identificável não contribui para a ponte.
    if (!ue || !uf) continue

    const ufSigla = uf.toUpperCase()
    const codigoUe = normalizarCodigoTse(ue)
    const chave = chaveUnidade(ufSigla, codigoUe)

    // Já visto: a imensa maioria das linhas cai aqui, e é o que mantém a
    // memória baixa apesar de 463 mil iterações.
    if (unidades.has(chave)) continue

    unidades.set(chave, {
      codigoUe,
      // O nome pode faltar em algumas linhas; preservamos vazio e deixamos o
      // casamento por nome marcá-lo como órfão em vez de inventar valor.
      nome: nome ?? '',
      ufSigla,
    })
  }

  return unidades
}

/** Chave de deduplicação usada pelo carregador — exportada para teste. */
export { chaveUnidade }
