/**
 * Orçamento e finanças públicas (Siconfi/Tesouro) — lidos dos arquivos estáticos
 * publicados pela Caixa 7.
 *
 * ── Contrato publicado ────────────────────────────────────────────────────
 *
 *   orcamento/brasil.json    { entes: [...] }   (Brasil + UFs, quando houver)
 *   orcamento/{SIGLA}.json   { uf, municipios: [...] }
 *
 * O shard é pedido por **SIGLA da UF** (`RO.json`), não pelo código IBGE
 * (`11.json`) — a publicação nomeia por sigla porque é o que o frontend usa
 * nas rotas de indicadores e territórios. O código de 2 dígitos precisa ser
 * convertido antes de montar o caminho.
 */

import { lerDados, siglaDaUf } from '../../lib/fontes'

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
}

interface ArquivoBrasil {
  entes: OrcamentoEnte[]
}

interface ArquivoUf {
  uf: string
  municipios: OrcamentoEnte[]
}

/**
 * Orçamento de um território.
 * - Brasil: o payload consolidado traz os entes; buscamos o código "1".
 * - Estado: mesmo arquivo, pelo código de 2 dígitos.
 * - Município: busca no shard da UF, nomeado por SIGLA.
 */
export async function buscarOrcamento(
  nivel: 'brasil' | 'estado' | 'municipio',
  codigo: string,
): Promise<OrcamentoEnte | null> {
  if (nivel === 'municipio') {
    const sigla = siglaDaUf(codigo)
    if (!sigla) return null

    const arquivo = await lerDados<ArquivoUf>(`orcamento/${sigla}.json`)
    return arquivo?.municipios.find((m) => m.codarea === codigo) ?? null
  }

  const dados = await lerDados<ArquivoBrasil>('orcamento/brasil.json')
  return dados?.entes.find((e) => e.codarea === codigo) ?? null
}
