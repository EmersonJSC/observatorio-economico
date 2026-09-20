/**
 * Caixa 3 — RAW: persistência.
 *
 * Recebe um `ResultadoColeta` da Caixa 2 e grava bytes + procedência.
 *
 * Regras aplicadas (todas verificadas em `raw.test.ts`):
 *
 *   R1  Só `sucesso` grava bytes; `sem-dado` e `falha` apenas registram tentativa.
 *   R2  O nome do arquivo é o hash: `<sha256>.<ext>`.
 *   R3  Extensão vem do `formato` (Caixa 1), com `content-type` como desempate.
 *   R4  Resultado paginado grava UM objeto por página. Nunca concatena.
 *   R5  Deduplicação por hash: se já existe, nada é gravado — mas a tentativa
 *       é registrada mesmo assim. Objeto que está no disco mas não no manifesto
 *       (execução interrompida entre a gravação e o manifesto) é RECUPERADO:
 *       entra no manifesto sem ser regravado.
 *   R6  Gravação atômica: escreve `.tmp` e renomeia no fim.
 *   R7  Imutabilidade: objeto existente nunca é sobrescrito nem removido.
 *   R8  Manifesto append-only: `objetos` só cresce.
 *   R9  Falha de I/O não lança para o chamador: vira `resultado: 'erro'`.
 *   R10 A caixa é CEGA: nunca abre o arquivo nem interpreta o conteúdo.
 */

import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'

import { buscarRecurso } from '../fontes/catalogo.js'
import type { Formato } from '../fontes/tipos.js'
import type { ResultadoColeta } from '../coletor/tipos.js'
import {
  caminhoManifesto,
  caminhoObjeto,
  caminhoRelativo,
  caminhoTemporario,
  caminhoTentativas,
  dirObjetos,
  idSeguro,
  nomeObjeto,
} from './caminhos.js'
import { resolverExtensao } from './extensoes.js'
import type {
  Manifesto,
  OpcoesPersistencia,
  PersistenciaResultado,
  RegistroObjeto,
  ResultadoPersistencia,
  Tentativa,
} from './tipos.js'
import { VERSAO_RAW } from './tipos.js'

/** Versão do formato do manifesto. */
const VERSAO_MANIFESTO = 1

// ---------------------------------------------------------------------------
// Manifesto
// ---------------------------------------------------------------------------

/** Lê o manifesto do recurso, ou devolve um vazio quando não existe. */
async function lerManifesto(
  raiz: string,
  fonteId: string,
  recursoId: string,
  agora: string,
): Promise<Manifesto> {
  try {
    const conteudo = await readFile(caminhoManifesto(raiz, fonteId, recursoId), 'utf-8')
    const lido = JSON.parse(conteudo) as Manifesto
    // Manifesto de formato desconhecido não deve quebrar a persistência.
    if (!Array.isArray(lido.objetos)) throw new Error('manifesto sem lista de objetos')
    return lido
  } catch {
    return {
      fonteId,
      recursoId,
      versao: VERSAO_MANIFESTO,
      criadoEm: agora,
      atualizadoEm: agora,
      objetos: [],
    }
  }
}

/** Grava o manifesto de forma atômica. */
async function gravarManifesto(raiz: string, manifesto: Manifesto): Promise<void> {
  const destino = caminhoManifesto(raiz, manifesto.fonteId, manifesto.recursoId)
  const temporario = caminhoTemporario(destino)
  await writeFile(temporario, `${JSON.stringify(manifesto, null, 2)}\n`, 'utf-8')
  await rename(temporario, destino)
}

// ---------------------------------------------------------------------------
// Log de tentativas (append-only)
// ---------------------------------------------------------------------------

/**
 * Anexa UMA linha ao `tentativas.jsonl`.
 *
 * Chamado SEMPRE — em sucesso novo, sucesso deduplicado, sem-dado e falha.
 * É o que preserva o histórico de execução mesmo quando o objeto é deduplicado,
 * e o que distingue "a fonte não tinha o dado" de "a requisição caiu".
 */
async function anexarTentativa(
  raiz: string,
  fonteId: string,
  recursoId: string,
  tentativa: Tentativa,
): Promise<void> {
  await mkdir(dirObjetos(raiz, fonteId, recursoId), { recursive: true })
  const destino = caminhoTentativas(raiz, fonteId, recursoId)
  await appendFile(destino, `${JSON.stringify(tentativa)}\n`, 'utf-8')
}

