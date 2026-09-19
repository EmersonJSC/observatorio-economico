/**
 * Script de atualização dos mandatos ESTADUAIS e NACIONAIS (TSE).
 *
 * Gera, a partir dos arquivos NACIONAIS das eleições gerais:
 *   - data/elections/estados/{uf}.json → governador, vice-governador, senadores,
 *     deputados federais e deputados estaduais/distritais de cada UF.
 *   - data/elections/brasil.json        → presidente, vice-presidente e a
 *     composição do Congresso Nacional.
 *
 * Fonte: arquivos nacionais publicados pelo TSE (mesmo padrão do municipal):
 *   - votacao_candidato_munzona_{ano}.zip  (votos + situação de eleito)
 *   - consulta_cand_{ano}.zip              (candidaturas + resultado no turno)
 *
 * Como as colunas `SG_UE` das eleições estaduais/nacionais trazem a SIGLA da UF
 * (ex: "RO") ou "BR", o mapeamento territorial TSE↔IBGE não é necessário aqui.
 *
 * Uso:
 *   npx tsx scripts/update-mandatos-gerais.ts
 *   npx tsx scripts/update-mandatos-gerais.ts --ano=2022
 *   npx tsx scripts/update-mandatos-gerais.ts --only=31,35
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TseCsvParser } from './adapters/tse/tse-csv-parser.js'
import { CARGO, type CandidatoTse } from './adapters/tse/tse-csv-parser.js'
import { cdCargoParaNome, calcularPeriodoMandato } from './adapters/tse/tse-mandatos.js'
import type {
  MandatoRepresentante,
  MandatoEstado,
  MandatoBrasil,
} from './adapters/tse/tse-mandatos.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'elections')
const ESTADOS_DIR = join(DATA_DIR, 'estados')
const RAW_DIR = join(DATA_DIR, 'raw')

// Cargos por esfera
const CARGOS_ESTADUAIS = [
  CARGO.GOVERNADOR,
  CARGO.VICE_GOVERNADOR,
  CARGO.SENADOR,
  CARGO.DEPUTADO_FEDERAL,
  CARGO.DEPUTADO_ESTADUAL,
  CARGO.DEPUTADO_DISTRITAL,
]
const CARGOS_NACIONAIS = [CARGO.PRESIDENTE, CARGO.VICE_PRESIDENTE]

// Código IBGE (2 dígitos) → sigla UF
const UF_SIGLAS: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
  '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
  '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
  '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
  '52': 'GO', '53': 'DF',
}

function parseArgs() {
  const args = process.argv.slice(2)
  const only = args
    .find((a) => a.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const anoArg = args.find((a) => a.startsWith('--ano='))?.slice('--ano='.length)
  return { only, ano: anoArg ? Number(anoArg) : 2022 }
}

/** Converte um candidato do TSE em mandato consolidado. */
function paraMandato(cand: CandidatoTse, ano: number): MandatoRepresentante {
  return {
    cargo: cdCargoParaNome(cand.cdCargo) ?? cand.dsCargo,
    codigoCargoTse: cand.cdCargo,
    nomeUrna: cand.nomeUrna,
    nomeCompleto: cand.nomeCompleto,
    partido: cand.partido,
    numeroCandidato: cand.numeroCandidato,
    anoEleicao: ano,
    mandatoPeriodo: calcularPeriodoMandato(ano, cand.cdCargo),
    situacaoEleicao: cand.situacao,
    sqCandidato: cand.sqCandidato,
  } as MandatoRepresentante
}

