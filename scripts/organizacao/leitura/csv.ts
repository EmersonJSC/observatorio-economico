/**
 * Caixa 4 — ORGANIZAÇÃO: leitura de CSV em stream.
 *
 * Lê um CSV sem materializar o arquivo inteiro: consome a `Readable` linha a
 * linha via `node:readline` e entrega um registro por vez ao tradutor.
 *
 * O problema real que isto resolve: o TSE publica CSVs de até 234 MB
 * (`consulta_cand_2024_BRASIL.csv`). O parser legado fazia
 * `entry.getData().toString('latin1')` + `split()` — isso materializa
 * ~1,4 GB em pico (Buffer + string UTF-16 + array de linhas). Aqui o consumo
 * é O(1) no tamanho do arquivo.
 *
 * O arquivo do TSE tem:
 *   - separador `;`
 *   - aspas duplas em quase todos os campos
 *   - encoding latin1 (ISO-8859-1) — confirmado por inspeção de bytes reais
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { Transform, type Readable } from 'node:stream'

import type { OrigemRegistro, RegistroBruto } from './json.js'

/** Erro ao interpretar um CSV. */
export class ErroCsv extends Error {
  constructor(
    message: string,
    readonly arquivo: string,
    readonly linha?: number,
  ) {
    super(message)
    this.name = 'ErroCsv'
  }
}

/** Opções de leitura de CSV. */
export interface OpcoesCsv {
  /** Separador de campos. O TSE usa `;`. */
  separador: string
  /** Encoding do arquivo: `latin1`, `windows-1252` ou `utf-8`. */
  encoding: 'latin1' | 'windows-1252' | 'utf-8'
  /**
   * Nome do arquivo na origem, usado apenas para rastreabilidade (mensagens e
   * quarentena). Não é aberto por este módulo.
   */
  arquivo: string
}

/** Encoding aceito pelo `TextDecoder` do Node. */
function nomeEncoding(enc: OpcoesCsv['encoding']): string {
  // `windows-1252` é o rótulo do WHATWG para cp1252; o Node aceita ambos.
  return enc === 'latin1' ? 'windows-1252' : enc
}

/**
 * Marca um fluxo como "já decodificado para texto".
 *
 * Usamos um símbolo em vez de heurística: `readline` sempre entrega `string`
 * (decodifica Buffers como UTF-8 por conta própria), então não dá para
 * inspecionar o chunk para saber se os bytes foram tratados. A marca explícita
 * é a única forma confiável de distinguir "texto decodificado" de "bytes que
 * serão decodificados errado".
 */
const MARCA_TEXTO = Symbol.for('observatorio.fluxoTexto')

/** `true` quando o fluxo foi produzido por `criarFluxoDecodificado` ou declara encoding. */
function ehFluxoDeTexto(fluxo: Readable): boolean {
  const estado = fluxo as Readable & {
    readableEncoding?: string | null
    [MARCA_TEXTO]?: boolean
  }
  return estado[MARCA_TEXTO] === true || Boolean(estado.readableEncoding)
}

/**
 * Guarda contra passar BYTES onde se espera TEXTO.
 *
 * `readline` sempre entrega `string` — ele decodifica Buffers como UTF-8 por
 * conta própria. É exatamente por isso que passar bytes crus produz mojibake
 * silencioso em latin1 ("ELEIÇÃO" → "ELEI??O") sem nenhum erro. Sem esta
 * guarda, o defeito só apareceria na saída, já gravada.
 */
function conferirFluxoDeTexto(fluxo: Readable, arquivo: string): void {
  if (ehFluxoDeTexto(fluxo)) return

  throw new ErroCsv(
    `o fluxo de "${arquivo}" não foi decodificado para texto.\n` +
      `  Envolva com criarFluxoDecodificado(fluxo, encoding) antes de iterar.\n` +
      `  Sem isso os acentos viram mojibake silencioso (ex.: "ELEIÇÃO" → "ELEI??O").`,
    arquivo,
  )
}

/**
 * Quebra uma linha CSV em campos, respeitando aspas duplas.
 *
 * Regras aplicadas (formato RFC 4180, que é o que o TSE usa):
 *   - aspas envolvem o campo e são removidas
 *   - `""` dentro de um campo entre aspas representa uma aspa literal
 *   - o separador dentro de aspas não quebra o campo
 */
export function quebrarLinha(linha: string, separador: string): string[] {
  const campos: string[] = []
  let atual = ''
  let dentroDeAspas = false

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]!

    if (dentroDeAspas) {
      if (c === '"') {
        // `""` escapado vira uma aspa literal.
        if (linha[i + 1] === '"') {
          atual += '"'
          i++
        } else {
          dentroDeAspas = false
        }
      } else {
        atual += c
      }
      continue
    }

    if (c === '"') {
      dentroDeAspas = true
    } else if (c === separador) {
      campos.push(atual)
      atual = ''
    } else {
      atual += c
    }
  }

  campos.push(atual)
  return campos
}

/** Localiza índices das colunas a partir do cabeçalho. */
export function indexarCabecalho(cabecalho: readonly string[]): Map<string, number> {
  const indice = new Map<string, number>()
  for (let i = 0; i < cabecalho.length; i++) {
    const nome = cabecalho[i]!.trim().toUpperCase()
    if (nome !== '' && !indice.has(nome)) indice.set(nome, i)
  }
  return indice
}

