/**
 * Caixa 2 — COLETOR EXTERNO: porta de entrada.
 *
 * Superfície pública do coletor. Quem for usá-lo (a ORGANIZAÇÃO, um futuro
 * orquestrador) importa daqui, não dos módulos internos.
 *
 * A Caixa 2 executa o que a Caixa 1 declara e devolve BYTES + PROCEDÊNCIA.
 * Ela não interpreta, não transforma e não grava em `data/`.
 *
 * Uso típico:
 *
 *   import { coletar } from './scripts/coletor/index.js'
 *
 *   const resultado = await coletar({
 *     fonteId: 'ibge-localidades',
 *     recursoId: 'estados',
 *   })
 *   // resultado.estado === 'sucesso' | 'sem-dado' | 'falha'
 *   // resultado.bytes  → conteúdo original
 *   // resultado.procedencia → de onde veio, quando, com que hash
 */

import { buscarFonte, buscarRecurso } from '../fontes/catalogo.js'
import { coletarRecurso, ErroDeclaracao, expandirChamadas } from './coletar.js'
import type { DependenciasColetor, RequisicaoColeta, ResultadoColeta } from './tipos.js'

export { coletarRecurso, expandirChamadas, hashDosBytes, resolverCredencial, ErroDeclaracao } from './coletar.js'
export { politicaPara, concorrenciaPara, USER_AGENT } from './politicas.js'
export { decidirProximaPagina, parametrosDePagina } from './paginacao.js'
export { VERSAO_COLETOR } from './tipos.js'
export type {
  EstadoColeta,
  MotivoFalha,
  Procedencia,
  ResultadoColeta,
  PaginaColeta,
  RequisicaoColeta,
  ValoresDimensao,
  DependenciasColetor,
} from './tipos.js'

/**
 * Coleta todas as chamadas de um recurso (respeitando o fan-out declarado).
 *
 * Recurso sem dimensão produz um resultado; `siconfi/dca` com `dimensao: 'ente'`
 * e 5.570 entes produz 5.570 resultados. A lista de valores de cada dimensão é
 * responsabilidade de quem chama (docs/PLANO_CAIXA_2_COLETOR.md §5).
 *
 * Nunca lança por falha de coleta — cada resultado carrega seu próprio estado.
 * Lança `ErroDeclaracao` quando o catálogo não descreve o que a coleta precisa.
 */
export async function coletar(
  req: RequisicaoColeta,
  deps: DependenciasColetor = {},
): Promise<ResultadoColeta[]> {
  const fonte = buscarFonte(req.fonteId)
  if (!fonte) throw new ErroDeclaracao(`fonte não encontrada no catálogo: ${req.fonteId}`)

  const recurso = buscarRecurso(req.fonteId, req.recursoId)
  if (!recurso) {
    throw new ErroDeclaracao(
      `recurso não encontrado no catálogo: ${req.fonteId}/${req.recursoId}`,
    )
  }

  const chamadas = expandirChamadas(fonte, recurso, req)

  // Execução sequencial: é o comportamento que a política central assume e o
  // que as fontes com rate limit crítico exigem. Paralelizar entre coletas é
  // decisão de quem orquestra, usando `concorrenciaPara(recurso)` como teto.
  const resultados: ResultadoColeta[] = []
  for (const chamada of chamadas) {
    resultados.push(await coletarRecurso(fonte, recurso, chamada, deps))
  }

  return resultados
}
