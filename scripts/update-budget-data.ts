/**
 * Script de atualização do dataset de orçamento e finanças públicas (Siconfi / Tesouro Nacional).
 *
 * Responsável por baixar dados fiscais de Estados e Municípios a partir da API
 * pública do Siconfi (Sistema de Informações Contábeis e Fiscais do Setor Público
 * Brasileiro) e consolidá-los em arquivos JSON locais em `data/budget/`.
 *
 * Fonte oficial:
 *   - Siconfi API Data Lake: https://apidatalake.tesouro.gov.br/ords/siconfi/tt/
 *   - Endpoint utilizado: DCA (Declaração de Contas Anuais): /dca
 *
 * RATE LIMITING DO SICONFI:
 *   A API do Tesouro Nacional possui limites estritos de requisições concorrentes.
 *   Disparar requisições em paralelo para 5.570 municípios resultará em HTTP 429
 *   (Too Many Requests) e bloqueio temporário do IP. Este script utiliza execução
 *   em lotes controlados com delay configurável entre requisições.
 *
 * Uso:
 *   npx tsx scripts/update-budget-data.ts
 *   npx tsx scripts/update-budget-data.ts --only=11,35       # apenas UFs específicas
 *   npx tsx scripts/update-budget-data.ts --ano=2023        # ano do exercício contábil
 *   npx tsx scripts/update-budget-data.ts --delay=500       # delay em ms entre requisições
 *   npx tsx scripts/update-budget-data.ts --concurrency=2   # requisições simultâneas
 *
 * Estrutura gerada:
 *   data/budget/
 *   ├── brasil.json           (resumo orçamentário dos 26 estados + DF)
 *   ├── metadata.json         (data de atualização, ano de exercício, versão)
 *   └── ufs/
 *       ├── 11.json           (finanças dos municípios de Rondônia)
 *       ├── 35.json           (finanças dos municípios de São Paulo)
 *       └── ...
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SiconfiAdapter,
  type OrcamentoEnte,
} from './adapters/siconfi/siconfi.adapter.js'
import { IbgeLocalidadesAdapter } from './adapters/ibge/ibge-localidades.adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'budget')
const UFS_DIR = join(DATA_DIR, 'ufs')

// Todas as UFs do Brasil (código IBGE de 2 dígitos)
const TODAS_UFS = [
  '11', '12', '13', '14', '15', '16', '17', '21', '22', '23', '24', '25',
  '26', '27', '28', '29', '31', '32', '33', '35', '41', '42', '43', '50',
  '51', '52', '53',
]

/** Metadados do dataset orçamentário */
export interface MetadataOrcamento {
  updatedAt: string
  source: string
  exercicio: number
  estados: number
  municipios: number
  ufs: string[]
  version: number
}

// =============================================================================
// Utilitários CLI e Delay
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2)
  const only = args
    .find((a) => a.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const anoArg = args.find((a) => a.startsWith('--ano='))?.slice('--ano='.length)
  const delayArg = args.find((a) => a.startsWith('--delay='))?.slice('--delay='.length)
  const concurrencyArg = args.find((a) => a.startsWith('--concurrency='))?.slice('--concurrency='.length)

  return {
    only,
    exercicio: anoArg ? Number(anoArg) : 2023,
    delayMs: delayArg ? Number(delayArg) : 300,
    concurrency: concurrencyArg ? Number(concurrencyArg) : 2,
  }
}

async function ensureDirs() {
  await mkdir(UFS_DIR, { recursive: true })
}

/**
 * Converte o resultado do adaptador para o formato de saída do dataset,
 * usando `codarea` como chave territorial (padrão do restante do projeto).
 */
function paraSaida(ente: OrcamentoEnte, nomeLimpo?: string) {
  return {
    codarea: ente.codareaIbge,
    nome: nomeLimpo ?? ente.nome,
    exercicio: ente.exercicio,
    receitaTotal: ente.receitaTotal,
    despesaTotal: ente.despesaTotal,
    gastosPorArea: ente.gastosPorArea,
    fonte: ente.fonte,
    atualizadoEm: ente.atualizadoEm,
  }
}

// =============================================================================
// Execução Principal
// =============================================================================

async function main() {
  const { only, exercicio, delayMs, concurrency } = parseArgs()

  console.log('Atualizando dataset de finanças públicas e orçamento (Siconfi/Tesouro)…\n')
  await ensureDirs()

  console.log(`  Exercício contábil: ${exercicio}`)
  console.log(`  Delay entre requests: ${delayMs}ms`)
  console.log(`  Concorrência:         ${concurrency}`)
  if (only) console.log(`  Filtro de UFs:        ${only.join(', ')}`)

  const siconfi = new SiconfiAdapter({ delayMs })
  const localidades = new IbgeLocalidadesAdapter()

  // 1. Estados e Distrito Federal
  console.log('\n→ Consolidando dados orçamentários dos Estados e DF…')

  const estados = await localidades.listarEstados()
  const nomeEstadoPorCod = new Map(estados.map((e) => [String(e.id), e.nome]))
  const codigosEstados = estados.map((e) => String(e.id))

  const entesEstaduais = await siconfi.processarEmLote(
    codigosEstados,
    exercicio,
    concurrency,
  )

  const estadosSaida = entesEstaduais
    .map((ente) => paraSaida(ente, nomeEstadoPorCod.get(ente.codareaIbge)))
    .sort((a, b) => a.codarea.localeCompare(b.codarea))

  await writeFile(
    join(DATA_DIR, 'brasil.json'),
    JSON.stringify(
      { updatedAt: new Date().toISOString(), exercicio, estados: estadosSaida },
      null,
      2,
    ),
    'utf-8',
  )
  console.log(`  ✓ brasil.json salvo (${estadosSaida.length} estados com dados)`)

  // 2. Municípios por UF
  const ufsAlvo = only ?? TODAS_UFS

  console.log(`\n→ Processando dados fiscais para ${ufsAlvo.length} UFs…`)
  let totalMunicipios = 0

  for (const uf of ufsAlvo) {
    try {
      const municipios = await localidades.listarMunicipiosPorUf(uf)
      const nomePorCod = new Map(
        municipios.map((m) => [String(m.id).padStart(7, '0'), m.nome]),
      )
      const codareias = [...nomePorCod.keys()]

      const entes = await siconfi.processarEmLote(codareias, exercicio, concurrency)
      const saida = entes
        .map((ente) => paraSaida(ente, nomePorCod.get(ente.codareaIbge)))
        .sort((a, b) => a.codarea.localeCompare(b.codarea))

      await writeFile(
        join(UFS_DIR, `${uf}.json`),
        JSON.stringify({ uf, exercicio, municipios: saida }, null, 2),
        'utf-8',
      )

      totalMunicipios += saida.length
      console.log(
        `  ✓ UF ${uf}: ${saida.length}/${codareias.length} municípios com dados fiscais`,
      )
    } catch (err) {
      console.error(`  ✗ UF ${uf}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 3. Metadados de auditoria
  const metadata: MetadataOrcamento = {
    updatedAt: new Date().toISOString(),
    source: 'Secretaria do Tesouro Nacional — Siconfi (DCA)',
    exercicio,
    estados: estadosSaida.length,
    municipios: totalMunicipios,
    ufs: ufsAlvo,
    version: 2,
  }

  await writeFile(
    join(DATA_DIR, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8',
  )

  console.log('\n✓ Dataset de orçamento atualizado com sucesso.')
  console.log(`  Local: ${DATA_DIR}`)
}

main().catch((err) => {
  console.error('\n✗ Erro ao atualizar o dataset orçamentário:', err)
  process.exit(1)
})
