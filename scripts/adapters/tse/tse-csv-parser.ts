/**
 * Parser de CSVs eleitorais do TSE.
 *
 * Os arquivos do TSE são distribuídos como ZIPs contendo CSVs com:
 *  - Separador: ponto e vírgula (;)
 *  - Encoding: latin1 (ISO-8859-1) — convertido para UTF-8 pelo parser
 *  - Cabeçalho: primeira linha com nomes das colunas
 *  - Aspas: valores podem estar entre aspas duplas
 *
 * Datasets processados:
 *  - consulta_cand_{ano}[_{UF}].zip    → Candidaturas (nome, partido, cargo)
 *  - votacao_candidato_munzona_{ano}[_{UF}].zip → Votos + situação de eleição
 *
 * Filtros aplicados automaticamente:
 *  - Cargo: 11 (Prefeito) e 12 (Vice-Prefeito) [ou 3/4 para estadual]
 *  - Situação: ELEITO, ELEITO POR QP, ELEITO POR MÉDIA, ELEITO NO 2º TURNO
 *
 * Uso:
 *   import { TseCsvParser } from './tse-csv-parser.js'
 *   const parser = new TseCsvParser()
 *   const candidatos = await parser.parseCandidatos('data/elections/raw/consulta_cand_2024_MG.zip')
 *   const eleitos = await parser.parseEleitos('data/elections/raw/votacao_candidato_munzona_2024_MG.zip')
 */

import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import AdmZip from 'adm-zip'

// ---------------------------------------------------------------------------
// Situações de totalização aceitas como eleição
// ---------------------------------------------------------------------------

const SITUACOES_ELEITO = new Set([
  'ELEITO',
  'ELEITO POR QP',
  'ELEITO POR MÉDIA',
  'ELEITO NO 2º TURNO',
  'ELEITO NO 2o TURNO',
  'ELEITO POR MEDIA',
  'ELEITO POR QUOCIENTE PARTIDÁRIO',
])

// ---------------------------------------------------------------------------
// Códigos de cargo do TSE
// ---------------------------------------------------------------------------

/** Códigos oficiais de cargo do TSE. */
export const CARGO = {
  PRESIDENTE: 1,
  VICE_PRESIDENTE: 2,
  GOVERNADOR: 3,
  VICE_GOVERNADOR: 4,
  SENADOR: 5,
  DEPUTADO_FEDERAL: 6,
  DEPUTADO_ESTADUAL: 7,
  DEPUTADO_DISTRITAL: 8,
  PREFEITO: 11,
  VICE_PREFEITO: 12,
  VEREADOR: 13,
} as const

/** Cargos de interesse em todos os pleitos (municipais, estaduais e nacionais). */
const CARGOS_INTERESSE = new Set<number>([1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13])

/** Resolve o conjunto de cargos a filtrar (default: todos os de interesse). */
function cargosAlvo(cargos?: number[]): Set<number> {
  return cargos && cargos.length > 0 ? new Set(cargos) : CARGOS_INTERESSE
}

// ---------------------------------------------------------------------------
// Interfaces de saída
// ---------------------------------------------------------------------------

/** Candidato eleito, extraído e normalizado do CSV do TSE */
export interface CandidatoTse {
  /** Código TSE de 5 dígitos da unidade eleitoral (município) */
  codigoUeTse: string
  /** Nome oficial do município conforme TSE */
  nomeMunicipioTse: string
  /** Sigla da UF */
  uf: string
  /** Código do cargo TSE (3=Gov, 4=VGov, 11=Prefeito, 12=VPrefeito) */
  cdCargo: number
  /** Nome do cargo */
  dsCargo: string
  /** Nome na urna (popular) */
  nomeUrna: string
  /** Nome civil completo */
  nomeCompleto: string
  /** Sigla do partido */
  partido: string
  /** Número na urna */
  numeroCandidato: number
  /** Número do turno (1 ou 2) */
  turno: number
  /** Situação no pleito (ex: "ELEITO", "ELEITO NO 2º TURNO") */
  situacao: string
  /** URL da foto oficial do TSE (pode ser undefined se não disponível) */
  fotoUrl?: string
  /** Sequencial único do candidato no TSE */
  sqCandidato: string
}

