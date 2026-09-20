/**
 * Caixa 6 — motores puros: verificação.
 *
 * ⚠️ TESTES PUROS. Nenhum disco, nenhuma rede, nenhum arquivo temporário.
 * Testam exclusivamente a matemática e as guardas metodológicas.
 *
 * Uso:
 *   npx tsx --test scripts/calculos/motores.test.ts
 *   npm run test:calculos
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { calcularDensidade, calcularPerCapita, calcularRazao } from './motores/razao.js'
import {
  agregarPor,
  contarPresentes,
  mediaPonderada,
  resumirMotivos,
  somar,
  somarComCobertura,
} from './motores/soma.js'
import { insumo } from './tipos.js'

// ---------------------------------------------------------------------------
// 1. Razão — caminho feliz
// ---------------------------------------------------------------------------

test('razao: calcula per capita com anos iguais', () => {
  // PIB 2021 em mil R$ = 1.000.000 → R$ 1.000.000.000 ÷ 10.000 hab = 100.000
  const r = calcularPerCapita(
    insumo('pib', 1_000_000, 2021, 'mil R$'),
    insumo('populacao', 10_000, 2021),
    { fatorNumerador: 1000 },
  )
  assert.equal(r.ok, true)
  assert.equal(r.ok ? r.valor : null, 100_000)
  assert.equal(r.ok ? r.ano : null, 2021)
})

test('razao: arredonda para 2 casas por padrão', () => {
  const r = calcularPerCapita(insumo('v', 10, 2024), insumo('p', 3, 2024))
  assert.equal(r.ok ? r.valor : null, 3.33)
})

test('razao: respeita casas decimais customizadas', () => {
  const r = calcularRazao(insumo('v', 10, 2024), insumo('p', 3, 2024), {
    exigirMesmoAno: true,
    casas: 4,
  })
  assert.equal(r.ok ? r.valor : null, 3.3333)
})

// ---------------------------------------------------------------------------
// 2. Razão — ANOS DIVERGENTES (a guarda metodológica)
// ---------------------------------------------------------------------------

test('razao: anos divergentes devolvem null com motivo ano-divergente', () => {
  // O caso real: receita do exercício 2023 ÷ população de 2024.
  const r = calcularPerCapita(
    insumo('receitaTotal', 50_000_000, 2023),
    insumo('populacao', 10_000, 2024),
  )

  assert.equal(r.ok, false, 'não pode produzir valor')
  assert.equal(r.ok === false ? r.motivo : '', 'ano-divergente')
  assert.match(r.ok === false ? r.detalhe : '', /2023/)
  assert.match(r.ok === false ? r.detalhe : '', /2024/)
})

test('razao: ano-divergente tem precedência sobre divisor-zero', () => {
  // Anos diferentes E divisor zero: o motivo deve ser o metodológico.
  const r = calcularPerCapita(
    insumo('receitaTotal', 100, 2023),
    insumo('populacao', 0, 2024),
  )
  assert.equal(r.ok === false ? r.motivo : '', 'ano-divergente')
})

test('razao: sem exigir mesmo ano, anos diferentes são aceitos', () => {
  // Densidade: a área não tem ano, então a paridade não se aplica.
  const r = calcularDensidade(insumo('populacao', 10_000, 2024), insumo('areaKm2', 100, 0))
  assert.equal(r.ok, true)
  assert.equal(r.ok ? r.valor : null, 100)
})

// ---------------------------------------------------------------------------
// 3. Razão — DIVISÃO POR ZERO
// ---------------------------------------------------------------------------

test('razao: divisor zero devolve null com motivo divisor-zero', () => {
  const r = calcularRazao(insumo('populacao', 1000, 2024), insumo('areaKm2', 0, 0), {
    exigirMesmoAno: false,
  })
  assert.equal(r.ok, false)
  assert.equal(r.ok === false ? r.motivo : '', 'divisor-zero')
})

test('razao: divisor zero com numerador zero também é divisor-zero', () => {
  // 0/0 é indefinido, não zero.
  const r = calcularRazao(insumo('a', 0, 2024), insumo('b', 0, 2024), { exigirMesmoAno: true })
  assert.equal(r.ok === false ? r.motivo : '', 'divisor-zero')
})

// ---------------------------------------------------------------------------
// 4. Razão — insumos ausentes e inválidos
// ---------------------------------------------------------------------------

test('razao: numerador ausente devolve insumo-ausente', () => {
  const r = calcularPerCapita(insumo('receitaTotal', null, 2023), insumo('populacao', 100, 2023))
  assert.equal(r.ok, false)
  assert.equal(r.ok === false ? r.motivo : '', 'insumo-ausente')
  assert.match(r.ok === false ? r.detalhe : '', /receitaTotal/)
})

test('razao: divisor ausente devolve insumo-ausente', () => {
  // Município com receita mas sem população — o caso real do cruzamento.
  const r = calcularPerCapita(insumo('receitaTotal', 1000, 2023), insumo('populacao', null, 2023))
  assert.equal(r.ok === false ? r.motivo : '', 'insumo-ausente')
  assert.match(r.ok === false ? r.detalhe : '', /populacao/)
})

test('razao: NaN e Infinity não propagam', () => {
  const nan = calcularPerCapita(insumo('a', Number.NaN, 2024), insumo('b', 10, 2024))
  assert.equal(nan.ok === false ? nan.motivo : '', 'valor-invalido')

  const inf = calcularPerCapita(insumo('a', 10, 2024), insumo('b', Number.POSITIVE_INFINITY, 2024))
  assert.equal(inf.ok === false ? inf.motivo : '', 'valor-invalido')
})

test('razao: nunca devolve NaN nem Infinity como valor', () => {
  const casos = [
    calcularPerCapita(insumo('a', 0, 2024), insumo('b', 0, 2024)),
    calcularPerCapita(insumo('a', Number.NaN, 2024), insumo('b', 1, 2024)),
    calcularRazao(insumo('a', 1, 2024), insumo('b', 0, 2024), { exigirMesmoAno: false }),
  ]
  for (const r of casos) {
    if (r.ok) {
      assert.ok(Number.isFinite(r.valor), 'valor deve ser finito quando ok')
    }
  }
})

// ---------------------------------------------------------------------------
// 5. Soma
// ---------------------------------------------------------------------------

test('soma: soma valores presentes', () => {
  const r = somar([10, 20, 30])
  assert.equal(r.ok ? r.valor : null, 60)
})

test('soma: ignora nulos sem virar zero', () => {
  const r = somar([10, null, 30])
  assert.equal(r.ok ? r.valor : null, 40)
})

test('soma: nenhum valor presente devolve sem-dados, NÃO zero', () => {
  // Crítico: "nenhum dado" é diferente de "soma zero".
  const r = somar([null, null])
  assert.equal(r.ok, false)
  assert.equal(r.ok === false ? r.motivo : '', 'sem-dados')
})

test('soma: lista vazia devolve sem-dados', () => {
  const r = somar([])
  assert.equal(r.ok === false ? r.motivo : '', 'sem-dados')
})

test('soma: zeros reais somam zero (diferente de ausência)', () => {
  const r = somar([0, 0])
  assert.equal(r.ok, true)
  assert.equal(r.ok ? r.valor : null, 0)
})

test('soma: ignora NaN e Infinity', () => {
  const r = somar([10, Number.NaN, 20, Number.POSITIVE_INFINITY])
  assert.equal(r.ok ? r.valor : null, 30)
})

test('somaComCobertura: conta contribuições e ausentes', () => {
  const { resultado, contribuicoes, ausentes } = somarComCobertura([10, null, 30, null])
  assert.equal(resultado.ok ? resultado.valor : null, 40)
  assert.equal(contribuicoes, 2)
  assert.equal(ausentes, 2)
})

test('contarPresentes: conta apenas valores válidos', () => {
  assert.equal(contarPresentes([1, null, 3, Number.NaN]), 2)
})

// ---------------------------------------------------------------------------
// 6. Agregação por chave
// ---------------------------------------------------------------------------

test('agregarPor: soma por chave', () => {
  const grupos = agregarPor([
    { chave: 'MG', valor: 10 },
    { chave: 'SP', valor: 100 },
    { chave: 'MG', valor: 20 },
  ])

  const mg = grupos.find((g) => g.chave === 'MG')
  const sp = grupos.find((g) => g.chave === 'SP')
  assert.equal(mg?.resultado.ok ? mg.resultado.valor : null, 30)
  assert.equal(sp?.resultado.ok ? sp.resultado.valor : null, 100)
})

test('agregarPor: grupo só com ausentes devolve sem-dados', () => {
  const grupos = agregarPor([
    { chave: 'MG', valor: 10 },
    { chave: 'DF', valor: null },
    { chave: 'DF', valor: null },
  ])

  const df = grupos.find((g) => g.chave === 'DF')
  assert.equal(df?.resultado.ok, false)
  assert.equal(df?.resultado.ok === false ? df.resultado.motivo : '', 'sem-dados')
  assert.equal(df?.ausentes, 2)
})

// ---------------------------------------------------------------------------
// 7. Média ponderada
// ---------------------------------------------------------------------------

test('mediaPonderada: pondera pelo peso', () => {
  // (10×100 + 20×300) ÷ 400 = 7000/400 = 17.5
  const r = mediaPonderada([
    { valor: 10, peso: 100 },
    { valor: 20, peso: 300 },
  ])
  assert.equal(r.ok ? r.valor : null, 17.5)
})

test('mediaPonderada: ignora pares incompletos', () => {
  const r = mediaPonderada([
    { valor: 10, peso: 100 },
    { valor: null, peso: 300 },
    { valor: 50, peso: null },
  ])
  assert.equal(r.ok ? r.valor : null, 10)
})

test('mediaPonderada: soma de pesos zero devolve divisor-zero', () => {
  const r = mediaPonderada([
    { valor: 10, peso: 0 },
    { valor: 20, peso: 0 },
  ])
  assert.equal(r.ok === false ? r.motivo : '', 'divisor-zero')
})

test('mediaPonderada: nenhum par válido devolve sem-dados', () => {
  const r = mediaPonderada([{ valor: null, peso: null }])
  assert.equal(r.ok === false ? r.motivo : '', 'sem-dados')
})

// ---------------------------------------------------------------------------
// 8. Resumo de motivos
// ---------------------------------------------------------------------------

test('resumirMotivos: conta por motivo, ignorando indefinidos', () => {
  const resumo = resumirMotivos(['insumo-ausente', 'ano-divergente', undefined, 'insumo-ausente'])
  assert.equal(resumo['insumo-ausente'], 2)
  assert.equal(resumo['ano-divergente'], 1)
  assert.equal(Object.keys(resumo).length, 2)
})

// ---------------------------------------------------------------------------
// 9. Pureza: os motores não têm efeito colateral
// ---------------------------------------------------------------------------

test('pureza: chamadas repetidas com os mesmos insumos dão o mesmo resultado', () => {
  const a = insumo('a', 100, 2024)
  const b = insumo('b', 7, 2024)
  const r1 = calcularRazao(a, b, { exigirMesmoAno: true })
  const r2 = calcularRazao(a, b, { exigirMesmoAno: true })
  assert.deepEqual(r1, r2)
})

test('pureza: os insumos de entrada não são modificados', () => {
  const a = insumo('a', 100, 2024)
  const b = insumo('b', 7, 2021)
  const antes = JSON.stringify([a, b])
  calcularRazao(a, b, { exigirMesmoAno: true })
  assert.equal(JSON.stringify([a, b]), antes)
})
