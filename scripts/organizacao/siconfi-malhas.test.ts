/**
 * Caixa 4 — tradutores de Siconfi (DCA) e IBGE Malhas (área): verificação.
 *
 * Testes com arquivos temporários. Nenhuma rede, nada gravado em `data/`.
 *
 * Uso:
 *   npx tsx --test scripts/organizacao/siconfi-malhas.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { organizarRecurso } from './organizar.js'
import {
  agregarEnvelopeDca,
  normalizarCodigoEnte,
  tradutorSiconfiDca,
} from './tradutores/siconfi-dca.js'
import {
  areaDaGeometria,
  desmembrarMalha,
  tradutorMalhaMunicipios,
} from './tradutores/ibge-malhas.js'

// ---------------------------------------------------------------------------
// Ajuda
// ---------------------------------------------------------------------------

async function comTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'tr-test-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Semeia um RAW do Siconfi com um envelope por ente. */
async function semearRawSiconfi(
  raizRaw: string,
  entes: Array<{ codIbge: number | string; instituicao: string; itens: unknown[] }>,
): Promise<void> {
  const dir = join(raizRaw, 'siconfi', 'dca')
  await mkdir(join(dir, 'objetos'), { recursive: true })

  const objetos: Array<{ hash: string; arquivo: string }> = []

  for (const [i, ente] of entes.entries()) {
    const hash = String(i).repeat(64).slice(0, 64)
    const arquivo = `siconfi/dca/objetos/${hash}.json`
    await writeFile(
      join(raizRaw, arquivo),
      JSON.stringify({
        items: ente.itens.map((it) => ({ ...(it as object), cod_ibge: ente.codIbge, instituicao: ente.instituicao })),
        count: ente.itens.length,
      }),
      'utf-8',
    )
    objetos.push({ hash, arquivo })
  }

  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      fonteId: 'siconfi',
      recursoId: 'dca',
      versao: 1,
      criadoEm: '2026-01-01T00:00:00.000Z',
      atualizadoEm: '2026-01-01T00:00:00.000Z',
      objetos: objetos.map((o) => ({
        hash: o.hash,
        arquivo: o.arquivo,
        extensao: '.json',
        tamanho: 10,
        formato: 'json-envelope',
      })),
    }),
    'utf-8',
  )
}

/** Item do DCA. */
const itemDca = (
  anexo: string,
  codConta: string,
  coluna: string,
  valor: number,
  conta = '',
) => ({ exercicio: 2023, anexo, coluna, cod_conta: codConta, conta, valor, uf: 'MG' })

