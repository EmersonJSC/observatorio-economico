/**
 * Caixa 5 — estratégia: casamento por nome normalizado.
 *
 * Estratégia mais simples possível, deliberadamente: nome normalizado exato,
 * restrito à mesma UF. Sem fuzzy nesta etapa.
 *
 * Validação contra o dado real do projeto: casou 5.560 das 5.569 unidades
 * eleitorais do TSE (99,84%). As 9 restantes são divergências históricas
 * conhecidas — o candidato natural a exceção auditada, não a algoritmo.
 */

import { chaveCasamento, normalizarNome } from '../normalizacao.js'
import type { MunicipioIbge } from '../entidades/ibge.js'
import type { UnidadeTse } from '../entidades/tse.js'

/** Resultado do casamento de uma unidade do TSE. */
export type ResultadoCasamento =
  | { tipo: 'casado'; municipio: MunicipioIbge; metodo: 'nome-exato' }
  | { tipo: 'sem-match'; nomeNormalizado: string }
  | { tipo: 'ambiguo'; candidatos: MunicipioIbge[] }

/**
 * Casa uma unidade eleitoral do TSE contra o índice de municípios do IBGE.
 *
 * A UF faz parte da chave: "Bom Jesus" existe em várias UFs, e casar só por
 * nome ligaria municípios de estados diferentes.
 */
export function casarPorNome(
  unidade: UnidadeTse,
  indice: Map<string, MunicipioIbge>,
): ResultadoCasamento {
  const nomeNormalizado = normalizarNome(unidade.nome)

  if (nomeNormalizado === '') {
    return { tipo: 'sem-match', nomeNormalizado }
  }

  const encontrado = indice.get(chaveCasamento(unidade.ufSigla, unidade.nome))
  if (encontrado) {
    return { tipo: 'casado', municipio: encontrado, metodo: 'nome-exato' }
  }

  return { tipo: 'sem-match', nomeNormalizado }
}
