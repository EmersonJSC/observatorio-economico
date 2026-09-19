/**
 * Script de atualização do dataset de eleições e mandatos públicos (TSE).
 *
 * Responsável por ingerir dados eleitorais oficiais do Tribunal Superior Eleitoral,
 * filtrando representantes eleitos (Governadores, Prefeitos e respectivos vices)
 * e associando-os ao código territorial padrão IBGE para exibição na aba "Pessoas"
 * do painel territorial do Observatório.
 *
 * Fontes:
 *   - CDN TSE via Playwright: https://cdn.tse.jus.br/estatistica/sead/odsele/
 *   - Arquivos: consulta_cand_{ano}[_{UF}].zip e votacao_candidato_munzona_{ano}[_{UF}].zip
 *
 * Uso:
 *   npx tsx scripts/update-elections-data.ts
 *   npx tsx scripts/update-elections-data.ts --only=31,33         # UFs específicas
 *   npx tsx scripts/update-elections-data.ts --ano=2024           # ano da eleição municipal
 *   npx tsx scripts/update-elections-data.ts --download           # força re-download via Playwright
 *   npx tsx scripts/update-elections-data.ts --rebuild-depara     # regenera tabela TSE↔IBGE
 *   npx tsx scripts/update-elections-data.ts --no-headless        # exibe janela do browser
 *
 * Pré-requisitos:
 *   1. playwright instalado:   npm install --save-dev playwright
 *   2. Chromium instalado:     npx playwright install chromium
 *
 * Estrutura gerada:
 *   data/elections/
 *   ├── de-para-tse-ibge.json    (tabela de correlação TSE ↔ IBGE — gerada 1x)
 *   ├── brasil.json              (governadores e vice-governadores dos 27 estados)
 *   ├── metadata.json            (data de atualização, anos das eleições, fontes)
 *   ├── raw/                     (ZIPs baixados via Playwright — não versionados)
 *   │   ├── consulta_cand_2024_MG.zip
 *   │   └── votacao_candidato_munzona_2024_MG.zip
 *   └── ufs/
 *       ├── 31.json              (prefeitos e vices dos municípios de MG)
 *       └── ...
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TseCsvParser } from './adapters/tse/tse-csv-parser.js'
import { TseDeParaBuilder } from './adapters/tse/tse-depara-builder.js'
import { cdCargoParaNome, calcularPeriodoMandato } from './adapters/tse/tse-mandatos.js'
import type { MandatoRepresentante, MandatoMunicipio, MetadataEleicoes } from './adapters/tse/tse-mandatos.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'elections')
const UFS_DIR = join(DATA_DIR, 'ufs')
const RAW_DIR = join(DATA_DIR, 'raw')
const DE_PARA_PATH = join(DATA_DIR, 'de-para-tse-ibge.json')

// Todas as UFs do Brasil
const TODAS_UFS = ['11', '12', '13', '14', '15', '16', '17', '21', '22', '23', '24', '25', '26', '27', '28', '29', '31', '32', '33', '35', '41', '42', '43', '50', '51', '52', '53']

// Mapa de código IBGE → Sigla UF (para localizar o arquivo por UF)
const UF_SIGLAS: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
  '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
  '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
  '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
  '52': 'GO', '53': 'DF',
}

// ---------------------------------------------------------------------------
// Parse de argumentos CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2)

  const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)
    .split(',').map((s) => s.trim()).filter(Boolean)

  const anoArg = args.find((a) => a.startsWith('--ano='))?.slice('--ano='.length)
  const anoEstadualArg = args.find((a) => a.startsWith('--ano-estadual='))?.slice('--ano-estadual='.length)

  return {
    only,
    anoMunicipal: anoArg ? Number(anoArg) : 2024,
    anoEstadual: anoEstadualArg ? Number(anoEstadualArg) : 2022,
    forceDownload: args.includes('--download'),
    rebuilDeParа: args.includes('--rebuild-depara'),
    headless: !args.includes('--no-headless'),
    skipMunicipios: args.includes('--skip-municipios'),
  }
}

// ---------------------------------------------------------------------------
// Processamento principal
// ---------------------------------------------------------------------------

/**
 * Processa os candidatos eleitos de uma UF e gera o arquivo JSON de mandatos.
 */
