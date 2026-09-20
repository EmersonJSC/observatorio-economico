/**
 * Caixa 6 — motor: RAZÃO (divisão).
 *
 * ⚠️ FUNÇÃO PURA. Não lê arquivo, não escreve, não faz rede, não usa relógio.
 * Toda a matemática da Caixa 6 que envolve divisão vive aqui.
 *
 * Cobre per capita (receita ÷ população) e densidade (população ÷ área).
 *
 * As três guardas, na ordem em que são aplicadas:
 *   1. insumo ausente   → não há o que dividir
 *   2. valor inválido   → NaN/Infinity não propagam
 *   3. anos divergentes → a razão não é metodologicamente defensável
 *   4. divisor zero     → divisão indefinida
 *
 * A guarda de ANO vem antes da de ZERO de propósito: se os anos não batem, o
 * resultado seria inválido mesmo que o divisor fosse diferente de zero — e o
 * motivo precisa ser o metodológico, não o aritmético.
 */

import type { Insumo, ResultadoCalculo } from '../tipos.js'
import { semValor } from '../tipos.js'

/** Opções de um cálculo de razão. */
export interface OpcoesRazao {
  /**
   * Exige que numerador e divisor sejam do mesmo ano de referência.
   *
   * Quando `true` (o padrão para per capita), anos diferentes produzem
   * `ano-divergente`. Quando `false` (densidade), anos diferentes são
   * aceitos — a área territorial não tem ano de referência.
   */
  exigirMesmoAno: boolean
  /** Fator aplicado ao numerador (ex.: converter mil R$ em R$ → 1000). */
  fatorNumerador?: number
  /** Casas decimais do resultado. Padrão: 2. */
  casas?: number
}

/**
 * Calcula `numerador ÷ divisor`, com guardas metodológicas.
 *
 * @param numerador O insumo dividido (ex.: receita, população).
 * @param divisor O insumo que divide (ex.: população, área).
 * @param opcoes Guardas e formatação.
 */
export function calcularRazao(
  numerador: Insumo,
  divisor: Insumo,
  opcoes: OpcoesRazao,
): ResultadoCalculo {
  // 1. Insumo ausente.
  if (numerador.valor === null) {
    return semValor('insumo-ausente', `insumo "${numerador.nome}" não tem valor`)
  }
  if (divisor.valor === null) {
    return semValor('insumo-ausente', `insumo "${divisor.nome}" não tem valor`)
  }

  // 2. Valor inválido (NaN/Infinity não devem propagar).
  if (!Number.isFinite(numerador.valor)) {
    return semValor('valor-invalido', `insumo "${numerador.nome}" não é número finito`)
  }
  if (!Number.isFinite(divisor.valor)) {
    return semValor('valor-invalido', `insumo "${divisor.nome}" não é número finito`)
  }

  // 3. Guarda metodológica de ano.
  if (opcoes.exigirMesmoAno && numerador.ano !== divisor.ano) {
    return semValor(
      'ano-divergente',
      `"${numerador.nome}" é de ${numerador.ano} e "${divisor.nome}" é de ${divisor.ano}; ` +
        `a razão entre anos diferentes não é metodologicamente defensável`,
    )
  }

  // 4. Divisão por zero.
  if (divisor.valor === 0) {
    return semValor('divisor-zero', `insumo "${divisor.nome}" é zero`)
  }

  const fator = opcoes.fatorNumerador ?? 1
  const casas = opcoes.casas ?? 2
  const bruto = (numerador.valor * fator) / divisor.valor

  if (!Number.isFinite(bruto)) {
    return semValor('valor-invalido', 'o resultado da divisão não é um número finito')
  }

  return { ok: true, valor: Number(bruto.toFixed(casas)), ano: numerador.ano }
}

/**
 * Per capita: `valor ÷ população`, exigindo o mesmo ano.
 *
 * Estreita `calcularRazao` para o caso mais comum do projeto.
 */
export function calcularPerCapita(
  valor: Insumo,
  populacao: Insumo,
  opcoes: { fatorNumerador?: number; casas?: number } = {},
): ResultadoCalculo {
  return calcularRazao(valor, populacao, {
    exigirMesmoAno: true,
    ...(opcoes.fatorNumerador !== undefined ? { fatorNumerador: opcoes.fatorNumerador } : {}),
    ...(opcoes.casas !== undefined ? { casas: opcoes.casas } : {}),
  })
}

/**
 * Densidade: `população ÷ área`.
 *
 * A área territorial não tem ano de referência — a malha do IBGE é a vigente.
 * Por isso `exigirMesmoAno: false`: exigir paridade aqui bloquearia um cálculo
 * que é perfeitamente válido.
 */
export function calcularDensidade(
  populacao: Insumo,
  area: Insumo,
  opcoes: { casas?: number } = {},
): ResultadoCalculo {
  return calcularRazao(populacao, area, {
    exigirMesmoAno: false,
    ...(opcoes.casas !== undefined ? { casas: opcoes.casas } : {}),
  })
}
