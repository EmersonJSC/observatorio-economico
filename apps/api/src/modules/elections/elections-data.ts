/**
 * Serviço de dados eleitorais e mandatos (TSE).
 *
 * Lê o dataset distribuído em `data/elections/`:
 *   - ufs/{uf}.json     → mandatos municipais (prefeito, vice, vereadores) — 2024
 *   - estados/{uf}.json → mandatos estaduais (governador, senadores, deputados) — 2022
 *   - brasil.json       → mandatos nacionais (presidente, vice) — 2022
 *
 * O TSE nunca é consultado em runtime.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'

import { lerJsonComCache } from '../../lib/cached-dataset.js'
import { urlFotoCandidato } from './foto-candidato.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const DATA_DIR = join(ROOT, 'data', 'elections')
const UFS_DIR = join(DATA_DIR, 'ufs')
const ESTADOS_DIR = join(DATA_DIR, 'estados')

export interface MandatoRepresentante {
  cargo: string
  codigoCargoTse: number
  nomeUrna: string
  nomeCompleto: string
  partido: string
  numeroCandidato: number
  anoEleicao: number
  mandatoPeriodo: string
  situacaoEleicao: string
  /** Sequencial único do candidato no TSE (base para localizar a foto) */
  sqCandidato?: string
  totalVotos?: number
  /** URL da foto oficial no DivulgaCandContas (calculada a partir do SQ_CANDIDATO) */
  fotoUrl?: string
}

/** Acrescenta a URL da foto oficial a um mandato. */
function comFoto<T extends MandatoRepresentante>(mandato: T, sgUe: string): T {
  const url = urlFotoCandidato(mandato.sqCandidato, mandato.anoEleicao, sgUe)
  return url ? { ...mandato, fotoUrl: url } : mandato
}

/** Mandatos de um município: prefeito, vice e a câmara de vereadores. */
export interface MandatoMunicipio {
  codareaIbge: string
  codigoTse: string
  nomeMunicipio: string
  uf: string
  prefeito?: MandatoRepresentante
  vicePrefeito?: MandatoRepresentante
  vereadores: MandatoRepresentante[]
}

/** Mandatos de uma UF: governo estadual e bancada no Congresso/Assembleia. */
export interface MandatoEstado {
  uf: string
  sigla: string
  anoEleicao: number
  governador?: MandatoRepresentante
  viceGovernador?: MandatoRepresentante
  senadores: MandatoRepresentante[]
  deputadosFederais: MandatoRepresentante[]
  deputadosEstaduais: MandatoRepresentante[]
}

/** Mandatos nacionais: presidente, vice e composição do Congresso. */
export interface MandatoBrasil {
  updatedAt: string
  anoEleicao: number
  presidente?: MandatoRepresentante
  vicePresidente?: MandatoRepresentante
  congresso: { senadores: number; deputadosFederais: number }
}

export interface EleicoesUf {
  uf: string
  anoEleicao: number
  municipios: MandatoMunicipio[]
}

export interface MetadataEleicoes {
  updatedAt: string
  source: string
  anoEleicaoEstadual?: number
  anoEleicaoMunicipal?: number
  estados: number
  municipios: number
  ufs: string[]
  version: number
}

/** Mandatos nacionais (presidente e vice) + composição do Congresso. */
export async function getEleicoesBrasil(): Promise<MandatoBrasil> {
  const dados = await lerJsonComCache<MandatoBrasil>(join(DATA_DIR, 'brasil.json'), 'elections:brasil')
  return {
    ...dados,
    ...(dados.presidente ? { presidente: comFoto(dados.presidente, 'BR') } : {}),
    ...(dados.vicePresidente ? { vicePresidente: comFoto(dados.vicePresidente, 'BR') } : {}),
  }
}

/** Mandatos municipais de todos os municípios de uma UF (2024). */
export async function getEleicoesUf(uf: string): Promise<EleicoesUf> {
  return lerJsonComCache<EleicoesUf>(join(UFS_DIR, `${uf}.json`), `elections:uf:${uf}`)
}

