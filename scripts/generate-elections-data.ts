/**
 * Script para gerar dados de eleições com mandatos eleitos
 * 
 * Processa os dados brutos do TSE e gera:
 * - eleicoes/ufs/{SIGLA}.json - mandatos municipais (prefeitos, vereadores)
 * - eleicoes/estados/{CODIGO}.json - mandatos estaduais
 * - eleicoes/brasil.json - mandatos nacionais + composição
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'published', 'eleicoes')
const UFS_DIR = join(DATA_DIR, 'ufs')
const ESTADOS_DIR = join(DATA_DIR, 'estados')

// Mapa de código IBGE para sigla UF
const SIGLA_POR_CODIGO: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
  '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
  '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
  '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
  '52': 'GO', '53': 'DF',
}

// Códigos de cargo TSE
const CARGO_TSE = {
  PRESIDENTE: 1,
  VICE_PRESIDENTE: 2,
  SENADOR: 5,
  DEPUTADO_FEDERAL: 6,
  DEPUTADO_ESTADUAL: 7,
  DEPUTADO_DISTRITAL: 8,
  GOVERNADOR: 3,
  VICE_GOVERNADOR: 4,
  PREFEITO: 11,
  VICE_PREFEITO: 12,
  VEREADOR: 13,
} as const

interface CandidatoTse {
  ufSigla?: string
  codigoMunicipio?: string
  codigoCargo?: number
  partidoSigla?: string
  nomeUrna?: string
  nomeCompleto?: string
  numeroCandidato?: number
  anoEleicao?: number
  situacaoTotalizacao?: string
  sqCandidato?: string
}

interface MandatoRepresentante {
  cargo: string
  codigoCargoTse: number
  nomeUrna: string
  nomeCompleto: string
  partido: string
  numeroCandidato: number
  anoEleicao: number
  mandatoPeriodo: string
  sqCandidato?: string
}

interface MandatoMunicipio {
  codareaIbge: string
  codigoTse: string
  nomeMunicipio: string
  uf: string
  prefeito?: MandatoRepresentante
  vicePrefeito?: MandatoRepresentante
  vereadores: MandatoRepresentante[]
}

interface ArquivoUfs {
  uf: string
  anoEleicao: number
  municipios: MandatoMunicipio[]
}

async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) {
    await mkdir(path, { recursive: true })
  }
}

/**
 * Filtra candidatos eleitos por situação
 */
function ehEleito(candidato: CandidatoTse): boolean {
  const situacao = candidato.situacaoTotalizacao?.toUpperCase()
  return situacao === 'ELEITO' || situacao === 'ELEITO POR QP' || situacao === 'ELEITO POR MÉDIA'
}

/**
 * Converte código de cargo TSE para nome legível
 */
function getCargoNome(codigo: number): string {
  const mapa: Record<number, string> = {
    [CARGO_TSE.PRESIDENTE]: 'Presidente',
    [CARGO_TSE.VICE_PRESIDENTE]: 'Vice-Presidente',
    [CARGO_TSE.SENADOR]: 'Senador',
    [CARGO_TSE.DEPUTADO_FEDERAL]: 'Deputado Federal',
    [CARGO_TSE.DEPUTADO_ESTADUAL]: 'Deputado Estadual',
    [CARGO_TSE.DEPUTADO_DISTRITAL]: 'Deputado Distrital',
    [CARGO_TSE.GOVERNADOR]: 'Governador',
    [CARGO_TSE.VICE_GOVERNADOR]: 'Vice-Governador',
    [CARGO_TSE.PREFEITO]: 'Prefeito',
    [CARGO_TSE.VICE_PREFEITO]: 'Vice-Prefeito',
    [CARGO_TSE.VEREADOR]: 'Vereador',
  }
  return mapa[codigo] || `Cargo ${codigo}`
}

/**
 * Gera período do mandato com base no ano da eleição
 */
function getMandatoPeriodo(anoEleicao: number, cargo: number): string {
  if (cargo === CARGO_TSE.PREFEITO || cargo === CARGO_TSE.VICE_PREFEITO || cargo === CARGO_TSE.VEREADOR) {
    return `${anoEleicao}-${anoEleicao + 4}`
  }
  if (cargo === CARGO_TSE.GOVERNADOR || cargo === CARGO_TSE.VICE_GOVERNADOR || 
      cargo === CARGO_TSE.DEPUTADO_ESTADUAL || cargo === CARGO_TSE.DEPUTADO_FEDERAL) {
    return `${anoEleicao}-${anoEleicao + 4}`
  }
  if (cargo === CARGO_TSE.SENADOR) {
    return `${anoEleicao}-${anoEleicao + 8}`
  }
  if (cargo === CARGO_TSE.PRESIDENTE || cargo === CARGO_TSE.VICE_PRESIDENTE) {
    return `${anoEleicao}-${anoEleicao + 4}`
  }
  return `${anoEleicao}-?`
}

