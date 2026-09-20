/**
 * Caixa 3 — RAW: verificação.
 *
 * Testes com FILESYSTEM TEMPORÁRIO. Nenhuma chamada de rede, nenhum dado real,
 * nada é gravado em `data/`.
 *
 * Uso:
 *   npx tsx --test scripts/raw/raw.test.ts
 *   npm run test:raw
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ResultadoColeta } from '../coletor/tipos.js'
import { persistirResultado } from './persistir.js'
import { persistirColeta } from './index.js'
import { resolverExtensao, extensaoPorContentType } from './extensoes.js'
import { caminhoManifesto, caminhoTentativas, caminhoObjeto, nomeObjeto } from './caminhos.js'
import type { Manifesto, PersistenciaResultado, Tentativa } from './tipos.js'

// ---------------------------------------------------------------------------
// Ajuda de teste
// ---------------------------------------------------------------------------

/** Cria um diretório temporário isolado por teste. */
async function comRaizTemp<T>(fn: (raiz: string) => Promise<T>): Promise<T> {
  const raiz = await mkdtemp(join(tmpdir(), 'raw-test-'))
  try {
    return await fn(raiz)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
}

/** Hash estável para fixtures (não depende de rede). */
function hashFalso(semente: string): string {
  // 64 hex chars, apenas para identificar o objeto no teste.
  return semente.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'a')
}

/** Monta um `ResultadoColeta` de sucesso. */
function sucesso(corpo: string, over: Partial<ResultadoColeta> = {}): ResultadoColeta {
  const bytes = new TextEncoder().encode(corpo)
  return {
    estado: 'sucesso',
    bytes,
    hash: hashFalso(over.hash ?? 'abc'),
    tamanho: bytes.byteLength,
    procedencia: {
      fonteId: 'fonte-teste',
      recursoId: 'recurso-teste',
      transporte: 'http-json',
      url: 'https://exemplo.test/dados',
      coletadoEm: '2026-01-01T00:00:00.000Z',
      status: 200,
      headers: { contentType: 'application/json' },
      parametros: { uf: '31' },
      tentativas: 1,
      versaoColetor: '1.0.0',
      peculiaridades: [],
    },
    ...over,
  } as ResultadoColeta
}

/** Monta um resultado de falha (sem bytes). */
function falha(motivo = 'http-erro'): ResultadoColeta {
  return {
    estado: 'falha',
    motivo,
    mensagem: 'algo deu errado',
    procedencia: {
      fonteId: 'fonte-teste',
      recursoId: 'recurso-teste',
      transporte: 'http-json',
      url: 'https://exemplo.test/dados',
      parametros: { uf: '31' },
      tentativas: 3,
      versaoColetor: '1.0.0',
      peculiaridades: [],
    },
  } as ResultadoColeta
}

/** Monta um resultado sem-dado (sem bytes). */
function semDado(): ResultadoColeta {
  return {
    estado: 'sem-dado',
    procedencia: {
      fonteId: 'fonte-teste',
      recursoId: 'recurso-teste',
      transporte: 'http-json',
      url: 'https://exemplo.test/dados',
      parametros: {},
      tentativas: 1,
      versaoColetor: '1.0.0',
      peculiaridades: [],
    },
  } as ResultadoColeta
}

/** Lê e faz parse do manifesto. */
async function lerManifesto(raiz: string, fonte = 'fonte-teste', recurso = 'recurso-teste'): Promise<Manifesto> {
  return JSON.parse(await readFile(caminhoManifesto(raiz, fonte, recurso), 'utf-8')) as Manifesto
}

/** Lê as tentativas registradas, uma por linha. */
async function lerTentativas(raiz: string, fonte = 'fonte-teste', recurso = 'recurso-teste'): Promise<Tentativa[]> {
  const texto = await readFile(caminhoTentativas(raiz, fonte, recurso), 'utf-8')
  return texto
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Tentativa)
}

