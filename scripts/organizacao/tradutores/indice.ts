/**
 * Caixa 4 — ORGANIZAÇÃO: índice de tradutores.
 *
 * Registra os tradutores disponíveis por `fonteId/recursoId`. Um arquivo por
 * FONTE (não por recurso) evita fragmentar 25 arquivos para um vocabulário que
 * a fonte compartilha.
 */

import type { Tradutor } from '../tipos.js'
import { tradutoresIbgeLocalidades } from './ibge-localidades.js'
import { tradutoresIbgeMalhas } from './ibge-malhas.js'
import { tradutoresIbgeSidra } from './ibge-sidra.js'
import { tradutoresSiconfi } from './siconfi-dca.js'
import { tradutoresTse } from './tse-consulta-cand.js'

/** Todos os tradutores implementados até agora. */
export const TRADUTORES: readonly Tradutor[] = [
  ...tradutoresIbgeLocalidades,
  ...tradutoresIbgeSidra,
  ...tradutoresIbgeMalhas,
  ...tradutoresTse,
  ...tradutoresSiconfi,
  // Próximas fontes: camara-deputados, portal-transparencia.
]

/** Chave estável de um tradutor. */
export function chaveTradutor(fonteId: string, recursoId: string): string {
  return `${fonteId}/${recursoId}`
}

/** Localiza um tradutor pelo par fonte/recurso. */
export function buscarTradutor(fonteId: string, recursoId: string): Tradutor | undefined {
  return TRADUTORES.find((t) => t.fonteId === fonteId && t.recursoId === recursoId)
}

/** Lista os pares fonte/recurso que têm tradutor implementado. */
export function recursosComTradutor(): Array<{ fonteId: string; recursoId: string }> {
  return TRADUTORES.map((t) => ({ fonteId: t.fonteId, recursoId: t.recursoId }))
}
