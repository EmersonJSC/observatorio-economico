/**
 * Caixa 5 — RELACIONAMENTOS: tipos.
 *
 * A Caixa 5 resolve a "Torre de Babel" dos identificadores do governo: descobre
 * quando entidades de fontes diferentes são a MESMA coisa e registra o vínculo.
 *
 * Ela NÃO calcula indicador, NÃO agrega e NÃO soma. Responde apenas
 * "o X de uma fonte é o mesmo que o Y de outra".
 *
 * Fronteira de desempate: se a saída responde "qual o valor total", é CÁLCULOS.
 *
 * Referência: plano da Caixa 5.
 */

// ---------------------------------------------------------------------------
// Versão
// ---------------------------------------------------------------------------

/** Versão da Caixa 5, gravada nos metadados de cada ponte. */
export const VERSAO_RELACIONAMENTOS = '1.0.0'

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

/**
 * Como um vínculo foi estabelecido.
 *
 * O campo mais importante desta caixa: sem ele não dá para distinguir um
 * vínculo por código idêntico (confiança alta) de um por nome aproximado
 * (precisa de revisão). O legado não tinha essa distinção.
 */
export type MetodoMatch =
  | 'codigo-nativo' // o identificador da fonte JÁ é o codarea (Siconfi, Transparência)
  | 'nome-exato' // nome normalizado idêntico, dentro da mesma UF
  | 'excecao-auditada' // divergência histórica conhecida e revisada por humano
  | 'prefixo' // casamento aproximado (não implementado nesta etapa)

/** Quanta confiança merece o vínculo. */
export type Confianca = 'alta' | 'media' | 'revisada'

// ---------------------------------------------------------------------------
// Ponte
// ---------------------------------------------------------------------------

/** Como a entidade aparece em uma fonte específica. */
export interface OrigemNaFonte {
  /** Identificador usado por aquela fonte. */
  id: string
  /** Nome como a fonte escreve (preserva a grafia original). */
  nome?: string
  /** Como o vínculo foi feito para esta fonte. */
  metodo: MetodoMatch
}

/** Uma linha da ponte canônica de municípios. */
export interface PonteMunicipio {
  /** Chave mestra: código IBGE de 7 dígitos. */
  codarea: string
  /** Nome oficial do IBGE. */
  nome: string
  /** Sigla da UF. */
  ufSigla: string
  /** Código IBGE da UF (2 dígitos). */
  ufCodigo: string
  /** Como esta entidade aparece em cada fonte relacionada. */
  origens: {
    ibge: OrigemNaFonte
    tse?: OrigemNaFonte
  }
  /** Método do vínculo principal (o do TSE, quando existe). */
  metodoMatch: MetodoMatch
  confianca: Confianca
}

// ---------------------------------------------------------------------------
// Órfãos
// ---------------------------------------------------------------------------

/**
 * Por que uma entidade ficou sem par.
 *
 * Distinguir estes casos é o que faltava no legado, onde "sem match" era só um
 * `console.warn` e um órfão legítimo (Fernando de Noronha) era indistinguível
 * de um erro de casamento.
 */
export type ClasseOrfao =
  | 'ausente-na-fonte' // a entidade legitimamente não existe na outra fonte
  | 'nao-correspondido' // existe nas duas, mas o casamento falhou
  | 'ambiguo' // o casamento encontrou 2+ candidatos — não escolhemos sozinhos
  | 'orfao-de-fonte' // está em uma fonte e não na canônica

/** Uma entidade sem par, registrada para auditoria. */
export interface Orfao {
  /** De qual lado veio a entidade órfã. */
  lado: 'ibge' | 'tse'
  /** Identificador na fonte de origem. */
  id: string
  nome: string
  ufSigla: string
  classe: ClasseOrfao
  /** Explicação legível, para quem for revisar. */
  detalhe: string
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

/** Contagens da construção da ponte. */
export interface ContagensRelacionamento {
  /** Municípios do IBGE considerados (a base canônica). */
  municipiosIbge: number
  /** Unidades eleitorais distintas encontradas no TSE. */
  unidadesTse: number
  /** Vínculos estabelecidos por nome normalizado exato. */
  casados: number
  /** Vínculos por exceção auditada. */
  porExcecao: number
  /** Total de órfãos registrados. */
  orfaos: number
  /** Órfãos cuja causa exige revisão humana (`nao-correspondido` + `ambiguo`). */
  orfaosACorrigir: number
}

/** Metadados gravados em `relacionamentos.meta.json`. */
export interface MetadadosRelacionamento {
  versaoRelacionamentos: string
  construidoEm: string
  /** Hashes/versões das fontes consumidas, para detectar ponte desatualizada. */
  origens: {
    ibge: string
    tse: string
  }
  contagens: ContagensRelacionamento
  /** Fração de órfãos a corrigir sobre o total comparado. */
  taxaOrfaos: number
  limiarOrfaos: number
  avisos: readonly string[]
}

/** Resultado de construir a ponte. */
export interface ResultadoRelacionamento {
  ponte: string
  orfaos: string
  contagens: ContagensRelacionamento
  metadados: MetadadosRelacionamento
}

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/** Falha que ABORTA a construção da ponte. */
export class ErroRelacionamento extends Error {
  constructor(
    message: string,
    readonly motivo: 'fonte-ausente' | 'limiar-orfaos' | 'configuracao',
  ) {
    super(message)
    this.name = 'ErroRelacionamento'
  }
}

// ---------------------------------------------------------------------------
// Opções
// ---------------------------------------------------------------------------

/** Opções de construção da ponte. */
export interface OpcoesRelacionamento {
  /** Raiz dos JSONL da Caixa 4. Padrão: `<projeto>/data/organized`. */
  raizOrganizada?: string
  /** Raiz da saída. Padrão: `<projeto>/data/related`. */
  raizSaida?: string
  /**
   * Fração máxima de órfãos A CORRIGIR antes de abortar.
   * Padrão: 0.01 (1%), conforme diretriz aprovada.
   */
  limiarOrfaos?: number
  /** Injetável para teste; padrão `new Date()`. */
  agora?: () => Date
}
