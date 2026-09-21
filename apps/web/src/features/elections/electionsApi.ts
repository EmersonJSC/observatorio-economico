/**
 * Mandatos eleitorais (TSE) — lidos dos arquivos estáticos.
 *
 * Como o site é 100% estático, a agregação que antes era feita na API
 * (composição de cadeiras, URL das fotos) acontece aqui no navegador.
 *
 * Três esferas:
 *  - Município: prefeito, vice e câmara de vereadores (2024)
 *  - Estado: governador, vice, senadores e deputados (2022)
 *  - Brasil: presidente, vice e composição do Congresso (2022)
 */

import { lerDados, ufDoCodarea } from '../../lib/fontes'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

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
  sqCandidato?: string
  totalVotos?: number
  /** URL da foto oficial (calculada a partir do SQ_CANDIDATO) */
  fotoUrl?: string
}

export interface MandatoMunicipio {
  codareaIbge: string
  codigoTse: string
  nomeMunicipio: string
  uf: string
  prefeito?: MandatoRepresentante
  vicePrefeito?: MandatoRepresentante
  vereadores: MandatoRepresentante[]
}

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

export interface MandatoBrasil {
  updatedAt: string
  anoEleicao: number
  presidente?: MandatoRepresentante
  vicePresidente?: MandatoRepresentante
  congresso: { senadores: number; deputadosFederais: number }
}

export interface ComposicaoPartido {
  sigla: string
  cadeiras: number
}

