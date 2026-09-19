/**
 * Fonte ALTERNATIVA de dados eleitorais: Brasil.io
 *
 * Usada como fallback quando a fonte primária (TSE/CDN via scraper) falha.
 * O TSE bloqueia downloads automáticos com WAF (HTTP 403), então o Brasil.io
 * — que espelha e normaliza os dados do TSE — é a alternativa natural.
 *
 * API: https://api.brasil.io/v1/dataset/eleicoes-brasil/{tabela}/data/
 * Docs: https://brasil.io/api/v1/  |  https://blog.brasil.io/2020/10/10/como-acessar-os-dados-do-brasil-io/
 *
 * ⚠️ AUTENTICAÇÃO OBRIGATÓRIA:
 *   A API exige um token (gratuito). Crie o seu em:
 *     https://brasil.io/auth/tokens-api/
 *   e exporte na variável de ambiente:
 *     export BRASILIO_TOKEN="seu_token"
 *   Sem o token, esta fonte é ignorada (o orquestrador mantém os dados locais).
 *
 * Tabelas relevantes do dataset `eleicoes-brasil`:
 *   - candidatos  → candidaturas (nome, partido, cargo, resultado no turno)
 *   - votacoes    → votação por candidato/zona
 *   - bens_candidatos, filiados
 *
 * Chave de junção: `sigla_ue` (código TSE de 5 dígitos) → tabela DE-PARA local
 * (`data/elections/de-para-tse-ibge.json`) → codarea IBGE (7 dígitos).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { IbgeLocalidadesAdapter } from '../ibge/ibge-localidades.adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..', '..')
const DATA_DIR = join(ROOT, 'data', 'elections')
const UFS_DIR = join(DATA_DIR, 'ufs')
const DE_PARA_PATH = join(DATA_DIR, 'de-para-tse-ibge.json')

const API_BASE = 'https://api.brasil.io/v1'
const DATASET = 'eleicoes-brasil'

const UF_SIGLAS: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
  '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
  '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
  '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
  '52': 'GO', '53': 'DF',
}
const SIGLA_PARA_UF = Object.fromEntries(
  Object.entries(UF_SIGLAS).map(([cod, sigla]) => [sigla, cod]),
)

const CARGOS_INTERESSE: Record<number, 'prefeito' | 'vicePrefeito'> = {
  11: 'prefeito',
  12: 'vicePrefeito',
}

// ---------------------------------------------------------------------------
// Cliente HTTP da API Brasil.io (com paginação)
// ---------------------------------------------------------------------------

interface RespostaBrasilIo<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

interface CandidatoBrasilIo {
  ano_eleicao: number
  sigla_uf: string
  descricao_ue: string
  num_turno: number
  descricao_cargo: string
  codigo_cargo: number
  sigla_partido: string
  numero_candidato: number
  nome_candidato: string
  nome_urna_candidato: string
  desc_sit_tot_turno: string | null
  sigla_ue: string
  sequencial_candidato: string
}

async function buscarTodasPaginas(
  token: string,
  tabela: string,
  filtros: Record<string, string>,
): Promise<CandidatoBrasilIo[]> {
  const params = new URLSearchParams(filtros)
  let url: string | null = `${API_BASE}/dataset/${DATASET}/${tabela}/data/?${params.toString()}`
  const todos: CandidatoBrasilIo[] = []

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) {
      throw new Error(`[Brasil.io] HTTP ${res.status} em ${url}`)
    }
    const json = (await res.json()) as RespostaBrasilIo<CandidatoBrasilIo>
    todos.push(...(json.results ?? []))
    url = json.next
  }

  return todos
}

// ---------------------------------------------------------------------------
// Mapeamento TSE → IBGE
// ---------------------------------------------------------------------------

function normalizarNome(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['-]/g, ' ')
    .replace(/\bde\b|\bda\b|\bdo\b|\bdas\b|\bdos\b|\be\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Carrega o DE-PARA local, se existir. */
async function carregarDePara(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  if (!existsSync(DE_PARA_PATH)) return mapa
  const itens = JSON.parse(await readFile(DE_PARA_PATH, 'utf-8')) as Array<{
    codigoTse: string
    codareaIbge: string
  }>
  for (const i of itens) mapa.set(i.codigoTse, i.codareaIbge)
  return mapa
}

/**
 * Constrói um índice (sigla_uf + nome normalizado) → codarea IBGE usando a API
 * de Localidades. Usado quando não há DE-PARA local.
 */
async function construirIndicePorNome(
  ufs: string[],
): Promise<Map<string, string>> {
  const ibge = new IbgeLocalidadesAdapter()
  const indice = new Map<string, string>()
  for (const sigla of ufs) {
    const codUf = SIGLA_PARA_UF[sigla]
    if (!codUf) continue
    const lista = await ibge.listarMunicipiosPorUf(codUf)
    for (const m of lista) {
      indice.set(`${sigla}:${normalizarNome(m.nome)}`, String(m.id))
    }
  }
  return indice
}

// ---------------------------------------------------------------------------
// Entrada pública (chamada pelo orquestrador)
// ---------------------------------------------------------------------------

