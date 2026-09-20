/**
 * Caixa 6 — catálogo declarativo de métricas.
 *
 * Aqui fica parametrizado QUAIS insumos cada cálculo exige e SE eles precisam
 * ser do mesmo ano. A regra metodológica é dado auditável, não comentário
 * perdido no meio do código — que era como o legado registrava o bloqueio.
 *
 * Exemplo do que este catálogo torna explícito:
 *   - `pib_per_capita` exige PIB e população do MESMO ano → funciona (2021/2021)
 *   - `receita_per_capita` exige receita e população do MESMO ano → BLOQUEADO
 *     (receita 2023, população 2024)
 *
 * Se um dia a população de 2023 for coletada, `receita_per_capita` passa a
 * calcular sozinho — sem alterar uma linha de código.
 */

import type { MetricaDeclarada } from '../tipos.js'

/** Nomes canônicos dos insumos. */
export const INSUMO = {
  POPULACAO: 'populacao',
  PIB: 'pib',
  PIB_MIL_REAIS: 'pibMilReais',
  RECEITA: 'receitaTotal',
  DESPESA: 'despesaTotal',
  AREA: 'areaKm2',
  SAUDE: 'gastoSaude',
  EDUCACAO: 'gastoEducacao',
} as const

/** Fator de conversão de milhares de reais para reais. */
export const MIL_REAIS_EM_REAIS = 1000

/**
 * Catálogo das métricas de MUNICÍPIO.
 *
 * `exigirMesmoAno: true` é a guarda metodológica: misturar anos produz
 * `ano-divergente` em vez de um número enganoso.
 */
export const METRICAS_MUNICIPIO: readonly MetricaDeclarada[] = [
  // --- valores diretos (sem transformação) -------------------------------
  {
    id: 'populacao',
    nome: 'População residente estimada',
    tipo: 'direto',
    insumos: [INSUMO.POPULACAO],
    unidade: 'habitantes',
    exigirMesmoAno: false,
    descricao: 'População estimada pelo IBGE para o município.',
  },
  {
    id: 'pib_mil_reais',
    nome: 'PIB a preços correntes (mil R$)',
    tipo: 'direto',
    insumos: [INSUMO.PIB_MIL_REAIS],
    unidade: 'mil R$',
    exigirMesmoAno: false,
    descricao: 'Valor bruto como publicado pelo IBGE, em milhares de reais.',
  },
  {
    id: 'pib_reais',
    nome: 'PIB a preços correntes (R$)',
    tipo: 'direto',
    insumos: [INSUMO.PIB_MIL_REAIS],
    unidade: 'R$',
    exigirMesmoAno: false,
    fatorNumerador: MIL_REAIS_EM_REAIS,
    descricao: 'PIB convertido de milhares para reais.',
  },
  {
    id: 'receita_total',
    nome: 'Receita orçamentária realizada',
    tipo: 'direto',
    insumos: [INSUMO.RECEITA],
    unidade: 'R$',
    exigirMesmoAno: false,
    descricao: 'Arrecadação total do exercício, conforme a DCA do Siconfi.',
  },
  {
    id: 'despesa_total',
    nome: 'Despesa orçamentária liquidada',
    tipo: 'direto',
    insumos: [INSUMO.DESPESA],
    unidade: 'R$',
    exigirMesmoAno: false,
    descricao: 'Total executado e liquidado no exercício.',
  },

  // --- razões ------------------------------------------------------------
  {
    id: 'pib_per_capita',
    nome: 'PIB por habitante',
    tipo: 'razao',
    insumos: [INSUMO.PIB_MIL_REAIS, INSUMO.POPULACAO],
    unidade: 'R$/habitante',
    exigirMesmoAno: true,
    fatorNumerador: MIL_REAIS_EM_REAIS,
    descricao:
      'PIB (mil R$) × 1000 ÷ população. Exige o MESMO ano nos dois insumos: ' +
      'hoje PIB 2021 e população 2021.',
  },
  {
    id: 'densidade',
    nome: 'Densidade demográfica',
    tipo: 'razao',
    insumos: [INSUMO.POPULACAO, INSUMO.AREA],
    unidade: 'hab/km²',
    // A área vem da malha vigente do IBGE e não tem ano de referência:
    // exigir paridade aqui bloquearia um cálculo perfeitamente válido.
    exigirMesmoAno: false,
    descricao: 'População ÷ área territorial (km²).',
  },
  {
    id: 'receita_per_capita',
    nome: 'Receita por habitante',
    tipo: 'razao',
    insumos: [INSUMO.RECEITA, INSUMO.POPULACAO],
    unidade: 'R$/habitante',
    exigirMesmoAno: true,
    descricao:
      'Receita realizada ÷ população. Exige o MESMO ano: hoje a receita é do ' +
      'exercício 2023 e a população disponível é de 2024, então o cálculo ' +
      'fica bloqueado com motivo "ano-divergente".',
  },
  {
    id: 'despesa_per_capita',
    nome: 'Despesa por habitante',
    tipo: 'razao',
    insumos: [INSUMO.DESPESA, INSUMO.POPULACAO],
    unidade: 'R$/habitante',
    exigirMesmoAno: true,
    descricao:
      'Despesa liquidada ÷ população. Mesmo bloqueio temporal da receita.',
  },
  {
    id: 'saude_per_capita',
    nome: 'Gasto em saúde por habitante',
    tipo: 'razao',
    insumos: [INSUMO.SAUDE, INSUMO.POPULACAO],
    unidade: 'R$/habitante',
    exigirMesmoAno: true,
    descricao: 'Gasto na função Saúde (10) ÷ população. Mesmo bloqueio temporal.',
  },
  {
    id: 'educacao_per_capita',
    nome: 'Gasto em educação por habitante',
    tipo: 'razao',
    insumos: [INSUMO.EDUCACAO, INSUMO.POPULACAO],
    unidade: 'R$/habitante',
    exigirMesmoAno: true,
    descricao: 'Gasto na função Educação (12) ÷ população. Mesmo bloqueio temporal.',
  },
]

/** Localiza uma métrica no catálogo. */
export function buscarMetrica(
  id: string,
  catalogo: readonly MetricaDeclarada[] = METRICAS_MUNICIPIO,
): MetricaDeclarada | undefined {
  return catalogo.find((m) => m.id === id)
}

/** Métricas que exigem paridade de ano entre insumos. */
export function metricasComGuardaDeAno(
  catalogo: readonly MetricaDeclarada[] = METRICAS_MUNICIPIO,
): MetricaDeclarada[] {
  return catalogo.filter((m) => m.exigirMesmoAno)
}