/**
 * Converte candidato TSE para MandatoRepresentante
 */
function toMandatoRepresentante(candidato: CandidatoTse): MandatoRepresentante {
  return {
    cargo: getCargoNome(candidato.codigoCargo || 0),
    codigoCargoTse: candidato.codigoCargo || 0,
    nomeUrna: candidato.nomeUrna || 'N/A',
    nomeCompleto: candidato.nomeCompleto || 'N/A',
    partido: candidato.partidoSigla || 'N/A',
    numeroCandidato: candidato.numeroCandidato || 0,
    anoEleicao: candidato.anoEleicao || 0,
    mandatoPeriodo: getMandatoPeriodo(candidato.anoEleicao || 0, candidato.codigoCargo || 0),
    sqCandidato: candidato.sqCandidato,
  }
}

/**
 * Processa candidatos municipais e retorna por município
 */
async function processarCandidatosMunicipais(ano: number = 2024): Promise<void> {
  console.log(`Processando candidatos municipais ${ano}...`)
  
  await ensureDir(UFS_DIR)
  
  // Simulação: como não temos os dados brutos, vamos criar uma estrutura base
  // que o frontend pode consumir. Na prática, isso seria preenchido com dados
  // do TSE processados pela Caixa 6.
  
  // Para cada UF, criar arquivo com municípios
  for (const [codigoUf, sigla] of Object.entries(SIGLA_POR_CODIGO)) {
    const arquivoUf: ArquivoUfs = {
      uf: codigoUf,
      anoEleicao: ano,
      municipios: [],
    }
    
    // Aqui iriam os dados reais processados do TSE
    // Por enquanto, criamos uma estrutura vazia que o frontend pode consumir
    
    await writeFile(
      join(UFS_DIR, `${sigla}.json`),
      JSON.stringify(arquivoUf, null, 2),
      'utf-8'
    )
    
    console.log(`  Criado eleicoes/ufs/${sigla}.json`)
  }
}

/**
 * Processa candidatos estaduais
 */
async function processarCandidatosEstaduais(ano: number = 2022): Promise<void> {
  console.log(`Processando candidatos estaduais ${ano}...`)
  
  await ensureDir(ESTADOS_DIR)
  
  // Criar arquivos para cada estado
  for (const [codigoUf, sigla] of Object.entries(SIGLA_POR_CODIGO)) {
    // Estrutura mínima para o frontend
    const estado = {
      uf: codigoUf,
      sigla: sigla,
      anoEleicao: ano,
      governador: null,
      viceGovernador: null,
      senadores: [],
      deputadosFederais: [],
      deputadosEstaduais: [],
    }
    
    await writeFile(
      join(ESTADOS_DIR, `${codigoUf}.json`),
      JSON.stringify(estado, null, 2),
      'utf-8'
    )
    
    console.log(`  Criado eleicoes/estados/${codigoUf}.json`)
  }
}

/**
 * Processa candidatos nacionais
 */
async function processarCandidatosNacionais(ano: number = 2022): Promise<void> {
  console.log(`Processando candidatos nacionais ${ano}...`)
  
  const brasil = {
    updatedAt: new Date().toISOString(),
    anoEleicao: ano,
    presidente: null,
    vicePresidente: null,
    congresso: {
      senadores: 0,
      deputadosFederais: 0,
    },
  }
  
  await writeFile(
    join(DATA_DIR, 'brasil.json'),
    JSON.stringify(brasil, null, 2),
    'utf-8'
  )
  
  console.log(`  Criado eleicoes/brasil.json`)
}

/**
 * Função principal
 */
async function main() {
  console.log('Gerando dados de eleições...\n')
  
  await Promise.all([
    processarCandidatosMunicipais(2024),
    processarCandidatosEstaduais(2022),
    processarCandidatosNacionais(2022),
  ])
  
  console.log('\n✅ Dados de eleições gerados!')
  console.log(`   - UFs: ${UFS_DIR}`)
  console.log(`   - Estados: ${ESTADOS_DIR}`)
  console.log(`   - Brasil: ${DATA_DIR}/brasil.json`)
}

main().catch(console.error)