async function main() {
  const { only, ano } = parseArgs()

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Mandatos Estaduais e Nacionais')
  console.log('╚══════════════════════════════════════════════════════════\n')
  console.log(`  Eleição geral: ${ano}`)

  // Só o consulta_cand é necessário: ele traz o resultado final (ELEITO) de
  // todos os cargos, enquanto o votacao_candidato_munzona é gigante e só
  // acrescentaria a contagem de votos (não usada nos mandatos).
  const zipCand = join(RAW_DIR, `consulta_cand_${ano}.zip`)

  if (!existsSync(zipCand)) {
    console.error(
      `\n[TSE] Arquivo nacional de candidatos não encontrado: ${zipCand}\n` +
      `  Baixe com: npx tsx scripts/scrape-tse.ts --year=${ano} --skip-votacao`,
    )
    process.exit(1)
  }

  await mkdir(ESTADOS_DIR, { recursive: true })
  const parser = new TseCsvParser()

  const ufsAlvo = only && only.length > 0 ? only : Object.keys(UF_SIGLAS)

  // =========================================================================
  // 1. Mandatos por UF (governador, senadores, deputados)
  // =========================================================================

  console.log(`\n→ Processando ${ufsAlvo.length} UFs…`)
  let totalSenadores = 0
  let totalDeputadosFederais = 0

  for (const uf of ufsAlvo) {
    const sigla = UF_SIGLAS[uf]
    if (!sigla) {
      console.warn(`  ⚠ UF ${uf} sem sigla conhecida`)
      continue
    }

    try {
      // consulta_cand traz o resultado final (ELEITO) por candidato — uma linha
      // por candidato, o que evita duplicação nos cargos proporcionais.
      const eleitos = parser.parseCandidatos(zipCand, true, sigla, CARGOS_ESTADUAIS)

      const porCargo = (cd: number) => eleitos.filter((c) => c.cdCargo === cd)
      const senadores = porCargo(CARGO.SENADOR).map((c) => paraMandato(c, ano))
      const deputadosFederais = porCargo(CARGO.DEPUTADO_FEDERAL).map((c) => paraMandato(c, ano))
      const deputadosEstaduais = [
        ...porCargo(CARGO.DEPUTADO_ESTADUAL),
        ...porCargo(CARGO.DEPUTADO_DISTRITAL),
      ].map((c) => paraMandato(c, ano))

      const governador = porCargo(CARGO.GOVERNADOR)[0]
      const viceGovernador = porCargo(CARGO.VICE_GOVERNADOR)[0]

      const arquivo: MandatoEstado = {
        uf,
        sigla,
        anoEleicao: ano,
        ...(governador ? { governador: paraMandato(governador, ano) } : {}),
        ...(viceGovernador ? { viceGovernador: paraMandato(viceGovernador, ano) } : {}),
        senadores,
        deputadosFederais,
        deputadosEstaduais,
      }

      await writeFile(
        join(ESTADOS_DIR, `${uf}.json`),
        JSON.stringify(arquivo, null, 2),
        'utf-8',
      )

      totalSenadores += senadores.length
      totalDeputadosFederais += deputadosFederais.length
      console.log(
        `  ✓ UF ${uf} (${sigla}): governo=${governador ? 'sim' : 'não'}, ` +
        `senadores=${senadores.length}, dep. federais=${deputadosFederais.length}, ` +
        `dep. estaduais=${deputadosEstaduais.length}`,
      )
    } catch (err) {
      console.error(`  ✗ UF ${uf}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // =========================================================================
  // 2. Mandatos nacionais (presidente e vice)
  // =========================================================================

  console.log('\n→ Processando mandatos nacionais…')
  let presidente: MandatoRepresentante | undefined
  let vicePresidente: MandatoRepresentante | undefined

  try {
    const eleitosBr = parser.parseCandidatos(zipCand, true, 'BRASIL', CARGOS_NACIONAIS)
    const pres = eleitosBr.find((c) => c.cdCargo === CARGO.PRESIDENTE)
    const vice = eleitosBr.find((c) => c.cdCargo === CARGO.VICE_PRESIDENTE)
    if (pres) presidente = paraMandato(pres, ano)
    if (vice) vicePresidente = paraMandato(vice, ano)
    console.log(`  ✓ Presidente: ${presidente?.nomeUrna ?? 'não identificado'}`)
    console.log(`  ✓ Vice-presidente: ${vicePresidente?.nomeUrna ?? 'não identificado'}`)
  } catch (err) {
    console.warn(`  ⚠ Falha nos mandatos nacionais: ${err instanceof Error ? err.message : String(err)}`)
  }

  const brasil: MandatoBrasil = {
    updatedAt: new Date().toISOString(),
    anoEleicao: ano,
    ...(presidente ? { presidente } : {}),
    ...(vicePresidente ? { vicePresidente } : {}),
    congresso: {
      senadores: totalSenadores,
      deputadosFederais: totalDeputadosFederais,
    },
  }

  await writeFile(join(DATA_DIR, 'brasil.json'), JSON.stringify(brasil, null, 2), 'utf-8')
  console.log(`  ✓ brasil.json salvo (Senado: ${totalSenadores}, Câmara: ${totalDeputadosFederais})`)

  console.log('\n✓ Mandatos estaduais e nacionais atualizados com sucesso.')
}

main().catch((err) => {
  console.error('\n✗ Erro ao atualizar mandatos gerais:', err)
  process.exit(1)
})
