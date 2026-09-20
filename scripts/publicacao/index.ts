/**
 * Caixa 7 — PUBLICAÇÃO: porta de entrada.
 *
 * Lê as Caixas 4, 5 e 6 e emite os artefatos estáticos que o navegador consome
 * em `data/published/`, com compressão `.gz` ao lado.
 *
 * CLI:
 *   npm run publicar
 *   npm run publicar -- --sem-compressao
 *   npm run validar:publicacao
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { publicar } from './publicacao.js'
import { validarPublicacao } from './validar.js'
import type { OpcoesPublicacao, ResultadoPublicacao } from './tipos.js'
import { VERSAO_PUBLICACAO } from './tipos.js'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export { publicar } from './publicacao.js'
export { validarPublicacao, rotasExigidas } from './validar.js'
export { ROTAS_FRONTEND, MAPA_METRICAS, ALIASES_ELIMINADOS, UFS } from './contrato.js'
export { VERSAO_PUBLICACAO } from './tipos.js'
export type {
  OpcoesPublicacao,
  ResultadoPublicacao,
  ManifestoPublicacao,
  ArtefatoPublicado,
  MunicipioPublicado,
  MunicipioIndice,
  MetricasMunicipio,
} from './tipos.js'
export type { ResultadoValidacaoPublicacao, RotaConsumida } from './validar.js'

/** Raiz padrão da saída publicada. */
export function raizPublicada(): string {
  return join(RAIZ_PROJETO, 'data', 'published')
}

const emMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2)
const emKB = (bytes: number) => (bytes / 1024).toFixed(0)

/** Executa a publicação a partir da linha de comando. */
export async function executarCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const comprimir = !argv.includes('--sem-compressao')
  const raiz = raizPublicada()

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Publicação (Caixa 7)')
  console.log('╚══════════════════════════════════════════════════════════')
  console.log(`  Destino:    ${raiz}`)
  console.log(`  Compressão: ${comprimir ? 'sim (.gz)' : 'não'}`)
  console.log('')

  let resultado: ResultadoPublicacao
  try {
    const opcoes: OpcoesPublicacao = { comprimir }
    resultado = await publicar(opcoes)
  } catch (err) {
    console.error(`\n[FALHA] ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }

  console.log(`[OK] ${resultado.artefatos.length} artefatos publicados`)
  console.log('')
  console.log('  MAIORES ARTEFATOS')
  const maiores = [...resultado.artefatos]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6)
  for (const a of maiores) {
    const gz = a.bytesGzip !== undefined ? ` -> ${emKB(a.bytesGzip)} KB gz` : ''
    console.log(`    ${a.caminho.padEnd(42)} ${emKB(a.bytes).padStart(7)} KB${gz}`)
  }

  console.log('')
  console.log(
    `  TOTAL: ${emMB(resultado.totais.bytes)} MB -> ${emMB(resultado.totais.bytesGzip)} MB gz` +
      (resultado.totais.bytes > 0
        ? `  (${(100 - (resultado.totais.bytesGzip / resultado.totais.bytes) * 100).toFixed(0)}% menor)`
        : ''),
  )

  // Valida o contrato logo após publicar: falhar aqui é melhor que falhar no
  // navegador do usuário.
  const validacao = validarPublicacao(raiz)
  console.log('')
  if (validacao.ok) {
    console.log(`  ✓ contrato do frontend atendido (${validacao.presentes.length} rotas)`)
  } else {
    console.log(`  ✗ ${validacao.ausentes.length} rota(s) exigida(s) e AUSENTE(s):`)
    for (const a of validacao.ausentes.slice(0, 10)) console.log(`      ${a}`)
    console.log('')
    return 1
  }

  if (validacao.orfaos.length > 0) {
    console.log(`  ⚠ ${validacao.orfaos.length} artefato(s) sem consumidor:`)
    for (const o of validacao.orfaos.slice(0, 5)) console.log(`      ${o}`)
  }

  console.log(`  Versão da Caixa 7: ${VERSAO_PUBLICACAO}`)
  console.log('')
  return 0
}

const invocadoDiretamente =
  process.argv[1] !== undefined && /publicacao[\\/]index\.(ts|js|mts)$/.test(process.argv[1])

if (invocadoDiretamente) {
  executarCli()
    .then((codigo) => {
      if (codigo !== 0) process.exitCode = codigo
    })
    .catch((err) => {
      console.error('\n✗ Erro fatal na publicação:', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
