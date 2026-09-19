/**
 * Leitor de datasets JSON com cache em memória (RAM → disco).
 *
 * O cache guarda o mtime do arquivo: se o dataset for regenerado pelos scripts
 * de ingestão, a próxima leitura invalida o cache automaticamente — sem
 * precisar reiniciar o servidor.
 */

import { readFile, stat } from 'node:fs/promises'

interface EntradaRam {
  dados: unknown
  mtimeMs: number
}

const ramCache = new Map<string, EntradaRam>()

export async function lerJsonComCache<T>(caminho: string, chave: string): Promise<T> {
  const { mtimeMs } = await stat(caminho)
  const emMemoria = ramCache.get(chave)

  if (emMemoria && emMemoria.mtimeMs === mtimeMs) return emMemoria.dados as T

  const conteudo = await readFile(caminho, 'utf-8')
  const dados = JSON.parse(conteudo) as T
  ramCache.set(chave, { dados, mtimeMs })
  return dados
}

/** Limpa todo o cache (útil após uma atualização manual do dataset). */
export function limparCacheDados(): void {
  ramCache.clear()
}
