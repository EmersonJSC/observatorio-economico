/**
 * Ingestão: Câmara dos Deputados — Dados Abertos v2
 *
 * Fonte: https://dadosabertos.camara.leg.br/api/v2/
 * Adaptador: scripts/adapters/camara/camara.adapter.ts
 *
 * Grava:
 *   data/congresso/deputados.json   — deputados em exercício + partido + UF
 *   data/congresso/partidos.json    — partidos com representação
 *   data/congresso/despesas.json    — cota parlamentar (CEAP) agregada por deputado
 *   data/congresso/metadata.json    — cobertura, anos e data de atualização
 *
 * NÃO exige autenticação.
 *
 * Uso:
 *   npx tsx scripts/update-congresso-data.ts
 *   npx tsx scripts/update-congresso-data.ts --ano=2023
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CamaraAdapter } from './adapters/camara/camara.adapter.js'
import type { DespesaCamara } from './adapters/camara/camara.adapter.js'
import { carregarEnv, lerEnv } from './lib/env.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'congresso')

/** Despesas agregadas de um deputado — o detalhe linha a linha fica no bruto. */
interface ResumoDespesa {
  idDeputado: number
  nome: string
  siglaPartido: string
  siglaUf: string
  ano: number
  /** Soma de `valorLiquido` no ano, em reais. */
  totalLiquido: number
  /** Soma de `valorGlosa`. */
  totalGlosa: number
  quantidadeDocumentos: number
  /** Total por tipo de despesa, do maior para o menor. */
  porTipo: Array<{ tipo: string; valor: number }>
}

const anoDosArgs = process.argv.find((a) => a.startsWith('--ano='))?.slice('--ano='.length)

async function main(): Promise<void> {
  carregarEnv()

  const anos = (anoDosArgs ?? lerEnv('CAMARA_ANO_DESPESA') ?? '2024')
    .split(',')
    .map((a) => Number(a.trim()))
    .filter((a) => Number.isInteger(a) && a >= 2000)

  const idLegislatura = Number(lerEnv('CAMARA_ID_LEGISLATURA') ?? 57)
  const itens = Number(lerEnv('CAMARA_ITENS_POR_PAGINA') ?? 100)

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Câmara dos Deputados — Dados Abertos v2')
  console.log('╚══════════════════════════════════════════════════════════')
  console.log(`  Legislatura: ${idLegislatura}`)
  console.log(`  Anos de despesa: ${anos.join(', ')}`)
  console.log(`  Itens por página: ${itens}\n`)

  const adapter = new CamaraAdapter({ itens })

  // 1. Deputados em exercício
  const deputados = await adapter.listarDeputados({ idLegislatura })
  if (deputados.length === 0) {
    throw new Error(
      'Nenhum deputado retornado. Verifique CAMARA_ID_LEGISLATURA ' +
      '(57 = 2023-2027) ou a conectividade com dadosabertos.camara.leg.br.',
    )
  }

  // 2. Partidos
  const partidos = await adapter.listarPartidos({ idLegislatura })

  // 3. Despesas da cota parlamentar, deputado a deputado
  console.log(`\n  → Despesas da cota parlamentar (${deputados.length} deputados × ${anos.length} ano(s))…`)
  console.log('     Uma requisição por deputado/ano — pode levar alguns minutos.\n')

  const resumos: ResumoDespesa[] = []
  let falhasDespesa = 0

  for (const [i, dep] of deputados.entries()) {
    for (const ano of anos) {
      try {
        const despesas = await adapter.listarDespesas(dep.id, ano)
        if (despesas.length === 0) continue

        const porTipo = new Map<string, number>()
        let totalLiquido = 0
        let totalGlosa = 0

        for (const d of despesas) {
          totalLiquido += Number(d.valorLiquido ?? 0)
          totalGlosa += Number(d.valorGlosa ?? 0)
          porTipo.set(d.tipoDespesa, (porTipo.get(d.tipoDespesa) ?? 0) + Number(d.valorLiquido ?? 0))
        }

        resumos.push({
          idDeputado: dep.id,
          nome: dep.nome,
          siglaPartido: dep.siglaPartido,
          siglaUf: dep.siglaUf,
          ano,
          totalLiquido: Number(totalLiquido.toFixed(2)),
          totalGlosa: Number(totalGlosa.toFixed(2)),
          quantidadeDocumentos: despesas.length,
          porTipo: [...porTipo.entries()]
            .map(([tipo, valor]) => ({ tipo, valor: Number(valor.toFixed(2)) }))
            .sort((a, b) => b.valor - a.valor),
        })
      } catch (err) {
        falhasDespesa++
        // Não aborta: um deputado sem despesa não invalida a ingestão inteira.
        if (falhasDespesa <= 5) {
          console.warn(`    ⚠ ${dep.nome} (${ano}): ${(err as Error).message}`)
        }
      }
    }

    if ((i + 1) % 50 === 0 || i === deputados.length - 1) {
      console.log(`    … ${i + 1}/${deputados.length} deputados processados`)
    }
  }

  if (falhasDespesa > 0) {
    console.warn(`\n  ⚠ ${falhasDespesa} consulta(s) de despesa falharam (deputado/ano sem dados).`)
  }

  // 4. Gravação
  await mkdir(DATA_DIR, { recursive: true })

  await writeFile(
    join(DATA_DIR, 'deputados.json'),
    JSON.stringify({
      total: deputados.length,
      idLegislatura,
      deputados: deputados.map((d) => ({
        id: d.id,
        nome: d.nome,
        siglaPartido: d.siglaPartido,
        siglaUf: d.siglaUf,
        idLegislatura: d.idLegislatura,
        email: d.email,
        urlFoto: d.urlFoto,
      })),
    }),
    'utf-8',
  )

  await writeFile(
    join(DATA_DIR, 'partidos.json'),
    JSON.stringify({
      total: partidos.length,
      partidos: partidos.map((p) => ({ id: p.id, sigla: p.sigla, nome: p.nome })),
    }),
    'utf-8',
  )

  await writeFile(
    join(DATA_DIR, 'despesas.json'),
    JSON.stringify({
      total: resumos.length,
      anos,
      resumos: resumos.sort((a, b) => b.totalLiquido - a.totalLiquido),
    }),
    'utf-8',
  )

  await writeFile(
    join(DATA_DIR, 'metadata.json'),
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        source: 'Câmara dos Deputados — Dados Abertos v2',
        endpointBase: 'https://dadosabertos.camara.leg.br/api/v2',
        autenticacao: 'não exige',
        idLegislatura,
        anosDespesa: anos,
        deputados: deputados.length,
        partidos: partidos.length,
        deputadosComDespesa: resumos.length,
        totalLiquidoGeral: Number(resumos.reduce((s, r) => s + r.totalLiquido, 0).toFixed(2)),
        version: 1,
      },
      null,
      2,
    ),
    'utf-8',
  )

  console.log(`\n  ✓ congresso/deputados.json — ${deputados.length} deputados`)
  console.log(`  ✓ congresso/partidos.json — ${partidos.length} partidos`)
  console.log(`  ✓ congresso/despesas.json — ${resumos.length} resumos de despesa`)
  console.log(`  ✓ congresso/metadata.json`)
  console.log('\n✓ Ingestão da Câmara concluída.')
}

main().catch((err) => {
  console.error('\n✗ Erro na ingestão da Câmara:', err instanceof Error ? err.message : err)
  process.exit(1)
})