export async function ingestirComoFonteAlternativa(dominio: string): Promise<void> {
  if (dominio !== 'eleicoes') return // este adaptador cobre apenas eleições

  const token = process.env.BRASILIO_TOKEN
  if (!token) {
    throw new Error(
      'BRASILIO_TOKEN não configurado. Obtenha um token gratuito em https://brasil.io/auth/tokens-api/ ' +
      'e exporte: export BRASILIO_TOKEN="..."',
    )
  }

  const ano = Number(process.env.ELECTION_YEAR ?? 2024)
  console.log(`\n[Brasil.io] Buscando eleições ${ano} como fonte alternativa…`)

  const candidatos = await buscarTodasPaginas(token, 'candidatos', {
    ano_eleicao: String(ano),
  })
  console.log(`[Brasil.io] ✓ ${candidatos.length} candidaturas recebidas`)

  const eleitos = candidatos.filter((c) => {
    if (!CARGOS_INTERESSE[c.codigo_cargo]) return false
    const sit = (c.desc_sit_tot_turno ?? '').toUpperCase()
    return sit === 'ELEITO' || sit.startsWith('ELEITO ')
  })

  if (eleitos.length === 0) {
    throw new Error(
      `[Brasil.io] Nenhum eleito encontrado para ${ano}. ` +
      'A base do Brasil.io pode ainda não cobrir este ano — verifique em https://brasil.io/dataset/eleicoes-brasil/.',
    )
  }

  // Mapeamento TSE → IBGE (DE-PARA local; senão, por nome via IBGE Localidades)
  const dePara = await carregarDePara()
  const ufsPresentes = [...new Set(eleitos.map((c) => c.sigla_uf))].sort()
  const indiceNome = dePara.size === 0 ? await construirIndicePorNome(ufsPresentes) : new Map<string, string>()

  const porUf = new Map<string, Map<string, {
    codareaIbge: string
    codigoTse: string
    nomeMunicipio: string
    uf: string
    prefeito?: unknown
    vicePrefeito?: unknown
  }>>()

  const semMapa: string[] = []
  for (const c of eleitos) {
    const codigoTse = (c.sigla_ue ?? '').trim().replace(/^0+/, '').padStart(5, '0')
    let codareaIbge = dePara.get(codigoTse)
    if (!codareaIbge) {
      codareaIbge = indiceNome.get(`${c.sigla_uf}:${normalizarNome(c.descricao_ue)}`)
    }
    if (!codareaIbge) {
      semMapa.push(`${c.sigla_uf}/${c.descricao_ue} (TSE ${codigoTse})`)
      continue
    }

    const codUf = SIGLA_PARA_UF[c.sigla_uf]
    if (!codUf) continue

    if (!porUf.has(codUf)) porUf.set(codUf, new Map())
    const mapaUf = porUf.get(codUf)!
    if (!mapaUf.has(codareaIbge)) {
      mapaUf.set(codareaIbge, {
        codareaIbge,
        codigoTse,
        nomeMunicipio: c.descricao_ue,
        uf: c.sigla_uf,
      })
    }

    const tipo = CARGOS_INTERESSE[c.codigo_cargo]
    const iniciais = 2025
    mapaUf.get(codareaIbge)![tipo] = {
      cargo: tipo === 'prefeito' ? 'Prefeito' : 'Vice-Prefeito',
      codigoCargoTse: c.codigo_cargo,
      nomeUrna: c.nome_urna_candidato,
      nomeCompleto: c.nome_candidato,
      partido: c.sigla_partido,
      numeroCandidato: c.numero_candidato,
      anoEleicao: ano,
      mandatoPeriodo: `${iniciais}–${iniciais + 3}`,
      situacaoEleicao: c.desc_sit_tot_turno,
    }
  }

  await mkdir(UFS_DIR, { recursive: true })
  let total = 0
  for (const [codUf, mapaUf] of porUf) {
    const municipios = [...mapaUf.values()].sort((a, b) =>
      a.codareaIbge.localeCompare(b.codareaIbge),
    )
    await writeFile(
      join(UFS_DIR, `${codUf}.json`),
      JSON.stringify({ uf: codUf, anoEleicao: ano, fonte: 'Brasil.io', municipios }, null, 2),
      'utf-8',
    )
    total += municipios.length
    console.log(`  [Brasil.io] ✓ UF ${codUf} (${UF_SIGLAS[codUf]}): ${municipios.length} municípios`)
  }

  await writeFile(
    join(DATA_DIR, 'metadata.json'),
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        source: 'Brasil.io — dataset eleicoes-brasil (espelho do TSE)',
        anoEleicaoMunicipal: ano,
        ufs: [...porUf.keys()].sort(),
        municipios: total,
        version: 2,
        viaFallback: true,
      },
      null,
      2,
    ),
    'utf-8',
  )

  if (semMapa.length > 0) {
    console.warn(`  [Brasil.io] ⚠ ${semMapa.length} municípios sem correspondência IBGE`)
  }
  console.log(`\n[Brasil.io] ✓ Fonte alternativa concluída: ${total} municípios em ${porUf.size} UFs`)
}