// ---------------------------------------------------------------------------
// Objetos
// ---------------------------------------------------------------------------

/** `true` quando o objeto já existe e não está vazio. */
async function objetoExiste(caminho: string): Promise<boolean> {
  try {
    const info = await stat(caminho)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

/**
 * Grava um objeto de forma ATÔMICA (R6).
 *
 * Escreve em `<hash>.<ext>.tmp` e renomeia ao final. Um processo interrompido
 * no meio deixa apenas um `.tmp`, nunca um objeto parcial com nome de hash
 * válido — exatamente a falha que hoje passa pela validação `PK` do scraper.
 */
async function gravarObjetoAtomico(caminhoFinal: string, bytes: Uint8Array): Promise<void> {
  const temporario = caminhoTemporario(caminhoFinal)
  await writeFile(temporario, bytes)
  await rename(temporario, caminhoFinal)
}

// ---------------------------------------------------------------------------
// Extração dos corpos
// ---------------------------------------------------------------------------

/** Um corpo a preservar, com sua origem. */
interface CorpoAGravar {
  bytes: Uint8Array
  hash: string
  pagina?: number
}

/**
 * Extrai os corpos de um resultado, sem interpretar nada (R4).
 *
 * Quando o resultado é paginado, cada página vira um objeto próprio — os bytes
 * NUNCA são concatenados (concatenar seria transformar).
 */
function corposDe(resultado: ResultadoColeta): CorpoAGravar[] {
  if (resultado.paginas && resultado.paginas.length > 0) {
    return resultado.paginas
      .filter((p) => p.bytes.byteLength > 0)
      .map((p) => ({ bytes: p.bytes, hash: p.hash, pagina: p.pagina }))
  }
  if (resultado.bytes && resultado.bytes.byteLength > 0 && resultado.hash) {
    return [{ bytes: resultado.bytes, hash: resultado.hash }]
  }
  return []
}

/** Resolve o `formato` declarado na Caixa 1 para o recurso desta coleta. */
function formatoDoRecurso(fonteId: string, recursoId: string): Formato | undefined {
  return buscarRecurso(fonteId, recursoId)?.formato
}

// ---------------------------------------------------------------------------
// Tentativa
// ---------------------------------------------------------------------------

/** Monta o registro de tentativa a partir do resultado da coleta. */
function montarTentativa(
  resultado: ResultadoColeta,
  resultadoPersistencia: ResultadoPersistencia,
  em: string,
  extras: Partial<Tentativa> = {},
): Tentativa {
  const p = resultado.procedencia
  return {
    em,
    fonteId: p.fonteId,
    recursoId: p.recursoId,
    estado: resultado.estado,
    resultado: resultadoPersistencia,
    parametros: p.parametros,
    transporte: p.transporte,
    tentativasColeta: p.tentativas,
    versaoColetor: p.versaoColetor,
    versaoRaw: VERSAO_RAW,
    ...(resultado.hash !== undefined ? { hash: resultado.hash } : {}),
    ...(resultado.tamanho !== undefined ? { tamanho: resultado.tamanho } : {}),
    ...(resultado.motivo !== undefined ? { motivo: resultado.motivo } : {}),
    ...(resultado.mensagem !== undefined ? { mensagem: resultado.mensagem } : {}),
    ...(p.url !== undefined ? { url: p.url } : {}),
    ...(p.status !== undefined ? { status: p.status } : {}),
    ...extras,
  }
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/**
 * Persiste UM resultado de coleta.
 *
 * Não lança por falha de I/O: devolve `resultado: 'erro'` com a mensagem, para
 * que uma falha de disco em um recurso não invalide os outros (R9).
 *
 * @param raiz Raiz do RAW (normalmente `data/raw`).
 */
export async function persistirResultado(
  raiz: string,
  resultado: ResultadoColeta,
  opcoes: OpcoesPersistencia = {},
): Promise<PersistenciaResultado> {
  const agora = (opcoes.agora ?? (() => new Date()))().toISOString()
  const { fonteId, recursoId } = resultado.procedencia

  const base = { fonteId, recursoId, gravados: [] as RegistroObjeto[], hashes: [] as string[] }

  // Guarda contra identificadores que escapariam da raiz do RAW.
  if (!idSeguro(fonteId) || !idSeguro(recursoId)) {
    return {
      ...base,
      resultado: 'erro',
      mensagem: `identificador inválido para caminho: ${fonteId}/${recursoId}`,
    }
  }

  const corpos = corposDe(resultado)

  // R1 — sem bytes: apenas registra a tentativa; não cria manifesto.
  if (corpos.length === 0) {
    try {
      await anexarTentativa(raiz, fonteId, recursoId, montarTentativa(resultado, 'ignorado', agora))
      return { ...base, resultado: 'ignorado' }
    } catch (err) {
      return {
        ...base,
        resultado: 'erro',
        mensagem: err instanceof Error ? err.message : String(err),
      }
    }
  }

  try {
    const contentType = resultado.procedencia.headers?.contentType
    const formato = formatoDoRecurso(fonteId, recursoId)
    const extensao = resolverExtensao(formato ?? 'json', contentType)

    await mkdir(dirObjetos(raiz, fonteId, recursoId), { recursive: true })
    const manifesto = await lerManifesto(raiz, fonteId, recursoId, agora)
    const hashesConhecidos = new Set(manifesto.objetos.map((o) => o.hash))

    const gravados: RegistroObjeto[] = []
    const hashes: string[] = []

    for (const corpo of corpos) {
      hashes.push(corpo.hash)

      const destino = caminhoObjeto(raiz, fonteId, recursoId, corpo.hash, extensao)

      // Já registrado no manifesto: nada a fazer.
      if (hashesConhecidos.has(corpo.hash)) continue

      // O objeto existe no disco mas NÃO está no manifesto. Isso acontece
      // quando uma execução grava o objeto e é interrompida antes de atualizar
      // o manifesto (a gravação é atômica, o manifesto não é transacional com
      // ela).
      //
      // Não basta pular: o manifesto é a fonte de verdade que as caixas
      // seguintes leem — `dca.jsonl` da Caixa 4, por exemplo, itera sobre os
      // objetos do manifesto. Um objeto órfão no disco seria invisível para
      // todo o pipeline, e a coleta pareceria completa sem estar.
      //
      // Aqui RECUPERAMOS o órfão: registramos no manifesto o que já está no
      // disco, em vez de gravá-lo de novo (R7 — objeto existente nunca é
      // sobrescrito).
      if (await objetoExiste(destino)) {
        const info = await stat(destino)
        gravados.push({
          hash: corpo.hash,
          arquivo: caminhoRelativo(fonteId, recursoId, nomeObjeto(corpo.hash, extensao)),
          extensao,
          tamanho: info.size,
          formato: formato ?? 'desconhecido',
          ...(contentType !== undefined ? { contentType } : {}),
          ...(corpo.pagina !== undefined ? { pagina: corpo.pagina } : {}),
          gravadoEm: agora,
        })
        hashesConhecidos.add(corpo.hash)
        continue
      }

      // R6 / R7 — gravação atômica; objeto existente nunca é sobrescrito.
      await gravarObjetoAtomico(destino, corpo.bytes)

      gravados.push({
        hash: corpo.hash,
        arquivo: caminhoRelativo(fonteId, recursoId, nomeObjeto(corpo.hash, extensao)),
        extensao,
        tamanho: corpo.bytes.byteLength,
        formato: formato ?? 'desconhecido',
        ...(contentType !== undefined ? { contentType } : {}),
        ...(corpo.pagina !== undefined ? { pagina: corpo.pagina } : {}),
        gravadoEm: agora,
      })
      hashesConhecidos.add(corpo.hash)
    }

    const deduplicado = gravados.length === 0

    // R8 — manifesto append-only, só quando houve gravação nova.
    if (!deduplicado) {
      await gravarManifesto(raiz, {
        ...manifesto,
        atualizadoEm: agora,
        objetos: [...manifesto.objetos, ...gravados],
        ultimoHash: gravados[gravados.length - 1]!.hash,
      })
    }

    // Registra a tentativa SEMPRE, inclusive quando deduplicado (R5).
    await anexarTentativa(
      raiz,
      fonteId,
      recursoId,
      montarTentativa(resultado, deduplicado ? 'deduplicado' : 'gravado', agora, {
        hash: hashes[0] ?? '',
      }),
    )

    return {
      ...base,
      resultado: deduplicado ? 'deduplicado' : 'gravado',
      gravados,
      hashes,
    }
  } catch (err) {
    // R9 — falha de I/O não invalida a coleta; vira estado de erro.
    return {
      ...base,
      resultado: 'erro',
      mensagem: err instanceof Error ? err.message : String(err),
    }
  }
}
