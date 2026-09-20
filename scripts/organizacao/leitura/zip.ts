/**
 * Caixa 4 — ORGANIZAÇÃO: ponte ZIP → stream de CSV.
 *
 * O TSE publica um ZIP nacional que contém um CSV por UF mais um consolidado
 * `_BRASIL.csv`. Tamanhos reais medidos no RAW do projeto:
 *
 *   consulta_cand_2024_BRASIL.csv   233,9 MB
 *   consulta_cand_2024_SP.csv        39,2 MB
 *   consulta_cand_2024_MG.csv        37,3 MB
 *   (demais UFs)                    0,7 – 17,8 MB
 *
 * MITIGAÇÃO 3a (aprovada): `adm-zip` carrega a entrada inteira em memória e
 * não faz streaming. Como não adicionaremos dependência nova agora, a
 * estratégia é IGNORAR o `_BRASIL.csv` e ler apenas os arquivos por UF, que
 * cabem confortavelmente em RAM. O consolidado não é necessário: é a soma das
 * UFs, e processá-lo causaria duplicação de registros além do risco de OOM.
 *
 * Isto mantém o pico de memória no maior arquivo de UF (~39 MB) em vez dos
 * 234 MB do consolidado — cerca de 6× menos.
 */

import { readFile } from 'node:fs/promises'

import { criarFluxoDecodificado, iterarCsv, lerCabecalhoDeArquivo, type OpcoesCsv } from './csv.js'
import type { OrigemRegistro, RegistroBruto } from './json.js'
import { Readable } from 'node:stream'

/** Erro ao manipular o ZIP. */
export class ErroZip extends Error {
  constructor(
    message: string,
    readonly arquivo: string,
  ) {
    super(message)
    this.name = 'ErroZip'
  }
}

/** Uma entrada de CSV dentro do ZIP. */
export interface EntradaZip {
  nome: string
  /** Tamanho descompactado em bytes. */
  tamanho: number
  /** UF extraída do nome, quando aplicável (`SP`, `MG`, …). */
  uf?: string
}

/** Tamanho máximo de um CSV que aceitamos materializar com `adm-zip`. */
const LIMITE_SEGURANCA_BYTES = 80 * 1024 * 1024

/** Extrai a UF do nome do arquivo (`consulta_cand_2024_SP.csv` → `SP`). */
function ufDoNome(nome: string): string | undefined {
  const m = /_([A-Z]{2})\.csv$/i.exec(nome)
  return m ? m[1]!.toUpperCase() : undefined
}

/** `true` quando a entrada é um CSV consolidado do Brasil (deve ser ignorada). */
export function ehConsolidadoBrasil(nome: string): boolean {
  return /_BRASIL\.csv$/i.test(nome)
}

/**
 * Lista as entradas de CSV de um ZIP, já aplicando a Mitigação 3a.
 *
 * Descarta:
 *   - arquivos que não são `.csv` (ex.: `leiame.pdf`)
 *   - o consolidado `_BRASIL.csv`
 *
 * @param apenasUfs Restringe a estas UFs (vazio = todas).
 */
export async function listarCsvsDoZip(
  caminhoZip: string,
  apenasUfs: readonly string[] = [],
): Promise<EntradaZip[]> {
  const AdmZip = (await import('adm-zip')).default

  let zip: InstanceType<typeof AdmZip>
  try {
    zip = new AdmZip(caminhoZip)
  } catch (err) {
    throw new ErroZip(
      `não foi possível abrir o ZIP: ${err instanceof Error ? err.message : String(err)}`,
      caminhoZip,
    )
  }

  const filtro = new Set(apenasUfs.map((u) => u.toUpperCase()))

  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && /\.csv$/i.test(e.entryName))
    .filter((e) => !ehConsolidadoBrasil(e.entryName))
    .map((e) => {
      const nome = e.entryName
      const uf = ufDoNome(nome)
      return { nome, tamanho: e.header.size, ...(uf !== undefined ? { uf } : {}) }
    })
    .filter((e) => filtro.size === 0 || (e.uf !== undefined && filtro.has(e.uf)))
    .sort((a, b) => (a.uf ?? '').localeCompare(b.uf ?? ''))
}

