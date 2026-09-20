/**
 * Caixa 7 — PUBLICAÇÃO: verificação.
 *
 * Testes com arquivos temporários. Nenhuma rede, nada gravado em `data/`.
 *
 * Uso:
 *   npx tsx --test scripts/publicacao/publicacao.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ALIASES_ELIMINADOS, ROTAS_FRONTEND, UFS, nomePublicado, ufDoCodarea } from './contrato.js'
import {
  dividirEmBlocos,
  extrairCoordenadas,
  formatarIndice,
  formatarMunicipio,
} from './formatos/municipios.js'
import { formatarRanking } from './formatos/dominios.js'
import { publicar } from './publicacao.js'
import { rotasExigidas, validarPublicacao } from './validar.js'
import type { MunicipioPublicado } from './tipos.js'

// ---------------------------------------------------------------------------
// Ajuda
// ---------------------------------------------------------------------------

async function comTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'pub-test-'))
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

/** Município calculado sintético (formato da Caixa 6). */
function calculado(codarea: string, nome: string, uf: string) {
  const metricas: Record<string, { valor: number | null; ano: number | null }> = {
    populacao: { valor: 10_000, ano: 2021 },
    pib_mil_reais: { valor: 500_000, ano: 2021 },
    pib_per_capita: { valor: 50_000, ano: 2021 },
    densidade: { valor: 100, ano: 2021 },
    receita_total: { valor: null, ano: 2023 },
    despesa_total: { valor: null, ano: 2023 },
  }
  return { codarea, nome, ufSigla: uf, metricas }
}

/** Semeia as três camadas de origem. */
async function semearFontes(
  dir: string,
  municipios: unknown[],
  extras: { candidatos?: unknown[]; estados?: unknown[]; orcamento?: unknown[] } = {},
): Promise<{ raizOrganizada: string; raizRelacionada: string; raizCalculada: string; raizRaw: string }> {
  const raizOrganizada = join(dir, 'organized')
  const raizRelacionada = join(dir, 'related')
  const raizCalculada = join(dir, 'calculated')
  const raizRaw = join(dir, 'raw')

  await mkdir(raizOrganizada, { recursive: true })
  await mkdir(raizRelacionada, { recursive: true })
  await mkdir(raizCalculada, { recursive: true })
  await mkdir(raizRaw, { recursive: true })

  await gravarJsonl(join(raizCalculada, 'municipio.jsonl'), municipios)
  await gravarJsonl(join(raizRelacionada, 'municipio.jsonl'), municipios)

  await gravarJsonl(
    join(raizOrganizada, 'ibge-localidades', 'estados.jsonl'),
    extras.estados ?? [{ codarea: '11', sigla: 'RO', nome: 'Rondônia' }],
  )
  if (extras.candidatos) {
    await gravarJsonl(join(raizCalculada, 'candidatos-por-municipio.jsonl'), extras.candidatos)
  }
  if (extras.orcamento) {
    await gravarJsonl(join(raizOrganizada, 'siconfi', 'dca.jsonl'), extras.orcamento)
  } else {
    await gravarJsonl(join(raizOrganizada, 'siconfi', 'dca.jsonl'), [])
  }

  return { raizOrganizada, raizRelacionada, raizCalculada, raizRaw }
}

// ---------------------------------------------------------------------------
// 1. Contrato
// ---------------------------------------------------------------------------

test('contrato: mapeia nomes calculados para publicados', () => {
  assert.equal(nomePublicado('pib_mil_reais'), 'pib')
  assert.equal(nomePublicado('receita_total'), 'receita')
  assert.equal(nomePublicado('pib_per_capita'), 'pibPerCapita')
})

test('contrato: aliases eliminados apontam para o nome canônico', () => {
  // Estes existiam no payload antigo e duplicavam metade do maior arquivo.
  assert.equal(ALIASES_ELIMINADOS['populacao_2024'], 'populacao')
  assert.equal(ALIASES_ELIMINADOS['pib_2021_reais'], 'pib')
  assert.equal(ALIASES_ELIMINADOS['receita_2023_reais'], 'receita')
})

test('contrato: rotas em português, sem caminhos legados', () => {
  const rotas = Object.values(ROTAS_FRONTEND).filter((v) => typeof v === 'string') as string[]
  for (const r of rotas) {
    assert.ok(!r.startsWith('indicators/'), `rota legada: ${r}`)
    assert.ok(!r.startsWith('explorer/'), `rota legada: ${r}`)
    assert.ok(!r.startsWith('maps/'), `rota legada: ${r}`)
    assert.match(r, /\.(json|geojson)$/)
  }
})

