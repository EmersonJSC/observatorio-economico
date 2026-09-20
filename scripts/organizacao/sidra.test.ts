/**
 * Caixa 4 — tradutor do SIDRA: verificação do formato de saída.
 *
 * O tradutor recebe a resposta aninhada da API de Agregados do IBGE
 * (`resultados[].series[]`) e produz uma tabela longa: uma linha por
 * (localidade, ano). Estes testes garantem o FORMATO de saída — que é o
 * contrato que a Caixa 6 consome.
 *
 * Uso:
 *   npx tsx --test scripts/organizacao/sidra.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { organizarRecurso } from './organizar.js'
import {
  desmembrarSidra,
  parseValorSidra,
  tradutorSidraPib,
  tradutorSidraPopulacao,
} from './tradutores/ibge-sidra.js'

// ---------------------------------------------------------------------------
// Ajuda
// ---------------------------------------------------------------------------

async function comTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'sidra-test-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Semeia um RAW sintético do SIDRA no formato real da API. */
async function semearRaw(
  raizRaw: string,
  recursoId: string,
  series: Array<{ id?: string | undefined; nome?: string; serie: Record<string, string> }>,
): Promise<void> {
  const dir = join(raizRaw, 'ibge-sidra', recursoId)
  await mkdir(join(dir, 'objetos'), { recursive: true })
  const hash = 'b'.repeat(64)

  const corpo = [
    {
      id: recursoId === 'pib' ? '37' : '9324',
      variavel: recursoId === 'pib' ? 'Produto Interno Bruto' : 'População residente estimada',
      unidade: recursoId === 'pib' ? 'Mil Reais' : 'Pessoas',
      resultados: [
        {
          classificacoes: [],
          series: series.map((s) => ({
            localidade: {
              ...(s.id !== undefined ? { id: s.id } : {}),
              nivel: { id: 'N6', nome: 'Município' },
              ...(s.nome !== undefined ? { nome: s.nome } : {}),
            },
            serie: s.serie,
          })),
        },
      ],
    },
  ]

  await writeFile(join(dir, 'objetos', `${hash}.json`), JSON.stringify(corpo), 'utf-8')
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      fonteId: 'ibge-sidra',
      recursoId,
      versao: 1,
      criadoEm: '2026-01-01T00:00:00.000Z',
      atualizadoEm: '2026-01-01T00:00:00.000Z',
      objetos: [
        {
          hash,
          arquivo: `ibge-sidra/${recursoId}/objetos/${hash}.json`,
          extensao: '.json',
          tamanho: 10,
          formato: 'json',
        },
      ],
    }),
    'utf-8',
  )
}

async function lerJsonl(caminho: string): Promise<Array<Record<string, unknown>>> {
  const texto = await readFile(caminho, 'utf-8')
  return texto
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// 1. Desmembramento
// ---------------------------------------------------------------------------

test('sidra: desmembra uma linha por (localidade, ano)', () => {
  const linhas = desmembrarSidra({
    resultados: [
      {
        series: [
          { localidade: { id: '3100104' }, serie: { '2024': '6365', '2021': '6000' } },
          { localidade: { id: '3100203' }, serie: { '2024': '23161' } },
        ],
      },
    ],
  })
  assert.equal(linhas.length, 3)
  assert.deepEqual(
    linhas.map((l) => l.ano).sort(),
    [2021, 2024, 2024],
  )
})

test('sidra: desmembrar devolve vazio para entradas inválidas', () => {
  assert.deepEqual(desmembrarSidra(null), [])
  assert.deepEqual(desmembrarSidra([]), [])
  assert.deepEqual(desmembrarSidra('x'), [])
  assert.deepEqual(desmembrarSidra({ resultados: [] }), [])
})

test('sidra: série sem localidade é EMITIDA (para a quarentena registrar)', () => {
  const linhas = desmembrarSidra({
    resultados: [{ series: [{ serie: { '2024': '1' } }] }],
  })
  assert.equal(linhas.length, 1, 'não descarta em silêncio')
  assert.equal(linhas[0]?.localidade.id, undefined)
})

// ---------------------------------------------------------------------------
// 2. Conversão de valores
// ---------------------------------------------------------------------------

test('sidra: converte inteiros simples', () => {
  assert.equal(parseValorSidra('6365'), 6365)
})

test('sidra: converte formato brasileiro com separador de milhar', () => {
  // "1.234,5" sem tratamento correto vira NaN e o valor se perde.
  assert.equal(parseValorSidra('1.234,5'), 1234.5)
  assert.equal(parseValorSidra('1.234.567,89'), 1234567.89)
  assert.equal(parseValorSidra('1234.5'), 1234.5)
})

test('sidra: marcadores de ausência do IBGE viram null, não zero', () => {
  for (const m of ['-', '...', 'X', 'C', '']) {
    assert.equal(parseValorSidra(m), null, `marcador ${JSON.stringify(m)}`)
  }
  assert.equal(parseValorSidra(undefined), null)
})

test('sidra: texto não numérico vira null em vez de NaN', () => {
  const v = parseValorSidra('abc')
  assert.equal(v, null)
  assert.ok(!Number.isNaN(v))
})

// ---------------------------------------------------------------------------
// 3. Formato de saída da organização
// ---------------------------------------------------------------------------

test('sidra: populacao.jsonl tem as chaves esperadas', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')
    await semearRaw(raizRaw, 'populacao', [
      { id: '3100104', nome: 'Abadia dos Dourados - MG', serie: { '2024': '6365' } },
    ])

    await organizarRecurso(tradutorSidraPopulacao, { raizRaw, raizSaida })
    const linhas = await lerJsonl(join(raizSaida, 'ibge-sidra', 'populacao.jsonl'))

    assert.equal(linhas.length, 1)
    const l = linhas[0]!
    assert.equal(l['codarea'], '3100104')
    assert.equal(l['ano'], 2024)
    assert.equal(l['populacao'], 6365)
    assert.equal(l['nivel'], 'N6')
    assert.equal(l['nomeLocalidade'], 'Abadia dos Dourados - MG')
    // O valor bruto da API não deve vazar para a saída.
    assert.equal(l['serie'], undefined)
  })
})

