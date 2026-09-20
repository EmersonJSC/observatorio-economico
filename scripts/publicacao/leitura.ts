/**
 * Caixa 7 — leitura das fontes publicáveis.
 *
 * Lê o organizado (Caixa 4), a ponte (Caixa 5) e os cálculos (Caixa 6), mais as
 * malhas territoriais do RAW. NÃO transforma nada — só carrega e tipa.
 *
 * O streaming é usado onde o volume justifica (TSE tem 463.859 linhas); o resto
 * cabe folgadamente em memória.
 */

import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

import { ErroPublicacao } from './tipos.js'

/** Itera um JSONL linha a linha. */
export async function* iterarJsonl<T>(caminho: string, nomeLegivel: string): AsyncGenerator<T> {
  if (!existsSync(caminho)) {
    throw new ErroPublicacao(
      `arquivo não encontrado: ${nomeLegivel}\n  Caminho: ${caminho}`,
      'fonte-ausente',
    )
  }

  const fluxo = createReadStream(caminho, { encoding: 'utf-8' })
  const rl = createInterface({ input: fluxo, crlfDelay: Infinity })

  try {
    for await (const texto of rl) {
      const limpo = texto.trim()
      if (limpo === '') continue
      try {
        yield JSON.parse(limpo) as T
      } catch (err) {
        throw new ErroPublicacao(
          `${nomeLegivel}: JSON inválido: ${err instanceof Error ? err.message : String(err)}`,
          'contrato-invalido',
        )
      }
    }
  } finally {
    rl.close()
    fluxo.destroy()
  }
}

