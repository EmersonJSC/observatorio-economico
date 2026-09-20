/**
 * Caixa 6 — motor: SOMA e AGREGAÇÃO.
 *
 * ⚠️ FUNÇÕES PURAS. Sem I/O, sem relógio, sem estado global.
 *
 * Distinção que o motor precisa respeitar e que o legado já acertava em parte:
 *
 *   - métricas ADITIVAS (população, PIB, receita) podem ser somadas;
 *   - métricas RELATIVAS (per capita, densidade) NÃO podem — a média de
 *     densidades não significa nada. Para essas, a agregação correta é
 *     recalcular a razão sobre os totais.
 *
 * `somar` soma; `agregarPor` agrupa e soma; `mediaPonderada` existe para o caso
 * em que uma média é legítima (ponderada pela base).
 */

import type { MotivoNulo, ResultadoCalculo } from '../tipos.js'
import { semValor } from '../tipos.js'

/** Um valor com sua chave de agrupamento. */
export interface ValorAgrupavel<TChave extends string = string> {
  chave: TChave
  valor: number | null
}

/**
 * Soma uma lista de valores, ignorando ausentes.
 *
 * @returns `sem-dados` quando NENHUM valor contribuiu — que é diferente de
 *          somar zero. O legado devolvia `0` para "nenhum dado", o que
 *          poluía agregações com zeros falsos.
 */
export function somar(valores: readonly (number | null)[]): ResultadoCalculo {
  let total = 0
  let contribuicoes = 0

  for (const v of valores) {
    if (v === null || !Number.isFinite(v)) continue
    total += v
    contribuicoes++
  }

  if (contribuicoes === 0) {
    return semValor('sem-dados', 'nenhum valor contribuiu para a soma')
  }

  return { ok: true, valor: total }
}

/**
 * Soma com contagem de ausentes.
 *
 * Útil para agregações territoriais, em que saber quantos municípios NÃO
 * entraram na soma é tão importante quanto o total.
 */
export function somarComCobertura(valores: readonly (number | null)[]): {
  resultado: ResultadoCalculo
  contribuicoes: number
  ausentes: number
} {
  const presentes = valores.filter((v) => v !== null && Number.isFinite(v))
  return {
    resultado: somar(valores),
    contribuicoes: presentes.length,
    ausentes: valores.length - presentes.length,
  }
}

/** Resultado de um agrupamento. */
export interface GrupoAgregado<TChave extends string = string> {
  chave: TChave
  resultado: ResultadoCalculo
  contribuicoes: number
  ausentes: number
}

/**
 * Agrupa por chave e soma cada grupo.
 *
 * Ausentes não viram zero: um grupo sem nenhum valor válido devolve
 * `sem-dados` em vez de `0`.
 */
export function agregarPor<TChave extends string>(
  valores: readonly ValorAgrupavel<TChave>[],
): GrupoAgregado<TChave>[] {
  const porChave = new Map<TChave, (number | null)[]>()

  for (const { chave, valor } of valores) {
    const lista = porChave.get(chave)
    if (lista) lista.push(valor)
    else porChave.set(chave, [valor])
  }

  const grupos: GrupoAgregado<TChave>[] = []
  for (const [chave, lista] of porChave) {
    const { resultado, contribuicoes, ausentes } = somarComCobertura(lista)
    grupos.push({ chave, resultado, contribuicoes, ausentes })
  }

  return grupos
}

/**
 * Média ponderada.
 *
 * O peso é o que dá sentido à média: a densidade média de um estado deve ser
 * ponderada pela área (ou a média de PIB per capita, pela população), nunca
 * uma média simples das razões.
 *
 * @returns `sem-dados` quando nenhum par contribuiu; `divisor-zero` quando a
 *          soma dos pesos é zero.
 */
export function mediaPonderada(
  pares: readonly { valor: number | null; peso: number | null }[],
): ResultadoCalculo {
  let somaPonderada = 0
  let somaPesos = 0
  let contribuicoes = 0

  for (const { valor, peso } of pares) {
    if (valor === null || peso === null) continue
    if (!Number.isFinite(valor) || !Number.isFinite(peso)) continue
    somaPonderada += valor * peso
    somaPesos += peso
    contribuicoes++
  }

  if (contribuicoes === 0) {
    return semValor('sem-dados', 'nenhum par valor/peso contribuiu')
  }
  if (somaPesos === 0) {
    return semValor('divisor-zero', 'a soma dos pesos é zero')
  }

  return { ok: true, valor: Number((somaPonderada / somaPesos).toFixed(2)) }
}

/** Conta quantos valores estão presentes (não nulos e finitos). */
export function contarPresentes(valores: readonly (number | null)[]): number {
  return valores.filter((v) => v !== null && Number.isFinite(v)).length
}

/** Resumo de motivos, para os metadados de cobertura. */
export function resumirMotivos(
  motivos: readonly (MotivoNulo | undefined)[],
): Partial<Record<MotivoNulo, number>> {
  const resumo: Partial<Record<MotivoNulo, number>> = {}
  for (const m of motivos) {
    if (m === undefined) continue
    resumo[m] = (resumo[m] ?? 0) + 1
  }
  return resumo
}
