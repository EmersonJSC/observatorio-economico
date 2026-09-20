/**
 * Caixa 4 — ORGANIZAÇÃO: verificação.
 *
 * Testes com filesystem temporário. Nenhuma rede, nenhum dado real, nada é
 * gravado em `data/`.
 *
 * Uso:
 *   npx tsx --test scripts/organizacao/organizacao.test.ts
 *   npm run test:organizacao
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { converter, extrairCampo, lerCaminho } from './campos.js'
import { organizarRecurso } from './organizar.js'
import { tradutorEstados, tradutorMunicipios } from './tradutores/ibge-localidades.js'
import { ErroOrganizacao, type CampoMapeado, type Tradutor } from './tipos.js'

// ---------------------------------------------------------------------------
// Ajuda
// ---------------------------------------------------------------------------

/** Cria RAW e saída temporários isolados. */
async function comTemp<T>(
  fn: (ctx: { raizRaw: string; raizSaida: string }) => Promise<T>,
): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), 'org-test-'))
  const raizRaw = join(base, 'raw')
  const raizSaida = join(base, 'organized')
  try {
    return await fn({ raizRaw, raizSaida })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

/** Grava um objeto no RAW e devolve seu manifesto. */
async function semearRaw(
  raizRaw: string,
  fonteId: string,
  recursoId: string,
  objetos: unknown[],
  opcoes: { paginas?: boolean } = {},
): Promise<void> {
  const dir = join(raizRaw, fonteId, recursoId)
  await mkdir(join(dir, 'objetos'), { recursive: true })

  const registros = objetos.map((o, i) => {
    const hash = `hash${i}`.padEnd(64, '0')
    const arquivo = `${fonteId}/${recursoId}/objetos/${hash}.json`
    return { hash, arquivo, conteudo: o }
  })

  for (const r of registros) {
    await writeFile(join(raizRaw, r.arquivo), JSON.stringify(r.conteudo), 'utf-8')
  }

  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      fonteId,
      recursoId,
      versao: 1,
      criadoEm: '2026-01-01T00:00:00.000Z',
      atualizadoEm: '2026-01-01T00:00:00.000Z',
      objetos: registros.map((r, i) => ({
        hash: r.hash,
        arquivo: r.arquivo,
        extensao: '.json',
        tamanho: 10,
        formato: 'json',
        ...(opcoes.paginas ? { pagina: i + 1 } : {}),
      })),
      ultimoHash: registros.at(-1)?.hash,
    }),
    'utf-8',
  )
}

