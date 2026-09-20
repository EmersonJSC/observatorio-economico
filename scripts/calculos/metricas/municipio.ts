/**
 * Caixa 6 — aplicação das métricas por município.
 *
 * Liga o catálogo declarativo aos motores puros. Este módulo é onde a regra do
 * catálogo (`exigirMesmoAno`) encontra a implementação (`calcularRazao`).
 *
 * Não faz I/O: recebe os insumos já carregados e devolve os valores calculados.
 */

import { calcularPerCapita, calcularRazao } from '../motores/razao.js'
import type { InsumosMunicipio } from '../insumos.js'
import type { Insumo, MotivoNulo, ResultadoCalculo, ValorCalculado } from '../tipos.js'
import { METRICAS_MUNICIPIO, MIL_REAIS_EM_REAIS } from './catalogo.js'
import type { MetricaDeclarada } from '../tipos.js'

/** Converte o insumo de um município para o formato do motor. */
function paraInsumo(
  nome: string,
  dado: { valor: number | null; ano: number },
  unidade?: string,
): Insumo {
  return unidade !== undefined
    ? { nome, valor: dado.valor, ano: dado.ano, unidade }
    : { nome, valor: dado.valor, ano: dado.ano }
}

/**
 * Resolve um `ResultadoCalculo` no formato de saída.
 *
 * Aqui o motivo estruturado vira dado gravável — é o que permite auditar depois
 * por que uma métrica está vazia.
 */
function paraValor(r: ResultadoCalculo): ValorCalculado {
  if (r.ok) return { valor: r.valor, ano: r.ano ?? null }
  return { valor: null, ano: null, motivo: r.motivo, detalhe: r.detalhe }
}

/** Todos os valores calculados para um município, por id de métrica. */
export type ValoresMunicipio = Record<string, ValorCalculado>

/**
 * Aplica o catálogo de métricas a um município.
 *
 * Métricas são independentes: a falha de uma não impede as outras.
 */
export function calcularMetricasMunicipio(
  insumos: InsumosMunicipio,
  catalogo: readonly MetricaDeclarada[] = METRICAS_MUNICIPIO,
): ValoresMunicipio {
  const valores: ValoresMunicipio = {}

  for (const metrica of catalogo) {
    valores[metrica.id] = aplicarMetrica(metrica, insumos)
  }

  return valores
}

/** Aplica UMA métrica declarada. */
export function aplicarMetrica(
  metrica: MetricaDeclarada,
  insumos: InsumosMunicipio,
): ValorCalculado {
  switch (metrica.tipo) {
    case 'direto': {
      const dado = lerInsumo(metrica.insumos[0] ?? '', insumos)
      if (!dado) {
        return {
          valor: null,
          ano: null,
          motivo: 'insumo-ausente',
          detalhe: `insumo "${metrica.insumos[0]}" desconhecido`,
        }
      }
      const fator = metrica.fatorNumerador ?? 1
      const valor = dado.valor === null ? null : Number((dado.valor * fator).toFixed(2))
      return { valor, ano: dado.ano }
    }

    case 'razao': {
      const primeiro = metrica.insumos[0]
      const segundo = metrica.insumos[1]
      if (!primeiro || !segundo) {
        return {
          valor: null,
          ano: null,
          motivo: 'insumo-ausente',
          detalhe: `métrica "${metrica.id}" precisa de dois insumos`,
        }
      }

      const numerador = lerInsumo(primeiro, insumos)
      const divisor = lerInsumo(segundo, insumos)
      if (!numerador || !divisor) {
        return {
          valor: null,
          ano: null,
          motivo: 'insumo-ausente',
          detalhe: `insumo desconhecido em "${metrica.id}"`,
        }
      }

      // A guarda de ano vem do CATÁLOGO, não de código espalhado.
      const opcoes = {
        exigirMesmoAno: metrica.exigirMesmoAno,
        ...(metrica.fatorNumerador !== undefined
          ? { fatorNumerador: metrica.fatorNumerador }
          : {}),
      }

      return paraValor(
        calcularRazao(
          paraInsumo(primeiro, numerador),
          paraInsumo(segundo, divisor),
          opcoes,
        ),
      )
    }

    case 'soma': {
      let total = 0
      let contribuicoes = 0
      let ano = 0

      for (const id of metrica.insumos) {
        const dado = lerInsumo(id, insumos)
        if (!dado || dado.valor === null) continue
        total += dado.valor
        contribuicoes++
        if (dado.ano > ano) ano = dado.ano
      }

      if (contribuicoes === 0) {
        return {
          valor: null,
          ano: null,
          motivo: 'sem-dados',
          detalhe: `nenhum insumo de "${metrica.id}" tinha valor`,
        }
      }
      return { valor: Number(total.toFixed(2)), ano: ano === 0 ? null : ano }
    }

    default: {
      // Chegamos aqui apenas se o catálogo declarar um tipo não implementado.
      // Falhar alto com o tipo desconhecido é melhor que devolver null mudo.
      const tipoDesconhecido: string = String((metrica as { tipo?: unknown }).tipo)
      return {
        valor: null,
        ano: null,
        motivo: 'valor-invalido',
        detalhe: `tipo de métrica não implementado: ${tipoDesconhecido}`,
      }
    }
  }
}

/** Lê o insumo de um município pelo nome canônico. */
function lerInsumo(
  nome: string,
  insumos: InsumosMunicipio,
): { valor: number | null; ano: number } | undefined {
  switch (nome) {
    case 'populacao':
      return insumos.populacao
    case 'pibMilReais':
      return insumos.pibMilReais
    case 'pib':
      return insumos.pibMilReais
    case 'areaKm2':
      return insumos.areaKm2
    case 'receitaTotal':
      return insumos.receitaTotal
    case 'despesaTotal':
      return insumos.despesaTotal
    case 'gastoSaude':
      return insumos.gastoSaude
    case 'gastoEducacao':
      return insumos.gastoEducacao
    default:
      return undefined
  }
}

/** Exportado para teste: fator de conversão de milhares para reais. */
export { MIL_REAIS_EM_REAIS }

/** Métricas que dependem de área — usadas para explicar cobertura parcial. */
export function metricasDependentesDeArea(
  catalogo: readonly MetricaDeclarada[] = METRICAS_MUNICIPIO,
): MetricaDeclarada[] {
  return catalogo.filter((m) => m.insumos.includes('areaKm2'))
}

/** Exportado para a montagem dos metadados. */
export type { MotivoNulo }
