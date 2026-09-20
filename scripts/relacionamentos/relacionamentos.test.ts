/**
 * Caixa 5 — RELACIONAMENTOS: verificação.
 *
 * Testes com JSONL sintéticos em diretório temporário. Nenhuma rede, nenhum
 * dado real de produção, nada gravado em `data/`.
 *
 * Uso:
 *   npx tsx --test scripts/relacionamentos/relacionamentos.test.ts
 *   npm run test:relacionamentos
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chaveCasamento, normalizarCodarea, normalizarCodigoTse, normalizarNome } from './normalizacao.js'
import { carregarMunicipiosIbge } from './entidades/ibge.js'
import { carregarUnidadesTse } from './entidades/tse.js'
import { casarPorNome } from './estrategias/nome-normalizado.js'
import { EXCECOES_TSE_IBGE, indexarExcecoes } from './estrategias/excecoes.js'
import { construirPonteMunicipios } from './ponte.js'
import { ErroRelacionamento } from './tipos.js'

// ---------------------------------------------------------------------------
// Ajuda
// ---------------------------------------------------------------------------

async function comTemp<T>(
  fn: (ctx: { raizOrganizada: string; raizSaida: string }) => Promise<T>,
): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), 'rel-test-'))
  try {
    return await fn({
      raizOrganizada: join(base, 'organized'),
      raizSaida: join(base, 'related'),
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

/** Grava um JSONL a partir de uma lista de objetos. */
async function gravarJsonl(caminho: string, registros: unknown[]): Promise<void> {
  await mkdir(join(caminho, '..'), { recursive: true })
  await writeFile(caminho, registros.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8')
}

/** Semeia as duas fontes da Caixa 4. */
async function semearFontes(
  raizOrganizada: string,
  municipios: unknown[],
  candidatos: unknown[],
): Promise<void> {
  await gravarJsonl(
    join(raizOrganizada, 'ibge-localidades', 'municipios-por-uf.jsonl'),
    municipios,
  )
  await gravarJsonl(join(raizOrganizada, 'tse', 'cdn-dados-abertos.jsonl'), candidatos)
}

/** Município no formato da Caixa 4. */
const muni = (codarea: string, nome: string, ufSigla: string, ufCodigo = '11') => ({
  codarea,
  nome,
  ufSigla,
  ufCodigo,
})

/** Candidato no formato da Caixa 4 (só os campos que a Caixa 5 usa). */
const cand = (unidadeEleitoral: string, nomeUnidadeEleitoral: string, ufSigla: string) => ({
  anoEleicao: 2024,
  unidadeEleitoral,
  nomeUnidadeEleitoral,
  ufSigla,
  sequencialCandidato: '1',
})

/** Lê um JSONL como array. */
async function lerJsonl(caminho: string): Promise<Array<Record<string, unknown>>> {
  const texto = await readFile(caminho, 'utf-8')
  return texto
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// 1. Normalização
// ---------------------------------------------------------------------------

test('normaliza: minúsculas, acentos e espaços', () => {
  assert.equal(normalizarNome('São Paulo'), 'sao paulo')
  assert.equal(normalizarNome('  SÃO   PAULO  '), 'sao paulo')
})

test('normaliza: apóstrofo e hífen viram espaço', () => {
  // TSE escreve "OLHO D'ÁGUA"; IBGE escreve "Olho d'Água".
  assert.equal(normalizarNome("Olho D'Água"), normalizarNome('OLHO D ÁGUA'))
  assert.equal(normalizarNome('Xique-Xique'), 'xique xique')
})

test('normaliza: remove artigos, conectivos e o "d" solto do apóstrofo', () => {
  assert.equal(normalizarNome('União da Vitória'), 'uniao vitoria')
  assert.equal(normalizarNome("Dias d'Ávila"), 'dias avila')
  // O apóstrofo vira espaço e o "d" sobra; ele precisa sair para que
  // "Espigão D'Oeste" (IBGE) case com "ESPIGÃO DO OESTE" (TSE).
  assert.equal(normalizarNome("Espigão D'Oeste"), 'espigao oeste')
  assert.equal(normalizarNome('ESPIGÃO DO OESTE'), 'espigao oeste')
  assert.equal(normalizarNome("Alvorada D'Oeste"), normalizarNome('ALVORADA DO OESTE'))
})

test('normaliza: TSE maiúsculo casa com IBGE capitalizado', () => {
  const casos: Array<[string, string]> = [
    ['SÃO JOÃO DEL-REI', 'São João del-Rei'],
    ['TARAUACÁ', 'Tarauacá'],
    ['XIQUE-XIQUE', 'Xique-Xique'],
    ['DIAS D\u2019ÁVILA', "Dias d'Ávila"],
  ]
  for (const [tse, ibge] of casos) {
    assert.equal(normalizarNome(tse), normalizarNome(ibge), `${tse} ↔ ${ibge}`)
  }
})

test('normaliza: preserva números (distritos homônimos são lugares distintos)', () => {
  assert.notEqual(normalizarNome('União da Vitória'), normalizarNome('União da Vitória II'))
})

test('normaliza: chave de casamento inclui a UF', () => {
  assert.equal(chaveCasamento('mg', 'São João del-Rei'), 'MG|sao joao del rei')
  // "Bom Jesus" existe em várias UFs — não podem colidir.
  assert.notEqual(chaveCasamento('MG', 'Bom Jesus'), chaveCasamento('PI', 'Bom Jesus'))
})

test('normaliza: códigos preservam zeros à esquerda', () => {
  assert.equal(normalizarCodarea('1100015'), '1100015')
  assert.equal(normalizarCodarea(1100015), '1100015')
  assert.equal(normalizarCodigoTse('310'), '00310')
  assert.equal(normalizarCodigoTse('00310'), '00310')
})

// ---------------------------------------------------------------------------
// 2. Carregamento de entidades
// ---------------------------------------------------------------------------

test('ibge: carrega municípios indexados por UF+nome', async () => {
  await comTemp(async ({ raizOrganizada }) => {
    await semearFontes(
      raizOrganizada,
      [muni('1100015', "Alta Floresta D'Oeste", 'RO'), muni('3106200', 'Belo Horizonte', 'MG', '31')],
      [],
    )
    const indice = await carregarMunicipiosIbge(
      join(raizOrganizada, 'ibge-localidades', 'municipios-por-uf.jsonl'),
    )
    assert.equal(indice.size, 2)
    assert.ok(indice.has(chaveCasamento('RO', "Alta Floresta D'Oeste")))
    assert.equal(indice.get(chaveCasamento('MG', 'Belo Horizonte'))?.codarea, '3106200')
  })
})

test('tse: reduz 463k candidatos a unidades distintas', async () => {
  await comTemp(async ({ raizOrganizada }) => {
    // 5 candidatos, mas apenas 2 unidades eleitorais distintas.
    await semearFontes(raizOrganizada, [], [
      cand('00310', "ALTA FLORESTA D'OESTE", 'RO'),
      cand('00310', "ALTA FLORESTA D'OESTE", 'RO'),
      cand('00310', "ALTA FLORESTA D'OESTE", 'RO'),
      cand('66000', 'PORTO VELHO', 'RO'),
      cand('66000', 'PORTO VELHO', 'RO'),
    ])

    const unidades = await carregarUnidadesTse(
      join(raizOrganizada, 'tse', 'cdn-dados-abertos.jsonl'),
    )
    assert.equal(unidades.size, 2, 'deduplica por UF+código')
    assert.equal(unidades.get('RO|00310')?.nome, "ALTA FLORESTA D'OESTE")
  })
})

test('tse: ignora linhas sem unidade eleitoral', async () => {
  await comTemp(async ({ raizOrganizada }) => {
    await semearFontes(raizOrganizada, [], [
      cand('00310', 'CIDADE A', 'RO'),
      { anoEleicao: 2024, ufSigla: 'RO' }, // sem unidade
      { anoEleicao: 2024, unidadeEleitoral: '1' }, // sem UF
    ])
    const unidades = await carregarUnidadesTse(
      join(raizOrganizada, 'tse', 'cdn-dados-abertos.jsonl'),
    )
    assert.equal(unidades.size, 1)
  })
})

// ---------------------------------------------------------------------------
// 3. Casamento
// ---------------------------------------------------------------------------

test('casar: nome exato normalizado casa', async () => {
  await comTemp(async ({ raizOrganizada }) => {
    await semearFontes(raizOrganizada, [muni('1100015', "Alta Floresta D'Oeste", 'RO')], [])
    const indice = await carregarMunicipiosIbge(
      join(raizOrganizada, 'ibge-localidades', 'municipios-por-uf.jsonl'),
    )

    const r = casarPorNome(
      { codigoUe: '00310', nome: "ALTA FLORESTA D'OESTE", ufSigla: 'RO' },
      indice,
    )
    assert.equal(r.tipo, 'casado')
    assert.equal(r.tipo === 'casado' ? r.municipio.codarea : '', '1100015')
  })
})

test('casar: mesmo nome em UF diferente NÃO casa', async () => {
  await comTemp(async ({ raizOrganizada }) => {
    await semearFontes(raizOrganizada, [muni('3106200', 'Bom Jesus', 'MG', '31')], [])
    const indice = await carregarMunicipiosIbge(
      join(raizOrganizada, 'ibge-localidades', 'municipios-por-uf.jsonl'),
    )

    // "Bom Jesus" do PI não pode casar com o de MG.
    const r = casarPorNome({ codigoUe: '12345', nome: 'BOM JESUS', ufSigla: 'PI' }, indice)
    assert.equal(r.tipo, 'sem-match')
  })
})

test('casar: nome vazio não casa', async () => {
  await comTemp(async ({ raizOrganizada }) => {
    await semearFontes(raizOrganizada, [muni('1100015', 'Cidade', 'RO')], [])
    const indice = await carregarMunicipiosIbge(
      join(raizOrganizada, 'ibge-localidades', 'municipios-por-uf.jsonl'),
    )
    assert.equal(casarPorNome({ codigoUe: '1', nome: '', ufSigla: 'RO' }, indice).tipo, 'sem-match')
  })
})

// ---------------------------------------------------------------------------
// 4. Exceções auditadas
// ---------------------------------------------------------------------------

test('excecoes: todas têm motivo e UF válida', () => {
  assert.ok(EXCECOES_TSE_IBGE.length > 0)
  for (const e of EXCECOES_TSE_IBGE) {
    assert.match(e.ufSigla, /^[A-Z]{2}$/, `UF inválida em ${e.nomeTse}`)
    assert.match(e.codarea, /^\d{7}$/, `codarea inválido em ${e.nomeTse}`)
    assert.ok(
      e.motivo.trim().length > 10,
      `exceção sem motivo útil: ${e.nomeTse} (exceção sem justificativa é dívida)`,
    )
  }
})

test('excecoes: não há chave duplicada', () => {
  const indice = indexarExcecoes()
  assert.equal(indice.size, EXCECOES_TSE_IBGE.length)
})

// ---------------------------------------------------------------------------
// 5. Ponte: caminho feliz
// ---------------------------------------------------------------------------

test('ponte: grava vínculo com método e confiança', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    await semearFontes(
      raizOrganizada,
      [muni('1100015', "Alta Floresta D'Oeste", 'RO')],
      [cand('00310', "ALTA FLORESTA D'OESTE", 'RO')],
    )

    const r = await construirPonteMunicipios({ raizOrganizada, raizSaida })
    assert.equal(r.contagens.casados, 1)
    assert.equal(r.contagens.orfaos, 0)

    const linhas = await lerJsonl(join(raizSaida, 'municipio.jsonl'))
    assert.equal(linhas.length, 1)

    const l = linhas[0] as Record<string, never>
    assert.equal(l['codarea'], '1100015')
    assert.equal(l['metodoMatch'], 'nome-exato')
    assert.equal(l['confianca'], 'alta')
    assert.equal((l['origens'] as Record<string, Record<string, string>>)['tse']!['id'], '00310')
  })
})

