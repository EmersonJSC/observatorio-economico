/**
 * Caixa 7 — escrita e compressão de artefatos.
 *
 * Os artefatos são gravados de forma atômica (`.tmp` + rename) e, quando
 * pedido, acompanhados de um `.gz` pré-gerado.
 *
 * ── Por que comprimir NO BUILD e não por cabeçalho ────────────────────────
 *
 * O alvo de produção é o **GitHub Pages**, que ignora o arquivo `_headers`
 * (esse só vale para Cloudflare/Netlify). Ou seja: a configuração de cache e
 * compressão por cabeçalho que o projeto tinha **não surtia efeito nenhum**.
 *
 * O Pages serve o `.gz` automaticamente quando ele existe ao lado do arquivo
 * original, então pré-comprimir no build é a única via que funciona no alvo
 * real. Medição no payload do projeto: 69% a 94% de redução.
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { pipeline } from 'node:stream/promises'
import { createGzip, constants as zlibConstants } from 'node:zlib'

import type { ArtefatoPublicado } from './tipos.js'

/** Sufixo do arquivo temporário. */
const SUFIXO_TEMPORARIO = '.tmp'

/** Escreve um artefato JSON de forma atômica e devolve seu tamanho. */
export async function gravarJson(caminho: string, dado: unknown): Promise<number> {
  await mkdir(dirname(caminho), { recursive: true })

  // Sem indentação: o payload é para o navegador, não para leitura humana.
  // A indentação de 2 espaços inflaria os arquivos em ~20% sem benefício.
  const conteudo = JSON.stringify(dado)
  const temporario = `${caminho}${SUFIXO_TEMPORARIO}`
  await writeFile(temporario, conteudo, 'utf-8')
  await rename(temporario, caminho)

  return Buffer.byteLength(conteudo)
}

/** Escreve um artefato JSONL (uma linha por registro), de forma atômica. */
export async function gravarJsonl(caminho: string, registros: readonly unknown[]): Promise<number> {
  await mkdir(dirname(caminho), { recursive: true })

  const conteudo = registros.map((r) => JSON.stringify(r)).join('\n') + (registros.length > 0 ? '\n' : '')
  const temporario = `${caminho}${SUFIXO_TEMPORARIO}`
  await writeFile(temporario, conteudo, 'utf-8')
  await rename(temporario, caminho)

  return Buffer.byteLength(conteudo)
}

/** Copia bytes crus (GeoJSON já é texto) de forma atômica. */
export async function gravarTexto(caminho: string, conteudo: string): Promise<number> {
  await mkdir(dirname(caminho), { recursive: true })
  const temporario = `${caminho}${SUFIXO_TEMPORARIO}`
  await writeFile(temporario, conteudo, 'utf-8')
  await rename(temporario, caminho)
  return Buffer.byteLength(conteudo)
}

/**
 * Gera `<arquivo>.gz` ao lado do original.
 *
 * Usa nível máximo de compressão: o custo é pago uma vez no build e o ganho é
 * de banda em toda requisição. Devolve o tamanho comprimido.
 */
export async function comprimir(caminho: string): Promise<number> {
  const destino = `${caminho}.gz`
  const temporario = `${destino}${SUFIXO_TEMPORARIO}`

  await pipeline(
    createReadStream(caminho),
    createGzip({ level: zlibConstants.Z_BEST_COMPRESSION }),
    createWriteStream(temporario),
  )
  await rename(temporario, destino)

  return (await stat(destino)).size
}

/** Remove um diretório inteiro, ignorando ausência. */
export async function limparDiretorio(caminho: string): Promise<void> {
  await rm(caminho, { recursive: true, force: true })
}

/** Monta o registro de um artefato, opcionalmente comprimindo. */
export async function registrarArtefato(
  raiz: string,
  caminhoAbsoluto: string,
  bytes: number,
  comprimirArquivo: boolean,
  registros?: number,
): Promise<ArtefatoPublicado> {
  const relativo = caminhoAbsoluto.slice(raiz.length + 1)
  const bytesGzip = comprimirArquivo ? await comprimir(caminhoAbsoluto) : undefined

  return {
    caminho: relativo,
    bytes,
    ...(bytesGzip !== undefined ? { bytesGzip } : {}),
    ...(registros !== undefined ? { registros } : {}),
  }
}

/** Caminho absoluto de um artefato dentro da raiz publicada. */
export function caminhoDe(raiz: string, relativo: string): string {
  return join(raiz, relativo)
}