/** Mandato de um município (busca pelo codarea IBGE de 7 dígitos). */
export async function getMandatoMunicipio(codarea: string): Promise<MandatoMunicipio | null> {
  const uf = codarea.slice(0, 2)
  const arquivo = await getEleicoesUf(uf)
  const m = arquivo.municipios.find((x) => x.codareaIbge === codarea)
  if (!m) return null
  return {
    ...m,
    ...(m.prefeito ? { prefeito: comFoto(m.prefeito, m.codigoTse) } : {}),
    ...(m.vicePrefeito ? { vicePrefeito: comFoto(m.vicePrefeito, m.codigoTse) } : {}),
    vereadores: (m.vereadores ?? []).map((v) => comFoto(v, m.codigoTse)),
  }
}

/** Mandatos estaduais de uma UF (governador, senadores, deputados). */
export async function getMandatoEstado(uf: string): Promise<MandatoEstado | null> {
  const caminho = join(ESTADOS_DIR, `${uf}.json`)
  if (!existsSync(caminho)) return null
  const estado = await lerJsonComCache<MandatoEstado>(caminho, `elections:estado:${uf}`)
  const sigla = estado.sigla
  return {
    ...estado,
    ...(estado.governador ? { governador: comFoto(estado.governador, sigla) } : {}),
    ...(estado.viceGovernador ? { viceGovernador: comFoto(estado.viceGovernador, sigla) } : {}),
    senadores: (estado.senadores ?? []).map((m) => comFoto(m, sigla)),
    deputadosFederais: (estado.deputadosFederais ?? []).map((m) => comFoto(m, sigla)),
    deputadosEstaduais: (estado.deputadosEstaduais ?? []).map((m) => comFoto(m, sigla)),
  }
}

/** Metadados de auditoria do dataset eleitoral. */
export async function getMetadataEleicoes(): Promise<MetadataEleicoes> {
  return lerJsonComCache<MetadataEleicoes>(join(DATA_DIR, 'metadata.json'), 'elections:metadata')
}

// ---------------------------------------------------------------------------
// Composição de cadeiras por partido (gráfico + mapa "força política")
// ---------------------------------------------------------------------------

export interface ComposicaoPartido {
  sigla: string
  cadeiras: number
}

/** Distribuição de cadeiras de um território (município ou estado). */
export interface ComposicaoTerritorio {
  codarea: string
  nome: string
  total: number
  /** partido → número de cadeiras */
  cadeiras: Record<string, number>
  /** partido com mais cadeiras */
  dominante: string
}

export interface ComposicaoCamara {
  id: string
  nome: string
  cargo: string
  total: number
  partidos: ComposicaoPartido[]
}

export interface Composicao {
  nivel: 'brasil' | 'estado' | 'municipio'
  codigo: string
  camaras: ComposicaoCamara[]
  territorios: ComposicaoTerritorio[]
}

/** Conta cadeiras por partido, ordenando do maior para o menor. */
function agregarPorPartido(mandatos: MandatoRepresentante[]): ComposicaoPartido[] {
  const contagem = new Map<string, number>()
  for (const m of mandatos) {
    const sigla = m.partido || '—'
    contagem.set(sigla, (contagem.get(sigla) ?? 0) + 1)
  }
  return [...contagem.entries()]
    .map(([sigla, cadeiras]) => ({ sigla, cadeiras }))
    .sort((a, b) => b.cadeiras - a.cadeiras || a.sigla.localeCompare(b.sigla))
}

/** Cadeiras de um território em mapa partido→nº, com o partido dominante. */
function territorioDe(
  codarea: string,
  nome: string,
  mandatos: MandatoRepresentante[],
): ComposicaoTerritorio {
  const cadeiras: Record<string, number> = {}
  for (const m of mandatos) {
    const sigla = m.partido || '—'
    cadeiras[sigla] = (cadeiras[sigla] ?? 0) + 1
  }
  const dominante = Object.entries(cadeiras).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
  return { codarea, nome, total: mandatos.length, cadeiras, dominante }
}