/** Resultado de votação de um candidato por município (votacao_candidato_munzona) */
export interface ResultadoVotacaoTse {
  codigoUeTse: string
  nomeMunicipioTse: string
  uf: string
  cdCargo: number
  dsCargo: string
  nomeUrna: string
  nomeCompleto: string
  partido: string
  numeroCandidato: number
  turno: number
  situacao: string
  /** Sequencial único do candidato (SQ_CANDIDATO) — usado para localizar a foto */
  sqCandidato: string
  totalVotos: number
}

// ---------------------------------------------------------------------------
// Parsing de CSV
// ---------------------------------------------------------------------------

/**
 * Normaliza o código da unidade eleitoral (UE) para o padrão de 5 dígitos.
 * Em eleições estaduais o SG_UE é a sigla da UF (ex: "RO") e não é alterado.
 */
function normalizarCodigoUe(valor: string): string {
  const limpo = valor.trim()
  if (!/^\d+$/.test(limpo)) return limpo
  return limpo.replace(/^0+/, '').padStart(5, '0')
}

/**
 * Parseia uma string CSV (formato TSE: separador=";", encoding já convertido para UTF-8)
 * e retorna as linhas como arrays de campos.
 *
 * Suporta campos entre aspas duplas com ponto-e-vírgula interno.
 */
function parseCsvLinhas(conteudo: string): string[][] {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim().length > 0)
  return linhas.map((linha) => {
    const campos: string[] = []
    let dentro_aspas = false
    let campo_atual = ''

    for (let i = 0; i < linha.length; i++) {
      const c = linha[i]
      if (c === '"') {
        dentro_aspas = !dentro_aspas
      } else if (c === ';' && !dentro_aspas) {
        campos.push(campo_atual.trim())
        campo_atual = ''
      } else {
        campo_atual += c
      }
    }
    campos.push(campo_atual.trim())
    return campos
  })
}

/** Estrutura mínima de uma entrada de ZIP (evita depender dos tipos do adm-zip). */
interface EntradaZip {
  entryName: string
  header: { size: number }
  getData: () => Buffer
}

/**
 * Filtra as entradas de CSV por UF de um ZIP nacional do TSE.
 * Exclui o consolidado nacional (`_BRASIL.csv`) e arquivos leiame/readme.
 */
function entradasCsvPorUf(entries: EntradaZip[]): EntradaZip[] {
  return entries.filter((e) => {
    const nome = e.entryName.toLowerCase()
    return (
      nome.endsWith('.csv') &&
      !nome.includes('leiame') &&
      !nome.includes('readme') &&
      !nome.includes('brasil')
    )
  })
}

/**
 * Extrai o conteúdo de um CSV de dentro de um ZIP do TSE.
 * Converte de latin1 para UTF-8 automaticamente.
 *
 * Os ZIPs do TSE 2024 são NACIONAIS e contêm um CSV por UF
 * (ex: votacao_candidato_munzona_2024_RO.csv) + um consolidado _BRASIL.csv.
 *
 * @param filtroUf - Sigla da UF (ex: 'RO'). Quando informado, extrai o CSV
 *                   específico daquela UF. Quando omitido, usa o primeiro CSV
 *                   por UF disponível (nunca o consolidado _BRASIL).
 */
function extrairCsvDoZip(zipPath: string, filtroUf?: string): string {
  if (!existsSync(zipPath)) {
    throw new Error(`[TSE Parser] Arquivo não encontrado: ${zipPath}`)
  }

  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries() as unknown as EntradaZip[]

  let csvEntry: EntradaZip | undefined
  if (filtroUf) {
    const alvo = `_${filtroUf.toLowerCase()}.csv`
    csvEntry = entries.find((e) => e.entryName.toLowerCase().endsWith(alvo))
  } else {
    csvEntry = entradasCsvPorUf(entries)[0]
  }

  if (!csvEntry) {
    const nomes = entries.map((e) => e.entryName).join(', ')
    throw new Error(
      `[TSE Parser] CSV não encontrado${filtroUf ? ` para a UF ${filtroUf}` : ''} em ${zipPath}. Arquivos: ${nomes}`,
    )
  }

  console.log(`  [TSE Parser] → Extraindo: ${csvEntry.entryName} (${(csvEntry.header.size / 1024 / 1024).toFixed(1)}MB)`)

  // Lê como Buffer e converte de latin1 para UTF-8
  const buffer = csvEntry.getData()
  return buffer.toString('latin1')
}

