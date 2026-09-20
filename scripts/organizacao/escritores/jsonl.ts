/**
 * Caixa 4 — ORGANIZAÇÃO: escrita JSONL incremental.
 *
 * Grava um registro por linha, com `appendFile` a cada registro — a memória
 * fica O(1) em relação ao número de linhas. O `.meta.json` é escrito só no
 * final, quando as contagens já são conhecidas.
 *
 * Escreve primeiro em `<arquivo>.tmp` e renomeia no fim, para que uma execução
 * interrompida não deixe um JSONL parcial parecendo completo.
 */

import { appendFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  ContagensOrganizacao,
  LinhaQuarentena,
  MetadadosOrganizacao,
  RegistroOrganizado,
} from '../tipos.js'

/** Sufixo do arquivo temporário, usado antes do rename atômico. */
const SUFIXO_TEMPORARIO = '.tmp'

/** Escritor de JSONL incremental. */
export class EscritorJsonl {
  private readonly temporario: string
  private iniciado = false
  private fechado = false

  constructor(private readonly destino: string) {
    this.temporario = `${destino}${SUFIXO_TEMPORARIO}`
  }

  /** Prepara o diretório e remove um temporário remanescente. */
  async abrir(): Promise<void> {
    await mkdir(dirname(this.destino), { recursive: true })
    // Um `.tmp` de execução anterior não deve se misturar com esta.
    await rm(this.temporario, { force: true })
    this.iniciado = true
  }

  /** Acrescenta um registro como uma linha JSON. */
  async escrever(registro: RegistroOrganizado): Promise<void> {
    if (!this.iniciado) throw new Error('EscritorJsonl.escrever() chamado antes de abrir()')
    await appendFile(this.temporario, `${JSON.stringify(registro)}\n`, 'utf-8')
  }

  /** Finaliza o arquivo, renomeando o temporário para o destino. */
  async fechar(): Promise<void> {
    if (this.fechado) return
    // Mesmo sem linhas, cria o arquivo vazio: a saída existir é informação.
    await appendFile(this.temporario, '', 'utf-8')
    await rename(this.temporario, this.destino)
    this.fechado = true
  }

  /** Descarta o temporário (usado quando a organização aborta). */
  async abortar(): Promise<void> {
    if (this.fechado) return
    await rm(this.temporario, { force: true })
    this.fechado = true
  }
}

/** Escritor de quarentena: mesma mecânica, conteúdo diferente. */
export class EscritorQuarentena {
  private readonly escritor: EscritorJsonl

  constructor(destino: string) {
    this.escritor = new EscritorJsonl(destino)
  }

  abrir(): Promise<void> {
    return this.escritor.abrir()
  }

  escrever(linha: LinhaQuarentena): Promise<void> {
    return this.escritor.escrever(linha as unknown as RegistroOrganizado)
  }

  fechar(): Promise<void> {
    return this.escritor.fechar()
  }

  abortar(): Promise<void> {
    return this.escritor.abortar()
  }
}

/** Grava os metadados de uma organização. */
export async function gravarMetadados(
  raizSaida: string,
  metadados: MetadadosOrganizacao,
): Promise<string> {
  const destino = join(raizSaida, metadados.fonteId, `${metadados.recursoId}.meta.json`)
  await mkdir(dirname(destino), { recursive: true })
  const temporario = `${destino}${SUFIXO_TEMPORARIO}`
  await writeFile(temporario, `${JSON.stringify(metadados, null, 2)}\n`, 'utf-8')
  await rename(temporario, destino)
  return destino
}

/** Caminho do JSONL de saída. */
export function caminhoSaida(raizSaida: string, fonteId: string, recursoId: string): string {
  return join(raizSaida, fonteId, `${recursoId}.jsonl`)
}

/** Caminho da quarentena. */
export function caminhoQuarentena(raizSaida: string, fonteId: string, recursoId: string): string {
  return join(raizSaida, fonteId, `${recursoId}.quarentena.jsonl`)
}

/** Contagens zeradas. */
export function contagensZeradas(): ContagensOrganizacao {
  return { lidas: 0, gravadas: 0, quarentenadas: 0 }
}
