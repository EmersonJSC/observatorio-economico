/**
 * Gera os arquivos DERIVADOS usados pelo site estático.
 *
 * Como o site publicado não tem servidor, as contas que antes eram feitas na
 * API precisam virar arquivo. São gerados:
 *
 *   data/indicators/pontos.json              → todos os municípios com PIB + centroide
 *   data/elections/composicao-brasil.json    → Câmara/Senado por partido + por estado
 *
 * Uso:
 *   npx tsx scripts/gerar-derivados.ts
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const INDICATORS_DIR = join(DATA_DIR, 'indicators')
const ELECTIONS_DIR = join(DATA_DIR, 'elections')
const MAPS_DIR = join(DATA_DIR, 'maps')

async function lerJson<T>(caminho: string): Promise<T | null> {
  if (!existsSync(caminho)) return null
  return JSON.parse(await readFile(caminho, 'utf-8')) as T
}

// ---------------------------------------------------------------------------
// 1. Pontos de PIB (indicadores + centroides)
// ---------------------------------------------------------------------------

interface IndicadorMunicipio {
  codarea: string
  nome: string
  populacao: { total: number | null } | null
  pib: { valorTotalMilReais: number | null; valorPerCapitaReais: number | null } | null
}

async function gerarPontosPib() {
  const centroides = await lerJson<{ municipios: Record<string, [number, number]> }>(
    join(MAPS_DIR, 'centroides.json'),
  )
  if (!centroides) {
    console.warn('  ⚠ centroides.json não encontrado — rode: npx tsx scripts/update-centroides.ts')
    return
  }

  const arquivos = (await readdir(join(INDICATORS_DIR, 'ufs'))).filter((f) => f.endsWith('.json')).sort()
  const pontos: Array<Record<string, unknown>> = []

  for (const arquivo of arquivos) {
    const dados = await lerJson<{ municipios: IndicadorMunicipio[] }>(
      join(INDICATORS_DIR, 'ufs', arquivo),
    )
    for (const m of dados?.municipios ?? []) {
      const centro = centroides.municipios[m.codarea]
      if (!centro) continue
      pontos.push({
        codarea: m.codarea,
        nome: m.nome,
        lng: centro[0],
        lat: centro[1],
        pib: m.pib?.valorTotalMilReais ?? null,
        pibPerCapita: m.pib?.valorPerCapitaReais ?? null,
        populacao: m.populacao?.total ?? null,
      })
    }
  }

  await writeFile(
    join(INDICATORS_DIR, 'pontos.json'),
    JSON.stringify({ total: pontos.length, pontos }),
    'utf-8',
  )
  console.log(`  ✓ indicators/pontos.json — ${pontos.length} municípios`)
}

// ---------------------------------------------------------------------------
// 2. Composição nacional de cadeiras
// ---------------------------------------------------------------------------

async function gerarComposicaoBrasil() {
  const dir = join(ELECTIONS_DIR, 'estados')
  if (!existsSync(dir)) {
    console.warn('  ⚠ data/elections/estados não existe — rode: npx tsx scripts/update-mandatos-gerais.ts')
    return
  }

  const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  const deputadosFederais: any[] = []
  const senadores: any[] = []
  const territorios: Array<Record<string, unknown>> = []

  for (const arquivo of arquivos) {
    const e = await lerJson<{
      uf: string
      sigla: string
      deputadosFederais?: any[]
      senadores?: any[]
    }>(join(dir, arquivo))
    if (!e) continue

    deputadosFederais.push(...(e.deputadosFederais ?? []))
    senadores.push(...(e.senadores ?? []))

    const cadeiras: Record<string, number> = {}
    for (const d of e.deputadosFederais ?? []) {
      const sigla = d.partido || '—'
      cadeiras[sigla] = (cadeiras[sigla] ?? 0) + 1
    }
    const total = (e.deputadosFederais ?? []).length
    if (total > 0) {
      const dominante = Object.entries(cadeiras).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
      territorios.push({ codarea: e.uf, nome: e.sigla, total, cadeiras, dominante })
    }
  }

  const agregar = (mandatos: any[]) => {
    const contagem = new Map<string, number>()
    for (const m of mandatos) {
      const sigla = m.partido || '—'
      contagem.set(sigla, (contagem.get(sigla) ?? 0) + 1)
    }
    return [...contagem.entries()]
      .map(([sigla, cadeiras]) => ({ sigla, cadeiras }))
      .sort((a, b) => b.cadeiras - a.cadeiras || a.sigla.localeCompare(b.sigla))
  }

  const composicao = {
    nivel: 'brasil',
    codigo: 'BR',
    camaras: [
      {
        id: 'camara-federal',
        nome: 'Câmara dos Deputados',
        cargo: 'Deputado Federal',
        total: deputadosFederais.length,
        partidos: agregar(deputadosFederais),
      },
      {
        id: 'senado',
        nome: 'Senado (eleitos em 2022)',
        cargo: 'Senador',
        total: senadores.length,
        partidos: agregar(senadores),
      },
    ],
    territorios: territorios.sort((a, b) => String(a.codarea).localeCompare(String(b.codarea))),
  }

  await mkdir(ELECTIONS_DIR, { recursive: true })
  await writeFile(
    join(ELECTIONS_DIR, 'composicao-brasil.json'),
    JSON.stringify(composicao, null, 2),
    'utf-8',
  )
  console.log(`  ✓ elections/composicao-brasil.json — ${territorios.length} estados`)
}

async function main() {
  console.log('Gerando arquivos derivados para o site estático…\n')
  await gerarPontosPib()
  await gerarComposicaoBrasil()
  console.log('\n✓ Derivados gerados.')
}

main().catch((err) => {
  console.error('\n✗ Erro ao gerar derivados:', err)
  process.exit(1)
})