/** Lê um JSONL como array de objetos. */
async function lerJsonl(caminho: string): Promise<Array<Record<string, unknown>>> {
  const texto = await readFile(caminho, 'utf-8')
  return texto
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// 1. Conversores
// ---------------------------------------------------------------------------

test('conversor: texto limpa espaços e trata vazio como null', () => {
  assert.deepEqual(converter('  RO  ', 'texto'), { ok: true, valor: 'RO' })
  assert.deepEqual(converter('   ', 'texto'), { ok: true, valor: null })
})

test('conversor: código preserva zeros à esquerda', () => {
  // Crítico: o IBGE tem códigos como "11" que virariam 11 (number).
  assert.deepEqual(converter(11, 'codigo'), { ok: true, valor: '11' })
  assert.deepEqual(converter('0011', 'codigo'), { ok: true, valor: '0011' })
})

test('conversor: inteiro rejeita não-número em vez de gerar NaN', () => {
  assert.deepEqual(converter('42', 'inteiro'), { ok: true, valor: 42 })
  const r = converter('abc', 'inteiro')
  assert.equal(r.ok, false, 'não pode produzir NaN silencioso')
})

test('conversor: decimal aceita formato brasileiro', () => {
  assert.deepEqual(converter('1.234,56', 'decimal'), { ok: true, valor: 1234.56 })
  assert.deepEqual(converter('10,5', 'decimal'), { ok: true, valor: 10.5 })
})

test('conversor: booleano aceita S/N e true/false', () => {
  assert.deepEqual(converter('S', 'booleano'), { ok: true, valor: true })
  assert.deepEqual(converter('NÃO', 'booleano'), { ok: true, valor: false })
  assert.deepEqual(converter(true, 'booleano'), { ok: true, valor: true })
})

test('conversor: data valida ISO e normaliza', () => {
  assert.deepEqual(converter('2024-03-15', 'data'), { ok: true, valor: '2024-03-15' })
  assert.deepEqual(converter('2024-03-15T10:00:00Z', 'data'), { ok: true, valor: '2024-03-15' })
  assert.equal(converter('15/03/2024', 'data').ok, false)
})

test('lerCaminho: navega objetos aninhados', () => {
  const obj = { a: { b: { c: 7 } } }
  assert.equal(lerCaminho(obj, 'a.b.c'), 7)
  assert.equal(lerCaminho(obj, 'a.x'), undefined)
  assert.equal(lerCaminho(obj, 'a.b.c.d'), undefined)
})

test('extrairCampo: distingue ausente de nulo', () => {
  const campo: CampoMapeado = { origem: 'x', destino: 'x', tipo: 'texto', obrigatorio: true }
  assert.deepEqual(extrairCampo({ x: 'a' }, campo), { estado: 'ok', valor: 'a' })
  assert.deepEqual(extrairCampo({ x: '' }, campo), { estado: 'ok', valor: null })
  // Ausente é diferente de null: é o sintoma de coluna renomeada.
  assert.deepEqual(extrairCampo({ y: 'a' }, campo), { estado: 'ausente' })
})

test('extrairCampo: nulos conhecidos do IBGE viram null', () => {
  const campo: CampoMapeado = {
    origem: 'v',
    destino: 'v',
    tipo: 'decimal',
    obrigatorio: true,
    nulosConhecidos: ['-', '...', 'X', 'C'],
  }
  assert.deepEqual(extrairCampo({ v: '-' }, campo), { estado: 'ok', valor: null })
  assert.deepEqual(extrairCampo({ v: '...' }, campo), { estado: 'ok', valor: null })
  assert.deepEqual(extrairCampo({ v: '3,5' }, campo), { estado: 'ok', valor: 3.5 })
})

// ---------------------------------------------------------------------------
// 2. Organização: caminho feliz
// ---------------------------------------------------------------------------

test('organiza: grava JSONL e metadados', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    await semearRaw(raizRaw, 'ibge-localidades', 'estados', [
      [{ id: 11, sigla: 'RO', nome: 'Rondônia', regiao: { id: 1, sigla: 'N', nome: 'Norte' } }],
    ])

    const r = await organizarRecurso(tradutorEstados, { raizRaw, raizSaida })

    assert.equal(r.contagens.lidas, 1)
    assert.equal(r.contagens.gravadas, 1)
    assert.equal(r.contagens.quarentenadas, 0)

    const linhas = await lerJsonl(join(raizSaida, 'ibge-localidades', 'estados.jsonl'))
    assert.deepEqual(linhas[0], {
      codarea: '11',
      sigla: 'RO',
      nome: 'Rondônia',
      regiaoCodigo: '1',
      regiaoSigla: 'N',
      regiaoNome: 'Norte',
    })
  })
})

test('organiza: metadados registram versão, contagens e hashes', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    await semearRaw(raizRaw, 'ibge-localidades', 'estados', [[{ id: 11, sigla: 'RO', nome: 'R' }]])
    await organizarRecurso(tradutorEstados, { raizRaw, raizSaida })

    const meta = JSON.parse(
      await readFile(join(raizSaida, 'ibge-localidades', 'estados.meta.json'), 'utf-8'),
    ) as Record<string, unknown>

    assert.equal(meta.fonteId, 'ibge-localidades')
    assert.equal(meta.recursoId, 'estados')
    assert.equal(meta.versaoOrganizacao, '1.0.0')
    assert.equal(meta.versaoEsquema, 1)
    assert.equal(meta.objetosRaw, 1)
    assert.equal((meta.origensRaw as string[]).length, 1)
  })
})

