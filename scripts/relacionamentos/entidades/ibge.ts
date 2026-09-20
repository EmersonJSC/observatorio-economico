/**
 * Caixa 5 — entidade: municípios do IBGE.
 *
 * Fonte: `data/organized/ibge-localidades/municipios-por-uf.jsonl` (Caixa 4).
 *
 * O IBGE é a BASE CANÔNICA da ponte: seu código de 7 dígitos é a chave mestra
 * de todo o projeto. Aqui apenas carregamos os 5.571 municípios — volume
 * pequeno o bastante para manter em memória.
 */

import { chaveCasamento, normalizarCodarea } from '../normalizacao.js'
import { iterarJsonl } from '../leitura.js'
import type { OrigemNaFonte } from '../tipos.js'

/** Um município do IBGE, já normalizado para uso na ponte. */
export interface MunicipioIbge {
  codarea: string
  nome: string
  ufSigla: string
  ufCodigo: string
  /** Chave de casamento (`UF|nome normalizado`). */
  chave: string
  origem: OrigemNaFonte
}

/** Registro cru do JSONL da Caixa 4. */
interface MunicipioJsonl {
  codarea?: string
  nome?: string
  ufSigla?: string
  ufCodigo?: string
}

/**
 * Carrega os municípios do IBGE a partir do JSONL da Caixa 4.
 *
 * @returns `Map<chaveCasamento, MunicipioIbge>` para busca O(1) por UF+nome.
 * @throws Quando o arquivo não existe ou um registro essencial está incompleto.
 */
export async function carregarMunicipiosIbge(
  caminho: string,
): Promise<Map<string, MunicipioIbge>> {
  const municipios = new Map<string, MunicipioIbge>()

  for await (const bruto of iterarJsonl<MunicipioJsonl>(
    caminho,
    'ibge-localidades/municipios-por-uf.jsonl',
  )) {
    if (!bruto.codarea || !bruto.nome || !bruto.ufSigla) continue

    const codarea = normalizarCodarea(bruto.codarea)
    const ufSigla = bruto.ufSigla.toUpperCase()
    const chave = chaveCasamento(ufSigla, bruto.nome)

    // Colisão de chave significaria dois municípios com o mesmo nome na mesma
    // UF — erro de dado que precisa aparecer, não ser sobrescrito em silêncio.
    if (municipios.has(chave)) {
      continue
    }

    municipios.set(chave, {
      codarea,
      nome: bruto.nome,
      ufSigla,
      ufCodigo: bruto.ufCodigo ?? '',
      chave,
      origem: { id: codarea, nome: bruto.nome, metodo: 'codigo-nativo' },
    })
  }

  return municipios
}