/** Lê um JSON inteiro. */
export async function lerJson<T>(caminho: string): Promise<T | null> {
  if (!existsSync(caminho)) return null
  try {
    return JSON.parse(await readFile(caminho, 'utf-8')) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Estruturas de origem
// ---------------------------------------------------------------------------

/** Linha de `calculated/municipio.jsonl` (Caixa 6). */
export interface MunicipioCalculado {
  codarea: string
  nome: string
  ufSigla: string
  metricas: Record<string, { valor: number | null; ano: number | null; motivo?: string }>
}

/** Linha de `calculated/candidatos-por-municipio.jsonl` (Caixa 6). */
export interface CandidatosCalculado {
  codarea: string
  ufSigla: string
  totalCandidatos: number
  candidatosPrefeito: number
  candidatosVereador: number
  partidosDistintos: number
  anoEleicao: number | null
}

/** Linha de `organized/siconfi/dca.jsonl` (Caixa 4). */
export interface OrcamentoOrganizado {
  codarea: string
  exercicio: number
  instituicao?: string
  ufSigla?: string
  receitaTotal: number | null
  despesaTotal: number | null
  gastoSaude: number | null
  gastoEducacao: number | null
}

/** Linha de `organized/ibge-localidades/estados.jsonl` (Caixa 4). */
export interface EstadoOrganizado {
  codarea: string
  sigla: string
  nome: string
  regiaoCodigo?: string
  regiaoSigla?: string
  regiaoNome?: string
}

/** Linha de `organized/ibge-malhas/malha-municipios-por-uf.jsonl` (Caixa 4). */
export interface AreaMunicipio {
  codarea: string
  areaKm2: number | null
}

/** Linha da ponte `related/municipio.jsonl` (Caixa 5). */
export interface LinhaPonte {
  codarea: string
  nome: string
  ufSigla: string
  ufCodigo: string
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

/** Caminhos das fontes. */
export interface CaminhosPublicacao {
  raizOrganizada: string
  raizRelacionada: string
  raizCalculada: string
  raizRaw: string
}

/**
 * Carrega os municípios calculados (Caixa 6) em um mapa por codarea.
 *
 * É a base da publicação: 5.571 registros, volume que cabe em memória.
 */
export async function carregarMunicipiosCalculados(
  caminhos: CaminhosPublicacao,
): Promise<Map<string, MunicipioCalculado>> {
  const caminho = join(caminhos.raizCalculada, 'municipio.jsonl')
  const mapa = new Map<string, MunicipioCalculado>()

  for await (const linha of iterarJsonl<MunicipioCalculado>(
    caminho,
    'calculated/municipio.jsonl',
  )) {
    if (linha.codarea) mapa.set(linha.codarea, linha)
  }

  return mapa
}

/** Carrega as candidaturas agregadas por município (Caixa 6). */
export async function carregarCandidatos(
  caminhos: CaminhosPublicacao,
): Promise<Map<string, CandidatosCalculado>> {
  const caminho = join(caminhos.raizCalculada, 'candidatos-por-municipio.jsonl')
  const mapa = new Map<string, CandidatosCalculado>()
  if (!existsSync(caminho)) return mapa

  for await (const linha of iterarJsonl<CandidatosCalculado>(
    caminho,
    'calculated/candidatos-por-municipio.jsonl',
  )) {
    if (linha.codarea) mapa.set(linha.codarea, linha)
  }

  return mapa
}

/** Carrega o orçamento organizado (Caixa 4). */
export async function carregarOrcamento(
  caminhos: CaminhosPublicacao,
): Promise<Map<string, OrcamentoOrganizado>> {
  const caminho = join(caminhos.raizOrganizada, 'siconfi', 'dca.jsonl')
  const mapa = new Map<string, OrcamentoOrganizado>()
  if (!existsSync(caminho)) return mapa

  for await (const linha of iterarJsonl<OrcamentoOrganizado>(caminho, 'siconfi/dca.jsonl')) {
    if (linha.codarea) mapa.set(linha.codarea, linha)
  }

  return mapa
}

/** Carrega os estados organizados (Caixa 4). */
export async function carregarEstados(
  caminhos: CaminhosPublicacao,
): Promise<Map<string, EstadoOrganizado>> {
  const caminho = join(caminhos.raizOrganizada, 'ibge-localidades', 'estados.jsonl')
  const mapa = new Map<string, EstadoOrganizado>()
  if (!existsSync(caminho)) return mapa

  for await (const linha of iterarJsonl<EstadoOrganizado>(caminho, 'ibge-localidades/estados.jsonl')) {
    if (linha.codarea) mapa.set(linha.codarea, linha)
  }

  return mapa
}

/** Carrega as áreas municipais (Caixa 4). */
export async function carregarAreas(
  caminhos: CaminhosPublicacao,
): Promise<Map<string, number>> {
  const caminho = join(
    caminhos.raizOrganizada,
    'ibge-malhas',
    'malha-municipios-por-uf.jsonl',
  )
  const mapa = new Map<string, number>()
  if (!existsSync(caminho)) return mapa

  for await (const linha of iterarJsonl<AreaMunicipio>(caminho, 'ibge-malhas/malha-municipios-por-uf.jsonl')) {
    if (linha.codarea && typeof linha.areaKm2 === 'number') {
      mapa.set(linha.codarea, linha.areaKm2)
    }
  }

  return mapa
}

/** Carrega a ponte canônica (Caixa 5) — nome e UF oficiais de cada município. */
export async function carregarPonte(
  caminhos: CaminhosPublicacao,
): Promise<Map<string, LinhaPonte>> {
  const caminho = join(caminhos.raizRelacionada, 'municipio.jsonl')
  const mapa = new Map<string, LinhaPonte>()

  for await (const linha of iterarJsonl<LinhaPonte>(caminho, 'related/municipio.jsonl')) {
    if (linha.codarea) mapa.set(linha.codarea, linha)
  }

  return mapa
}

/** Malha municipal de uma UF, pronta para publicar. */
export interface MalhaUf {
  uf: string
  geojson: string
  bytes: number
  features: number
}

/**
 * Indexa as malhas municipais do RAW por UF.
 *
 * O nome do arquivo no RAW é o hash do conteúdo, então a UF não está no
 * caminho. Ela é derivada do prefixo do primeiro `codarea` de cada coleção —
 * o código IBGE de município começa com os 2 dígitos da UF.
 *
 * @returns Mapa `uf → { arquivo relativo ao RAW, features }`.
 */
export async function indexarMalhas(
  caminhos: CaminhosPublicacao,
): Promise<Map<string, { arquivo: string; features: number }>> {
  const indice = new Map<string, { arquivo: string; features: number }>()
  const manifesto = join(caminhos.raizRaw, 'ibge-malhas', 'malha-municipios-por-uf', 'manifest.json')
  if (!existsSync(manifesto)) return indice

  const manifest = await lerJson<{ objetos?: Array<{ arquivo?: string }> }>(manifesto)
  if (!manifest?.objetos) return indice

  for (const objeto of manifest.objetos) {
    if (!objeto.arquivo) continue
    const caminho = join(caminhos.raizRaw, objeto.arquivo)
    if (!existsSync(caminho)) continue

    const colecao = await lerJson<{ features?: Array<{ properties?: { codarea?: string } }> }>(caminho)
    const primeiro = colecao?.features?.[0]?.properties?.codarea
    if (!primeiro) continue

    const uf = String(primeiro).slice(0, 2)
    indice.set(uf, { arquivo: objeto.arquivo, features: colecao?.features?.length ?? 0 })
  }

  return indice
}

/** Lê o GeoJSON de malha municipal de uma UF, direto do RAW. */
export async function lerMalhaUf(
  caminhos: CaminhosPublicacao,
  arquivoRelativo: string,
): Promise<string | null> {
  const caminho = join(caminhos.raizRaw, arquivoRelativo)
  if (!existsSync(caminho)) return null
  return readFile(caminho, 'utf-8')
}

/** Nome, UF e código de UF de um município, para enriquecer a geometria. */
export interface NomeMunicipio {
  nome: string
  ufSigla: string
  ufCodigo: string
}

/**
 * Carrega os nomes dos municípios (Caixa 4) para enriquecer as malhas.
 *
 * O IBGE devolve a geometria com apenas `codarea`; o mapa precisa de nome e UF.
 */
export async function carregarNomeMunicipios(
  caminhos: CaminhosPublicacao,
): Promise<Map<string, NomeMunicipio>> {
  const caminho = join(
    caminhos.raizOrganizada,
    'ibge-localidades',
    'municipios-por-uf.jsonl',
  )
  const mapa = new Map<string, NomeMunicipio>()
  if (!existsSync(caminho)) return mapa

  for await (const linha of iterarJsonl<{
    codarea?: string
    nome?: string
    ufSigla?: string
    ufCodigo?: string
  }>(caminho, 'ibge-localidades/municipios-por-uf.jsonl')) {
    if (!linha.codarea) continue
    mapa.set(linha.codarea, {
      nome: linha.nome ?? linha.codarea,
      ufSigla: linha.ufSigla ?? '',
      ufCodigo: linha.ufCodigo ?? '',
    })
  }

  return mapa
}

/**
 * Localiza o arquivo da malha das UFs no RAW.
 *
 * A malha nacional é um único objeto; o nome do arquivo é o hash, então não há
 * como adivinhar. Lemos o manifesto e pegamos o primeiro objeto.
 */
export async function localizarMalhaUfs(
  caminhos: CaminhosPublicacao,
): Promise<string | null> {
  const manifesto = join(caminhos.raizRaw, 'ibge-malhas', 'malha-ufs', 'manifest.json')
  if (!existsSync(manifesto)) return null

  const manifest = await lerJson<{ objetos?: Array<{ arquivo?: string }> }>(manifesto)
  return manifest?.objetos?.[0]?.arquivo ?? null
}
