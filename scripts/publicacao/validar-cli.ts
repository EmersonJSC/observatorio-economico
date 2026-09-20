/**
 * Caixa 7 — validação do contrato de publicação (CLI).
 *
 * Uso:
 *   npm run validar:publicacao
 *
 * Sai com código 1 quando alguma rota exigida pelo frontend está ausente —
 * é o portão que impede publicar um site com 404 silencioso.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validarPublicacao } from './validar.js'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function main(): number {
  const raiz = join(RAIZ_PROJETO, 'data', 'published')

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Validação da Publicação')
  console.log('╚══════════════════════════════════════════════════════════')
  console.log(`  Fonte: ${raiz}`)
  console.log('')

  const r = validarPublicacao(raiz)

  console.log(`  Rotas exigidas pelo frontend: ${r.presentes.length + r.ausentes.length}`)
  console.log(`  Presentes:                    ${r.presentes.length}`)
  console.log(`  AUSENTES:                     ${r.ausentes.length}`)
  console.log('')

  if (!r.ok) {
    console.error('  ✗ O site teria 404 nas seguintes rotas:')
    for (const a of r.ausentes) console.error(`      ${a}`)
    console.error('')
    return 1
  }

  if (r.orfaos.length > 0) {
    console.log(`  ⚠ ${r.orfaos.length} artefato(s) publicado(s) sem consumidor:`)
    for (const o of r.orfaos.slice(0, 10)) console.log(`      ${o}`)
    if (r.orfaos.length > 10) console.log(`      … e mais ${r.orfaos.length - 10}`)
    console.log('')
  }

  console.log('  ✓ contrato do frontend integralmente atendido')
  console.log('')
  return 0
}

process.exitCode = main()