/** Lista os objetos gravados. */
async function listarObjetos(raiz: string, fonte = 'fonte-teste', recurso = 'recurso-teste'): Promise<string[]> {
  return (await readdir(join(raiz, fonte, recurso, 'objetos'))).sort()
}

const existe = async (caminho: string): Promise<boolean> => {
  try {
    await stat(caminho)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 1. Extensões
// ---------------------------------------------------------------------------

test('extensão: formato determina a extensão', () => {
  assert.equal(resolverExtensao('json'), '.json')
  assert.equal(resolverExtensao('json-envelope'), '.json')
  assert.equal(resolverExtensao('geojson'), '.geojson')
  assert.equal(resolverExtensao('zip-csv'), '.zip')
})

test('extensão: imagem usa o content-type', () => {
  assert.equal(resolverExtensao('imagem', 'image/png'), '.png')
  assert.equal(resolverExtensao('imagem', 'image/jpeg'), '.jpg')
  assert.equal(resolverExtensao('imagem'), '.bin', 'sem content-type não inventa tipo')
})

test('extensão: content-type com parâmetros é tratado', () => {
  assert.equal(extensaoPorContentType('application/json; charset=utf-8'), '.json')
  assert.equal(extensaoPorContentType('text/html;charset=UTF-8'), '.html')
})

test('extensão: tipo desconhecido cai em .bin', () => {
  assert.equal(extensaoPorContentType('application/x-desconhecido'), undefined)
  assert.equal(resolverExtensao('json', 'application/x-desconhecido'), '.json', 'formato vence')
})

// ---------------------------------------------------------------------------
// 2. Gravação básica
// ---------------------------------------------------------------------------

test('grava: objeto nomeado pelo hash e manifesto atualizado', async () => {
  await comRaizTemp(async (raiz) => {
    const r = await persistirResultado(raiz, sucesso('{"a":1}', { hash: 'a'.repeat(64) }))

    assert.equal(r.resultado, 'gravado')
    assert.equal(r.gravados.length, 1)
    assert.deepEqual(await listarObjetos(raiz), [`${'a'.repeat(64)}.json`])

    const m = await lerManifesto(raiz)
    assert.equal(m.objetos.length, 1)
    assert.equal(m.objetos[0]?.hash, 'a'.repeat(64))
    assert.equal(m.ultimoHash, 'a'.repeat(64))
    assert.equal(m.objetos[0]?.arquivo, `fonte-teste/recurso-teste/objetos/${'a'.repeat(64)}.json`)
  })
})

test('grava: bytes são preservados exatamente', async () => {
  await comRaizTemp(async (raiz) => {
    const original = '  {\n  "a" : 1 }\n\n'
    const r = await persistirResultado(raiz, sucesso(original, { hash: 'b'.repeat(64) }))
    const lido = await readFile(join(raiz, r.gravados[0]!.arquivo), 'utf-8')
    assert.equal(lido, original, 'conteúdo não pode ser reescrito')
  })
})

test('grava: extensão do zip vem do formato declarado', async () => {
  await comRaizTemp(async (raiz) => {
    const resultado = sucesso('PK-conteudo', { hash: 'c'.repeat(64) })
    // Fonte/recurso do catálogo real, cujo formato é zip-csv.
    resultado.procedencia.fonteId = 'tse'
    resultado.procedencia.recursoId = 'cdn-dados-abertos'

    const r = await persistirResultado(raiz, resultado)
    assert.equal(r.gravados[0]?.extensao, '.zip')
  })
})

// ---------------------------------------------------------------------------
// 3. Atomicidade e ausência de temporários
// ---------------------------------------------------------------------------

test('atômico: nenhum arquivo .tmp sobra após a gravação', async () => {
  await comRaizTemp(async (raiz) => {
    await persistirResultado(raiz, sucesso('{"a":1}', { hash: 'd'.repeat(64) }))
    const arquivos = await listarObjetos(raiz)
    assert.equal(arquivos.filter((f) => f.endsWith('.tmp')).length, 0)
  })
})

// ---------------------------------------------------------------------------
// 4. Deduplicação
// ---------------------------------------------------------------------------

test('dedup: mesmo hash não grava de novo, mas registra tentativa', async () => {
  await comRaizTemp(async (raiz) => {
    const h = 'e'.repeat(64)
    const primeiro = await persistirResultado(raiz, sucesso('{"a":1}', { hash: h }))
    assert.equal(primeiro.resultado, 'gravado')

    const segundo = await persistirResultado(raiz, sucesso('{"a":1}', { hash: h }))
    assert.equal(segundo.resultado, 'deduplicado')
    assert.equal(segundo.gravados.length, 0, 'nada novo em disco')

    // O manifesto continua com UM objeto (append-only, sem duplicar).
    const m = await lerManifesto(raiz)
    assert.equal(m.objetos.length, 1)

    // A tentativa FOI registrada mesmo deduplicando.
    const tentativas = await lerTentativas(raiz)
    assert.equal(tentativas.length, 2)
    assert.equal(tentativas[0]?.resultado, 'gravado')
    assert.equal(tentativas[1]?.resultado, 'deduplicado')
  })
})

test('dedup: hash diferente grava um segundo objeto', async () => {
  await comRaizTemp(async (raiz) => {
    await persistirResultado(raiz, sucesso('{"a":1}', { hash: 'f'.repeat(64) }))
    await persistirResultado(raiz, sucesso('{"a":2}', { hash: '1'.repeat(64) }))

    const m = await lerManifesto(raiz)
    assert.equal(m.objetos.length, 2)
    assert.equal((await listarObjetos(raiz)).length, 2)
  })
})

test('dedup: arquivo no disco fora do manifesto é recuperado para o manifesto', async () => {
  await comRaizTemp(async (raiz) => {
    const h = '2'.repeat(64)
    // Simula uma execução interrompida entre a gravação atômica do objeto e a
    // atualização do manifesto.
    await mkdir(join(raiz, 'fonte-teste', 'recurso-teste', 'objetos'), { recursive: true })
    await writeFile(caminhoObjeto(raiz, 'fonte-teste', 'recurso-teste', h, '.json'), 'existente')

    const r = await persistirResultado(raiz, sucesso('{"a":1}', { hash: h }))

    // Gravado, não deduplicado: o manifesto passou a registrar o órfão. As
    // caixas seguintes iteram sobre o manifesto — um órfão invisível faria a
    // coleta parecer completa sem estar.
    assert.equal(r.resultado, 'gravado')

    const conteudo = await readFile(
      caminhoObjeto(raiz, 'fonte-teste', 'recurso-teste', h, '.json'),
      'utf-8',
    )
    assert.equal(conteudo, 'existente', 'objeto existente nunca é sobrescrito')

    const m = await lerManifesto(raiz)
    assert.equal(m.objetos.length, 1, 'o órfão entra no manifesto')
    assert.equal(m.objetos[0]?.hash, h)
    // O tamanho registrado é o do arquivo real, não o do payload recebido.
    assert.equal(m.objetos[0]?.tamanho, Buffer.byteLength('existente'))
  })
})

test('dedup: órfão recuperado não duplica entrada em execução repetida', async () => {
  await comRaizTemp(async (raiz) => {
    const h = '4'.repeat(64)
    await mkdir(join(raiz, 'fonte-teste', 'recurso-teste', 'objetos'), { recursive: true })
    await writeFile(caminhoObjeto(raiz, 'fonte-teste', 'recurso-teste', h, '.json'), 'existente')

    const primeira = await persistirResultado(raiz, sucesso('{"a":1}', { hash: h }))
    const segunda = await persistirResultado(raiz, sucesso('{"a":1}', { hash: h }))

    assert.equal(primeira.resultado, 'gravado', 'primeira execução recupera o órfão')
    assert.equal(segunda.resultado, 'deduplicado', 'depois disso, já está no manifesto')

    const m = await lerManifesto(raiz)
    assert.equal(m.objetos.length, 1, 'o manifesto não ganha entrada repetida')
  })
})

// ---------------------------------------------------------------------------
// 5. Imutabilidade
// ---------------------------------------------------------------------------

test('imutável: objeto existente não é sobrescrito', async () => {
  await comRaizTemp(async (raiz) => {
    const h = '3'.repeat(64)
    await persistirResultado(raiz, sucesso('ORIGINAL', { hash: h }))
    const caminho = caminhoObjeto(raiz, 'fonte-teste', 'recurso-teste', h, '.json')
    const antes = await readFile(caminho, 'utf-8')

    // Mesmo hash, conteúdo diferente: não pode sobrescrever.
    await persistirResultado(raiz, sucesso('DIFERENTE', { hash: h }))
    const depois = await readFile(caminho, 'utf-8')

    assert.equal(depois, antes)
  })
})

// ---------------------------------------------------------------------------
// 6. Sem-dado e falha (R1)
// ---------------------------------------------------------------------------

test('falha: registra tentativa com motivo, sem criar manifesto', async () => {
  await comRaizTemp(async (raiz) => {
    const r = await persistirResultado(raiz, falha('http-erro'))
    assert.equal(r.resultado, 'ignorado')
    assert.equal(r.gravados.length, 0)

    const tentativas = await lerTentativas(raiz)
    assert.equal(tentativas.length, 1)
    assert.equal(tentativas[0]?.estado, 'falha')
    assert.equal(tentativas[0]?.motivo, 'http-erro')

    assert.equal(await existe(caminhoManifesto(raiz, 'fonte-teste', 'recurso-teste')), false)
  })
})

test('sem-dado: registra tentativa e distingue de falha', async () => {
  await comRaizTemp(async (raiz) => {
    const r = await persistirResultado(raiz, semDado())
    assert.equal(r.resultado, 'ignorado')

    const tentativas = await lerTentativas(raiz)
    assert.equal(tentativas[0]?.estado, 'sem-dado')
    assert.equal(tentativas[0]?.motivo, undefined)
  })
})

test('sem-dado e falha convivem no mesmo log, em ordem', async () => {
  await comRaizTemp(async (raiz) => {
    await persistirResultado(raiz, semDado())
    await persistirResultado(raiz, falha('timeout'))
    await persistirResultado(raiz, sucesso('{"a":1}', { hash: '4'.repeat(64) }))

    const t = await lerTentativas(raiz)
    assert.equal(t.length, 3)
    assert.deepEqual(
      t.map((x) => x.estado),
      ['sem-dado', 'falha', 'sucesso'],
    )
  })
})

// ---------------------------------------------------------------------------
// 7. Paginação (R4)
// ---------------------------------------------------------------------------

test('paginado: cada página vira um objeto separado, sem concatenar', async () => {
  await comRaizTemp(async (raiz) => {
    const p1 = new TextEncoder().encode('[{"a":1}]')
    const p2 = new TextEncoder().encode('[{"a":2}]')
    const resultado: ResultadoColeta = {
      estado: 'sucesso',
      bytes: p1,
      hash: 'p1'.padEnd(64, '0').replace(/[^0-9a-f]/g, 'a'),
      tamanho: p1.byteLength,
      paginas: [
        { pagina: 1, url: 'https://x?pagina=1', bytes: p1, hash: 'a1'.padEnd(64, '0'), tamanho: p1.byteLength, status: 200 },
        { pagina: 2, url: 'https://x?pagina=2', bytes: p2, hash: 'a2'.padEnd(64, '0'), tamanho: p2.byteLength, status: 200 },
      ],
      procedencia: {
        fonteId: 'fonte-teste',
        recursoId: 'recurso-teste',
        transporte: 'http-json',
        url: 'https://x',
        parametros: {},
        tentativas: 2,
        versaoColetor: '1.0.0',
        peculiaridades: [],
      },
    } as ResultadoColeta

    const r = await persistirResultado(raiz, resultado)
    assert.equal(r.resultado, 'gravado')
    assert.equal(r.gravados.length, 2, 'uma objeto por página')
    assert.equal((await listarObjetos(raiz)).length, 2)
    assert.deepEqual(r.gravados.map((g) => g.pagina), [1, 2])

    // Cada objeto tem o conteúdo da SUA página, não a concatenação.
    const o1 = await readFile(join(raiz, r.gravados[0]!.arquivo), 'utf-8')
    const o2 = await readFile(join(raiz, r.gravados[1]!.arquivo), 'utf-8')
    assert.equal(o1, '[{"a":1}]')
    assert.equal(o2, '[{"a":2}]')
  })
})

// ---------------------------------------------------------------------------
// 8. Manifesto append-only (R8)
// ---------------------------------------------------------------------------

test('manifesto: é append-only e preserva objetos anteriores', async () => {
  await comRaizTemp(async (raiz) => {
    await persistirResultado(raiz, sucesso('{"a":1}', { hash: '5'.repeat(64) }))
    const m1 = await lerManifesto(raiz)
    await persistirResultado(raiz, sucesso('{"a":2}', { hash: '6'.repeat(64) }))
    const m2 = await lerManifesto(raiz)

    assert.equal(m2.objetos.length, 2)
    assert.equal(m2.criadoEm, m1.criadoEm, 'criadoEm não muda')
    assert.deepEqual(m2.objetos[0], m1.objetos[0], 'objeto anterior intacto')
  })
})

test('manifesto: não é criado quando só há dedup', async () => {
  await comRaizTemp(async (raiz) => {
    const h = '7'.repeat(64)
    await persistirResultado(raiz, sucesso('{"a":1}', { hash: h }))
    const antes = await readFile(caminhoManifesto(raiz, 'fonte-teste', 'recurso-teste'), 'utf-8')

    await persistirResultado(raiz, sucesso('{"a":1}', { hash: h }))
    const depois = await readFile(caminhoManifesto(raiz, 'fonte-teste', 'recurso-teste'), 'utf-8')

    assert.equal(depois, antes, 'dedup não reescreve o manifesto')
  })
})

// ---------------------------------------------------------------------------
// 9. Isolamento por recurso
// ---------------------------------------------------------------------------

test('isolamento: fontes e recursos não se misturam', async () => {
  await comRaizTemp(async (raiz) => {
    const a = sucesso('{"a":1}', { hash: '8'.repeat(64) })
    a.procedencia.fonteId = 'fonte-a'
    a.procedencia.recursoId = 'recurso-a'

    const b = sucesso('{"b":1}', { hash: '9'.repeat(64) })
    b.procedencia.fonteId = 'fonte-b'
    b.procedencia.recursoId = 'recurso-b'

    await persistirResultado(raiz, a)
    await persistirResultado(raiz, b)

    assert.equal((await lerManifesto(raiz, 'fonte-a', 'recurso-a')).objetos.length, 1)
    assert.equal((await lerManifesto(raiz, 'fonte-b', 'recurso-b')).objetos.length, 1)
  })
})

// ---------------------------------------------------------------------------
// 10. Falhas e segurança
// ---------------------------------------------------------------------------

test('segurança: identificador com path traversal vira erro, sem gravar', async () => {
  await comRaizTemp(async (raiz) => {
    const resultado = sucesso('{"a":1}', { hash: '0'.repeat(64) })
    resultado.procedencia.fonteId = '../escapa'

    const r = await persistirResultado(raiz, resultado)
    assert.equal(r.resultado, 'erro')
    assert.match(r.mensagem ?? '', /identificador inválido/)
  })
})

test('erro de I/O não lança: devolve resultado erro', async () => {
  // Raiz inválida (um arquivo onde deveria haver diretório) força falha de I/O.
  await comRaizTemp(async (raiz) => {
    await writeFile(join(raiz, 'fonte-teste'), 'bloqueio')
    const r = await persistirResultado(raiz, sucesso('{"a":1}', { hash: 'a'.repeat(64) }))
    assert.equal(r.resultado, 'erro')
    assert.ok(r.mensagem)
  })
})

// ---------------------------------------------------------------------------
// 11. persistirColeta
// ---------------------------------------------------------------------------

test('persistirColeta: processa vários resultados e preserva a ordem', async () => {
  await comRaizTemp(async (raiz) => {
    const resultados = [
      sucesso('{"a":1}', { hash: 'a'.repeat(64) }),
      falha('timeout'),
      sucesso('{"a":2}', { hash: 'b'.repeat(64) }),
    ]
    const saida: PersistenciaResultado[] = await persistirColeta(resultados, { raiz })

    assert.equal(saida.length, 3)
    assert.deepEqual(
      saida.map((s) => s.resultado),
      ['gravado', 'ignorado', 'gravado'],
    )
  })
})

test('persistirColeta: lista vazia não cria nada', async () => {
  await comRaizTemp(async (raiz) => {
    const saida = await persistirColeta([], { raiz })
    assert.equal(saida.length, 0)
    assert.equal((await readdir(raiz)).length, 0)
  })
})

// ---------------------------------------------------------------------------
// 12. Tentativas: conteúdo registrado
// ---------------------------------------------------------------------------

test('tentativa: carrega procedência completa para auditoria', async () => {
  await comRaizTemp(async (raiz) => {
    await persistirResultado(raiz, sucesso('{"a":1}', { hash: 'c'.repeat(64) }))
    const t = (await lerTentativas(raiz))[0]!

    assert.equal(t.fonteId, 'fonte-teste')
    assert.equal(t.recursoId, 'recurso-teste')
    assert.equal(t.estado, 'sucesso')
    assert.equal(t.resultado, 'gravado')
    assert.equal(t.url, 'https://exemplo.test/dados')
    assert.equal(t.status, 200)
    assert.equal(t.transporte, 'http-json')
    assert.equal(t.parametros.uf, '31')
    assert.equal(t.versaoColetor, '1.0.0')
    assert.equal(t.versaoRaw, '1.0.0')
    assert.ok(!Number.isNaN(Date.parse(t.em)))
  })
})

test('tentativa: é append-only (linhas acumulam em ordem)', async () => {
  await comRaizTemp(async (raiz) => {
    await persistirResultado(raiz, sucesso('{"a":1}', { hash: 'd'.repeat(64) }))
    await persistirResultado(raiz, semDado())
    await persistirResultado(raiz, falha())

    const linhas = (await readFile(caminhoTentativas(raiz, 'fonte-teste', 'recurso-teste'), 'utf-8'))
      .split('\n')
      .filter((l) => l.trim() !== '')
    assert.equal(linhas.length, 3)
    // Cada linha é JSON válido e independente.
    for (const l of linhas) assert.doesNotThrow(() => JSON.parse(l))
  })
})

// ---------------------------------------------------------------------------
// 13. A caixa é cega (R10)
// ---------------------------------------------------------------------------

test('cego: conteúdo inválido é gravado como veio, sem validação', async () => {
  await comRaizTemp(async (raiz) => {
    // Não é JSON, não é ZIP, não é nada reconhecível.
    const lixo = '\u0000\u0001 não é json {{{'
    const r = await persistirResultado(raiz, sucesso(lixo, { hash: 'e'.repeat(64) }))

    assert.equal(r.resultado, 'gravado')
    assert.equal(await readFile(join(raiz, r.gravados[0]!.arquivo), 'utf-8'), lixo)
  })
})

test('cego: nenhum arquivo .tmp permanece após erro de gravação', async () => {
  await comRaizTemp(async (raiz) => {
    await persistirResultado(raiz, sucesso('{"a":1}', { hash: 'f'.repeat(64) }))
    const arquivos = await listarObjetos(raiz)
    assert.equal(arquivos.length, 1)
    assert.equal(nomeObjeto('f'.repeat(64), '.json'), arquivos[0])
  })
})
