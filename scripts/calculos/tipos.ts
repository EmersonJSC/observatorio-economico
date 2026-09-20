/**
 * Caixa 6 — CÁLCULOS: tipos.
 *
 * A Caixa 6 aplica as regras analíticas: agregação, agrupamento, somatório e
 * razão entre métricas. Ela NÃO decide como o dado é servido para a web (Caixa 7).
 *
 * Princípio central: **todo valor nulo tem um motivo**. O legado devolvia `null`
 * para quatro situações diferentes (insumo ausente, divisão por zero, anos
 * divergentes, dado inválido) sem distinguir nenhuma — o que tornava impossível
 * auditar por que uma métrica estava vazia.
 *
 * Referência: plano da Caixa 6.
 */

// ---------------------------------------------------------------------------
// Versão
// ---------------------------------------------------------------------------

/** Versão da Caixa 6, gravada nos metadados. */
export const VERSAO_CALCULOS = '1.0.0'

// ---------------------------------------------------------------------------
// Motivos de nulo
// ---------------------------------------------------------------------------

/**
 * Por que um cálculo não produziu valor.
 *
 * A distinção entre `ano-divergente` e `insumo-ausente` é metodológica, não
 * técnica: o primeiro significa "os dados existem mas não podem ser combinados";
 * o segundo, "falta o dado".
 */
export type MotivoNulo =
  /** Falta um dos insumos necessários. */
  | 'insumo-ausente'
  /** O divisor é zero — divisão indefinida. */
  | 'divisor-zero'
  /**
   * Os insumos existem, mas são de anos diferentes e a razão não é
   * metodologicamente defensável. Ex.: receita 2023 ÷ população 2024.
   */
  | 'ano-divergente'
  /** O valor do insumo não é um número finito. */
  | 'valor-invalido'
  /** Nenhuma unidade contribuiu para a agregação. */
  | 'sem-dados'

// ---------------------------------------------------------------------------
// Resultado de cálculo
// ---------------------------------------------------------------------------

/**
 * O resultado de um cálculo: ou tem valor, ou tem motivo.
 *
 * União discriminada de propósito — torna impossível ler `.valor` sem antes
 * verificar que o cálculo deu certo, o que é exatamente o que queremos.
 */
export type ResultadoCalculo =
  | {
      ok: true
      valor: number | null
      /** Ano de referência do resultado, quando aplicável. */
      ano?: number
    }
  | { ok: false; motivo: MotivoNulo; detalhe: string }

/** Constrói um resultado com valor. */
export function comValor(valor: number | null, ano?: number): ResultadoCalculo {
  return ano !== undefined ? { ok: true, valor, ano } : { ok: true, valor }
}

/** Constrói um resultado nulo com motivo. */
export function semValor(motivo: MotivoNulo, detalhe: string): ResultadoCalculo {
  return { ok: false, motivo, detalhe }
}

// ---------------------------------------------------------------------------
// Insumos
// ---------------------------------------------------------------------------

/**
 * Um insumo numérico com seu ano de referência.
 *
 * O ano é obrigatório porque é ele que permite a guarda metodológica: sem
 * comparar anos, não há como recusar uma divisão indefensável.
 */
export interface Insumo {
  valor: number | null
  ano: number
  /** Nome do insumo, usado nas mensagens de motivo. */
  nome: string
  /** Unidade original, quando conhecida (ex.: `mil R$`). */
  unidade?: string
}

/** Cria um insumo. */
export function insumo(nome: string, valor: number | null, ano: number, unidade?: string): Insumo {
  return unidade !== undefined ? { nome, valor, ano, unidade } : { nome, valor, ano }
}

// ---------------------------------------------------------------------------
// Catálogo de métricas
// ---------------------------------------------------------------------------

/** Como uma métrica é derivada. */
export type TipoMetrica =
  /** Razão entre dois insumos (per capita, densidade). */
  | 'razao'
  /** Soma de insumos (total agregado). */
  | 'soma'
  /** Valor direto, sem transformação. */
  | 'direto'

/** Declaração de uma métrica no catálogo. */
export interface MetricaDeclarada {
  id: string
  nome: string
  tipo: TipoMetrica
  /** Ids dos insumos exigidos, na ordem esperada pelo motor. */
  insumos: readonly string[]
  unidade: string
  /**
   * Exige que TODOS os insumos sejam do mesmo ano.
   *
   * É a guarda metodológica: `true` faz o cálculo devolver `ano-divergente` em
   * vez de misturar anos. Fica no catálogo (declarativo) e não no motor, para
   * que a regra seja auditável sem ler código.
   */
  exigirMesmoAno: boolean
  /** Fator aplicado ao numerador, quando a unidade de origem difere. */
  fatorNumerador?: number
  descricao: string
}

/** Um valor calculado, com procedência. */
export interface ValorCalculado {
  valor: number | null
  ano: number | null
  motivo?: MotivoNulo
  detalhe?: string
}

// ---------------------------------------------------------------------------
// Metadados
// ---------------------------------------------------------------------------

/** Cobertura de uma métrica entre as entidades calculadas. */
export interface CoberturaMetrica {
  metricaId: string
  nome: string
  unidade: string
  /** Entidades com valor calculado. */
  comValor: number
  /** Entidades sem valor, por motivo. */
  porMotivo: Partial<Record<MotivoNulo, number>>
}

/** Metadados gravados em `calculos.meta.json`. */
export interface MetadadosCalculos {
  versaoCalculos: string
  calculadoEm: string
  /** Anos de referência de cada insumo consumido. */
  anosInsumos: Readonly<Record<string, number>>
  /** Catálogo de métricas aplicado, para auditoria da regra. */
  metricas: readonly MetricaDeclarada[]
  contagens: {
    municipios: number
  }
  cobertura: readonly CoberturaMetrica[]
  /** Bloqueios metodológicos ativos, em texto legível. */
  bloqueios: readonly string[]
  avisos: readonly string[]
  /** Agregações derivadas de bases volumosas, quando executadas. */
  agregacoes?: {
    tseCandidatos: {
      municipios: number
      candidatos: number
      /** Linhas cuja unidade eleitoral não estava na ponte da Caixa 5. */
      naoVinculados: number
      saida: string
    }
  }
}

/** Resultado da execução da Caixa 6. */
export interface ResultadoCalculos {
  saida: string
  contagens: { municipios: number }
  cobertura: readonly CoberturaMetrica[]
  metadados: MetadadosCalculos
}

// ---------------------------------------------------------------------------
// Erros e opções
// ---------------------------------------------------------------------------

/** Falha que impede o cálculo. */
export class ErroCalculo extends Error {
  constructor(
    message: string,
    readonly motivo: 'insumo-ausente' | 'configuracao',
  ) {
    super(message)
    this.name = 'ErroCalculo'
  }
}

/** Opções de execução. */
export interface OpcoesCalculos {
  /** Raiz do organizado (Caixa 4). Padrão: `<projeto>/data/organized`. */
  raizOrganizada?: string
  /** Raiz da ponte (Caixa 5). Padrão: `<projeto>/data/related`. */
  raizRelacionada?: string
  /** Raiz da saída. Padrão: `<projeto>/data/calculated`. */
  raizSaida?: string
  /** Injetável para teste; padrão `new Date()`. */
  agora?: () => Date
}