/**
 * Converte as linhas do CSV de candidatos em objetos CandidatoTse,
 * filtrando apenas os candidatos de cargo de interesse e com situação de eleito.
 */
function linhasParaCandidatos(
  cabecalho: string[],
  linhas: string[][],
  cargos: Set<number> = CARGOS_INTERESSE,
): CandidatoTse[] {
  const idx = (nome: string) => cabecalho.findIndex((c) => c.toUpperCase() === nome.toUpperCase())

  // Mapeamento de colunas — o TSE pode ter variações de nome entre eleições
  const iSgUe = idx('SG_UE') !== -1 ? idx('SG_UE') : idx('CD_MUNICIPIO')
  const iNmUe = idx('NM_UE') !== -1 ? idx('NM_UE') : idx('NM_MUNICIPIO')
  const iSgUf = idx('SG_UF')
  const iCdCargo = idx('CD_CARGO')
  const iDsCargo = idx('DS_CARGO')
  const iNmUrna = idx('NM_URNA_CANDIDATO')
  const iNmCand = idx('NM_CANDIDATO')
  const iSgPartido = idx('SG_PARTIDO')
  const iNrCand = idx('NR_CANDIDATO')
  const iSqCand = idx('SQ_CANDIDATO')
  // DS_SIT_TOT_TURNO é o RESULTADO eleitoral (ELEITO, ELEITO POR QP...).
  // DS_SITUACAO_CANDIDATURA é o status CADASTRAL (APTO, DEFERIDO, INDEFERIDO...)
  // e não deve ser filtrado por "eleito" — senão o consulta_cand retorna vazio.
  const iSitTotTurno = idx('DS_SIT_TOT_TURNO')
  const iSitCandidatura = idx('DS_SITUACAO_CANDIDATURA')
  const iSituacao = iSitTotTurno !== -1 ? iSitTotTurno : iSitCandidatura
  const situacaoEhResultado = iSitTotTurno !== -1
  const iTurno = idx('NR_TURNO') !== -1 ? idx('NR_TURNO') : -1

  const eleitos: CandidatoTse[] = []

  for (const linha of linhas) {
    if (linha.length < 5) continue

    const cdCargo = Number(linha[iCdCargo] ?? -1)
    if (!cargos.has(cdCargo)) continue

    const situacao = (linha[iSituacao] ?? '').toUpperCase().trim()
    // Só filtra por "ELEITO" quando a coluna é de resultado eleitoral.
    if (situacaoEhResultado && !SITUACOES_ELEITO.has(situacao)) continue

    eleitos.push({
      codigoUeTse: normalizarCodigoUe(linha[iSgUe] ?? ''),
      nomeMunicipioTse: (linha[iNmUe] ?? '').trim(),
      uf: (linha[iSgUf] ?? '').trim(),
      cdCargo,
      dsCargo: (linha[iDsCargo] ?? '').trim(),
      nomeUrna: (linha[iNmUrna] ?? '').trim(),
      nomeCompleto: (linha[iNmCand] ?? '').trim(),
      partido: (linha[iSgPartido] ?? '').trim(),
      numeroCandidato: Number(linha[iNrCand] ?? 0),
      turno: iTurno !== -1 ? Number(linha[iTurno] ?? 1) : 1,
      situacao,
      sqCandidato: (linha[iSqCand] ?? '').trim(),
    })
  }

  return eleitos
}

/**
 * Converte as linhas do CSV de votação em objetos ResultadoVotacaoTse,
 * filtrando por cargo e situação de eleito.
 */
