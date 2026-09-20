/**
 * Caixa 6 — CÁLCULOS: porta de entrada.
 *
 * Aplica as regras analíticas sobre o organizado (Caixa 4) e a ponte (Caixa 5),
 * gravando em `data/calculated/`.
 *
 * Escopo desta etapa: métricas de MUNICÍPIO (densidade, PIB, PIB per capita,
 * receita total e receita per capita — esta última bloqueada por ano divergente).
 *
 * CLI:
 *   npm run calcular
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { calcular } from './calculos.js'
import type { MotivoNulo, OpcoesCalculos, ResultadoCalculos } from './tipos.js'
import { VERSAO_CALCULOS } from './tipos.js'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export { calcular } from './calculos.js'
export { calcularRazao, calcularPerCapita, calcularDensidade } from './motores/razao.js'
export { somar, agregarPor, mediaPonderada, somarComCobertura } from './motores/soma.js'
export { METRICAS_MUNICIPIO, INSUMO, buscarMetrica } from './metricas/catalogo.js'
export { calcularMetricasMunicipio } from './metricas/municipio.js'
export { carregarInsumos } from './insumos.js'
export { VERSAO_CALCULOS } from './tipos.js'
export type {
  ResultadoCalculo,
  MotivoNulo,
  MetricaDeclarada,
  ValorCalculado,
  CoberturaMetrica,
  MetadadosCalculos,
  ResultadoCalculos,
  OpcoesCalculos,
} from './tipos.js'

/** Raiz padrão da saída de cálculos. */
export function raizCalculada(): string {
  return join(RAIZ_PROJETO, 'data', 'calculated')
}

/** Executa os cálculos a partir da linha de comando. */
export async function executarCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  void argv

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Cálculos (Caixa 6)')
  console.log('╚══════════════════════════════════════════════════════════')
  console.log(`  Destino: ${raizCalculada()}`)
  console.log(`  Escopo:  métricas de município`)
  console.log('')

  try {
    const opcoes: OpcoesCalculos = {}
    const r: ResultadoCalculos = await calcular(opcoes)

    console.log(`[OK] cálculos aplicados — ${r.contagens.municipios} municípios`)
    console.log('')
    console.log('  COBERTURA POR MÉTRICA')
    for (const c of r.cobertura) {
      const motivos = Object.entries(c.porMotivo)
        .map(([m, n]) => `${m}: ${n}`)
        .join(', ')
      const detalhe = motivos ? `  (${motivos})` : ''
      console.log(
        `    ${c.metricaId.padEnd(22)} ${String(c.comValor).padStart(6)} com valor${detalhe}`,
      )
    }

    if (r.metadados.bloqueios.length > 0) {
      console.log('')
      console.log('  BLOQUEIOS METODOLÓGICOS')
      for (const b of r.metadados.bloqueios) console.log(`    ⚠ ${b}`)
    }

    if (r.metadados.avisos.length > 0) {
      console.log('')
      console.log('  AVISOS')
      for (const a of r.metadados.avisos) console.log(`    • ${a}`)
    }

    console.log('')
    console.log(`  Saída: ${r.saida}`)
    console.log(`  Versão da Caixa 6: ${VERSAO_CALCULOS}`)
    console.log('')
    return 0
  } catch (err) {
    console.error(`\n[FALHA] ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

const invocadoDiretamente =
  process.argv[1] !== undefined && /calculos[\\/]index\.(ts|js|mts)$/.test(process.argv[1])

if (invocadoDiretamente) {
  executarCli()
    .then((codigo) => {
      if (codigo !== 0) process.exitCode = codigo
    })
    .catch((err) => {
      console.error('\n✗ Erro fatal nos cálculos:', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}

export type { MotivoNulo as Motivo }
