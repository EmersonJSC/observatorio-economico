/**
 * Script de atualização do dataset de indicadores socioeconômicos (IBGE).
 *
 * Responsável por baixar dados de População e PIB diretamente das APIs de
 * Agregados / SIDRA do IBGE e consolidá-los em arquivos JSON locais em
 * `data/indicators/`, mantendo a mesma separação territorial (Brasil e UFs).
 *
 * Fontes oficiais:
 *   - População: Tabela 6579 (Estimativas) ou 4714/202 (Censo Demográfico)
 *   - PIB: Tabela 5938 (Produto Interno Bruto a preços correntes e per capita)
 *
 * Uso:
 *   npx tsx scripts/update-indicators-data.ts
 *   npx tsx scripts/update-indicators-data.ts --only=11,35       # apenas UFs específicas
 *   npx tsx scripts/update-indicators-data.ts --skip-pib         # atualiza apenas população
 *   npx tsx scripts/update-indicators-data.ts --ano-populacao=2024 --ano-pib=2021
 *
 * Estrutura gerada:
 *   data/indicators/
 *   ├── brasil.json           (indicadores consolidados do país e das 27 UFs)
 *   ├── metadata.json         (data de sincronização, tabelas e períodos de referência)
 *   └── ufs/
 *       ├── 11.json           (indicadores de todos os municípios de Rondônia)
 *       ├── 35.json           (indicadores de todos os municípios de São Paulo)
 *       └── ...
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  IbgeSidraAdapter,
  calcularPibPerCapita,
  type IndicadoresLocalidade,
} from './adapters/ibge/ibge-sidra.adapter.js'
import { IbgeLocalidadesAdapter } from './adapters/ibge/ibge-localidades.adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'indicators')
const UFS_DIR = join(DATA_DIR, 'ufs')

// Tabelas e Variáveis de Referência no IBGE (SIDRA)
const TABELA_POPULACAO = '6579'
const VARIAVEL_POPULACAO = '9324'
const TABELA_PIB = '5938'
const VARIAVEL_PIB_TOTAL = '37'

// Todas as UFs do Brasil (código IBGE de 2 dígitos)
const TODAS_UFS = [
  '11', '12', '13', '14', '15', '16', '17', '21', '22', '23', '24', '25',
  '26', '27', '28', '29', '31', '32', '33', '35', '41', '42', '43', '50',
  '51', '52', '53',
]

/** Metadados de auditoria do dataset de indicadores */
export interface MetadataIndicadores {
  updatedAt: string
  source: string
  anoPopulacao: number
  anoPib: number
  estados: number
  municipios: number
  ufs: string[]
  version: number
}

// =============================================================================
// Utilitários CLI
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2)
  const only = args
    .find((a) => a.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const skipPib = args.includes('--skip-pib')
  const skipPopulacao = args.includes('--skip-populacao')

  const anoPopulacaoArg = args
    .find((a) => a.startsWith('--ano-populacao='))
    ?.slice('--ano-populacao='.length)
  const anoPibArg = args
    .find((a) => a.startsWith('--ano-pib='))
    ?.slice('--ano-pib='.length)

  return {
    only,
    skipPib,
    skipPopulacao,
    anoPopulacao: anoPopulacaoArg ? Number(anoPopulacaoArg) : 2024,
    anoPib: anoPibArg ? Number(anoPibArg) : 2021,
  }
}

async function ensureDirs() {
  await mkdir(UFS_DIR, { recursive: true })
}

/**
 * Remove o sufixo de UF que o SIDRA anexa ao nome da localidade
 * ("Alta Floresta D'Oeste - RO" → "Alta Floresta D'Oeste"), mantendo apenas o
 * nome oficial limpo, alinhado ao dataset de mapas.
 */
function limparNome(nome: string): string {
  return nome
    .replace(/\s*\([A-Z]{2}\)\s*$/u, '')
    .replace(/\s+-\s+[A-Z]{2}\s*$/u, '')
    .trim()
}

// =============================================================================
// Execução Principal
// =============================================================================