function linhasParaResultados(
  cabecalho: string[],
  linhas: string[][],
  cargos: Set<number> = CARGOS_INTERESSE,
): ResultadoVotacaoTse[] {
  const idx = (nome: string) => cabecalho.findIndex((c) => c.toUpperCase() === nome.toUpperCase())

  const iCdMun = idx('CD_MUNICIPIO') !== -1 ? idx('CD_MUNICIPIO') : idx('SG_UE')
  const iNmMun = idx('NM_MUNICIPIO') !== -1 ? idx('NM_MUNICIPIO') : idx('NM_UE')
  const iSgUf = idx('SG_UF')
  const iCdCargo = idx('CD_CARGO')
  const iDsCargo = idx('DS_CARGO')
  const iNmUrna = idx('NM_URNA_CANDIDATO')
  const iNmCand = idx('NM_CANDIDATO')
  const iSgPartido = idx('SG_PARTIDO')
  const iNrCand = idx('NR_CANDIDATO')
  const iTurno = idx('NR_TURNO')
  const iSituacao = idx('DS_SIT_TOT_TURNO')
  const iVotos = idx('QT_VOTOS_NOMINAIS')
  const iSqCand = idx('SQ_CANDIDATO')

  const resultados: ResultadoVotacaoTse[] = []

  for (const linha of linhas) {
    if (linha.length < 5) continue

    const cdCargo = Number(linha[iCdCargo] ?? -1)
    if (!cargos.has(cdCargo)) continue

    const situacao = (linha[iSituacao] ?? '').toUpperCase().trim()
    if (!SITUACOES_ELEITO.has(situacao)) continue

    resultados.push({
      codigoUeTse: normalizarCodigoUe(linha[iCdMun] ?? ''),
      nomeMunicipioTse: (linha[iNmMun] ?? '').trim(),
      uf: (linha[iSgUf] ?? '').trim(),
      cdCargo,
      dsCargo: (linha[iDsCargo] ?? '').trim(),
      nomeUrna: (linha[iNmUrna] ?? '').trim(),
      nomeCompleto: (linha[iNmCand] ?? '').trim(),
      partido: (linha[iSgPartido] ?? '').trim(),
      numeroCandidato: Number(linha[iNrCand] ?? 0),
      turno: Number(linha[iTurno] ?? 1),
      situacao,
      sqCandidato: iSqCand !== -1 ? (linha[iSqCand] ?? '').trim() : '',
      totalVotos: Number((linha[iVotos] ?? '0').replace(/\./g, '').replace(',', '.')),
    })
  }

  return resultados
}

// ---------------------------------------------------------------------------
// Classe principal
// ---------------------------------------------------------------------------

export class TseCsvParser {
  /**
   * Parseia o arquivo de candidaturas (consulta_cand) e retorna apenas os
   * candidatos de cargos de interesse (Prefeito, Vice, Governador, Vice-Gov).
   *
   * @param zipPath - Caminho para o ZIP do TSE
   * @param filtrarEleitos - Se true (padrão), retorna apenas candidatos com situação de eleito
   */
  parseCandidatos(
    zipPath: string,
    filtrarEleitos = false,
    filtroUf?: string,
    cargos?: number[],
  ): CandidatoTse[] {
    console.log(`  [TSE Parser] → Parseando candidatos: ${zipPath}${filtroUf ? ` (UF ${filtroUf})` : ''}`)

    const conteudo = extrairCsvDoZip(zipPath, filtroUf)
    const todasLinhas = parseCsvLinhas(conteudo)

    if (todasLinhas.length < 2) {
      throw new Error('[TSE Parser] CSV vazio ou sem dados')
    }

    const cabecalho = todasLinhas[0].map((c) => c.toUpperCase().trim())
    const linhasDados = todasLinhas.slice(1)

    const candidatos = linhasParaCandidatos(cabecalho, linhasDados, cargosAlvo(cargos))

    // Para consulta_cand, a situação de eleição não está disponível (é apenas cadastral)
    // Retornar todos os cargos de interesse sem filtro de situação, a menos que explicitamente solicitado
    const resultado = filtrarEleitos
      ? candidatos.filter((c) => c.situacao !== '')
      : candidatos

    console.log(
      `  [TSE Parser] ✓ ${resultado.length} candidatos de cargos de interesse extraídos (de ${linhasDados.length} linhas)`,
    )
    return resultado
  }