/**
 * Itera os registros de um CSV.
 *
 * ⚠️ O fluxo deve estar JÁ DECODIFICADO para texto. Se você tem bytes (de um
 * arquivo ou de dentro de um ZIP), envolva antes com `criarFluxoDecodificado()`
 * — passá-los crus produz mojibake silencioso nos acentos ("ELEIÇÃO" vira
 * "ELEI??O"). Para arquivos no disco, prefira `iterarCsvDeArquivo()`.
 *
 * Converte cada linha em um objeto `{ COLUNA: valor }`, usando o cabeçalho
 * como chave. O tradutor decide o que fazer com cada coluna — este módulo é
 * agnóstico de domínio.
 *
 * LINHAS EM BRANCO são ignoradas. A PRIMEIRA linha útil é o cabeçalho.
 *
 * @param fluxo Stream de TEXTO já decodificado.
 * @param opcoes Separador, encoding e nome do arquivo (rastreabilidade).
 * @param cabecalhoPrevio Cabeçalho já lido por outro consumidor.
 */
export async function* iterarCsv(
  fluxo: Readable,
  opcoes: OpcoesCsv,
  cabecalhoPrevio?: readonly string[],
): AsyncGenerator<RegistroBruto> {
  conferirFluxoDeTexto(fluxo, opcoes.arquivo)

  const rl = createInterface({ input: fluxo, crlfDelay: Infinity })

  let cabecalho: readonly string[] | undefined = cabecalhoPrevio
  let numeroLinha = 0

  for await (const linhaBruta of rl) {
    numeroLinha++

    // Linha vazia (ou só espaços) não é registro.
    if (linhaBruta.trim() === '') continue

    const campos = quebrarLinha(linhaBruta, opcoes.separador)

    if (cabecalho === undefined) {
      // A primeira linha útil é o cabeçalho.
      cabecalho = campos.map((c) => c.trim())
      continue
    }

    // Monta o registro: colunas ausentes na linha viram `undefined`.
    const registro: Record<string, string> = {}
    for (let i = 0; i < cabecalho.length; i++) {
      const nome = cabecalho[i]
      if (nome === undefined || nome === '') continue
      const valor = campos[i]
      if (valor !== undefined) registro[nome] = valor
    }

    const origem: OrigemRegistro = { arquivo: opcoes.arquivo, indice: numeroLinha - 1 }
    yield { valor: registro, origem }
  }
}

/** Lê um CSV de um caminho no disco (conveniência e teste). */
export async function* iterarCsvDeArquivo(
  caminho: string,
  opcoes: OpcoesCsv,
): AsyncGenerator<RegistroBruto> {
  const fluxo = criarFluxoDecodificado(createReadStream(caminho), opcoes.encoding)
  yield* iterarCsv(fluxo, opcoes)
}

/**
 * Envolve um stream de bytes em um stream de texto decodificado.
 *
 * A decodificação é incremental (`StringDecoder`), então um caractere
 * multi-byte partido entre dois chunks não corrompe o texto. Isso é
 * especialmente importante para `windows-1252`, em que um byte pode virar
 * qualquer caractere acentuado.
 */
export function criarFluxoDecodificado(origem: Readable, encoding: OpcoesCsv['encoding']): Readable {
  const decodificador = new TextDecoder(nomeEncoding(encoding))

  const transformado = origem.pipe(
    new Transform({
      transform(chunk: Buffer, _enc, callback) {
        try {
          this.push(decodificador.decode(chunk, { stream: true }))
          callback()
        } catch (err) {
          callback(err instanceof Error ? err : new Error(String(err)))
        }
      },
      flush(callback) {
        try {
          const resto = decodificador.decode()
          if (resto !== '') this.push(resto)
          callback()
        } catch (err) {
          callback(err instanceof Error ? err : new Error(String(err)))
        }
      },
    }),
  )

  // Marca o fluxo como texto: sem isso `iterarCsv` não teria como distinguir
  // este fluxo (correto) de um stream de bytes cru (que corromperia acentos).
  Object.defineProperty(transformado, MARCA_TEXTO, { value: true, enumerable: false })
  return transformado
}

/**
 * Marca um fluxo como texto SEM decodificar.
 *
 * Use apenas quando o conteúdo já é texto por construção — por exemplo
 * `Readable.from('a;b\n1;2')` em teste. Para bytes reais (arquivo, ZIP),
 * use `criarFluxoDecodificado`.
 */
export function marcarComoTexto(fluxo: Readable): Readable {
  Object.defineProperty(fluxo, MARCA_TEXTO, { value: true, enumerable: false })
  return fluxo
}

/** Lê apenas o cabeçalho de um CSV em stream, sem consumir o resto. */
export async function lerCabecalhoDeArquivo(
  caminho: string,
  opcoes: OpcoesCsv,
): Promise<string[]> {
  const fluxo = criarFluxoDecodificado(createReadStream(caminho), opcoes.encoding)
  const rl = createInterface({ input: fluxo, crlfDelay: Infinity })

  try {
    for await (const linha of rl) {
      if (linha.trim() === '') continue
      return quebrarLinha(linha, opcoes.separador).map((c) => c.trim())
    }
    return []
  } finally {
    rl.close()
    fluxo.destroy()
  }
}