async function main() {
  const { only, skipPib, skipPopulacao, anoPopulacao, anoPib } = parseArgs()

  console.log('Atualizando dataset de indicadores socioeconômicos (IBGE)…\n')
  await ensureDirs()

  console.log(`  Período População: ${anoPopulacao} (Tabela ${TABELA_POPULACAO})`)
  console.log(`  Período PIB:       ${anoPib} (Tabela ${TABELA_PIB})`)
  if (only) console.log(`  Filtro de UFs:     ${only.join(', ')}`)

  const sidra = new IbgeSidraAdapter()
  const localidades = new IbgeLocalidadesAdapter()

  // 1. Dados Federais e Estaduais (Brasil + 27 UFs)
  console.log('\n→ Consolidando dados do Brasil e UFs…')

  if (!skipPopulacao || !skipPib) {
    const estados = await localidades.listarEstados()
    const nomePorCod = new Map(estados.map((e) => [String(e.id), e.nome]))

    const populacao = skipPopulacao
      ? new Map<string, number | null>()
      : await sidra.baixarPopulacaoUfs(anoPopulacao)
    const pib = skipPib
      ? new Map<string, number | null>()
      : await sidra.baixarPibUfs(anoPib)

    // População do ano do PIB, para calcular o per capita com anos consistentes
    const populacaoPibAno =
      skipPib || anoPib === anoPopulacao
        ? populacao
        : await sidra.baixarPopulacaoUfs(anoPib)

    const codareas = new Set([...populacao.keys(), ...pib.keys()])
    const consolidado: IndicadoresLocalidade[] = []

    for (const codarea of codareas) {
      const nome = codarea === '1' ? 'Brasil' : (nomePorCod.get(codarea) ?? codarea)

      const pibTotal = pib.get(codarea) ?? null
      const populacaoPib = populacaoPibAno.get(codarea) ?? null

      consolidado.push({
        codarea,
        nome,
        populacao: skipPopulacao
          ? null
          : {
              total: populacao.get(codarea) ?? null,
              anoReferencia: anoPopulacao,
              fonte: `IBGE — Tabela SIDRA ${TABELA_POPULACAO} (${VARIAVEL_POPULACAO})`,
            },
        pib: skipPib
          ? null
          : {
              valorTotalMilReais: pibTotal,
              valorPerCapitaReais: calcularPibPerCapita(pibTotal, populacaoPib),
              anoReferencia: anoPib,
              fonte: `IBGE — Tabela SIDRA ${TABELA_PIB} (${VARIAVEL_PIB_TOTAL})`,
            },
      })
    }

    const brasil = consolidado.find((c) => c.codarea === '1') ?? null
    const ufs = consolidado
      .filter((c) => c.codarea !== '1')
      .sort((a, b) => a.codarea.localeCompare(b.codarea))

    await writeFile(
      join(DATA_DIR, 'brasil.json'),
      JSON.stringify(
        { updatedAt: new Date().toISOString(), anoPopulacao, anoPib, brasil, estados: ufs },
        null,
        2,
      ),
      'utf-8',
    )
    console.log(
      `  ✓ brasil.json salvo (Brasil + ${ufs.length} UFs consolidados)`,
    )
  }

  // 2. Dados Municipais por UF
  const ufsAlvo = only ?? TODAS_UFS

  console.log(`\n→ Processando indicadores municipais para ${ufsAlvo.length} UFs…`)
  let totalMunicipios = 0

  for (const uf of ufsAlvo) {
    try {
      const municipios = await sidra.baixarIndicadoresMunicipios(uf, anoPopulacao, anoPib)

      // Aplica as flags de skip e limpa o sufixo de UF no nome
      const limpos = municipios.map((m) => ({
        ...m,
        nome: limparNome(m.nome),
        populacao: skipPopulacao ? null : m.populacao,
        pib: skipPib ? null : m.pib,
      }))

      await writeFile(
        join(UFS_DIR, `${uf}.json`),
        JSON.stringify({ uf, anoPopulacao, anoPib, municipios: limpos }, null, 2),
        'utf-8',
      )

      totalMunicipios += limpos.length
      console.log(`  ✓ UF ${uf}: ${limpos.length} municípios salvos`)
    } catch (err) {
      console.error(`  ✗ UF ${uf}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 3. Metadados de integridade e auditoria
  const metadata: MetadataIndicadores = {
    updatedAt: new Date().toISOString(),
    source: 'IBGE — Sistema IBGE de Recuperação Automática (SIDRA)',
    anoPopulacao,
    anoPib,
    estados: 27,
    municipios: totalMunicipios,
    ufs: ufsAlvo,
    version: 2,
  }

  await writeFile(
    join(DATA_DIR, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8',
  )

  console.log('\n✓ Dataset de indicadores atualizado com sucesso.')
  console.log(`  Local: ${DATA_DIR}`)
}

main().catch((err) => {
  console.error('\n✗ Erro ao atualizar o dataset de indicadores:', err)
  process.exit(1)
})