async function processarUf(
  uf: string,
  anoMunicipal: number,
  deParaMap: Map<string, string>,
  parser: TseCsvParser,
): Promise<MandatoMunicipio[]> {
  const siglaUf = UF_SIGLAS[uf]
  if (!siglaUf) {
    console.warn(`  ⚠ UF ${uf} não encontrada no mapa de siglas`)
    return []
  }

  // Arquivos NACIONAIS do TSE: cada ZIP contém os CSVs de todas as UFs dentro
  // (ex: votacao_candidato_munzona_2024_RO.csv, ..._MG.csv, ..._BRASIL.csv).
  const zipVotacaoPath = join(RAW_DIR, `votacao_candidato_munzona_${anoMunicipal}.zip`)
  const zipCandPath = join(RAW_DIR, `consulta_cand_${anoMunicipal}.zip`)

  if (!existsSync(zipVotacaoPath)) {
    throw new Error(
      `[TSE Ingestão] Arquivo nacional de votação não encontrado: ${zipVotacaoPath}\n` +
      `  Baixe com: npx tsx scripts/scrape-tse.ts`
    )
  }
  if (!existsSync(zipCandPath)) {
    throw new Error(
      `[TSE Ingestão] Arquivo nacional de candidatos não encontrado: ${zipCandPath}\n` +
      `  Baixe com: npx tsx scripts/scrape-tse.ts`
    )
  }

  // A votação traz o PREFEITO (a chapa majoritária é votada no titular); o
  // VICE-PREFEITO (12) e os VEREADORES (13) vêm do consulta_cand, que traz o
  // resultado "ELEITO" na coluna DS_SIT_TOT_TURNO.
  const eleitosVotacao = parser.parseEleitos(zipVotacaoPath, siglaUf, [11, 12])
  const eleitosCad = parser.parseCandidatos(zipCandPath, true, siglaUf, [12, 13])

  // Agrupar eleitos por município (codigoUeTse)
  const porMunicipio = new Map<string, MandatoMunicipio>()

  for (const eleito of eleitosVotacao) {
    const cargo = cdCargoParaNome(eleito.cdCargo)
    if (cargo !== 'Prefeito' && cargo !== 'Vice-Prefeito') continue

    const codigoPad = eleito.codigoUeTse.padStart(5, '0')
    const codareaIbge = deParaMap.get(codigoPad) ?? deParaMap.get(eleito.codigoUeTse)
    if (!codareaIbge) {
      continue
    }

    if (!porMunicipio.has(codigoPad)) {
      porMunicipio.set(codigoPad, {
        codareaIbge,
        codigoTse: codigoPad,
        nomeMunicipio: eleito.nomeMunicipioTse,
        uf: eleito.uf,
        vereadores: [],
      })
    }

    const municipio = porMunicipio.get(codigoPad)!

    const mandato: MandatoRepresentante = {
      cargo,
      codigoCargoTse: eleito.cdCargo,
      nomeUrna: eleito.nomeUrna,
      nomeCompleto: eleito.nomeCompleto,
      partido: eleito.partido,
      numeroCandidato: eleito.numeroCandidato,
      anoEleicao: anoMunicipal,
      mandatoPeriodo: calcularPeriodoMandato(anoMunicipal, eleito.cdCargo),
      situacaoEleicao: eleito.situacao,
      sqCandidato: eleito.sqCandidato,
      totalVotos: eleito.totalVotos,
    }

    if (cargo === 'Prefeito') municipio.prefeito = mandato
    else municipio.vicePrefeito = mandato
  }

  // Anexa vice-prefeitos (12) e vereadores (13) eleitos, extraídos do consulta_cand
  for (const cand of eleitosCad) {
    const codigoPad = cand.codigoUeTse.padStart(5, '0')
    let municipio = porMunicipio.get(codigoPad)

    if (!municipio) {
      const codareaIbge = deParaMap.get(codigoPad) ?? deParaMap.get(cand.codigoUeTse)
      if (!codareaIbge) continue
      municipio = {
        codareaIbge,
        codigoTse: codigoPad,
        nomeMunicipio: cand.nomeMunicipioTse,
        uf: cand.uf,
        vereadores: [],
      }
      porMunicipio.set(codigoPad, municipio)
    }

    if (cand.cdCargo === 12) {
      municipio.vicePrefeito = {
        cargo: 'Vice-Prefeito',
        codigoCargoTse: 12,
        nomeUrna: cand.nomeUrna,
        nomeCompleto: cand.nomeCompleto,
        partido: cand.partido,
        numeroCandidato: cand.numeroCandidato,
        anoEleicao: anoMunicipal,
        mandatoPeriodo: calcularPeriodoMandato(anoMunicipal, 12),
        situacaoEleicao: cand.situacao,
        sqCandidato: cand.sqCandidato,
      }
    } else if (cand.cdCargo === 13) {
      municipio.vereadores.push({
        cargo: 'Vereador',
        codigoCargoTse: 13,
        nomeUrna: cand.nomeUrna,
        nomeCompleto: cand.nomeCompleto,
        partido: cand.partido,
        numeroCandidato: cand.numeroCandidato,
        anoEleicao: anoMunicipal,
        mandatoPeriodo: calcularPeriodoMandato(anoMunicipal, 13),
        situacaoEleicao: cand.situacao,
        sqCandidato: cand.sqCandidato,
      })
    }
  }

  // Ordena os vereadores pelo número de urna
  for (const m of porMunicipio.values()) {
    m.vereadores.sort((a, b) => a.numeroCandidato - b.numeroCandidato)
  }

  return [...porMunicipio.values()]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { only, anoMunicipal, anoEstadual, forceDownload, rebuilDeParа, headless, skipMunicipios } = parseArgs()

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Ingestão de Dados Eleitorais (TSE)')
  console.log('╚══════════════════════════════════════════════════════════\n')
  console.log(`  Eleição Municipal: ${anoMunicipal} | Eleição Estadual: ${anoEstadual}`)
  console.log(`  Modo Download:     ${forceDownload ? 'Forçar re-download' : 'Usar cache local se disponível'}`)
  console.log(`  Browser Headless:  ${headless}`)
  if (only) console.log(`  Filtro UFs:        ${only.join(', ')}`)

  await mkdir(UFS_DIR, { recursive: true })
  await mkdir(RAW_DIR, { recursive: true })

  const parser = new TseCsvParser()
  const deParaBuilder = new TseDeParaBuilder({ outputPath: DE_PARA_PATH })

  // =========================================================================
  // 1. Construir/carregar tabela DE-PARA TSE ↔ IBGE
  // =========================================================================

  let deParaMap: Map<string, string>

  if (rebuilDeParа || !existsSync(DE_PARA_PATH)) {
    console.log('\n━━━ ETAPA 1: Construindo tabela DE-PARA TSE ↔ IBGE ━━━')
    const zipVotacaoNacional = join(RAW_DIR, `votacao_candidato_munzona_${anoMunicipal}.zip`)

    if (!existsSync(zipVotacaoNacional)) {
      console.error(
        `\n[TSE Ingestão] Arquivo nacional de votação não encontrado: ${zipVotacaoNacional}\n` +
        `  Baixe com: npx tsx scripts/scrape-tse.ts`
      )
      process.exit(1)
    }

    const resultado = await deParaBuilder.construir(zipVotacaoNacional)
    deParaMap = new Map(resultado.mapeados.map((e) => [e.codigoTse, e.codareaIbge]))
  } else {
    console.log('\n━━━ ETAPA 1: Carregando tabela DE-PARA existente ━━━')
    deParaMap = await deParaBuilder.carregar()
  }

  // =========================================================================
  // 2. Mandatos estaduais e nacionais
  //    (governadores, senadores, deputados e presidente — eleição de 2022)
  //    Gerados pelo script dedicado, que grava em estados/ e brasil.json.
  // =========================================================================

  console.log('\n━━━ ETAPA 2: Mandatos estaduais/nacionais ━━━')
  console.log('  → Governadores, senadores, deputados e presidente são gerados por:')
  console.log('    npx tsx scripts/update-mandatos-gerais.ts')
  console.log('  (este script cuida apenas dos mandatos municipais)')

  // =========================================================================
  // 3. Dados municipais (Prefeitos) — eleições de 2024
  // =========================================================================

  let totalMunicipios = 0

  if (!skipMunicipios) {
    const ufsAlvo = only ?? TODAS_UFS
    console.log(`\n━━━ ETAPA 3: Prefeitos eleitos (municipal ${anoMunicipal}) — ${ufsAlvo.length} UFs ━━━`)

    let totalComPrefeito = 0

    for (const uf of ufsAlvo) {
      try {
        const mandatos = await processarUf(
          uf, anoMunicipal, deParaMap, parser,
        )

        await writeFile(
          join(UFS_DIR, `${uf}.json`),
          JSON.stringify({ uf, anoEleicao: anoMunicipal, municipios: mandatos }, null, 2),
          'utf-8',
        )

        const comPrefeito = mandatos.filter((m) => m.prefeito).length
        totalMunicipios += mandatos.length
        totalComPrefeito += comPrefeito
        console.log(`  ✓ UF ${uf} (${UF_SIGLAS[uf]}): ${mandatos.length} municípios, ${comPrefeito} com prefeito identificado`)
      } catch (err) {
        console.error(`  ✗ UF ${uf}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    console.log(`\n  Total: ${totalMunicipios} municípios processados, ${totalComPrefeito} com prefeito identificado`)
  }

  // =========================================================================
  // 4. Metadados
  // =========================================================================

  const metadata: MetadataEleicoes = {
    updatedAt: new Date().toISOString(),
    source: 'Tribunal Superior Eleitoral (TSE) — CDN Dados Abertos (Playwright)',
    anoEleicaoEstadual: anoEstadual,
    anoEleicaoMunicipal: anoMunicipal,
    estados: 27,
    municipios: totalMunicipios,
    ufs: only ?? TODAS_UFS,
    version: 2,
  }

  await writeFile(join(DATA_DIR, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8')

  console.log('\n✓ Dataset de eleições atualizado com sucesso.')
  console.log(`  Local: ${DATA_DIR}`)
}

main().catch((err) => {
  console.error('\n✗ Erro ao atualizar o dataset de eleições:', err)
  process.exit(1)
})