test('sidra: pib.jsonl usa a chave pibMilReais', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')
    await semearRaw(raizRaw, 'pib', [
      { id: '3100104', nome: 'Abadia - MG', serie: { '2021': '176730' } },
    ])

    await organizarRecurso(tradutorSidraPib, { raizRaw, raizSaida })
    const linhas = await lerJsonl(join(raizSaida, 'ibge-sidra', 'pib.jsonl'))
    assert.equal(linhas[0]?.['pibMilReais'], 176730)
    assert.equal(linhas[0]?.['ano'], 2021)
    assert.equal(linhas[0]?.['populacao'], undefined, 'não mistura esquemas')
  })
})

test('sidra: código preserva zeros à esquerda como string', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')
    // UF tem código de 2 dígitos; não pode virar number e perder o zero.
    await semearRaw(raizRaw, 'populacao', [
      { id: '11', nome: 'Rondônia', serie: { '2024': '1000' } },
    ])

    await organizarRecurso(tradutorSidraPopulacao, { raizRaw, raizSaida })
    const linhas = await lerJsonl(join(raizSaida, 'ibge-sidra', 'populacao.jsonl'))
    assert.equal(linhas[0]?.['codarea'], '11')
    assert.equal(typeof linhas[0]?.['codarea'], 'string')
  })
})

test('sidra: gera metadados com a versão do esquema', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')
    await semearRaw(raizRaw, 'populacao', [
      { id: '3100104', nome: 'X', serie: { '2024': '1' } },
    ])

    await organizarRecurso(tradutorSidraPopulacao, { raizRaw, raizSaida })
    const meta = JSON.parse(
      await readFile(join(raizSaida, 'ibge-sidra', 'populacao.meta.json'), 'utf-8'),
    ) as Record<string, unknown>

    assert.equal(meta['fonteId'], 'ibge-sidra')
    assert.equal(meta['recursoId'], 'populacao')
    assert.equal(meta['versaoEsquema'], 1)
    assert.equal((meta['contagens'] as Record<string, number>)['gravadas'], 1)
  })
})

test('sidra: linha sem código vai para quarentena', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')

    // 200 séries, 1 sem id = 0,5%, dentro do limiar de 1%.
    const series: Array<{ id?: string; nome?: string; serie: Record<string, string> }> =
      Array.from({ length: 199 }, (_, i) => ({
        id: `3100${String(i).padStart(3, '0')}`,
        nome: `Município ${i} - MG`,
        serie: { '2024': String(1000 + i) },
      }))
    series.push({ nome: 'sem codigo', serie: { '2024': '1' } })

    await semearRaw(raizRaw, 'populacao', series)
    const r = await organizarRecurso(tradutorSidraPopulacao, { raizRaw, raizSaida })

    assert.equal(r.contagens.gravadas, 199)
    assert.equal(r.contagens.quarentenadas, 1, 'o registro ruim é reportado')
    assert.equal(r.contagens.lidas, 200)
  })
})
