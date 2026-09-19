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

// ---------------------------------------------------------------------------
// 3. Ranking nacional (UFs + municípios com todas as métricas comparáveis)
// ---------------------------------------------------------------------------

/** Uma linha do ranking, com todas as métricas que o site sabe comparar. */
interface LinhaRanking {
  codarea: string
  nome: string
  uf: string
  populacao: number | null
  pib: number | null
  pibPerCapita: number | null
  receitaTotal: number | null
  despesaTotal: number | null
  lng: number | null
  lat: number | null
}

interface IndicadorUf {
  codarea: string
  nome: string
  populacao: { total: number | null } | null
  pib: { valorTotalMilReais: number | null; valorPerCapitaReais: number | null } | null
}

interface Orcamento {
  codarea: string
  nome?: string
  receitaTotal?: number
  despesaTotal?: number
}

/**
 * O ranking é o único lugar do site que compara TODOS os territórios entre si e
 * cruza os três blocos (indicadores, orçamento e território) em uma lista só.
 *
 * Sem ele o frontend teria que baixar 27 arquivos de indicadores + 27 de
 * orçamento para montar qualquer ordenação nacional.
 */
async function gerarRanking() {
  const centroides = await lerJson<{
    ufs: Record<string, [number, number]>
    municipios: Record<string, [number, number]>
  }>(join(MAPS_DIR, 'centroides.json'))

  // Código da UF → sigla (vem das eleições, que já carregam a sigla oficial)
  const siglas = new Map<string, string>()
  const dirEstados = join(ELECTIONS_DIR, 'estados')
  if (existsSync(dirEstados)) {
    for (const arquivo of await readdir(dirEstados)) {
      if (!arquivo.endsWith('.json')) continue
      const e = await lerJson<{ uf: string; sigla: string }>(join(dirEstados, arquivo))
      if (e?.uf && e?.sigla) siglas.set(String(e.uf), e.sigla)
    }
  }

  // Orçamento, indexado por codarea
  const orcamento = new Map<string, Orcamento>()
  const coletarOrcamento = (lista: Orcamento[] | undefined) => {
    for (const o of lista ?? []) orcamento.set(String(o.codarea), o)
  }
  coletarOrcamento((await lerJson<{ estados?: Orcamento[] }>(join(DATA_DIR, 'budget', 'brasil.json')))?.estados)
  const dirOrcamento = join(DATA_DIR, 'budget', 'ufs')
  if (existsSync(dirOrcamento)) {
    for (const arquivo of await readdir(dirOrcamento)) {
      if (!arquivo.endsWith('.json')) continue
      const d = await lerJson<{ municipios?: Orcamento[] }>(join(dirOrcamento, arquivo))
      coletarOrcamento(d?.municipios)
    }
  }

  // ---- UFs ----
  const brasil = await lerJson<{
    anoPopulacao?: number
    anoPib?: number
    estados?: IndicadorUf[]
  }>(join(INDICATORS_DIR, 'brasil.json'))

  const ufs: LinhaRanking[] = (brasil?.estados ?? []).map((e) => {
    const codarea = String(e.codarea)
    const centro = centroides?.ufs?.[codarea] ?? null
    return {
      codarea,
      nome: e.nome,
      uf: siglas.get(codarea) ?? codarea,
      populacao: e.populacao?.total ?? null,
      pib: e.pib?.valorTotalMilReais ?? null,
      pibPerCapita: e.pib?.valorPerCapitaReais ?? null,
      receitaTotal: orcamento.get(codarea)?.receitaTotal ?? null,
      despesaTotal: orcamento.get(codarea)?.despesaTotal ?? null,
      lng: centro?.[0] ?? null,
      lat: centro?.[1] ?? null,
    }
  })

  // ---- Municípios ----
  const municipios: LinhaRanking[] = []
  const dirIndicadores = join(INDICATORS_DIR, 'ufs')
  if (existsSync(dirIndicadores)) {
    for (const arquivo of (await readdir(dirIndicadores)).filter((f) => f.endsWith('.json')).sort()) {
      const ufCodigo = arquivo.replace('.json', '')
      const d = await lerJson<{ municipios?: IndicadorMunicipio[] }>(join(dirIndicadores, arquivo))
      for (const m of d?.municipios ?? []) {
        const codarea = String(m.codarea)
        const centro = centroides?.municipios?.[codarea] ?? null
        municipios.push({
          codarea,
          nome: m.nome,
          uf: siglas.get(ufCodigo) ?? ufCodigo,
          populacao: m.populacao?.total ?? null,
          pib: m.pib?.valorTotalMilReais ?? null,
          pibPerCapita: m.pib?.valorPerCapitaReais ?? null,
          receitaTotal: orcamento.get(codarea)?.receitaTotal ?? null,
          despesaTotal: orcamento.get(codarea)?.despesaTotal ?? null,
          lng: centro?.[0] ?? null,
          lat: centro?.[1] ?? null,
        })
      }
    }
  }

  if (ufs.length === 0 && municipios.length === 0) {
    console.warn('  ⚠ sem dados para o ranking — rode a ingestão primeiro')
    return
  }

  const ranking = {
    geradoEm: new Date().toISOString(),
    anos: {
      populacao: brasil?.anoPopulacao ?? null,
      pib: brasil?.anoPib ?? null,
      orcamento: (await lerJson<{ exercicio?: number }>(join(DATA_DIR, 'budget', 'brasil.json')))?.exercicio ?? null,
    },
    ufs,
    municipios,
  }

  await writeFile(join(INDICATORS_DIR, 'ranking.json'), JSON.stringify(ranking), 'utf-8')
  console.log(`  ✓ indicators/ranking.json — ${ufs.length} UFs e ${municipios.length} municípios`)
}

async function main() {
  console.log('Gerando arquivos derivados para o site estático…\n')
  await gerarPontosPib()
  await gerarComposicaoBrasil()
  await gerarRanking()
  console.log('\n✓ Derivados gerados.')
}

main().catch((err) => {
  console.error('\n✗ Erro ao gerar derivados:', err)
  process.exit(1)
})