test('ponte: aplica exceção auditada', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    // Camacan: TSE escreve "CAMACÃ", IBGE "Camacan".
    await semearFontes(
      raizOrganizada,
      [muni('2905602', 'Camacan', 'BA', '29')],
      [cand('34500', 'CAMACÃ', 'BA')],
    )

    const r = await construirPonteMunicipios({ raizOrganizada, raizSaida })
    assert.equal(r.contagens.porExcecao, 1)

    const linhas = await lerJsonl(join(raizSaida, 'municipio.jsonl'))
    assert.equal((linhas[0] as Record<string, string>)['metodoMatch'], 'excecao-auditada')
    assert.equal((linhas[0] as Record<string, string>)['confianca'], 'revisada')
    assert.equal((linhas[0] as Record<string, string>)['codarea'], '2905602')
  })
})

test('ponte: saída ordenada pela chave mestra', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    await semearFontes(
      raizOrganizada,
      [muni('3106200', 'Belo Horizonte', 'MG', '31'), muni('1100015', 'Ariquemes', 'RO')],
      [cand('66000', 'BELO HORIZONTE', 'MG'), cand('00310', 'ARIQUEMES', 'RO')],
    )

    await construirPonteMunicipios({ raizOrganizada, raizSaida })
    const linhas = await lerJsonl(join(raizSaida, 'municipio.jsonl'))
    const codigos = linhas.map((l) => l['codarea'])
    assert.deepEqual(codigos, ['1100015', '3106200'], 'ordenado por codarea')
  })
})

