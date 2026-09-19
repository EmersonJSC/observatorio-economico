/**
 * Orquestrador de ingestão de dados — executa todas as fontes automaticamente.
 *
 * Para cada domínio, tenta a fonte PRIMÁRIA e, em caso de falha, a fonte
 * ALTERNATIVA. Se todas falharem, os arquivos locais já existentes permanecem
 * intactos (o dashboard continua servindo os últimos dados válidos).
 *
 * Fontes por domínio:
 *   Território   → IBGE Malhas (primária). Sem alternativa (malha é única).
 *   Indicadores  → IBGE SIDRA (primária) → Base dos Dados (alternativa).
 *   Orçamento    → Siconfi/Tesouro (primária) → Base dos Dados (alternativa).
 *   Eleições     → TSE (primária, requer arquivos baixados) → Brasil.io (alternativa).
 *
 * Uso:
 *   npx tsx scripts/ingest-all.ts                     # roda tudo
 *   npx tsx scripts/ingest-all.ts --only=indicadores  # apenas um domínio
 *   npx tsx scripts/ingest-all.ts --skip=orcamento    # pula um domínio
 *   npx tsx scripts/ingest-all.ts --resumo            # apenas imprime status
 *
 * Saída: dados em data/{maps,indicators,budget,elections}/ e um resumo no console.
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx')

interface Resultado {
  dominio: string
  fonte: 'primária' | 'alternativa' | 'nenhuma'
  ok: boolean
  detalhe?: string
}

function parseArgs() {
  const args = process.argv.slice(2)
  const only = args
    .find((a) => a.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const skip = args
    .find((a) => a.startsWith('--skip='))
    ?.slice('--skip='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return { only, skip, resumo: args.includes('--resumo') }
}

/** Roda um script TS como subprocesso, propagando a saída e retornando o exit code. */
function runScript(script: string, args: string[] = []): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [join('scripts', script), ...args], {
      cwd: ROOT,
      stdio: 'inherit',
    })
    child.on('close', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

/**
 * Fallback de fontes alternativas. Usa import dinâmico para não quebrar o
 * orquestrador quando o adaptador ainda não existe ou não tem credencial.
 */
async function runAlternativa(dominio: string): Promise<{ ok: boolean; detalhe?: string }> {
  const modulos: Record<string, string> = {
    indicadores: './adapters/basedosdados/basedosdados.adapter.js',
    orcamento: './adapters/basedosdados/basedosdados.adapter.js',
    eleicoes: './adapters/brasilio/brasilio.adapter.js',
  }
  const caminho = modulos[dominio]
  if (!caminho) return { ok: false, detalhe: 'sem fonte alternativa configurada' }

  try {
    const mod = await import(caminho)
    const fn = mod?.ingestirComoFonteAlternativa
    if (typeof fn !== 'function') {
      return { ok: false, detalhe: 'adaptador alternativo não implementa ingestirComoFonteAlternativa()' }
    }
    await fn(dominio)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/cannot find module|Cannot find/i.test(msg)) {
      return { ok: false, detalhe: 'adaptador alternativo não encontrado' }
    }
    return { ok: false, detalhe: msg }
  }
}

async function main() {
  const { only, skip, resumo } = parseArgs()

  const etapas = [
    { dominio: 'territorial', nome: 'Território (IBGE Malhas)', script: 'update-territorial-data.ts' },
    { dominio: 'centroides', nome: 'Centróides (camadas de agregação)', script: 'update-centroides.ts' },
    { dominio: 'indicadores', nome: 'Indicadores (IBGE SIDRA)', script: 'update-indicators-data.ts' },
    { dominio: 'orcamento', nome: 'Orçamento (Siconfi)', script: 'update-budget-data.ts' },
    { dominio: 'eleicoes', nome: 'Eleições municipais (TSE)', script: 'update-elections-data.ts' },
    { dominio: 'mandatos', nome: 'Mandatos estaduais/nacionais (TSE)', script: 'update-mandatos-gerais.ts' },
  ].filter((e) => {
    if (only && only.length > 0) return only.includes(e.dominio)
    if (skip && skip.length > 0) return !skip.includes(e.dominio)
    return true
  })

  if (resumo) {
    console.log('Domínios que seriam executados:')
    for (const e of etapas) console.log(`  - ${e.nome}`)
    return
  }

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Ingestão Automática de Dados')
  console.log('╚══════════════════════════════════════════════════════════\n')
  console.log(`  Domínios: ${etapas.map((e) => e.dominio).join(', ')}\n`)

  const resultados: Resultado[] = []

  for (const etapa of etapas) {
    console.log(`\n━━━ ${etapa.nome} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

    const code = await runScript(etapa.script)
    if (code === 0) {
      resultados.push({ dominio: etapa.dominio, fonte: 'primária', ok: true })
      console.log(`  ✓ ${etapa.nome}: concluído pela fonte primária`)
      continue
    }

    console.log(`\n  ⚠ Fonte primária falhou (exit ${code}). Tentando fonte alternativa…`)
    const alt = await runAlternativa(etapa.dominio)
    if (alt.ok) {
      resultados.push({ dominio: etapa.dominio, fonte: 'alternativa', ok: true })
      console.log(`  ✓ ${etapa.nome}: recuperado pela fonte alternativa`)
    } else {
      resultados.push({
        dominio: etapa.dominio,
        fonte: 'nenhuma',
        ok: false,
        detalhe: alt.detalhe,
      })
      console.log(`  ✗ ${etapa.nome}: falhou em todas as fontes. Mantendo dados locais anteriores.`)
      if (alt.detalhe) console.log(`      Motivo: ${alt.detalhe}`)
    }
  }

  console.log('\n══════════════════════════════════════════════════════════')
  console.log('  RESUMO DA INGESTÃO')
  console.log('══════════════════════════════════════════════════════════')
  let falhas = 0
  for (const r of resultados) {
    const status = r.ok ? '✅ OK' : '❌ FALHOU'
    console.log(`  ${status}  ${r.dominio}  (fonte: ${r.fonte})`)
    if (!r.ok) falhas++
  }
  console.log('══════════════════════════════════════════════════════════')

  if (falhas > 0) {
    console.log(`\n⚠ ${falhas} domínio(s) falharam. Os dados locais anteriores foram preservados.`)
    process.exit(1)
  }
  console.log('\n✓ Todos os domínios foram atualizados com sucesso.')
}

main().catch((err) => {
  console.error('\n✗ Erro fatal no orquestrador:', err)
  process.exit(1)
})