async function lerJsonl(caminho: string): Promise<Array<Record<string, unknown>>> {
  const texto = await readFile(caminho, 'utf-8')
  return texto
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// 1. Siconfi — normalização de código
// ---------------------------------------------------------------------------

test('siconfi: preserva 2 dígitos de estado e 7 de município', () => {
  // O bug que isso previne: padStart(7) transformaria 31 em "0000031".
  assert.equal(normalizarCodigoEnte(31), '31')
  assert.equal(normalizarCodigoEnte('31'), '31')
  assert.equal(normalizarCodigoEnte(3136702), '3136702')
  assert.equal(normalizarCodigoEnte('3136702'), '3136702')
})

test('siconfi: completa município que perdeu zeros à esquerda', () => {
  assert.equal(normalizarCodigoEnte('1100205'), '1100205')
  assert.equal(normalizarCodigoEnte(110020), '0110020', 'código de 6 dígitos')
})

test('siconfi: código de 1 dígito vira UF de 2', () => {
  assert.equal(normalizarCodigoEnte(3), '03')
})

// ---------------------------------------------------------------------------
// 2. Siconfi — agregação do envelope
// ---------------------------------------------------------------------------

test('siconfi: agrega várias linhas do envelope em uma por ente', () => {
  const linhas = agregarEnvelopeDca({
    items: [
      itemDca('DCA-Anexo I-C', 'ReceitasExcetoIntraOrcamentarias', 'Receitas Brutas Realizadas', 100),
      itemDca('DCA-Anexo I-C', 'ReceitasExcetoIntraOrcamentarias', 'Receitas Brutas Realizadas', 50),
      itemDca('DCA-Anexo I-D', 'TotalDespesas', 'Despesas Liquidadas', 80),
      itemDca('DCA-Anexo I-E', '', 'Despesas Liquidadas', 30, '10 - Saúde'),
      itemDca('DCA-Anexo I-E', '', 'Despesas Liquidadas', 20, '12 - Educação'),
    ].map((it) => ({ ...it, cod_ibge: 3136702, instituicao: 'Prefeitura X', exercicio: 2023 })),
  })

  assert.equal(linhas.length, 1, 'um ente -> uma linha')
  const l = linhas[0]!
  assert.equal(l.codarea, '3136702')
  assert.equal(l.receitaTotal, 150, 'soma as duas linhas de receita')
  assert.equal(l.despesaTotal, 80)
  assert.equal(l.gastoSaude, 30)
  assert.equal(l.gastoEducacao, 20)
})

test('siconfi: conta não mapeada é ignorada sem poluir a soma', () => {
  const linhas = agregarEnvelopeDca({
    items: [
      itemDca('DCA-Anexo I-C', 'ReceitasExcetoIntraOrcamentarias', 'Receitas Brutas Realizadas', 100),
      itemDca('DCA-Anexo I-AB', 'P1.0.0.0.0.00.00', '31/12/2023', 999999),
    ].map((it) => ({ ...it, cod_ibge: 3136702, exercicio: 2023 })),
  })
  assert.equal(linhas[0]?.receitaTotal, 100, 'a conta não mapeada não entra')
})

test('siconfi: ente sem nenhuma conta mapeada tem totais nulos, não zero', () => {
  const linhas = agregarEnvelopeDca({
    items: [itemDca('DCA-Anexo I-AB', 'P1.0.0.0.0.00.00', '31/12/2023', 5)].map((it) => ({
      ...it,
      cod_ibge: 3136702,
      exercicio: 2023,
    })),
  })
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0]?.receitaTotal, null, 'ausência não é zero')
  assert.equal(linhas[0]?.despesaTotal, null)
})

test('siconfi: separa entes diferentes do mesmo envelope', () => {
  const linhas = agregarEnvelopeDca({
    items: [
      { ...itemDca('DCA-Anexo I-C', 'ReceitasExcetoIntraOrcamentarias', 'Receitas Brutas Realizadas', 100), cod_ibge: 3136702 },
      { ...itemDca('DCA-Anexo I-C', 'ReceitasExcetoIntraOrcamentarias', 'Receitas Brutas Realizadas', 200), cod_ibge: 3106200 },
    ],
  })
  assert.equal(linhas.length, 2)
  const porCod = new Map(linhas.map((l) => [l.codarea, l]))
  assert.equal(porCod.get('3136702')?.receitaTotal, 100)
  assert.equal(porCod.get('3106200')?.receitaTotal, 200)
})

test('siconfi: ignora item sem código de ente', () => {
  const linhas = agregarEnvelopeDca({
    items: [{ anexo: 'DCA-Anexo I-C', cod_conta: 'ReceitasExcetoIntraOrcamentarias', coluna: 'Receitas Brutas Realizadas', valor: 100 }],
  })
  assert.equal(linhas.length, 0)
})

test('siconfi: entrada inválida devolve vazio', () => {
  assert.deepEqual(agregarEnvelopeDca(null), [])
  assert.deepEqual(agregarEnvelopeDca({}), [])
  assert.deepEqual(agregarEnvelopeDca({ items: 'nao-array' }), [])
})