  /**
   * Parseia o arquivo de votação (votacao_candidato_munzona) e retorna apenas
   * os candidatos eleitos para cargos de interesse.
   *
   * @param zipPath - Caminho para o ZIP do TSE
   */
  parseEleitos(zipPath: string, filtroUf?: string, cargos?: number[]): ResultadoVotacaoTse[] {
    console.log(`  [TSE Parser] → Parseando eleitos: ${zipPath}${filtroUf ? ` (UF ${filtroUf})` : ''}`)

    const conteudo = extrairCsvDoZip(zipPath, filtroUf)
    const todasLinhas = parseCsvLinhas(conteudo)

    if (todasLinhas.length < 2) {
      throw new Error('[TSE Parser] CSV vazio ou sem dados')
    }

    const cabecalho = todasLinhas[0].map((c) => c.toUpperCase().trim())
    const linhasDados = todasLinhas.slice(1)

    const eleitos = linhasParaResultados(cabecalho, linhasDados, cargosAlvo(cargos))

    console.log(
      `  [TSE Parser] ✓ ${eleitos.length} eleitos extraídos (de ${linhasDados.length} linhas)`,
    )
    return eleitos
  }

  /**
   * Extrai apenas os pares (codigoUeTse, nomeMunicipioTse, uf) únicos do CSV
   * de votação, para uso na geração da tabela DE-PARA TSE↔IBGE.
   */
  extrairMunicipiosTse(
    zipPath: string,
    filtroUf?: string,
  ): Array<{ codigoUeTse: string; nomeMunicipioTse: string; uf: string }> {
    console.log(
      `  [TSE Parser] → Extraindo municípios TSE: ${zipPath}${filtroUf ? ` (UF ${filtroUf})` : ' (todas as UFs)'}`,
    )

    if (!existsSync(zipPath)) {
      throw new Error(`[TSE Parser] Arquivo não encontrado: ${zipPath}`)
    }

    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries() as unknown as EntradaZip[]

    // Com filtro: 1 CSV (a UF). Sem filtro: todos os CSVs por UF do ZIP nacional.
    const alvos = filtroUf
      ? entries.filter((e) => e.entryName.toLowerCase().endsWith(`_${filtroUf.toLowerCase()}.csv`))
      : entradasCsvPorUf(entries)

    if (alvos.length === 0) {
      throw new Error(
        `[TSE Parser] Nenhum CSV${filtroUf ? ` da UF ${filtroUf}` : ' por UF'} encontrado em ${zipPath}`,
      )
    }

    const vistos = new Set<string>()
    const municipios: Array<{ codigoUeTse: string; nomeMunicipioTse: string; uf: string }> = []

    for (const entry of alvos) {
      const conteudo = entry.getData().toString('latin1')
      const todasLinhas = parseCsvLinhas(conteudo)
      if (todasLinhas.length < 2) continue

      const cabecalho = todasLinhas[0].map((c) => c.toUpperCase().trim())
      const linhasDados = todasLinhas.slice(1)

      const idx = (nome: string) => cabecalho.findIndex((c) => c === nome)
      const iCdMun = idx('CD_MUNICIPIO') !== -1 ? idx('CD_MUNICIPIO') : idx('SG_UE')
      const iNmMun = idx('NM_MUNICIPIO') !== -1 ? idx('NM_MUNICIPIO') : idx('NM_UE')
      const iSgUf = idx('SG_UF')

      for (const linha of linhasDados) {
        const codigo = normalizarCodigoUe(linha[iCdMun] ?? '')
        if (!codigo || vistos.has(codigo)) continue
        vistos.add(codigo)

        municipios.push({
          codigoUeTse: codigo,
          nomeMunicipioTse: (linha[iNmMun] ?? '').trim(),
          uf: (linha[iSgUf] ?? '').trim(),
        })
      }
    }

    console.log(`  [TSE Parser] ✓ ${municipios.length} municípios únicos extraídos`)
    return municipios
  }
}
