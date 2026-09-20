/**
 * Caixa 6 — leitura de JSONL em stream.
 *
 * Mesma estratégia da Caixa 5: consumir linha a linha em vez de materializar o
 * arquivo inteiro. O organizado do TSE tem 463.859 linhas; carregá-lo de uma vez
 * só para agregar seria desperdício.
 */

import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

/** Itera os registros de um JSONL, um por vez. */
export async function* iterarJsonl<T = Record<string, unknown>>(
  caminho: string,
  nomeLegivel: string,
): AsyncGenerator<T> {
  if (!existsSync(caminho)) {
    throw new Error(
      `arquivo não encontrado: ${nomeLegivel}\n  Caminho: ${caminho}`,
    )
  }

  const fluxo = createReadStream(caminho, { encoding: 'utf-8' })
  const rl = createInterface({ input: fluxo, crlfDelay: Infinity })

  try {
    for await (const texto of rl) {
      const limpo = texto.trim()
      if (limpo === '') continue
      try {
        yield JSON.parse(limpo) as T
      } catch (err) {
        throw new Error(
          `${nomeLegivel}: JSON inválido: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  } finally {
    rl.close()
    fluxo.destroy()
  }
}