// ---------------------------------------------------------------------------
// 6. Órfãos
// ---------------------------------------------------------------------------

test('orfaos: município sem eleição municipal é ausente-na-fonte, não erro', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    // Fernando de Noronha e Brasília legitimamente não têm eleição municipal.
    await semearFontes(
      raizOrganizada,
      [muni('2605459', 'Fernando de Noronha', 'PE', '26'), muni('5300108', 'Brasília', 'DF', '53')],
      [],
    )

    const r = await construirPonteMunicipios({ raizOrganizada, raizSaida })
    assert.equal(r.contagens.orfaos, 2)
    assert.equal(r.contagens.orfaosACorrigir, 0, 'não exigem revisão humana')

    const orfaos = await lerJsonl(join(raizSaida, 'orfaos.jsonl'))
    assert.equal(orfaos.length, 2)
    for (const o of orfaos) {
      assert.equal(o['classe'], 'ausente-na-fonte')
      assert.ok(String(o['detalhe']).length > 20, 'órfão precisa explicar a causa')
    }
  })
})

test('orfaos: unidade do TSE sem par vira nao-correspondido', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    // 200 municípios, 199 casando. Só 1 órfão a corrigir = 0,5%, sob o limiar.
    const municipios = Array.from({ length: 199 }, (_, i) =>
      muni(`11000${String(i).padStart(2, '0')}`, `Cidade ${i}`, 'RO'),
    )
    const candidatos = municipios.map((m, i) => cand(`9000${i}`, String(m.nome).toUpperCase(), 'RO'))
    // Uma unidade do TSE sem par no IBGE.
    candidatos.push(cand('99999', 'CIDADE INEXISTENTE', 'RO'))

    await semearFontes(raizOrganizada, municipios, candidatos)

    const r = await construirPonteMunicipios({ raizOrganizada, raizSaida })
    assert.equal(r.contagens.casados, 199)
    assert.equal(r.contagens.orfaosACorrigir, 1)

    const orfaos = await lerJsonl(join(raizSaida, 'orfaos.jsonl'))
    const tse = orfaos.find((o) => o['lado'] === 'tse')
    assert.equal(tse?.['classe'], 'nao-correspondido')
    assert.match(String(tse?.['detalhe']), /excecoes\.ts/, 'deve indicar como resolver')
  })
})