test('organiza: nenhum arquivo .tmp permanece', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    await semearRaw(raizRaw, 'ibge-localidades', 'estados', [[{ id: 11, sigla: 'RO', nome: 'R' }]])
    await organizarRecurso(tradutorEstados, { raizRaw, raizSaida })
    const { readdir } = await import('node:fs/promises')
    const arquivos = await readdir(join(raizSaida, 'ibge-localidades'))
    assert.equal(arquivos.filter((f) => f.endsWith('.tmp')).length, 0)
  })
})

// ---------------------------------------------------------------------------
// 3. Paginação: N objetos → 1 JSONL
// ---------------------------------------------------------------------------

test('paginação: 3 objetos do RAW viram um único JSONL contínuo', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    await semearRaw(
      raizRaw,
      'ibge-localidades',
      'estados',
      [
        [{ id: 11, sigla: 'RO', nome: 'Rondônia' }],
        [{ id: 12, sigla: 'AC', nome: 'Acre' }],
        [{ id: 13, sigla: 'AM', nome: 'Amazonas' }],
      ],
      { paginas: true },
    )

    const r = await organizarRecurso(tradutorEstados, { raizRaw, raizSaida })
    assert.equal(r.contagens.gravadas, 3)
    assert.equal(r.metadados.objetosRaw, 3)

    const linhas = await lerJsonl(join(raizSaida, 'ibge-localidades', 'estados.jsonl'))
    assert.equal(linhas.length, 3)
    assert.deepEqual(linhas.map((l) => l.sigla), ['RO', 'AC', 'AM'])
  })
})

// ---------------------------------------------------------------------------
// 4. Campo obrigatório ausente ABORTA
// ---------------------------------------------------------------------------

test('aborta: campo obrigatório ausente interrompe a organização', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    // Sem "sigla" — simula renomeação de coluna no layout do governo.
    await semearRaw(raizRaw, 'ibge-localidades', 'estados', [
      [{ id: 11, nome: 'Rondônia' }],
    ])

    await assert.rejects(
      () => organizarRecurso(tradutorEstados, { raizRaw, raizSaida }),
      (err: unknown) => {
        assert.ok(err instanceof ErroOrganizacao)
        assert.equal(err.motivo, 'campo-obrigatorio-ausente')
        assert.match(err.message, /sigla/)
        return true
      },
    )
  })
})

test('aborta: não deixa JSONL parcial após o aborto', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    await semearRaw(raizRaw, 'ibge-localidades', 'estados', [[{ id: 11, nome: 'Rondônia' }]])
    await assert.rejects(() => organizarRecurso(tradutorEstados, { raizRaw, raizSaida }))

    const { existsSync } = await import('node:fs')
    assert.equal(
      existsSync(join(raizSaida, 'ibge-localidades', 'estados.jsonl')),
      false,
      'saída parcial não pode parecer boa',
    )
  })
})

// ---------------------------------------------------------------------------
// 5. Quarentena
// ---------------------------------------------------------------------------

test('quarentena: valor sujo vai para *.quarentena.jsonl', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    const tradutor: Tradutor = {
      fonteId: 'teste',
      recursoId: 'r',
      versaoEsquema: 1,
      leitura: { tipo: 'json-colecao' },
      campos: [
        { origem: 'id', destino: 'id', tipo: 'codigo', obrigatorio: true },
        { origem: 'valor', destino: 'valor', tipo: 'inteiro', obrigatorio: true },
      ],
    }

    // 200 linhas com 1 suja = 0,5%, abaixo do limiar de 1%.
    const linhas = Array.from({ length: 200 }, (_, i) =>
      i === 0 ? { id: '0', valor: 'nao-numero' } : { id: String(i), valor: i },
    )
    await semearRaw(raizRaw, 'teste', 'r', [linhas])

    const r = await organizarRecurso(tradutor, { raizRaw, raizSaida })
    assert.equal(r.contagens.lidas, 200)
    assert.equal(r.contagens.gravadas, 199)
    assert.equal(r.contagens.quarentenadas, 1)
    assert.ok(r.quarentena)

    const quar = await lerJsonl(join(raizSaida, 'teste', 'r.quarentena.jsonl'))
    assert.equal(quar.length, 1)
    assert.equal(quar[0]?.motivo, 'tipo-invalido')
    assert.deepEqual(quar[0]?.bruto, { id: '0', valor: 'nao-numero' })
  })
})

