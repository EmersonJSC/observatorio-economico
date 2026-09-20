/**
 * Caixa 3 — RAW: tipos.
 *
 * A Caixa 3 PERSISTE. Ela recebe o `ResultadoColeta` da Caixa 2 e grava os
 * bytes originais + a procedência, sem nunca interpretar o conteúdo.
 *
 *   FONTES   declara   (Caixa 1)
 *   COLETOR  executa   (Caixa 2) → entrega bytes + procedência
 *   RAW      preserva  (esta caixa) → grava bytes + procedência, deduplica por hash
 *
 * Ela é "cega": não faz parse, não lê campos, não valida esquema, não normaliza,
 * não concatena páginas e não calcula nada. Trata todo corpo como blob opaco.
 *
 * Referência: plano da Caixa 3 (endereçamento por conteúdo, manifesto
 * append-only e log de tentativas).
 */

// ---------------------------------------------------------------------------
// Versão da camada
// ---------------------------------------------------------------------------

/** Versão da Caixa 3, registrada em cada tentativa para rastreabilidade. */
export const VERSAO_RAW = '1.0.0'

// ---------------------------------------------------------------------------
// Resultado da persistência
// ---------------------------------------------------------------------------

/**
 * O que aconteceu com um resultado de coleta ao ser persistido.
 *
 *   - `gravado`     → bytes novos; objeto físico criado e manifesto atualizado
 *   - `deduplicado` → o hash já existia; NADA foi gravado em disco
 *   - `ignorado`    → `sem-dado` ou `falha`: não há bytes para gravar
 *   - `erro`        → falha de I/O ao gravar (a coleta em si não é invalidada)
 */
export type ResultadoPersistencia = 'gravado' | 'deduplicado' | 'ignorado' | 'erro'

// ---------------------------------------------------------------------------
// Manifesto
// ---------------------------------------------------------------------------

/** Um objeto já preservado no RAW. */
export interface RegistroObjeto {
  /** SHA-256 do conteúdo — é também o nome do arquivo. */
  hash: string
  /** Caminho relativo a `data/raw/`. */
  arquivo: string
  /** Extensão usada, incluindo o ponto (ex.: `.json`). */
  extensao: string
  /** Tamanho em bytes. */
  tamanho: number
  /** Formato declarado na Caixa 1 (ex.: `zip-csv`). */
  formato: string
  /** `content-type` da resposta, quando houve. */
  contentType?: string
  /** Página de origem, quando o resultado era paginado (1-based). */
  pagina?: number
  /** Quando este objeto foi gravado pela primeira vez. */
  gravadoEm: string
}

/**
 * Índice do que já foi preservado para um recurso.
 *
 * APPEND-ONLY: `objetos` só cresce, nunca perde entrada. Sem isso não haveria
 * como auditar o que já foi coletado.
 */
export interface Manifesto {
  fonteId: string
  recursoId: string
  /** Versão do formato do manifesto (para migração futura). */
  versao: number
  /** Primeira gravação deste manifesto. */
  criadoEm: string
  /** Última atualização. */
  atualizadoEm: string
  /** Todos os objetos preservados, sem repetição de hash. */
  objetos: RegistroObjeto[]
  /** Hash do último objeto gravado — atalho de deduplicação. */
  ultimoHash?: string
}

// ---------------------------------------------------------------------------
// Log de tentativas
// ---------------------------------------------------------------------------

/**
 * Registro de UMA tentativa de coleta, gravado em `tentativas.jsonl`.
 *
 * É gravado SEMPRE — em sucesso novo, sucesso deduplicado, sem-dado e falha.
 * É isto que distingue "a fonte não tinha o dado" de "a requisição caiu",
 * distinção que hoje não existe em lugar nenhum do projeto.
 */
export interface Tentativa {
  /** Instante do registro, em ISO 8601. */
  em: string
  fonteId: string
  recursoId: string
  /** Estado devolvido pela Caixa 2: `sucesso`, `sem-dado` ou `falha`. */
  estado: string
  /** O que a Caixa 3 fez com este resultado. */
  resultado: ResultadoPersistencia
  /** Hash do conteúdo, quando houve. */
  hash?: string
  /** Tamanho em bytes, quando houve. */
  tamanho?: number
  /** Motivo da falha na coleta, quando houver. */
  motivo?: string
  /** Mensagem de erro (da coleta ou do I/O). */
  mensagem?: string
  /** URL consultada. */
  url?: string
  /** Status HTTP, quando houve resposta. */
  status?: number
  /** Parâmetros de fan-out usados nesta chamada. */
  parametros: Readonly<Record<string, string>>
  /** Transporte efetivamente usado. */
  transporte: string
  /** Quantas tentativas a Caixa 2 precisou. */
  tentativasColeta: number
  /** Versão do coletor que produziu o resultado. */
  versaoColetor: string
  /** Versão da Caixa 3 que persistiu. */
  versaoRaw: string
}

// ---------------------------------------------------------------------------
// Entrada e saída
// ---------------------------------------------------------------------------

/** Opções de persistência. */
export interface OpcoesPersistencia {
  /** Raiz do RAW. Padrão: `<raiz do repo>/data/raw`. */
  raiz?: string
  /** Injetável para teste; padrão `new Date()`. */
  agora?: () => Date
}

/** O que a persistência de UM resultado produziu. */
export interface PersistenciaResultado {
  resultado: ResultadoPersistencia
  fonteId: string
  recursoId: string
  /** Objetos efetivamente gravados nesta chamada. Vazio quando deduplicado. */
  gravados: RegistroObjeto[]
  /** Todos os hashes vistos nesta chamada (gravados ou já existentes). */
  hashes: string[]
  /** Preenchido quando `resultado === 'erro'`. */
  mensagem?: string
}
