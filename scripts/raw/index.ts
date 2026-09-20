/**
 * Caixa 3 — RAW: porta de entrada.
 *
 * Superfície pública da camada RAW. Quem for usá-la (um orquestrador futuro)
 * importa daqui, não dos módulos internos.
 *
 * A Caixa 3 recebe `ResultadoColeta[]` da Caixa 2 e grava bytes + procedência
 * em `data/raw/<fonteId>/<recursoId>/`. Ela é CEGA: não interpreta o conteúdo.
 *
 * Uso típico:
 *
 *   import { coletar } from './scripts/coletor/index.js'
 *   import { persistirColeta } from './scripts/raw/index.js'
 *
 *   const resultados = await coletar({ fonteId: 'ibge-localidades', recursoId: 'estados' })
 *   const persistidos = await persistirColeta(resultados)
 *   // persistidos[0].resultado === 'gravado' | 'deduplicado' | 'ignorado' | 'erro'
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ResultadoColeta } from '../coletor/tipos.js'
import { raizRaw } from './caminhos.js'
import { persistirResultado } from './persistir.js'
import type { OpcoesPersistencia, PersistenciaResultado } from './tipos.js'

export { persistirResultado } from './persistir.js'
export {
  raizRaw,
  dirRecurso,
  dirObjetos,
  caminhoManifesto,
  caminhoTentativas,
  caminhoObjeto,
} from './caminhos.js'
export { resolverExtensao, extensaoPorContentType } from './extensoes.js'
export { VERSAO_RAW } from './tipos.js'
export type {
  ResultadoPersistencia,
  RegistroObjeto,
  Manifesto,
  Tentativa,
  OpcoesPersistencia,
  PersistenciaResultado,
} from './tipos.js'

/** Raiz padrão do projeto (`scripts/raw/` → `../../`). */
const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Raiz do RAW dentro do repositório. */
export function raizPadrao(): string {
  return raizRaw(RAIZ_PROJETO)
}

/**
 * Persiste o resultado de uma coleta inteira (todas as chamadas de um recurso).
 *
 * Cada `ResultadoColeta` é gravado independentemente: uma falha de I/O em um
 * item não interrompe os demais. Devolve um resultado por item, na mesma ordem.
 *
 * @param resultados Saída de `coletar()` da Caixa 2.
 * @param opcoes Sobrescreve a raiz (útil em teste) e o relógio.
 */
export async function persistirColeta(
  resultados: readonly ResultadoColeta[],
  opcoes: OpcoesPersistencia = {},
): Promise<PersistenciaResultado[]> {
  const raiz = opcoes.raiz ?? raizPadrao()
  const persistidos: PersistenciaResultado[] = []

  for (const resultado of resultados) {
    persistidos.push(await persistirResultado(raiz, resultado, opcoes))
  }

  return persistidos
}