test('contrato: ufDoCodarea extrai os 2 primeiros dígitos', () => {
  assert.equal(ufDoCodarea('3550308'), '35')
  assert.equal(ufDoCodarea('11'), '11')
})

// ---------------------------------------------------------------------------
// 2. Formatador de município
// ---------------------------------------------------------------------------

test('municipio: publica apenas o nome canônico, sem aliases', () => {
  const m = formatarMunicipio(
    calculado('1100015', 'Alta Floresta', 'RO') as never,
    undefined,
    { lng: -62.39, lat: -12.47 },
    'RO',
  )

  // O payload antigo tinha 13 chaves; aqui são 10 canônicas.
  assert.deepEqual(Object.keys(m.metricas).sort(), [
    'candidatos',
    'densidade',
    'despesa',
    'educacao',
    'partidos',
    'pib',
    'pibPerCapita',
    'populacao',
    'receita',
    'saude',
  ])
  // Nenhum alias sobreviveu.
  const json = JSON.stringify(m)
  for (const alias of Object.keys(ALIASES_ELIMINADOS)) {
    assert.ok(!json.includes(`"${alias}"`), `alias vazou: ${alias}`)
  }
})

test('municipio: normaliza pib para a chave publicada', () => {
  const m = formatarMunicipio(calculado('1100015', 'X', 'RO') as never, undefined, undefined, 'RO')
  assert.equal(m.metricas.pib, 500_000)
  assert.equal(m.metricas.pibPerCapita, 50_000)
  assert.equal(m.metricas.densidade, 100)
})

test('municipio: incorpora candidatos quando existem', () => {
  const m = formatarMunicipio(
    calculado('1100015', 'X', 'RO') as never,
    { codarea: '1100015', ufSigla: 'RO', totalCandidatos: 71, candidatosPrefeito: 3, candidatosVereador: 65, partidosDistintos: 7, anoEleicao: 2024 },
    undefined,
    'RO',
  )
  assert.equal(m.metricas.candidatos, 71)
  assert.equal(m.metricas.partidos, 7)
  assert.equal(m.anos.eleicao, 2024)
})

test('municipio: sem candidatos, as métricas ficam nulas', () => {
  const m = formatarMunicipio(calculado('1100015', 'X', 'RO') as never, undefined, undefined, 'RO')
  assert.equal(m.metricas.candidatos, null)
  assert.equal(m.metricas.partidos, null)
})

test('municipio: saude e educacao vêm do orçamento absoluto', () => {
  const m = formatarMunicipio(
    calculado('1100015', 'X', 'RO') as never,
    undefined,
    undefined,
    'RO',
    {
      codarea: '1100015',
      exercicio: 2023,
      receitaTotal: 100,
      despesaTotal: 90,
      gastoSaude: 30,
      gastoEducacao: 20,
    },
  )
  assert.equal(m.metricas.saude, 30)
  assert.equal(m.metricas.educacao, 20)
})

test('indice: contém apenas campos de localização', () => {
  const m = formatarMunicipio(calculado('1100015', 'X', 'RO') as never, undefined, { lng: 1, lat: 2 }, 'RO')
  const i = formatarIndice(m)
  assert.deepEqual(Object.keys(i).sort(), ['codarea', 'lat', 'lng', 'nome', 'uf'])
  assert.equal((i as unknown as Record<string, unknown>)['metricas'], undefined)
})

// ---------------------------------------------------------------------------
// 3. Blocos
// ---------------------------------------------------------------------------

test('blocos: divide na quantidade pedida e ordena por codarea', () => {
  const municipios = Array.from({ length: 1200 }, (_, i) => ({
    codarea: String(1_000_000 + (1200 - i)),
    nome: `M${i}`,
    uf: 'RO',
    lng: 0,
    lat: 0,
    anos: { populacao: 2021, pib: 2021, orcamento: 2023, eleicao: 2024 },
    metricas: {
      populacao: null, pib: null, pibPerCapita: null, densidade: null,
      receita: null, despesa: null, saude: null, educacao: null,
      candidatos: null, partidos: null,
    },
  })) as MunicipioPublicado[]

  const blocos = dividirEmBlocos(municipios, 500)
  assert.equal(blocos.length, 3, '1200 / 500 = 3 blocos')
  assert.equal(blocos[0]?.length, 500)
  assert.equal(blocos[2]?.length, 200)
  // Ordenação determinística: primeiro bloco começa no menor código.
  const primeiro = blocos[0]?.[0]?.codarea ?? ''
  const ultimo = blocos[2]?.at(-1)?.codarea ?? ''
  assert.ok(primeiro < ultimo)
})

