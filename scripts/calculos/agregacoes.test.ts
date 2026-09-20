/**
 * Caixa 6 — tradutor SIDRA e agregador TSE: verificação.
 *
 * Testes com arquivos temporários. Nenhuma rede, nenhum dado real de produção,
 * nada gravado em `data/`.
 *
 * Uso:
 *   npx tsx --test scripts/calculos/agregacoes.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  agregarCandidatosPorMunicipio,
  CARGO_TSE,
  carregarPonte,
  caminhoPonte,
  caminhoTseOrganizado,
} from './agregacoes/tse-candidatos.js'
import {
  desmembrarSidra,
  parseValorSidra,
  tradutorSidraPib,
  tradutorSidraPopulacao,
} from '../organizacao/tradutores/ibge-sidra.js'
import { organizarRecurso } from '../organizacao/organizar.js'

// ---------------------------------------------------------------------------
// Ajuda
// ---------------------------------------------------------------------------

async function comTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'c6-test-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Grava um JSONL. */
async function gravarJsonl(caminho: string, registros: unknown[]): Promise<void> {
  await mkdir(join(caminho, '..'), { recursive: true })
  await writeFile(caminho, registros.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8')
}

/** Lê um JSONL como array. */
async function lerJsonl(caminho: string): Promise<Array<Record<string, unknown>>> {
  const texto = await readFile(caminho, 'utf-8')
  return texto
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

/** Semeia um RAW sintético do SIDRA (formato real da API de Agregados). */
async function semearRawSidra(
  raizRaw: string,
  recursoId: string,
  series: Array<{ codarea: string; nome: string; serie: Record<string, string> }>,
): Promise<void> {
  const dir = join(raizRaw, 'ibge-sidra', recursoId)
  await mkdir(join(dir, 'objetos'), { recursive: true })
  const hash = 'a'.repeat(64)

  const corpo = [
    {
      id: recursoId === 'pib' ? '37' : '9324',
      variavel: recursoId === 'pib' ? 'Produto Interno Bruto' : 'População residente estimada',
      unidade: recursoId === 'pib' ? 'Mil Reais' : 'Pessoas',
      resultados: [
        {
          classificacoes: [],
          series: series.map((s) => ({
            localidade: { id: s.codarea, nivel: { id: 'N6', nome: 'Município' }, nome: s.nome },
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

// ---------------------------------------------------------------------------
// 1. Tradutor SIDRA — desmembramento
// ---------------------------------------------------------------------------

test('sidra: desmembra resultados[].series[] em uma linha por (localidade, ano)', () => {
  const bruto = {
    resultados: [
      {
        series: [
          { localidade: { id: '3100104', nome: 'Abadia - MG' }, serie: { '2024': '6365', '2021': '6000' } },
          { localidade: { id: '3100203', nome: 'Abaeté - MG' }, serie: { '2024': '23161' } },
        ],
      },
    ],
  }

  const linhas = desmembrarSidra(bruto)
  // 2 anos da primeira + 1 da segunda = 3 linhas.
  assert.equal(linhas.length, 3)
  assert.equal(linhas.filter((l) => l.localidade.id === '3100104').length, 2)
  assert.equal(linhas.find((l) => l.ano === 2021)?.valor, 6000)
})

test('sidra: desmembrar EMITE série sem código, para o validador rejeitar', () => {
  // Descartar em silêncio esconderia dado ruim; emitir deixa a quarentena
  // registrá-lo, que é o comportamento auditável.
  const linhas = desmembrarSidra({
    resultados: [
      {
        series: [
          { serie: { '2024': '1' } },
          { localidade: { id: '1' }, serie: { '2024': '2' } },
        ],
      },
    ],
  })
  assert.equal(linhas.length, 2, 'a série sem id é emitida, não engolida')
  assert.equal(linhas.filter((l) => l.localidade.id === undefined).length, 1)
})

test('sidra: desmembrar devolve vazio para entrada inválida', () => {
  assert.deepEqual(desmembrarSidra(null), [])
  assert.deepEqual(desmembrarSidra('texto'), [])
  assert.deepEqual(desmembrarSidra([]), [])
})

test('sidra: parseValorSidra trata os marcadores de ausência', () => {
  assert.equal(parseValorSidra('6365'), 6365)
  assert.equal(parseValorSidra('1.234,5'), 1234.5)
  // Marcadores do IBGE significam ausência, não zero.
  for (const m of ['-', '...', 'X', 'C', '']) {
    assert.equal(parseValorSidra(m), null, `marcador ${JSON.stringify(m)}`)
  }
  assert.equal(parseValorSidra(undefined), null)
})

test('sidra: tradutores declaram desmembrar e o recurso correto', () => {
  assert.equal(tradutorSidraPopulacao.fonteId, 'ibge-sidra')
  assert.equal(tradutorSidraPopulacao.recursoId, 'populacao')
  assert.equal(tradutorSidraPib.recursoId, 'pib')
  assert.ok(tradutorSidraPopulacao.desmembrar, 'população precisa desmembrar')
  assert.ok(tradutorSidraPib.desmembrar, 'PIB precisa desmembrar')
})

// ---------------------------------------------------------------------------
// 2. Tradutor SIDRA — organização de ponta a ponta
// ---------------------------------------------------------------------------

test('sidra: organiza população em JSONL plano (uma linha por localidade/ano)', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')

    await semearRawSidra(raizRaw, 'populacao', [
      { codarea: '3100104', nome: 'Abadia dos Dourados - MG', serie: { '2024': '6365', '2021': '6000' } },
      { codarea: '3100203', nome: 'Abaeté - MG', serie: { '2024': '23161' } },
    ])

    const r = await organizarRecurso(tradutorSidraPopulacao, { raizRaw, raizSaida })
    assert.equal(r.contagens.gravadas, 3, '2 anos + 1 ano')
    assert.equal(r.contagens.quarentenadas, 0)

    const linhas = await lerJsonl(join(raizSaida, 'ibge-sidra', 'populacao.jsonl'))
    assert.equal(linhas.length, 3)

    // A ordem das linhas segue o dicionário de anos da origem, que não é
    // ordenado — buscamos pelo par (codarea, ano) em vez de assumir posição.
    const alvo = linhas.find(
      (l) => l['codarea'] === '3100104' && l['ano'] === 2024,
    ) as Record<string, unknown>
    assert.ok(alvo, 'linha de 3100104/2024 deve existir')
    assert.equal(alvo['populacao'], 6365)
    assert.equal(alvo['nivel'], 'N6')

    // Os dois anos da mesma localidade foram preservados.
    const anos = linhas
      .filter((l) => l['codarea'] === '3100104')
      .map((l) => l['ano'])
      .sort()
    assert.deepEqual(anos, [2021, 2024])
  })
})

test('sidra: organiza PIB com a chave pibMilReais e tipo decimal', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')

    await semearRawSidra(raizRaw, 'pib', [
      { codarea: '3100104', nome: 'Abadia - MG', serie: { '2021': '176730' } },
    ])

    await organizarRecurso(tradutorSidraPib, { raizRaw, raizSaida })
    const linhas = await lerJsonl(join(raizSaida, 'ibge-sidra', 'pib.jsonl'))
    assert.equal((linhas[0] as Record<string, unknown>)['pibMilReais'], 176730)
    assert.equal((linhas[0] as Record<string, unknown>)['ano'], 2021)
  })
})

test('sidra: linha sem código de localidade vai para quarentena', async () => {
  await comTemp(async (dir) => {
    const raizRaw = join(dir, 'raw')
    const raizSaida = join(dir, 'organized')

    // 200 séries, 1 sem localidade = 0,5%, dentro do limiar.
    const series = Array.from({ length: 199 }, (_, i) => ({
      codarea: `3100${String(i).padStart(3, '0')}`,
      nome: `Município ${i} - MG`,
      serie: { '2024': String(1000 + i) },
    }))
    series.push({ codarea: '', nome: 'sem codigo', serie: { '2024': '1' } })

    await semearRawSidra(raizRaw, 'populacao', series)
    const r = await organizarRecurso(tradutorSidraPopulacao, { raizRaw, raizSaida })

    assert.equal(r.contagens.gravadas, 199)
    assert.equal(r.contagens.quarentenadas, 1)
  })
})

// ---------------------------------------------------------------------------
// 3. Agregador TSE — ponte
// ---------------------------------------------------------------------------

test('ponte: carrega vínculo UF+códigoUE -> codarea', async () => {
  await comTemp(async (dir) => {
    const caminho = join(dir, 'municipio.jsonl')
    await gravarJsonl(caminho, [
      { codarea: '1100015', ufSigla: 'RO', origens: { tse: { id: '00310' } } },
      { codarea: '3106200', ufSigla: 'MG', origens: { tse: { id: '41238' } } },
    ])

    const ponte = await carregarPonte(caminho)
    assert.equal(ponte.size, 2)
    assert.equal(ponte.get('RO|00310'), '1100015')
    assert.equal(ponte.get('MG|41238'), '3106200')
  })
})

test('ponte: ignora linhas sem vínculo com o TSE', async () => {
  await comTemp(async (dir) => {
    const caminho = join(dir, 'municipio.jsonl')
    await gravarJsonl(caminho, [
      { codarea: '5300108', ufSigla: 'DF', origens: {} }, // sem TSE
      { codarea: '1100015', ufSigla: 'RO', origens: { tse: { id: '00310' } } },
    ])
    const ponte = await carregarPonte(caminho)
    assert.equal(ponte.size, 1)
  })
})

test('ponte: arquivo ausente devolve mapa vazio, sem lançar', async () => {
  await comTemp(async (dir) => {
    const ponte = await carregarPonte(join(dir, 'nao-existe.jsonl'))
    assert.equal(ponte.size, 0)
  })
})

// ---------------------------------------------------------------------------
// 4. Agregador TSE — agrupamento
// ---------------------------------------------------------------------------

/** Candidato no formato da Caixa 4. */
const cand = (
  ufSigla: string,
  unidadeEleitoral: string,
  codigoCargo: number,
  partidoSigla: string,
  anoEleicao = 2024,
) => ({ ufSigla, unidadeEleitoral, codigoCargo, partidoSigla, anoEleicao })

test('tse: agrupa candidatos por codarea usando a ponte', async () => {
  await comTemp(async (dir) => {
    const caminhoTse = join(dir, 'tse.jsonl')
    const caminhoDaPonte = join(dir, 'ponte.jsonl')

    await gravarJsonl(caminhoDaPonte, [
      { codarea: '1100015', ufSigla: 'RO', origens: { tse: { id: '00310' } } },
      { codarea: '1100023', ufSigla: 'RO', origens: { tse: { id: '00311' } } },
    ])
    await gravarJsonl(caminhoTse, [
      cand('RO', '00310', CARGO_TSE.PREFEITO, 'PSDB'),
      cand('RO', '00310', CARGO_TSE.VEREADOR, 'PSDB'),
      cand('RO', '00310', CARGO_TSE.VEREADOR, 'PT'),
      cand('RO', '00311', CARGO_TSE.PREFEITO, 'MDB'),
    ])

    const ponte = await carregarPonte(caminhoDaPonte)
    const { porMunicipio, naoVinculados } = await agregarCandidatosPorMunicipio(caminhoTse, ponte)

    assert.equal(naoVinculados, 0)
    assert.equal(porMunicipio.size, 2, '2 municípios distintos')

    const a = porMunicipio.get('1100015')!
    assert.equal(a.totalCandidatos, 3)
    assert.equal(a.candidatosPrefeito, 1)
    assert.equal(a.candidatosVereador, 2)
    assert.equal(a.partidosDistintos, 2, 'PSDB e PT')
    assert.equal(a.anoEleicao, 2024)

    const b = porMunicipio.get('1100023')!
    assert.equal(b.totalCandidatos, 1)
    assert.equal(b.partidosDistintos, 1)
  })
})

test('tse: linha sem vínculo na ponte é contada e descartada', async () => {
  await comTemp(async (dir) => {
    const caminhoTse = join(dir, 'tse.jsonl')
    const caminhoDaPonte = join(dir, 'ponte.jsonl')

    await gravarJsonl(caminhoDaPonte, [
      { codarea: '1100015', ufSigla: 'RO', origens: { tse: { id: '00310' } } },
    ])
    await gravarJsonl(caminhoTse, [
      cand('RO', '00310', CARGO_TSE.PREFEITO, 'PSDB'),
      cand('RO', '99999', CARGO_TSE.PREFEITO, 'XX'), // unidade fora da ponte
    ])

    const ponte = await carregarPonte(caminhoDaPonte)
    const { porMunicipio, naoVinculados } = await agregarCandidatosPorMunicipio(caminhoTse, ponte)

    assert.equal(naoVinculados, 1, 'não inventa codarea')
    assert.equal(porMunicipio.size, 1)
    assert.equal(porMunicipio.get('1100015')?.totalCandidatos, 1)
  })
})

test('tse: não confunde o mesmo códigoUE em UFs diferentes', async () => {
  await comTemp(async (dir) => {
    const caminhoTse = join(dir, 'tse.jsonl')
    const caminhoDaPonte = join(dir, 'ponte.jsonl')

    // Mesmo código de UE, UFs diferentes — são municípios diferentes.
    await gravarJsonl(caminhoDaPonte, [
      { codarea: '1100015', ufSigla: 'RO', origens: { tse: { id: '00310' } } },
      { codarea: '3106200', ufSigla: 'MG', origens: { tse: { id: '00310' } } },
    ])
    await gravarJsonl(caminhoTse, [
      cand('RO', '00310', CARGO_TSE.PREFEITO, 'A'),
      cand('MG', '00310', CARGO_TSE.VEREADOR, 'B'),
    ])

    const ponte = await carregarPonte(caminhoDaPonte)
    const { porMunicipio } = await agregarCandidatosPorMunicipio(caminhoTse, ponte)

    assert.equal(porMunicipio.size, 2)
    assert.equal(porMunicipio.get('1100015')?.candidatosPrefeito, 1)
    assert.equal(porMunicipio.get('3106200')?.candidatosVereador, 1)
  })
})

test('tse: conta partidos distintos, não candidatos por partido', async () => {
  await comTemp(async (dir) => {
    const caminhoTse = join(dir, 'tse.jsonl')
    const caminhoDaPonte = join(dir, 'ponte.jsonl')

    await gravarJsonl(caminhoDaPonte, [
      { codarea: '1100015', ufSigla: 'RO', origens: { tse: { id: '00310' } } },
    ])
    await gravarJsonl(caminhoTse, [
      cand('RO', '00310', CARGO_TSE.VEREADOR, 'PT'),
      cand('RO', '00310', CARGO_TSE.VEREADOR, 'PT'),
      cand('RO', '00310', CARGO_TSE.VEREADOR, 'PT'),
      cand('RO', '00310', CARGO_TSE.VEREADOR, 'PSDB'),
    ])

    const ponte = await carregarPonte(caminhoDaPonte)
    const { porMunicipio } = await agregarCandidatosPorMunicipio(caminhoTse, ponte)

    const m = porMunicipio.get('1100015')!
    assert.equal(m.totalCandidatos, 4)
    assert.equal(m.partidosDistintos, 2, 'PT repetido conta uma vez')
  })
})

test('tse: sigma dos cargos é igual ao total', async () => {
  await comTemp(async (dir) => {
    const caminhoTse = join(dir, 'tse.jsonl')
    const caminhoDaPonte = join(dir, 'ponte.jsonl')

    await gravarJsonl(caminhoDaPonte, [
      { codarea: '1100015', ufSigla: 'RO', origens: { tse: { id: '00310' } } },
    ])
    await gravarJsonl(caminhoTse, [
      cand('RO', '00310', CARGO_TSE.PREFEITO, 'A'),
      cand('RO', '00310', CARGO_TSE.VICE_PREFEITO, 'A'),
      cand('RO', '00310', CARGO_TSE.VEREADOR, 'B'),
      cand('RO', '00310', CARGO_TSE.VEREADOR, 'C'),
    ])

    const ponte = await carregarPonte(caminhoDaPonte)
    const { porMunicipio } = await agregarCandidatosPorMunicipio(caminhoTse, ponte)
    const m = porMunicipio.get('1100015')!

    assert.equal(
      m.candidatosPrefeito + m.candidatosVicePrefeito + m.candidatosVereador,
      m.totalCandidatos,
    )
    assert.equal(m.totalCandidatos, 4)
  })
})

test('tse: ignora partido vazio sem contar como distinto', async () => {
  await comTemp(async (dir) => {
    const caminhoTse = join(dir, 'tse.jsonl')
    const caminhoDaPonte = join(dir, 'ponte.jsonl')

    await gravarJsonl(caminhoDaPonte, [
      { codarea: '1100015', ufSigla: 'RO', origens: { tse: { id: '00310' } } },
    ])
    await gravarJsonl(caminhoTse, [
      cand('RO', '00310', CARGO_TSE.VEREADOR, ''),
      cand('RO', '00310', CARGO_TSE.VEREADOR, 'PT'),
    ])

    const ponte = await carregarPonte(caminhoDaPonte)
    const { porMunicipio } = await agregarCandidatosPorMunicipio(caminhoTse, ponte)
    assert.equal(porMunicipio.get('1100015')?.partidosDistintos, 1)
  })
})

test('tse: agrega ano da eleição (o mais recente quando há mais de um)', async () => {
  await comTemp(async (dir) => {
    const caminhoTse = join(dir, 'tse.jsonl')
    const caminhoDaPonte = join(dir, 'ponte.jsonl')

    await gravarJsonl(caminhoDaPonte, [
      { codarea: '1100015', ufSigla: 'RO', origens: { tse: { id: '00310' } } },
    ])
    await gravarJsonl(caminhoTse, [
      cand('RO', '00310', CARGO_TSE.PREFEITO, 'A', 2020),
      cand('RO', '00310', CARGO_TSE.PREFEITO, 'B', 2024),
    ])

    const ponte = await carregarPonte(caminhoDaPonte)
    const { porMunicipio } = await agregarCandidatosPorMunicipio(caminhoTse, ponte)
    assert.equal(porMunicipio.get('1100015')?.anoEleicao, 2024)
  })
})

test('tse: volume grande é agregado sem acumular candidatos', async () => {
  await comTemp(async (dir) => {
    const caminhoTse = join(dir, 'tse.jsonl')
    const caminhoDaPonte = join(dir, 'ponte.jsonl')

    // 100 municípios × 500 candidatos = 50.000 linhas.
    const municipios = Array.from({ length: 100 }, (_, i) => ({
      codarea: `11000${String(i).padStart(2, '0')}`,
      ufSigla: 'RO',
      origens: { tse: { id: String(90000 + i) } },
    }))
    await gravarJsonl(caminhoDaPonte, municipios)

    const linhas: unknown[] = []
    for (let i = 0; i < 100; i++) {
      for (let c = 0; c < 500; c++) {
        linhas.push(cand('RO', String(90000 + i), CARGO_TSE.VEREADOR, `P${c % 10}`))
      }
    }
    await gravarJsonl(caminhoTse, linhas)

    // Libera o array do fixture: medir o custo de montar o arquivo de teste não
    // diz nada sobre o agregador.
    linhas.length = 0

    const ponte = await carregarPonte(caminhoDaPonte)
    const { porMunicipio } = await agregarCandidatosPorMunicipio(caminhoTse, ponte)

    assert.equal(porMunicipio.size, 100, 'aguenta 50.000 linhas')
    assert.equal(porMunicipio.get('1100000')?.totalCandidatos, 500)
    assert.equal(porMunicipio.get('1100000')?.partidosDistintos, 10)

    // O acervo final é por MUNICÍPIO (100 acumuladores com um Set de até 10
    // partidos cada), não por candidato (50.000). A ordem de grandeza tem de
    // ser KB — um teto de 1 MB protege contra regressão que acumule linhas.
    const tamanhoMb = JSON.stringify([...porMunicipio.values()]).length / 1024 / 1024
    assert.ok(
      tamanhoMb < 1,
      `o acervo agregado não pode ter escala de MB: ${tamanhoMb.toFixed(2)}MB`,
    )
  })
})

// ---------------------------------------------------------------------------
// 5. Caminhos padrão
// ---------------------------------------------------------------------------

test('caminhos: apontam para as saídas da Caixa 4 e 5', () => {
  assert.match(caminhoTseOrganizado('/base/organized'), /organized\/tse\/cdn-dados-abertos\.jsonl$/)
  assert.match(caminhoPonte('/base/related'), /related\/municipio\.jsonl$/)
})
