/**
 * Carregador de variáveis de ambiente.
 *
 * O projeto não usa `dotenv` (nem qualquer dependência) — este módulo lê o
 * arquivo `.env` da raiz e popula `process.env`, que é o contrato que todos os
 * adaptadores já consomem.
 *
 * Regras:
 *  - `process.env` tem precedência: variável já definida no shell nunca é
 *    sobrescrita pelo arquivo. Isso permite `PORTAL_API_KEY=x npm run ingest`.
 *  - `.env.local` é lido depois de `.env` e sobrescreve (mesma convenção do Vite).
 *  - Arquivos ausentes são ignorados silenciosamente: o projeto continua
 *    funcionando sem `.env`, apenas com as fontes que não exigem chave.
 *
 * Uso:
 *   import { carregarEnv, exigirEnv } from '../lib/env.js'
 *   carregarEnv()                     // no topo do script de ingestão
 *   const chave = exigirEnv('PORTAL_API_KEY', 'instruções…')
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Raiz do repositório (scripts/lib/ → ../../). */
export const RAIZ = join(__dirname, '..', '..')

let jaCarregado = false

/**
 * Faz o parse de um arquivo `.env`.
 *
 * Suporta: comentários (`#`), linhas em branco, `export CHAVE=valor`, valores
 * entre aspas simples/duplas e escapes `\n` dentro de aspas duplas. Não
 * suporta interpolação (`${OUTRA}`) — se precisar, é sinal de que a variável
 * deveria ser explícita.
 */
export function parseEnv(conteudo: string): Record<string, string> {
  const vars: Record<string, string> = {}

  for (const linhaBruta of conteudo.split(/\r?\n/)) {
    const linha = linhaBruta.trim()
    if (!linha || linha.startsWith('#')) continue

    const semExport = linha.startsWith('export ') ? linha.slice(7).trim() : linha
    const igual = semExport.indexOf('=')
    if (igual <= 0) continue

    const chave = semExport.slice(0, igual).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(chave)) continue

    let valor = semExport.slice(igual + 1).trim()

    const aspas = valor[0]
    if ((aspas === '"' || aspas === "'") && valor.endsWith(aspas) && valor.length >= 2) {
      valor = valor.slice(1, -1)
      if (aspas === '"') valor = valor.replace(/\\n/g, '\n').replace(/\\"/g, '"')
    } else {
      // Valor sem aspas: corta comentário no fim da linha ("valor # comentário")
      const comentario = valor.indexOf(' #')
      if (comentario >= 0) valor = valor.slice(0, comentario).trim()
    }

    vars[chave] = valor
  }

  return vars
}

/**
 * Lê `.env` (e depois `.env.local`) e popula `process.env`.
 * Idempotente: chamadas repetidas não relêem o disco.
 *
 * @returns Os nomes das variáveis efetivamente definidas por esta chamada.
 */
export function carregarEnv(): string[] {
  if (jaCarregado) return []
  jaCarregado = true

  const definidas: string[] = []

  for (const arquivo of ['.env', '.env.local']) {
    const caminho = join(RAIZ, arquivo)
    if (!existsSync(caminho)) continue

    let vars: Record<string, string>
    try {
      vars = parseEnv(readFileSync(caminho, 'utf-8'))
    } catch (err) {
      console.warn(`  [env] ⚠ não foi possível ler ${arquivo}: ${(err as Error).message}`)
      continue
    }

    for (const [chave, valor] of Object.entries(vars)) {
      // Precedência: o que já está no ambiente (shell/CI) vence o arquivo.
      if (process.env[chave] !== undefined && process.env[chave] !== '') continue
      process.env[chave] = valor
      definidas.push(chave)
    }
  }

  if (definidas.length > 0) {
    console.log(`  [env] ${definidas.length} variável(is) carregada(s) de .env: ${definidas.join(', ')}`)
  }

  return definidas
}

/** Lê uma variável, devolvendo `null` quando ausente ou vazia. */
export function lerEnv(chave: string): string | null {
  const valor = process.env[chave]
  return valor && valor.trim() !== '' ? valor.trim() : null
}

/**
 * Lê uma variável obrigatória. Lança com instruções de como obter o valor —
 * a mensagem é o que o usuário vê no terminal quando esquece o `.env`.
 */
export function exigirEnv(chave: string, instrucoes: string): string {
  const valor = lerEnv(chave)
  if (valor) return valor

  throw new Error(
    `${chave} não configurada.\n` +
    `  ${instrucoes}\n` +
    `  Depois copie .env.example para .env e preencha o valor, ou exporte no shell:\n` +
    `    export ${chave}="..."`,
  )
}

/** `true` quando a variável está presente — usado para pular fontes opcionais. */
export function temEnv(chave: string): boolean {
  return lerEnv(chave) !== null
}