export interface ComposicaoTerritorio {
  codarea: string
  nome: string
  total: number
  cadeiras: Record<string, number>
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

interface ArquivoUfs {
  uf: string
  anoEleicao: number
  municipios: MandatoMunicipio[]
}

// ---------------------------------------------------------------------------
// Fotos oficiais (DivulgaCandContas)
// ---------------------------------------------------------------------------

const BASE_FOTO = 'https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img'
const ID_ELEICAO: Record<number, number> = {
  2020: 2030402020,
  2022: 2040602022,
  2024: 2045202024,
  2026: 20322002026,
}

function urlFoto(m: MandatoRepresentante, sgUe: string): string | null {
  const id = ID_ELEICAO[m.anoEleicao]
  if (!m.sqCandidato || !id) return null
  return `${BASE_FOTO}/${id}/${m.sqCandidato}/${sgUe}`
}

function comFoto(m: MandatoRepresentante, sgUe: string): MandatoRepresentante {
  const url = urlFoto(m, sgUe)
  return url ? { ...m, fotoUrl: url } : m
}

// ---------------------------------------------------------------------------
// Mandatos
// ---------------------------------------------------------------------------

export async function buscarMandatoMunicipio(codarea: string, anoSelecionado?: number | null): Promise<MandatoMunicipio | null> {
  const arquivo = await lerDados<ArquivoUfs>(`eleicoes/ufs/${ufDoCodarea(codarea)}.json`)
  const m = arquivo?.municipios.find((x) => x.codareaIbge === codarea)
  if (!m || (anoSelecionado !== null && anoSelecionado !== undefined && arquivo?.anoEleicao !== anoSelecionado)) return null
  return {
    ...m,
    ...(m.prefeito ? { prefeito: comFoto(m.prefeito, m.codigoTse) } : {}),
    ...(m.vicePrefeito ? { vicePrefeito: comFoto(m.vicePrefeito, m.codigoTse) } : {}),
    vereadores: (m.vereadores ?? []).map((v) => comFoto(v, m.codigoTse)),
  }
}

export async function buscarMandatoEstado(codigoUf: string, anoSelecionado?: number | null): Promise<MandatoEstado | null> {
  const e = await lerDados<MandatoEstado>(`eleicoes/estados/${(codigoUf)}.json`)
  if (!e || (anoSelecionado !== null && anoSelecionado !== undefined && e.anoEleicao !== anoSelecionado)) return null
  return comFotosEstado(e)
}

export async function buscarMandatoBrasil(anoSelecionado?: number | null): Promise<MandatoBrasil | null> {
  const b = await lerDados<MandatoBrasil>('eleicoes/brasil.json')
  if (!b || (anoSelecionado !== null && anoSelecionado !== undefined && b.anoEleicao !== anoSelecionado)) return null
  return {
    ...b,
    ...(b.presidente ? { presidente: comFoto(b.presidente, 'BR') } : {}),
    ...(b.vicePresidente ? { vicePresidente: comFoto(b.vicePresidente, 'BR') } : {}),
  }
}

function comFotosEstado(e: MandatoEstado): MandatoEstado {
  const sigla = e.sigla
  return {
    ...e,
    ...(e.governador ? { governador: comFoto(e.governador, sigla) } : {}),
    ...(e.viceGovernador ? { viceGovernador: comFoto(e.viceGovernador, sigla) } : {}),
    senadores: (e.senadores ?? []).map((m) => comFoto(m, sigla)),
    deputadosFederais: (e.deputadosFederais ?? []).map((m) => comFoto(m, sigla)),
    deputadosEstaduais: (e.deputadosEstaduais ?? []).map((m) => comFoto(m, sigla)),
  }
}

// ---------------------------------------------------------------------------
// Composição de cadeiras (agregada no navegador)
// ---------------------------------------------------------------------------

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

export async function buscarComposicao(
  nivel: 'brasil' | 'estado' | 'municipio',
  codigo: string,
  anoSelecionado?: number | null,
): Promise<Composicao | null> {
  if (nivel === 'brasil') {
    const composicao = await lerDados<Composicao>('eleicoes/brasil.json')
    return composicao && (anoSelecionado === null || anoSelecionado === undefined || (composicao as Composicao & { anoEleicao?: number }).anoEleicao === anoSelecionado) ? composicao : null
  }

  if (nivel === 'municipio') {
    const arquivo = await lerDados<ArquivoUfs>(`eleicoes/ufs/${ufDoCodarea(codigo)}.json`)
    const m = arquivo?.municipios.find((x) => x.codareaIbge === codigo)
    if (!m || (anoSelecionado !== null && anoSelecionado !== undefined && arquivo?.anoEleicao !== anoSelecionado)) return null
    const vereadores = m.vereadores ?? []
    return {
      nivel: 'municipio',
      codigo,
      camaras: [{
        id: 'camara-municipal',
        nome: 'Câmara Municipal',
        cargo: 'Vereador',
        total: vereadores.length,
        partidos: agregarPorPartido(vereadores),
      }],
      territorios: [],
    }
  }

  const [estado, arquivoUf] = await Promise.all([
    lerDados<MandatoEstado>(`eleicoes/estados/${(codigo)}.json`),
    lerDados<ArquivoUfs>(`eleicoes/ufs/${(codigo)}.json`),
  ])
  if (!estado || (anoSelecionado !== null && anoSelecionado !== undefined && estado.anoEleicao !== anoSelecionado)) return null

  const deputadosEstaduais = estado.deputadosEstaduais ?? []
  const deputadosFederais = estado.deputadosFederais ?? []
  const senadores = estado.senadores ?? []

  return {
    nivel: 'estado',
    codigo,
    camaras: [
      {
        id: 'assembleia',
        nome: 'Assembleia Legislativa',
        cargo: 'Deputado Estadual',
        total: deputadosEstaduais.length,
        partidos: agregarPorPartido(deputadosEstaduais),
      },
      {
        id: 'bancada-federal',
        nome: 'Bancada federal do estado',
        cargo: 'Deputado Federal / Senador',
        total: deputadosFederais.length + senadores.length,
        partidos: agregarPorPartido([...deputadosFederais, ...senadores]),
      },
    ],
    // Territórios do mapa: cada município colorido pela câmara de vereadores
    territorios: (arquivoUf?.municipios ?? [])
      .map((m) => territorioDe(m.codareaIbge, m.nomeMunicipio, m.vereadores ?? []))
      .filter((t) => t.total > 0)
      .sort((a, b) => a.codarea.localeCompare(b.codarea)),
  }
}