test('blocos: lista vazia produz zero blocos', () => {
  assert.equal(dividirEmBlocos([], 500).length, 0)
})

test('coordenadas: extrai mapa codarea -> lng/lat', () => {
  const m = formatarMunicipio(calculado('1100015', 'X', 'RO') as never, undefined, { lng: -62.39, lat: -12.47 }, 'RO')
  const coords = extrairCoordenadas([m])
  assert.deepEqual(coords['1100015'], { lng: -62.39, lat: -12.47 })
})

// ---------------------------------------------------------------------------
// 4. Ranking
// ---------------------------------------------------------------------------

test('ranking: agrega UFs somando apenas métricas aditivas', () => {
  const a = formatarMunicipio(calculado('1100015', 'A', 'RO') as never, undefined, undefined, 'RO')
  const b = formatarMunicipio(calculado('1100023', 'B', 'RO') as never, undefined, undefined, 'RO')

  const r = formatarRanking(
    [a, b],
    new Map([['11', { codarea: '11', sigla: 'RO', nome: 'Rondônia' }]]),
    '2026-01-01T00:00:00.000Z',
  )

  const ro = r.ufs[0]!
  assert.equal(ro.populacao, 20_000, 'população soma')
  assert.equal(ro.pib, 1_000_000, 'PIB soma')
  // Métrica relativa NÃO pode ser somada.
  assert.equal(ro.pibPerCapita, null, 'per capita não é somado')
})

test('ranking: inclui todos os municípios', () => {
  const a = formatarMunicipio(calculado('1100015', 'A', 'RO') as never, undefined, undefined, 'RO')
  const r = formatarRanking([a], new Map(), '2026-01-01T00:00:00.000Z')
  assert.equal(r.municipios.length, 1)
  assert.equal(r.municipios[0]?.codarea, '1100015')
})

// ---------------------------------------------------------------------------
// 5. Validação
// ---------------------------------------------------------------------------

test('validar: acusa rota ausente', async () => {
  await comTemp(async (dir) => {
    await mkdir(join(dir, 'municipios'), { recursive: true })
    await writeFile(join(dir, 'municipios', 'indice.json'), '{}')

    const r = validarPublicacao(dir)
    assert.equal(r.ok, false)
    assert.ok(r.ausentes.includes(ROTAS_FRONTEND.indicadoresBrasil))
    assert.ok(r.presentes.includes(ROTAS_FRONTEND.municipiosIndice))
  })
})

test('validar: ignora arquivos .gz e .tmp', async () => {
  await comTemp(async (dir) => {
    await mkdir(join(dir, 'municipios'), { recursive: true })
    await writeFile(join(dir, 'municipios', 'indice.json'), '{}')
    await writeFile(join(dir, 'municipios', 'indice.json.gz'), 'x')
    await writeFile(join(dir, 'municipios', 'rascunho.json.tmp'), 'x')

    const r = validarPublicacao(dir, [
      { rota: ROTAS_FRONTEND.municipiosIndice, origem: 'teste' },
    ])
    assert.equal(r.ok, true)
    assert.equal(r.orfaos.length, 0)
  })
})

test('validar: diretório vazio acusa tudo ausente', async () => {
  await comTemp(async (dir) => {
    const r = validarPublicacao(join(dir, 'nao-existe'))
    assert.equal(r.ok, false)
    assert.ok(r.ausentes.length > 0)
  })
})

test('validar: rotasExigidas cobre as 27 UFs de territórios', () => {
  const rotas = rotasExigidas(0).map((r) => r.rota)
  for (const uf of UFS) {
    assert.ok(rotas.includes(ROTAS_FRONTEND.territoriosUf(uf)), `falta território ${uf}`)
  }
})

// ---------------------------------------------------------------------------
// 6. Publicação ponta a ponta
// ---------------------------------------------------------------------------