test('quarentena: sem linhas ruins, o arquivo não é criado', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    await semearRaw(raizRaw, 'ibge-localidades', 'estados', [[{ id: 11, sigla: 'RO', nome: 'R' }]])
    const r = await organizarRecurso(tradutorEstados, { raizRaw, raizSaida })

    assert.equal(r.quarentena, undefined)
    const { existsSync } = await import('node:fs')
    assert.equal(existsSync(join(raizSaida, 'ibge-localidades', 'estados.quarentena.jsonl')), false)
  })
})

// ---------------------------------------------------------------------------
// 6. Limiar de 1% ABORTA
// ---------------------------------------------------------------------------

test('limiar: quarentena acima de 1% aborta a tradução inteira', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    const tradutor: Tradutor = {
      fonteId: 'teste',
      recursoId: 'r',
      versaoEsquema: 1,
      leitura: { tipo: 'json-colecao' },
      campos: [
        { origem: 'id', destino: 'id', tipo: 'codigo', obrigatorio: true },
        { origem: 'valor', destino: 'valor', tipo: 'inteiro', obrigatorio: true },
      ],
    }

    // 100 linhas, 5 sujas = 5% > 1%.
    const linhas = Array.from({ length: 100 }, (_, i) =>
      i < 5 ? { id: String(i), valor: 'sujo' } : { id: String(i), valor: i },
    )
    await semearRaw(raizRaw, 'teste', 'r', [linhas])

    await assert.rejects(
      () => organizarRecurso(tradutor, { raizRaw, raizSaida }),
      (err: unknown) => {
        assert.ok(err instanceof ErroOrganizacao)
        assert.equal(err.motivo, 'limiar-quarentena')
        assert.match(err.message, /5\.00%/)
        return true
      },
    )
  })
})

test('limiar: quarentena dentro do 1% é aceita', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    const tradutor: Tradutor = {
      fonteId: 'teste',
      recursoId: 'r',
      versaoEsquema: 1,
      leitura: { tipo: 'json-colecao' },
      campos: [
        { origem: 'id', destino: 'id', tipo: 'codigo', obrigatorio: true },
        { origem: 'valor', destino: 'valor', tipo: 'inteiro', obrigatorio: true },
      ],
    }

    // 200 linhas, 1 suja = 0,5% < 1%.
    const linhas = Array.from({ length: 200 }, (_, i) =>
      i === 0 ? { id: '0', valor: 'sujo' } : { id: String(i), valor: i },
    )
    await semearRaw(raizRaw, 'teste', 'r', [linhas])

    const r = await organizarRecurso(tradutor, { raizRaw, raizSaida })
    assert.equal(r.contagens.gravadas, 199)
    assert.equal(r.contagens.quarentenadas, 1)
  })
})

test('limiar: exatamente 1% é aceito (o limite é estrito, >)', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    const tradutor: Tradutor = {
      fonteId: 'teste',
      recursoId: 'r',
      versaoEsquema: 1,
      leitura: { tipo: 'json-colecao' },
      campos: [
        { origem: 'id', destino: 'id', tipo: 'codigo', obrigatorio: true },
        { origem: 'valor', destino: 'valor', tipo: 'inteiro', obrigatorio: true },
      ],
    }

    // 1000 linhas, 10 sujas = exatamente 1,00%.
    const linhas = Array.from({ length: 1000 }, (_, i) =>
      i < 10 ? { id: String(i), valor: 'sujo' } : { id: String(i), valor: i },
    )
    await semearRaw(raizRaw, 'teste', 'r', [linhas])

    const r = await organizarRecurso(tradutor, { raizRaw, raizSaida })
    assert.equal(r.contagens.quarentenadas, 10)
    assert.equal(r.contagens.gravadas, 990)
  })
})

// ---------------------------------------------------------------------------
// 7. Tradutor real: municípios com UF em dois caminhos
// ---------------------------------------------------------------------------

