/**
 * Caixa 3 — RAW: resolução de caminhos.
 *
 * Centraliza TODA a convenção de diretórios do RAW. Nenhum outro módulo monta
 * caminho à mão.
 *
 * Estrutura:
 *
 *   data/raw/
 *   └── <fonteId>/
 *       └── <recursoId>/
 *           ├── objetos/
 *           │   └── <sha256>.<ext>     ← conteúdo endereçado por hash
 *           ├── manifest.json          ← índice append-only do recurso
 *           └── tentativas.jsonl       ← log append-only de toda coleta
 *
 * Por que `objetos/<sha256>.<ext>`: o nome É o hash, o que torna a
 * imutabilidade estrutural (conteúdo diferente nunca colide no mesmo nome) e a
 * deduplicação nativa (o mesmo conteúdo nunca ocupa dois arquivos).
 *
 * Os parâmetros de fan-out NÃO entram no caminho: `siconfi/dca` com 5.570 entes
 * criaria 5.570 diretórios. Eles ficam nos metadados, que é onde pertencem.
 *
 * Este módulo é puro: não toca o disco.
 */

import { join } from 'node:path'

/** Diretório de objetos dentro do recurso. */
export const DIR_OBJETOS = 'objetos'
/** Nome do manifesto do recurso. */
export const ARQUIVO_MANIFESTO = 'manifest.json'
/** Nome do log de tentativas do recurso. */
export const ARQUIVO_TENTATIVAS = 'tentativas.jsonl'
/** Sufixo usado na gravação atômica antes do rename. */
export const SUFIXO_TEMPORARIO = '.tmp'

/**
 * Valida um identificador usado em caminho.
 *
 * Protege contra `../` e separadores vindos de dados: `fonteId` e `recursoId`
 * vêm do catálogo, mas nunca custa garantir que não escapam da raiz.
 */
export function idSeguro(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
}

/** Raiz do RAW. */
export function raizRaw(raizProjeto: string): string {
  return join(raizProjeto, 'data', 'raw')
}

/** Diretório do recurso: `data/raw/<fonteId>/<recursoId>/`. */
export function dirRecurso(raiz: string, fonteId: string, recursoId: string): string {
  return join(raiz, fonteId, recursoId)
}

/** Diretório de objetos: `data/raw/<fonteId>/<recursoId>/objetos/`. */
export function dirObjetos(raiz: string, fonteId: string, recursoId: string): string {
  return join(dirRecurso(raiz, fonteId, recursoId), DIR_OBJETOS)
}

/** Caminho absoluto do manifesto. */
export function caminhoManifesto(raiz: string, fonteId: string, recursoId: string): string {
  return join(dirRecurso(raiz, fonteId, recursoId), ARQUIVO_MANIFESTO)
}

/** Caminho absoluto do log de tentativas. */
export function caminhoTentativas(raiz: string, fonteId: string, recursoId: string): string {
  return join(dirRecurso(raiz, fonteId, recursoId), ARQUIVO_TENTATIVAS)
}

/** Nome do objeto: `<sha256><extensao>`. */
export function nomeObjeto(hash: string, extensao: string): string {
  return `${hash}${extensao}`
}

/** Caminho absoluto de um objeto. */
export function caminhoObjeto(
  raiz: string,
  fonteId: string,
  recursoId: string,
  hash: string,
  extensao: string,
): string {
  return join(dirObjetos(raiz, fonteId, recursoId), nomeObjeto(hash, extensao))
}

/** Caminho temporário usado antes do rename atômico. */
export function caminhoTemporario(caminhoFinal: string): string {
  return `${caminhoFinal}${SUFIXO_TEMPORARIO}`
}

/**
 * Caminho do objeto relativo à raiz do RAW.
 *
 * É o que vai no manifesto: relativo, para que o RAW possa ser movido de lugar.
 */
export function caminhoRelativo(fonteId: string, recursoId: string, nome: string): string {
  return [fonteId, recursoId, DIR_OBJETOS, nome].join('/')
}
