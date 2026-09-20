/**
 * Caixa 5 — RELACIONAMENTOS: porta de entrada.
 *
 * Lê os `.jsonl` da Caixa 4 e constrói as tabelas-ponte em `data/related/`.
 *
 * Escopo desta etapa: municípios (IBGE × TSE).
 *
 * CLI:
 *   npm run relacionar
 *   npm run relacionar -- --limiar 0.02
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { construirPonteMunicipios } from './ponte.js'
import type { OpcoesRelacionamento, ResultadoRelacionamento } from './tipos.js'
import { ErroRelacionamento, VERSAO_RELACIONAMENTOS } from './tipos.js'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export { construirPonteMunicipios } from './ponte.js'
export { normalizarNome, chaveCasamento, normalizarCodarea } from './normalizacao.js'
export { carregarMunicipiosIbge } from './entidades/ibge.js'
export { carregarUnidadesTse } from './entidades/tse.js'
export { casarPorNome } from './estrategias/nome-normalizado.js'
export { EXCECOES_TSE_IBGE, indexarExcecoes } from './estrategias/excecoes.js'
export { VERSAO_RELACIONAMENTOS } from './tipos.js'
export type {
  PonteMunicipio,
  Orfao,
  ClasseOrfao,
  MetodoMatch,
  Confianca,
  ResultadoRelacionamento,
  MetadadosRelacionamento,
  ContagensRelacionamento,
  OpcoesRelacionamento,
} from './tipos.js'

/** Raiz padrão da saída de relacionamentos. */
export function raizRelacionada(): string {
  return join(RAIZ_PROJETO, 'data', 'related')
}

/** Executa a construção da ponte a partir da linha de comando. */
export async function executarCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const pegar = (nome: string): string | undefined => {
    const comIgual = argv.find((a) => a.startsWith(`--${nome}=`))
    if (comIgual) return comIgual.slice(nome.length + 3)
    const i = argv.indexOf(`--${nome}`)
    const proximo = i >= 0 ? argv[i + 1] : undefined
    return proximo && !proximo.startsWith('--') ? proximo : undefined
  }

  const limiarBruto = pegar('limiar')
  const limiar = limiarBruto !== undefined ? Number(limiarBruto) : undefined

  if (limiar !== undefined && (!Number.isFinite(limiar) || limiar < 0 || limiar > 1)) {
    console.error('\n✗ --limiar deve ser uma fração entre 0 e 1 (ex.: 0.01 = 1%)\n')
    return 1
  }

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Relacionamentos (Caixa 5)')
  console.log('╚══════════════════════════════════════════════════════════')
  console.log(`  Destino: ${raizRelacionada()}`)
  console.log(`  Escopo:  municípios (IBGE × TSE)`)
  if (limiar !== undefined) console.log(`  Limiar:  ${(limiar * 100).toFixed(2)}%`)
  console.log('')

  const opcoes: OpcoesRelacionamento = limiar !== undefined ? { limiarOrfaos: limiar } : {}

  try {
    const r: ResultadoRelacionamento = await construirPonteMunicipios(opcoes)
    const c = r.contagens

    console.log(`[OK] ponte construída`)
    console.log(`  Municípios IBGE (base canônica): ${c.municipiosIbge}`)
    console.log(`  Unidades eleitorais do TSE:      ${c.unidadesTse}`)
    console.log(`  ─────────────────────────────────────────`)
    console.log(`  Casados por nome exato:          ${c.casados - c.porExcecao}`)
    console.log(`  Casados por exceção auditada:    ${c.porExcecao}`)
    console.log(`  Total de vínculos:               ${c.casados}`)
    console.log(`  Órfãos registrados:              ${c.orfaos}`)
    console.log(`    a corrigir (revisão humana):   ${c.orfaosACorrigir}`)
    console.log(`  Taxa de órfãos a corrigir:       ${(r.metadados.taxaOrfaos * 100).toFixed(2)}%`)
    console.log('')
    console.log(`  Ponte:  ${r.ponte}`)
    console.log(`  Órfãos: ${r.orfaos}`)
    console.log('')
    return 0
  } catch (err) {
    if (err instanceof ErroRelacionamento) {
      console.error(`[FALHA] ${err.message}\n`)
      return 1
    }
    throw err
  }
}

const invocadoDiretamente =
  process.argv[1] !== undefined && /relacionamentos[\\/]index\.(ts|js|mts)$/.test(process.argv[1])

if (invocadoDiretamente) {
  executarCli()
    .then((codigo) => {
      if (codigo !== 0) process.exitCode = codigo
    })
    .catch((err) => {
      console.error('\n✗ Erro fatal nos relacionamentos:', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}

export { VERSAO_RELACIONAMENTOS as VERSAO }