test('ibge: município com UF via mesorregião', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    await semearRaw(raizRaw, 'ibge-localidades', 'municipios-por-uf', [
      [
        {
          id: 1100015,
          nome: 'Alta Floresta D\u2019Oeste',
          microrregiao: {
            id: 11006,
            nome: 'Cacoal',
            mesorregiao: { id: 1102, nome: 'Leste', UF: { id: 11, sigla: 'RO' } },
          },
        },
      ],
    ])

    const r = await organizarRecurso(tradutorMunicipios, { raizRaw, raizSaida })
    const linha = (await lerJsonl(join(raizSaida, 'ibge-localidades', 'municipios-por-uf.jsonl')))[0]!

    assert.equal(linha.codarea, '1100015')
    assert.equal(linha.ufCodigo, '11')
    assert.equal(linha.ufSigla, 'RO')
    assert.equal(linha.ufCodigoAlternativo, undefined, 'campo alternativo é removido')
  })
})

test('ibge: município com UF apenas via região imediata', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    await semearRaw(raizRaw, 'ibge-localidades', 'municipios-por-uf', [
      [
        {
          id: 1100015,
          nome: 'Teste',
          'regiao-imediata': {
            id: 110005,
            nome: 'Cacoal',
            'regiao-intermediaria': { UF: { id: 11, sigla: 'RO' } },
          },
        },
      ],
    ])

    await organizarRecurso(tradutorMunicipios, { raizRaw, raizSaida })
    const linha = (await lerJsonl(join(raizSaida, 'ibge-localidades', 'municipios-por-uf.jsonl')))[0]!

    assert.equal(linha.ufCodigo, '11', 'cai no caminho alternativo')
    assert.equal(linha.ufSigla, 'RO')
  })
})

test('ibge: município sem id vai para quarentena', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    // 200 registros com 1 sem id = 0,5%, dentro do limiar.
    const registros = Array.from({ length: 200 }, (_, i) =>
      i === 0 ? { nome: 'Sem ID' } : { id: 1100015 + i, nome: `Município ${i}` },
    )
    await semearRaw(raizRaw, 'ibge-localidades', 'municipios-por-uf', [registros])

    const r = await organizarRecurso(tradutorMunicipios, { raizRaw, raizSaida })
    assert.equal(r.contagens.quarentenadas, 1)
    assert.equal(r.contagens.gravadas, 199)

    const quar = await lerJsonl(join(raizSaida, 'ibge-localidades', 'municipios-por-uf.quarentena.jsonl'))
    assert.equal(quar[0]?.motivo, 'campo-obrigatorio-ausente')
  })
})

// ---------------------------------------------------------------------------
// 8. RAW ausente
// ---------------------------------------------------------------------------

test('raw-ausente: recurso não coletado falha com mensagem clara', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    await assert.rejects(
      () => organizarRecurso(tradutorEstados, { raizRaw, raizSaida }),
      (err: unknown) => {
        assert.ok(err instanceof ErroOrganizacao)
        assert.equal(err.motivo, 'raw-ausente')
        return true
      },
    )
  })
})

// ---------------------------------------------------------------------------
// 9. Streaming: memória não cresce com o volume
// ---------------------------------------------------------------------------

test('stream: muitas linhas são gravadas incrementalmente', async () => {
  await comTemp(async ({ raizRaw, raizSaida }) => {
    // 5.000 registros — o escritor usa appendFile, memória O(1).
    const linhas = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, sigla: `S${i}`, nome: `N${i}` }))
    await semearRaw(raizRaw, 'ibge-localidades', 'estados', [linhas])

    const antes = process.memoryUsage().heapUsed
    const r = await organizarRecurso(tradutorEstados, { raizRaw, raizSaida })
    const depois = process.memoryUsage().heapUsed

    assert.equal(r.contagens.gravadas, 5000)
    const linhasGravadas = await lerJsonl(join(raizSaida, 'ibge-localidades', 'estados.jsonl'))
    assert.equal(linhasGravadas.length, 5000)

    // Folga generosa: o ponto é não acumular todos os registros em memória.
    const crescimentoMb = (depois - antes) / 1024 / 1024
    assert.ok(crescimentoMb < 50, `crescimento de heap suspeito: ${crescimentoMb.toFixed(1)}MB`)
  })
})