// ---------------------------------------------------------------------------
// 7. Limiar
// ---------------------------------------------------------------------------

test('limiar: órfãos a corrigir acima do limiar abortam', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    // 100 municípios no IBGE, nenhum casando → 100% de órfãos a corrigir.
    await semearFontes(
      raizOrganizada,
      Array.from({ length: 100 }, (_, i) => muni(`11000${String(i).padStart(2, '0')}`, `Cidade ${i}`, 'RO')),
      [cand('99999', 'OUTRA COISA', 'RO')],
    )

    await assert.rejects(
      () => construirPonteMunicipios({ raizOrganizada, raizSaida }),
      (err: unknown) => {
        assert.ok(err instanceof ErroRelacionamento)
        assert.equal(err.motivo, 'limiar-orfaos')
        assert.match(err.message, /acima do limiar/)
        return true
      },
    )
  })
})

test('limiar: nada é gravado quando aborta', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    await semearFontes(
      raizOrganizada,
      Array.from({ length: 100 }, (_, i) => muni(`11000${String(i).padStart(2, '0')}`, `Cidade ${i}`, 'RO')),
      [cand('99999', 'OUTRA COISA', 'RO')],
    )
    await assert.rejects(() => construirPonteMunicipios({ raizOrganizada, raizSaida }))

    const { existsSync } = await import('node:fs')
    assert.equal(
      existsSync(join(raizSaida, 'municipio.jsonl')),
      false,
      'ponte fora do tolerável não pode ser publicada',
    )
  })
})

