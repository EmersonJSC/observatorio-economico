/**
 * Orçamento e finanças públicas (Siconfi/Tesouro) — lidos dos arquivos estáticos.
 */

import { lerDados, ufDoCodarea } from '../../lib/fontes'

export interface GastosPorArea {
  saude: number | null
  educacao: number | null
}

export interface OrcamentoEnte {
  codarea: string
  nome: string
  exercicio: number
  receitaTotal: number | null
  despesaTotal: number | null
  gastosPorArea: GastosPorArea
  fonte: string
  atualizadoEm: string
}

interface ArquivoBrasil {
  exercicio: number
  estados: OrcamentoEnte[]
}

interface ArquivoUf {
  uf: string
  exercicio: number
  municipios: OrcamentoEnte[]
}

/**
 * Orçamento de um território.
 * - Brasil: ainda não há dataset nacional (retorna null).
 * - Estado: consolidado dos estados.
 * - Município: busca no arquivo da UF.
 */
export async function buscarOrcamento(
  nivel: 'brasil' | 'estado' | 'municipio',
  codigo: string,
): Promise<OrcamentoEnte | null> {
  if (nivel === 'brasil') return null

  if (nivel === 'municipio') {
    const arquivo = await lerDados<ArquivoUf>(`budget/ufs/${ufDoCodarea(codigo)}.json`)
    return arquivo?.municipios.find((m) => m.codarea === codigo) ?? null
  }

  const dados = await lerDados<ArquivoBrasil>('budget/brasil.json')
  return dados?.estados.find((e) => e.codarea === codigo) ?? null
}