test('publicar: gera índice, blocos e manifesto', async () => {
  await comTemp(async (dir) => {
    const raizSaida = join(dir, 'published')
    const fontes = await semearFontes(dir, [calculado('1100015', 'Alta Floresta', 'RO')])

    const r = await publicar({ ...fontes, raizSaida, comprimir: false, municipiosPorBloco: 500 })

    assert.ok(r.artefatos.length > 0)
    const caminhos = r.artefatos.map((a) => a.caminho)
    assert.ok(caminhos.includes(ROTAS_FRONTEND.municipiosIndice))
    assert.ok(caminhos.includes(ROTAS_FRONTEND.municipiosBloco(0)))
    assert.ok(caminhos.includes(ROTAS_FRONTEND.indicadoresBrasil))
    assert.ok(caminhos.includes(ROTAS_FRONTEND.ranking))

    const manifesto = JSON.parse(
      await readFile(join(raizSaida, 'publicacao.meta.json'), 'utf-8'),
    ) as Record<string, unknown>
    assert.equal(manifesto['versaoPublicacao'], '1.0.0')
    assert.equal((manifesto['contagens'] as Record<string, number>)['municipios'], 1)
  })
})

test('publicar: gera .gz quando pedido', async () => {
  await comTemp(async (dir) => {
    const raizSaida = join(dir, 'published')
    const fontes = await semearFontes(dir, [calculado('1100015', 'X', 'RO')])

    const r = await publicar({ ...fontes, raizSaida, comprimir: true })
    const comGz = r.artefatos.filter((a) => a.bytesGzip !== undefined)
    assert.ok(comGz.length > 0, 'todo artefato deve ter .gz')
    for (const a of comGz) {
      assert.ok((a.bytesGzip ?? 0) > 0)
    }
    assert.ok(r.totais.bytesGzip <= r.totais.bytes, 'comprimido não pode ser maior')
  })
})

test('publicar: sem compressão não cria .gz', async () => {
  await comTemp(async (dir) => {
    const raizSaida = join(dir, 'published')
    const fontes = await semearFontes(dir, [calculado('1100015', 'X', 'RO')])

    const r = await publicar({ ...fontes, raizSaida, comprimir: false })
    assert.ok(r.artefatos.every((a) => a.bytesGzip === undefined))
  })
})

test('publicar: limpa a saída anterior (não acumula builds)', async () => {
  await comTemp(async (dir) => {
    const raizSaida = join(dir, 'published')
    const fontes = await semearFontes(dir, [calculado('1100015', 'X', 'RO')])

    await mkdir(join(raizSaida, 'obsoleto'), { recursive: true })
    await writeFile(join(raizSaida, 'obsoleto', 'antigo.json'), '{}')

    await publicar({ ...fontes, raizSaida, comprimir: false })

    const { existsSync } = await import('node:fs')
    assert.equal(
      existsSync(join(raizSaida, 'obsoleto', 'antigo.json')),
      false,
      'artefato de build anterior não pode sobreviver',
    )
  })
})

test('publicar: sem municípios calculados, falha com mensagem acionável', async () => {
  await comTemp(async (dir) => {
    const fontes = await semearFontes(dir, [])
    await assert.rejects(
      () => publicar({ ...fontes, raizSaida: join(dir, 'published'), comprimir: false }),
      /rode as Caixas 4, 5 e 6/i,
    )
  })
})

test('publicar: o contrato fica atendido ponta a ponta', async () => {
  await comTemp(async (dir) => {
    const raizSaida = join(dir, 'published')
    // Semeia 27 UFs para satisfazer as rotas de território? Não: territórios
    // vêm das malhas (ausentes no teste). Validamos as rotas que a publicação
    // realmente gera, com a lista explícita.
    const fontes = await semearFontes(dir, [calculado('1100015', 'X', 'RO')])

    await publicar({ ...fontes, raizSaida, comprimir: false })

    const r = validarPublicacao(raizSaida, [
      { rota: ROTAS_FRONTEND.municipiosIndice, origem: 'teste' },
      { rota: ROTAS_FRONTEND.indicadoresBrasil, origem: 'teste' },
      { rota: ROTAS_FRONTEND.ranking, origem: 'teste' },
      { rota: ROTAS_FRONTEND.orcamentoBrasil, origem: 'teste' },
      { rota: ROTAS_FRONTEND.eleicoesBrasil, origem: 'teste' },
    ])
    assert.equal(r.ok, true, `ausentes: ${r.ausentes.join(', ')}`)
  })
})