test('limiar: ausente-na-fonte não conta para o limiar', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    // Só órfãos legítimos → taxa de correção zero, não aborta.
    await semearFontes(
      raizOrganizada,
      [muni('2605459', 'Fernando de Noronha', 'PE', '26'), muni('5300108', 'Brasília', 'DF', '53')],
      [],
    )
    const r = await construirPonteMunicipios({ raizOrganizada, raizSaida })
    assert.equal(r.metadados.taxaOrfaos, 0)
  })
})

test('limiar: limite customizado é respeitado', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    // 100 municípios, 90 casando → 10 órfãos a corrigir = ~5% (abortaria em 1%).
    const municipios = Array.from({ length: 100 }, (_, i) =>
      muni(`11000${String(i).padStart(2, '0')}`, `Cidade ${i}`, 'RO'),
    )
    const candidatos = municipios
      .slice(0, 90)
      .map((m, i) => cand(`9000${i}`, String(m.nome).toUpperCase(), 'RO'))
    await semearFontes(raizOrganizada, municipios, candidatos)

    // Com limiar padrão (1%) abortaria.
    await assert.rejects(() => construirPonteMunicipios({ raizOrganizada, raizSaida }))

    // Com limiar de 10%, passa.
    const r = await construirPonteMunicipios({ raizOrganizada, raizSaida, limiarOrfaos: 0.1 })
    assert.equal(r.contagens.casados, 90)
    assert.equal(r.contagens.orfaosACorrigir, 10)
    assert.ok(r.metadados.limiarOrfaos === 0.1, 'limiar customizado vai para os metadados')
  })
})

// ---------------------------------------------------------------------------
// 8. Metadados e fonte ausente
// ---------------------------------------------------------------------------

test('meta: registra versão das fontes e contagens', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    await semearFontes(
      raizOrganizada,
      [muni('1100015', 'Ariquemes', 'RO')],
      [cand('00310', 'ARIQUEMES', 'RO')],
    )
    await construirPonteMunicipios({ raizOrganizada, raizSaida })

    const meta = JSON.parse(
      await readFile(join(raizSaida, 'relacionamentos.meta.json'), 'utf-8'),
    ) as Record<string, unknown>

    assert.equal(meta['versaoRelacionamentos'], '1.0.0')
    assert.equal(meta['limiarOrfaos'], 0.01)
    const origens = meta['origens'] as Record<string, string>
    assert.ok(origens['ibge'] && origens['tse'], 'registra as duas fontes consumidas')
    assert.equal((meta['contagens'] as Record<string, number>)['casados'], 1)
  })
})

test('fonte ausente: falha com mensagem acionável', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    // Nenhuma fonte semeada.
    await assert.rejects(
      () => construirPonteMunicipios({ raizOrganizada, raizSaida }),
      (err: unknown) => {
        assert.ok(err instanceof ErroRelacionamento)
        assert.equal(err.motivo, 'fonte-ausente')
        assert.match(err.message, /Caixa 4/)
        return true
      },
    )
  })
})

test('sem .tmp remanescente após sucesso', async () => {
  await comTemp(async ({ raizOrganizada, raizSaida }) => {
    await semearFontes(
      raizOrganizada,
      [muni('1100015', 'Ariquemes', 'RO')],
      [cand('00310', 'ARIQUEMES', 'RO')],
    )
    await construirPonteMunicipios({ raizOrganizada, raizSaida })

    const { readdir } = await import('node:fs/promises')
    const arquivos = await readdir(raizSaida)
    assert.equal(arquivos.filter((f) => f.endsWith('.tmp')).length, 0)
  })
})