test('siconfi: valor NaN é ignorado', () => {
  const linhas = agregarEnvelopeDca({
    items: [
      { ...itemDca('DCA-Anexo I-C', 'ReceitasExcetoIntraOrcamentarias', 'Receitas Brutas Realizadas', 100), cod_ibge: 3136702 },
      { ...itemDca('DCA-Anexo I-C', 'ReceitasExcetoIntraOrcamentarias', 'Receitas Brutas Realizadas', Number.NaN), cod_ibge: 3136702 },
    ],
  })
  assert.equal(linhas[0]?.receitaTotal, 100)
})

// ---------------------------------------------------------------------------
// 3. Siconfi — formato de saída organizado
// ---------------------------------------------------------------------------

test('siconfi: organiza em uma linha por ente, com estado de 2 dígitos', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')

    await semearRawSiconfi(raizRaw, [
      {
        codIbge: 31,
        instituicao: 'Governo do Estado de Minas Gerais',
        itens: [itemDca('DCA-Anexo I-C', 'ReceitasExcetoIntraOrcamentarias', 'Receitas Brutas Realizadas', 1000)],
      },
      {
        codIbge: 3136702,
        instituicao: 'Prefeitura de Juiz de Fora',
        itens: [
          itemDca('DCA-Anexo I-C', 'ReceitasExcetoIntraOrcamentarias', 'Receitas Brutas Realizadas', 500),
          itemDca('DCA-Anexo I-D', 'TotalDespesas', 'Despesas Liquidadas', 400),
        ],
      },
    ])

    const r = await organizarRecurso(tradutorSiconfiDca, { raizRaw, raizSaida })
    assert.equal(r.contagens.gravadas, 2)

    const linhas = await lerJsonl(join(raizSaida, 'siconfi', 'dca.jsonl'))
    const estado = linhas.find((l) => l['codarea'] === '31')
    const municipio = linhas.find((l) => l['codarea'] === '3136702')

    assert.ok(estado, 'estado preserva 2 dígitos')
    assert.ok(municipio, 'município com 7 dígitos')
    assert.equal(estado?.['exercicio'], 2023)
    assert.equal(municipio?.['receitaTotal'], 500)
    assert.equal(municipio?.['despesaTotal'], 400)
    // Campos internos do envelope não vazam.
    assert.equal(municipio?.['items'], undefined)
    assert.equal(municipio?.['anexo'], undefined)
  })
})

test('siconfi: gera metadados', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')
    await semearRawSiconfi(raizRaw, [
      { codIbge: 3136702, instituicao: 'X', itens: [itemDca('DCA-Anexo I-C', 'ReceitasExcetoIntraOrcamentarias', 'Receitas Brutas Realizadas', 1)] },
    ])

    await organizarRecurso(tradutorSiconfiDca, { raizRaw, raizSaida })
    const meta = JSON.parse(
      await readFile(join(raizSaida, 'siconfi', 'dca.meta.json'), 'utf-8'),
    ) as Record<string, unknown>

    assert.equal(meta['fonteId'], 'siconfi')
    assert.equal(meta['versaoEsquema'], 1)
  })
})

// ---------------------------------------------------------------------------
// 4. Malhas — área da geometria
// ---------------------------------------------------------------------------

test('malhas: área de um quadrado de 1 grau na linha do Equador', () => {
  // 1° de latitude ≈ 111,2 km. Um quadrado de 1°×1° perto do Equador tem
  // ~12.300 km². Usamos tolerância porque a fórmula é esférica aproximada.
  const quadrado = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  }
  const area = areaDaGeometria(quadrado)
  assert.ok(area > 11_000 && area < 13_000, `área inesperada: ${area}`)
})

test('malhas: MultiPolygon soma as partes', () => {
  const parte = [
    [
      [0, 0],
      [0.1, 0],
      [0.1, 0.1],
      [0, 0.1],
      [0, 0],
    ],
  ]
  const uma = areaDaGeometria({ type: 'Polygon', coordinates: parte })
  const duas = areaDaGeometria({ type: 'MultiPolygon', coordinates: [parte, parte] })
  assert.ok(Math.abs(duas - uma * 2) < 0.01, 'duas partes = dobro da área')
})

