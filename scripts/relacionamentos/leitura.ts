/**
 * Caixa 5 — RELACIONAMENTOS: leitura de JSONL em stream.
 *
 * A Caixa 5 cruza dados, e o insumo do TSE tem 463.859 linhas. Carregar isso
 * inteiro em memória só para extrair ~5.569 municípios distintos seria
 * desperdício. Este leitor consome linha a linha e devolve um registro por vez.
 */

import { createReadStream } from 'node:fs'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

import { ErroRelacionamento } from './tipos.js'

/** Itera os registros de um JSONL, um por vez. */
export async function* iterarJsonl<T = Record<string, unknown>>(
  caminho: string,
  nomeLegivel: string,
): AsyncGenerator<T> {
  if (!existsSync(caminho)) {
    throw new ErroRelacionamento(
      `arquivo não encontrado: ${nomeLegivel}\n` +
        `  Caminho: ${caminho}\n` +
        `  Rode a organização (Caixa 4) antes de construir a ponte.`,
      'fonte-ausente',
    )
  }

  const fluxo = createReadStream(caminho, { encoding: 'utf-8' })
  const rl = createInterface({ input: fluxo, crlfDelay: Infinity })

  let linha = 0
  try {
    for await (const texto of rl) {
      linha++
      const limpo = texto.trim()
      if (limpo === '') continue
      try {
        yield JSON.parse(limpo) as T
      } catch (err) {
        throw new ErroRelacionamento(
          `${nomeLegivel}: JSON inválido na linha ${linha}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
          'configuracao',
        )
      }
    }
  } finally {
    rl.close()
    fluxo.destroy()
  }
}

/** Conta as linhas de um JSONL sem materializar o conteúdo. */
export async function contarLinhas(caminho: string, nomeLegivel: string): Promise<number> {
  let n = 0
  for await (const _ of iterarJsonl(caminho, nomeLegivel)) n++
  return n
}
