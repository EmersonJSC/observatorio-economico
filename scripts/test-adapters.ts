/**
 * Script de smoke test — valida conectividade de todos os adaptadores.
 *
 * Executa uma requisição real de baixo custo contra cada API externa
 * e exibe no console se a conectividade está funcionando.
 *
 * Uso:
 *   npx tsx scripts/test-adapters.ts
 *   npx tsx scripts/test-adapters.ts --only=ibge-malhas,siconfi
 *
 * Adaptadores disponíveis:
 *   - ibge-malhas       → API de Malhas Territoriais v3 do IBGE
 *   - ibge-localidades  → API de Localidades v1 do IBGE
 *   - ibge-sidra        → API de Agregados/SIDRA v3 do IBGE
 *   - siconfi           → API do Siconfi (Tesouro Nacional)
 *   - tse               → API DivulgaCandContas do TSE
 *   - camara            → API de Dados Abertos v2 da Câmara dos Deputados
 *   - portal            → API de Dados do Portal da Transparência (exige chave)
 *
 * Carrega `.env` automaticamente (ver scripts/lib/env.ts).
 */

import { carregarEnv } from './lib/env.js'
import { IbgeMalhasAdapter } from './adapters/ibge/ibge-malhas.adapter.js'
import { IbgeLocalidadesAdapter } from './adapters/ibge/ibge-localidades.adapter.js'
import { IbgeSidraAdapter } from './adapters/ibge/ibge-sidra.adapter.js'
import { SiconfiAdapter } from './adapters/siconfi/siconfi.adapter.js'
import { TseAdapter } from './adapters/tse/tse.adapter.js'
import { CamaraAdapter } from './adapters/camara/camara.adapter.js'
import { PortalTransparenciaAdapter } from './adapters/portal-transparencia/portal-transparencia.adapter.js'

// ---------------------------------------------------------------------------
// Registro de todos os adaptadores
// ---------------------------------------------------------------------------

const ADAPTADORES = {
  'ibge-malhas': () => new IbgeMalhasAdapter().testarConectividade(),
  'ibge-localidades': () => new IbgeLocalidadesAdapter().testarConectividade(),
  'ibge-sidra': () => new IbgeSidraAdapter().testarConectividade(),
  'siconfi': () => new SiconfiAdapter().testarConectividade(),
  'tse': () => new TseAdapter().testarConectividade(),
  'camara': () => new CamaraAdapter().testarConectividade(),
  'portal': () => new PortalTransparenciaAdapter().testarConectividade(),
} as const

type AdaptadorKey = keyof typeof ADAPTADORES

// ---------------------------------------------------------------------------
// Parse de argumentos CLI
// ---------------------------------------------------------------------------

function parseArgs(): { only: AdaptadorKey[] | null } {
  const args = process.argv.slice(2)
  const onlyArg = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)
  if (!onlyArg) return { only: null }

  const keys = onlyArg.split(',').map((s) => s.trim()) as AdaptadorKey[]
  const invalidos = keys.filter((k) => !(k in ADAPTADORES))
  if (invalidos.length > 0) {
    console.error(`\n✗ Adaptadores inválidos: ${invalidos.join(', ')}`)
    console.error(`  Disponíveis: ${Object.keys(ADAPTADORES).join(', ')}`)
    process.exit(1)
  }
  return { only: keys }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  carregarEnv()
  const { only } = parseArgs()

  const alvos: AdaptadorKey[] =
    only ?? (Object.keys(ADAPTADORES) as AdaptadorKey[])

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Smoke Test de Adaptadores')
  console.log('╚══════════════════════════════════════════════════════════')
  console.log(`\nTestando ${alvos.length} adaptador(es): ${alvos.join(', ')}\n`)

  const resultados: Record<AdaptadorKey, boolean> = {} as Record<AdaptadorKey, boolean>

  for (const key of alvos) {
    try {
      resultados[key] = await ADAPTADORES[key]()
    } catch (err) {
      console.error(
        `\n[${key}] ❌ Erro inesperado: ${err instanceof Error ? err.message : String(err)}`,
      )
      resultados[key] = false
    }
  }

  // Sumário final
  console.log('\n══════════════════════════════════════════════════════════')
  console.log('  SUMÁRIO DE CONECTIVIDADE')
  console.log('══════════════════════════════════════════════════════════')

  let totalOk = 0
  let totalFalha = 0

  for (const [key, ok] of Object.entries(resultados) as [AdaptadorKey, boolean][]) {
    const status = ok ? '✅ OK    ' : '❌ FALHA'
    console.log(`  ${status}  ${key}`)
    if (ok) totalOk++
    else totalFalha++
  }

  console.log('──────────────────────────────────────────────────────────')
  console.log(`  ${totalOk} OK  |  ${totalFalha} com falha  |  ${alvos.length} total`)
  console.log('══════════════════════════════════════════════════════════\n')

  if (totalFalha > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\n✗ Erro fatal no teste de adaptadores:', err)
  process.exit(1)
})