test('malhas: buraco é subtraído da área', () => {
  const comBuraco = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [0.4, 0.4],
        [0.6, 0.4],
        [0.6, 0.6],
        [0.4, 0.6],
        [0.4, 0.4],
      ],
    ],
  }
  const semBuraco = { type: 'Polygon', coordinates: [comBuraco.coordinates[0]!] }
  assert.ok(
    areaDaGeometria(comBuraco) < areaDaGeometria(semBuraco),
    'o anel interno reduz a área',
  )
})

test('malhas: geometria inválida devolve 0', () => {
  assert.equal(areaDaGeometria(null), 0)
  assert.equal(areaDaGeometria({}), 0)
  assert.equal(areaDaGeometria({ type: 'Point', coordinates: [0, 0] }), 0)
})

// ---------------------------------------------------------------------------
// 5. Malhas — desmembramento
// ---------------------------------------------------------------------------

test('malhas: desmembra FeatureCollection em uma linha por município', () => {
  const linhas = desmembrarMalha({
    features: [
      {
        properties: { codarea: '1100015' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]] },
      },
      { properties: { codarea: '1100023' }, geometry: null },
    ],
  })

  assert.equal(linhas.length, 2)
  assert.equal(linhas[0]?.codarea, '1100015')
  assert.ok((linhas[0]?.areaKm2 ?? 0) > 0)
  // Sem geometria válida a área é `null`, não zero: ausência ≠ área nula.
  assert.equal(linhas[1]?.areaKm2, null)
})

test('malhas: feature sem codarea é ignorada', () => {
  const linhas = desmembrarMalha({
    features: [{ properties: {}, geometry: null }, { properties: { codarea: '1' }, geometry: null }],
  })
  assert.equal(linhas.length, 1)
})

test('malhas: entrada inválida devolve vazio', () => {
  assert.deepEqual(desmembrarMalha(null), [])
  assert.deepEqual(desmembrarMalha({}), [])
  assert.deepEqual(desmembrarMalha({ features: 'x' }), [])
})

test('malhas: organiza area.jsonl a partir do RAW', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')

    const dirMalha = join(raizRaw, 'ibge-malhas', 'malha-municipios-por-uf')
    await mkdir(join(dirMalha, 'objetos'), { recursive: true })
    const hash = 'c'.repeat(64)
    const caminhoRel = `ibge-malhas/malha-municipios-por-uf/objetos/${hash}.json`

    await writeFile(
      join(raizRaw, caminhoRel),
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            properties: { codarea: '1100015' },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], [0, 0]]] },
          },
        ],
      }),
      'utf-8',
    )
    await writeFile(
      join(dirMalha, 'manifest.json'),
      JSON.stringify({
        fonteId: 'ibge-malhas',
        recursoId: 'malha-municipios-por-uf',
        versao: 1,
        criadoEm: '2026-01-01T00:00:00.000Z',
        atualizadoEm: '2026-01-01T00:00:00.000Z',
        objetos: [{ hash, arquivo: caminhoRel, extensao: '.json', tamanho: 10, formato: 'geojson' }],
      }),
      'utf-8',
    )

    const r = await organizarRecurso(tradutorMalhaMunicipios, { raizRaw, raizSaida })
    assert.equal(r.contagens.gravadas, 1)

    const linhas = await lerJsonl(
      join(raizSaida, 'ibge-malhas', 'malha-municipios-por-uf.jsonl'),
    )
    assert.equal(linhas[0]?.['codarea'], '1100015')
    assert.ok(typeof linhas[0]?.['areaKm2'] === 'number')
    assert.ok((linhas[0]?.['areaKm2'] as number) > 0)
  })
})
