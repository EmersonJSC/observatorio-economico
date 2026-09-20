/**
 * Caixa 4 — ORGANIZAÇÃO: leitura de JSON do RAW.
 *
 * Itera coleções e envelopes SEM materializar o array inteiro de uma vez
 * quando possível, e sempre de forma incremental do ponto de vista do
 * consumidor (generators).
 *
 * Nota honesta sobre memória: `JSON.parse` do Node não é incremental — o corpo
 * já está em memória como Buffer/Uint8Array vindo do RAW. O ganho real aqui é
 * não criar estruturas ADICIONAIS (cópias, arrays derivados, `map`/`filter`
 * intermediários) e entregar um registro por vez ao tradutor. Para JSON isso é
 * o limite sem dependência nova; CSV é o caso onde streaming é de fato
 * possível (ver `leitura/csv.ts`).
 */

import { readFile } from 'node:fs/promises'

import type { FormaLettura } from '../tipos.js'

/** Origem de um registro, para rastreabilidade na quarentena. */
export interface OrigemRegistro {
  /** Caminho do objeto no RAW (relativo à raiz do RAW). */
  arquivo: string
  /** Índice do registro dentro da coleção (1-based). */
  indice: number
}

/** Um registro bruto com sua origem. */
export interface RegistroBruto {
  valor: unknown
  origem: OrigemRegistro
}

/** Lê o caminho de um envelope (`a.b.c`), para achar o array interno. */
function lerCaminho(objeto: unknown, caminho: string): unknown {
  let atual: unknown = objeto
  for (const parte of caminho.split('.')) {
    if (atual === null || typeof atual !== 'object') return undefined
    atual = (atual as Record<string, unknown>)[parte]
  }
  return atual
}

/** Erro ao interpretar o conteúdo do RAW. */
export class ErroLeitura extends Error {
  constructor(
    message: string,
    readonly arquivo: string,
  ) {
    super(message)
    this.name = 'ErroLeitura'
  }
}

/**
 * Itera os registros de um objeto JSON do RAW.
 *
 * Aceita:
 *   - `json-colecao`  → array JSON na raiz
 *   - `json-envelope` → array dentro de um envelope, no caminho declarado
 *   - `json-objeto`   → objeto único na raiz (tratado como um registro)
 *
 * @param caminhoAbsoluto Caminho do arquivo do objeto no RAW.
 * @param arquivoRelativo Caminho relativo, usado na origem do registro.
 */
export async function* iterarJson(
  caminhoAbsoluto: string,
  arquivoRelativo: string,
  forma: FormaLettura,
): AsyncGenerator<RegistroBruto> {
  let conteudo: string
  try {
    conteudo = await readFile(caminhoAbsoluto, 'utf-8')
  } catch (err) {
    throw new ErroLeitura(
      `não foi possível ler ${arquivoRelativo}: ${err instanceof Error ? err.message : String(err)}`,
      arquivoRelativo,
    )
  }

  let json: unknown
  try {
    json = JSON.parse(conteudo)
  } catch (err) {
    throw new ErroLeitura(
      `${arquivoRelativo} não é JSON válido: ${err instanceof Error ? err.message : String(err)}`,
      arquivoRelativo,
    )
  }

  // Libera a string antes de percorrer, quando o runtime permitir.
  conteudo = ''

  if (forma.tipo === 'json-objeto') {
    yield { valor: json, origem: { arquivo: arquivoRelativo, indice: 1 } }
    return
  }

  const colecao =
    forma.tipo === 'json-envelope' ? lerCaminho(json, forma.caminho) : json

  if (!Array.isArray(colecao)) {
    throw new ErroLeitura(
      `${arquivoRelativo}: esperado array${forma.tipo === 'json-envelope' ? ` em "${forma.caminho}"` : ' na raiz'}, ` +
        `recebido ${colecao === null ? 'null' : typeof colecao}`,
      arquivoRelativo,
    )
  }

  for (let i = 0; i < colecao.length; i++) {
    yield { valor: colecao[i], origem: { arquivo: arquivoRelativo, indice: i + 1 } }
  }
}

/**
 * Lê apenas os NOMES dos campos presentes em um registro.
 *
 * Usado para detectar mudança de layout ANTES de processar o arquivo inteiro:
 * se um campo obrigatório não aparece no primeiro registro, abortamos cedo.
 */
export function camposDe(registro: unknown): Set<string> {
  if (registro === null || typeof registro !== 'object' || Array.isArray(registro)) {
    return new Set()
  }
  return new Set(Object.keys(registro as Record<string, unknown>))
}