/**
 * Abre uma entrada específica do ZIP como stream de texto decodificado.
 *
 * O entry ainda é materializado por `adm-zip` (limitação conhecida), mas
 * apenas o arquivo de UMA UF — nunca o consolidado. O stream existe para que o
 * CONSUMO seja incremental: o `readline` lê linha a linha e o tradutor recebe
 * um registro por vez, sem criar arrays intermediários.
 */
export async function abrirCsvDoZip(
  caminhoZip: string,
  nomeEntrada: string,
  opcoes: Pick<OpcoesCsv, 'encoding'>,
): Promise<Readable> {
  const AdmZip = (await import('adm-zip')).default

  const zip = new AdmZip(caminhoZip)
  const entry = zip.getEntry(nomeEntrada)
  if (!entry) {
    throw new ErroZip(`entrada não encontrada no ZIP: ${nomeEntrada}`, caminhoZip)
  }

  const tamanho = entry.header.size
  if (tamanho > LIMITE_SEGURANCA_BYTES) {
    throw new ErroZip(
      `entrada grande demais para leitura segura: ${nomeEntrada} ` +
        `(${(tamanho / 1024 / 1024).toFixed(1)} MB > ${LIMITE_SEGURANCA_BYTES / 1024 / 1024} MB).\n` +
        `  Mitigação 3a: leia por UF em vez do consolidado _BRASIL.csv.`,
      caminhoZip,
    )
  }

  const buffer = entry.getData()
  return criarFluxoDecodificado(Readable.from(buffer), opcoes.encoding)
}

/**
 * Itera os registros de TODOS os CSVs por UF de um ZIP.
 *
 * Cada entrada é lida e liberada em sequência — nunca há dois arquivos de UF
 * em memória ao mesmo tempo. O cabeçalho é lido uma vez por arquivo e
 * reaproveitado, e o nome do arquivo de origem acompanha cada registro para
 * rastreabilidade na quarentena.
 */
export async function* iterarCsvsDoZip(
  caminhoZip: string,
  opcoes: Pick<OpcoesCsv, 'separador' | 'encoding'>,
  apenasUfs: readonly string[] = [],
): AsyncGenerator<RegistroBruto> {
  const entradas = await listarCsvsDoZip(caminhoZip, apenasUfs)

  if (entradas.length === 0) {
    throw new ErroZip(
      `nenhum CSV por UF encontrado no ZIP${apenasUfs.length > 0 ? ` para ${apenasUfs.join(', ')}` : ''}.\n` +
        `  O consolidado _BRASIL.csv é ignorado de propósito (Mitigação 3a).`,
      caminhoZip,
    )
  }

  for (const entrada of entradas) {
    const caminhoEntrada = `${caminhoZip}::${entrada.nome}`
    const fluxo = await abrirCsvDoZip(caminhoZip, entrada.nome, opcoes)

    // O cabeçalho é lido pelo próprio iterador de CSV; a origem carrega o
    // nome da entrada para que a quarentena identifique de qual UF veio.
    const opcoesArquivo: OpcoesCsv = {
      separador: opcoes.separador,
      encoding: opcoes.encoding,
      arquivo: caminhoEntrada,
    }

    yield* iterarCsv(fluxo, opcoesArquivo)
  }
}

/** Lê o cabeçalho de uma entrada do ZIP, sem consumir o arquivo. */
export async function lerCabecalhoDoZip(
  caminhoZip: string,
  nomeEntrada: string,
  opcoes: Pick<OpcoesCsv, 'separador' | 'encoding'>,
): Promise<string[]> {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(caminhoZip)
  const entry = zip.getEntry(nomeEntrada)
  if (!entry) throw new ErroZip(`entrada não encontrada: ${nomeEntrada}`, caminhoZip)

  const texto = entry.getData().toString('latin1')
  const primeira = texto.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  return primeira
    .split(opcoes.separador)
    .map((c) => c.replace(/^"|"$/g, '').trim())
    .filter((c) => c !== '')
}

/** Lê um ZIP inteiro para a memória (usado apenas em teste). */
export async function lerZipInteiro(caminho: string): Promise<Buffer> {
  return readFile(caminho)
}

/** Reexporta o leitor de cabeçalho de arquivo solto, por conveniência. */
export { lerCabecalhoDeArquivo }

/** Reexporta o tipo de origem, usado nos geradores. */
export type { OrigemRegistro }