async function lerTodosOsEstados(): Promise<MandatoEstado[]> {
  if (!existsSync(ESTADOS_DIR)) return []
  const arquivos = (await readdir(ESTADOS_DIR)).filter((f) => f.endsWith('.json'))
  return Promise.all(
    arquivos.map((f) =>
      lerJsonComCache<MandatoEstado>(
        join(ESTADOS_DIR, f),
        `elections:estado:${f.replace('.json', '')}`,
      ),
    ),
  )
}

/** Composição nacional: Câmara dos Deputados e Senado, por partido e por estado. */
export async function getComposicaoBrasil(): Promise<Composicao> {
  const estados = await lerTodosOsEstados()

  const deputadosFederais = estados.flatMap((e) => e.deputadosFederais ?? [])
  const senadores = estados.flatMap((e) => e.senadores ?? [])

  const camaras: ComposicaoCamara[] = [
    {
      id: 'camara-federal',
      nome: 'Câmara dos Deputados',
      cargo: 'Deputado Federal',
      total: deputadosFederais.length,
      partidos: agregarPorPartido(deputadosFederais),
    },
    {
      id: 'senado',
      nome: 'Senado (eleitos em 2022)',
      cargo: 'Senador',
      total: senadores.length,
      partidos: agregarPorPartido(senadores),
    },
  ]

  const territorios = estados
    .map((e) => territorioDe(e.uf, e.sigla, e.deputadosFederais ?? []))
    .filter((t) => t.total > 0)
    .sort((a, b) => a.codarea.localeCompare(b.codarea))

  return { nivel: 'brasil', codigo: 'BR', camaras, territorios }
}

/** Composição estadual: assembleia legislativa + bancada federal, e municípios (vereadores). */
export async function getComposicaoEstado(uf: string): Promise<Composicao | null> {
  const estado = await getMandatoEstado(uf)
  if (!estado) return null

  const camaras: ComposicaoCamara[] = [
    {
      id: 'assembleia',
      nome: 'Assembleia Legislativa',
      cargo: 'Deputado Estadual',
      total: (estado.deputadosEstaduais ?? []).length,
      partidos: agregarPorPartido(estado.deputadosEstaduais ?? []),
    },
    {
      id: 'bancada-federal',
      nome: 'Bancada federal do estado',
      cargo: 'Deputado Federal / Senador',
      total: (estado.deputadosFederais ?? []).length + (estado.senadores ?? []).length,
      partidos: agregarPorPartido([...(estado.deputadosFederais ?? []), ...(estado.senadores ?? [])]),
    },
  ]

  // Territórios do mapa: cada município colorido pela sua câmara de vereadores
  const arquivoUf = existsSync(join(UFS_DIR, `${uf}.json`)) ? await getEleicoesUf(uf) : null
  const territorios = (arquivoUf?.municipios ?? [])
    .map((m) => territorioDe(m.codareaIbge, m.nomeMunicipio, m.vereadores ?? []))
    .filter((t) => t.total > 0)
    .sort((a, b) => a.codarea.localeCompare(b.codarea))

  return { nivel: 'estado', codigo: uf, camaras, territorios }
}

/** Composição municipal: câmara de vereadores. */
export async function getComposicaoMunicipio(codarea: string): Promise<Composicao | null> {
  const municipio = await getMandatoMunicipio(codarea)
  if (!municipio) return null

  const vereadores = municipio.vereadores ?? []
  return {
    nivel: 'municipio',
    codigo: codarea,
    camaras: [
      {
        id: 'camara-municipal',
        nome: 'Câmara Municipal',
        cargo: 'Vereador',
        total: vereadores.length,
        partidos: agregarPorPartido(vereadores),
      },
    ],
    territorios: [],
  }
}
