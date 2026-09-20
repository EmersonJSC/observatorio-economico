/**
 * Caixa 2 — COLETOR EXTERNO: verificação.
 *
 * Testes de comportamento do coletor usando MOCKS. Nenhuma requisição real é
 * feita, nenhum dado é baixado e nada é gravado em `data/`.
 *
 * Usa o runner nativo do Node (`node:test`), sem dependência nova.
 *
 * Uso:
 *   npx tsx --test scripts/coletor/coletor.test.ts
 *   npm run test:coletor
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buscarFonte, buscarRecurso } from '../fontes/catalogo.js'
import type { Fonte, Recurso } from '../fontes/tipos.js'
import { coletarRecurso, expandirChamadas, hashDosBytes, resolverCredencial } from './coletar.js'
import { concorrenciaPara, politicaPara } from './politicas.js'
import { decidirProximaPagina } from './paginacao.js'
import type { Buscar, DependenciasColetor } from './tipos.js'

// ---------------------------------------------------------------------------
// Ajuda de teste
// ---------------------------------------------------------------------------

/** Resposta HTTP falsa, montada a partir de um corpo textual. */
function resposta(corpo: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(corpo, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/**
 * `fetch` falso que devolve respostas pré-programadas, em ordem.
 *
 * Cada item é uma FÁBRICA de `Response`: um `Response` só pode ter o corpo lido
 * uma vez, então reutilizar a mesma instância em chamadas repetidas quebraria.
 */
function buscarSequencia(fabricas: Array<() => Response>): {
  buscar: Buscar
  chamadas: string[]
} {
  const chamadas: string[] = []
  let i = 0
  const buscar: Buscar = async (url) => {
    chamadas.push(url)
    const fabrica = fabricas[Math.min(i, fabricas.length - 1)]
    i++
    if (fabrica === undefined) throw new Error('sem resposta programada')
    return fabrica()
  }
  return { buscar, chamadas }
}

/** `fetch` falso que sempre falha com o erro informado. */
function buscarComErro(erro: Error): Buscar {
  return async () => {
    throw erro
  }
}

const depsDe = (buscar: Buscar): DependenciasColetor => ({
  buscar,
  dormir: async () => {}, // não espera de verdade
  ambiente: {}, // sem credenciais por padrão
})

/** Fonte/recurso sintéticos, para testar comportamento sem depender do catálogo. */
function fonteSintetica(over: Partial<Fonte> = {}, recursoOver: Partial<Recurso> = {}): {
  fonte: Fonte
  recurso: Recurso
} {
  const recurso: Recurso = {
    id: 'r',
    finalidade: 'teste',
    status: 'usado',
    transporte: 'http-json',
    metodo: 'GET',
    caminho: '/r',
    formato: 'json',
    periodicidade: 'anual',
    recorteTemporal: { tipo: 'ano', historico: true },
    identificadores: [{ nome: 'x', descricao: 'x' }],
    paginacao: 'nenhuma',
    rateLimit: { nivel: 'desconhecido' },
    ...recursoOver,
  }
  const fonte: Fonte = {
    id: 'f',
    nome: 'F',
    orgao: 'F',
    tipo: 'api-rest',
    baseUrl: 'https://exemplo.test',
    documentacao: 'https://exemplo.test',
    papel: 'primaria',
    recursos: [recurso],
    ...over,
  }
  return { fonte, recurso }
}

// ---------------------------------------------------------------------------
// 1. Política central
// ---------------------------------------------------------------------------

test('política: valores padrão preservam o comportamento legado', () => {
  const { recurso } = fonteSintetica()
  const p = politicaPara(recurso)
  assert.equal(p.timeoutMs, 30_000)
  assert.equal(p.maxRetries, 3)
  assert.equal(p.baseDelayMs, 500)
  assert.ok(p.codigosRetentaveis.includes(429))
  assert.ok(p.headers['User-Agent'], 'User-Agent deve identificar o projeto')
})

test('política: rate limit crítico deriva concorrência 2 e pausa', () => {
  const { recurso } = fonteSintetica({}, { rateLimit: { nivel: 'critico' } })
  const p = politicaPara(recurso)
  assert.equal(p.pausaEntreChamadasMs, 300)
  assert.equal(p.maxRetries, 4)
  assert.equal(concorrenciaPara(recurso), 2)
})

test('política: geojson usa timeout maior que o padrão', () => {
  const { recurso } = fonteSintetica({}, { transporte: 'http-geojson' })
  assert.equal(politicaPara(recurso).timeoutMs, 60_000)
})

// ---------------------------------------------------------------------------
// 2. Expansão de chamadas (fan-out)
// ---------------------------------------------------------------------------

test('fan-out: dimensão única gera N chamadas', () => {
  const { fonte, recurso } = fonteSintetica({}, {
    caminho: '/x/{uf}',
    parametros: [{ nome: 'uf', descricao: 'UF', obrigatorio: true, dimensao: 'uf' }],
  })
  const chamadas = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r', dimensoes: { uf: ['31', '35'] } })
  assert.equal(chamadas.length, 2)
  assert.equal(chamadas[0]?.url, 'https://exemplo.test/x/31')
  assert.equal(chamadas[1]?.url, 'https://exemplo.test/x/35')
})

test('fan-out: duas dimensões geram produto cartesiano', () => {
  const { fonte, recurso } = fonteSintetica({}, {
    caminho: '/d/{ano}/{deputado}',
    parametros: [
      { nome: 'ano', descricao: 'ano', obrigatorio: true, dimensao: 'ano' },
      { nome: 'deputado', descricao: 'dep', obrigatorio: true, dimensao: 'deputado' },
    ],
  })
  const chamadas = expandirChamadas(fonte, recurso, {
    fonteId: 'f',
    recursoId: 'r',
    dimensoes: { ano: ['2023', '2024'], deputado: ['1', '2', '3'] },
  })
  assert.equal(chamadas.length, 6, '2 anos × 3 deputados')
})

test('fan-out: parâmetro com valor fixo não gera chamadas extras', () => {
  const { fonte, recurso } = fonteSintetica({}, {
    caminho: '/paises/{pais}',
    parametros: [
      { nome: 'pais', descricao: 'país', obrigatorio: true, exemplo: 'BR' },
      { nome: 'formato', descricao: 'fmt', obrigatorio: true, valores: ['application/vnd.geo+json'] },
    ],
  })
  const chamadas = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })
  assert.equal(chamadas.length, 1)
  assert.match(chamadas[0]!.url, /paises\/BR/)
  assert.match(chamadas[0]!.url, /formato=application%2Fvnd\.geo%2Bjson/)
})

test('fan-out: dimensão sem valores usa o exemplo declarado', () => {
  const { fonte, recurso } = fonteSintetica({}, {
    caminho: '/a/{ano}',
    parametros: [{ nome: 'ano', descricao: 'ano', obrigatorio: true, dimensao: 'ano', exemplo: '2024' }],
  })
  const chamadas = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0]?.url, 'https://exemplo.test/a/2024')
})

test('fan-out: placeholder sem valor falha alto (erro de declaração)', () => {
  const { fonte, recurso } = fonteSintetica({}, { caminho: '/x/{faltando}' })
  assert.throws(
    () => expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' }),
    /placeholder "\{faltando\}" do caminho sem valor/,
  )
})

test('fan-out: baseUrl do RECURSO tem precedência sobre a da fonte', () => {
  const { fonte, recurso } = fonteSintetica({}, { baseUrl: 'https://outro.host' })
  const chamadas = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })
  assert.match(chamadas[0]!.url, /^https:\/\/outro\.host/)
})

// ---------------------------------------------------------------------------
// 3. Credenciais
// ---------------------------------------------------------------------------

test('credencial: ausente falha com o nome da variável', () => {
  const { fonte } = fonteSintetica({
    credencial: { env: 'PORTAL_API_KEY', header: 'chave-api-dados' },
  })
  const r = resolverCredencial(fonte, {})
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.mensagem : '', /PORTAL_API_KEY/)
})

test('credencial: presente vira header, com esquema quando declarado', () => {
  const { fonte } = fonteSintetica({
    credencial: { env: 'BRASILIO_TOKEN', header: 'Authorization', esquema: 'Token {valor}' },
  })
  const r = resolverCredencial(fonte, { BRASILIO_TOKEN: 'abc' })
  assert.equal(r.ok, true)
  assert.equal(r.ok === true ? r.headers.Authorization : '', 'Token abc')
})

test('credencial: fonte sem credencial não envia header', () => {
  const { fonte } = fonteSintetica()
  const r = resolverCredencial(fonte, {})
  assert.equal(r.ok, true)
  assert.deepEqual(r.ok === true ? r.headers : {}, {})
})

// ---------------------------------------------------------------------------
// 4. Tri-estado
// ---------------------------------------------------------------------------

test('estado: resposta com conteúdo é sucesso, com hash dos bytes', async () => {
  const { fonte, recurso } = fonteSintetica()
  const { buscar } = buscarSequencia([
    () => resposta('[{"a":1}]'),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'sucesso')
  assert.ok(r.bytes instanceof Uint8Array)
  assert.equal(r.hash, hashDosBytes(new TextEncoder().encode('[{"a":1}]')))
  assert.equal(r.tamanho, 9)
})

test('estado: corpo vazio é sem-dado, NÃO falha', async () => {
  const { fonte, recurso } = fonteSintetica()
  const { buscar } = buscarSequencia([
    () => resposta(''),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'sem-dado')
  assert.equal(r.motivo, undefined)
})

test('estado: coleção vazia é sem-dado, NÃO falha', async () => {
  const { fonte, recurso } = fonteSintetica({}, { paginacao: 'pagina-numerada' })
  const { buscar } = buscarSequencia([
    () => resposta('[]'),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'sem-dado')
})

test('estado: erro 500 após retries é falha, com motivo', async () => {
  const { fonte, recurso } = fonteSintetica()
  const { buscar } = buscarSequencia([
    () => resposta('erro', 500),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'falha')
  assert.equal(r.motivo, 'http-erro')
})

test('estado: 404 não é retentado e vira falha não-retentável', async () => {
  const { fonte, recurso } = fonteSintetica()
  const { buscar, chamadas } = buscarSequencia([
    () => resposta('nao encontrado', 404),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'falha')
  assert.equal(r.motivo, 'http-nao-retentavel')
  assert.equal(chamadas.length, 1, '404 não deve ser retentado')
})

test('estado: credencial ausente falha ANTES de qualquer requisição', async () => {
  const { fonte, recurso } = fonteSintetica({
    credencial: { env: 'PORTAL_API_KEY', header: 'chave-api-dados' },
  })
  const { buscar, chamadas } = buscarSequencia([
    () => resposta('[]'),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'falha')
  assert.equal(r.motivo, 'credencial-ausente')
  assert.equal(chamadas.length, 0, 'não pode ter tocado a rede')
})

test('estado: recurso manual reporta intervenção humana, sem rede', async () => {
  const { fonte, recurso } = fonteSintetica({}, { transporte: 'manual' })
  const { buscar, chamadas } = buscarSequencia([
    () => resposta('[]'),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'falha')
  assert.equal(r.motivo, 'manual')
  assert.equal(chamadas.length, 0)
})

test('estado: erro de rede vira falha com motivo erro-rede', async () => {
  const { fonte, recurso } = fonteSintetica()
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!
  const r = await coletarRecurso(
    fonte,
    recurso,
    chamada,
    depsDe(buscarComErro(new Error('conexão recusada'))),
  )
  assert.equal(r.estado, 'falha')
  assert.equal(r.motivo, 'erro-rede')
})

// ---------------------------------------------------------------------------
// 5. Bytes preservados
// ---------------------------------------------------------------------------

test('bytes: conteúdo é preservado exatamente, sem reescrita', async () => {
  const original = '  {  "a" : 1 }\n\n'
  const { fonte, recurso } = fonteSintetica()
  const { buscar } = buscarSequencia([
    () => resposta(original),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(new TextDecoder().decode(r.bytes!), original, 'bytes devem ser idênticos')
})

test('bytes: hash é calculado sobre os bytes exatos', async () => {
  const { fonte, recurso } = fonteSintetica()
  const { buscar } = buscarSequencia([
    () => resposta('abc'),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  // sha256 de "abc"
  assert.equal(r.hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

// ---------------------------------------------------------------------------
// 6. Procedência
// ---------------------------------------------------------------------------

test('procedência: registra o que o pipeline antigo não registrava', async () => {
  const { fonte, recurso } = fonteSintetica()
  const { buscar } = buscarSequencia([
    () => resposta('{"ok":true}', 200, { etag: '"v1"', 'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT' }),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  const p = r.procedencia
  assert.equal(p.fonteId, 'f')
  assert.equal(p.recursoId, 'r')
  assert.equal(p.transporte, 'http-json')
  assert.ok(p.url?.startsWith('https://exemplo.test'))
  assert.ok(p.coletadoEm && !Number.isNaN(Date.parse(p.coletadoEm)))
  assert.equal(p.status, 200)
  assert.equal(p.headers?.etag, '"v1"')
  assert.equal(p.headers?.lastModified, 'Mon, 01 Jan 2024 00:00:00 GMT')
  assert.equal(p.versaoColetor, '1.0.0')
  assert.ok(p.tentativas >= 1)
})

test('procedência: parâmetros usados ficam registrados', async () => {
  const { fonte, recurso } = fonteSintetica({}, {
    caminho: '/x/{uf}',
    parametros: [{ nome: 'uf', descricao: 'UF', obrigatorio: true, dimensao: 'uf' }],
  })
  const { buscar } = buscarSequencia([
    () => resposta('{"a":1}'),
  ])
  const chamada = expandirChamadas(fonte, recurso, {
    fonteId: 'f',
    recursoId: 'r',
    dimensoes: { uf: ['31'] },
  })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.procedencia.parametros.uf, '31')
})

// ---------------------------------------------------------------------------
// 7. Paginação
// ---------------------------------------------------------------------------

test('paginação: link-next segue a URL informada pela fonte', async () => {
  const { fonte, recurso } = fonteSintetica({}, { paginacao: 'link-next' })
  const { buscar, chamadas } = buscarSequencia([
    () => resposta('{"results":[{"a":1}],"next":"https://exemplo.test/r?page=2"}'),
    () => resposta('{"results":[{"a":2}],"next":null}'),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'sucesso')
  assert.equal(chamadas.length, 2)
  assert.equal(r.paginas?.length, 2)
})

test('paginação: pagina-numerada para na página vazia', async () => {
  const { fonte, recurso } = fonteSintetica({}, { paginacao: 'pagina-numerada' })
  const { buscar, chamadas } = buscarSequencia([
    () => resposta('[{"a":1}]'),
    () => resposta('[]'),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'sucesso')
  assert.equal(chamadas.length, 2, 'duas páginas: uma com dado, uma vazia')
})

test('paginação: envelope-offset usa hasMore=false para parar', () => {
  const pagina = (corpo: string) => ({
    bytes: new TextEncoder().encode(corpo),
    url: 'https://x',
    status: 200,
  })
  const continua = decidirProximaPagina('envelope-offset', pagina('{"items":[1],"hasMore":true,"limit":1}'), 1, 0)
  assert.equal(continua.continuar, true)
  assert.equal(continua.proximoOffset, 1)

  const para = decidirProximaPagina('envelope-offset', pagina('{"items":[1],"hasMore":false}'), 2, 1)
  assert.equal(para.continuar, false)
})

test('paginação: envelope-offset avança o offset com hasMore=true', async () => {
  const { fonte, recurso } = fonteSintetica({}, { paginacao: 'envelope-offset' })
  const { buscar, chamadas } = buscarSequencia([
    () => resposta('{"items":[{"a":1}],"hasMore":true,"limit":1}'),
    () => resposta('{"items":[{"a":2}],"hasMore":false,"limit":1}'),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'sucesso')
  assert.equal(chamadas.length, 2)
  assert.match(chamadas[1]!, /offset=1/)
})

test('paginação: estourar o limite de páginas é FALHA, não sucesso parcial', async () => {
  const { fonte, recurso } = fonteSintetica({}, { paginacao: 'pagina-numerada' })
  const { buscar } = buscarSequencia([
    () => resposta('[{"a":1}]'),
  ]) // sempre com dado
  const chamada = {
    ...expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!,
    maxPaginas: 3,
  }

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'falha')
  assert.equal(r.motivo, 'pagina-limite-excedido')
})

test('paginação: nenhuma faz uma única requisição', async () => {
  const { fonte, recurso } = fonteSintetica()
  const { buscar, chamadas } = buscarSequencia([
    () => resposta('{"a":1}'),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: 'f', recursoId: 'r' })[0]!

  await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(chamadas.length, 1)
})

// ---------------------------------------------------------------------------
// 8. BigQuery
// ---------------------------------------------------------------------------

test('bigquery: envia POST com o SQL e sem JSON.parse do conteúdo', async () => {
  const { fonte, recurso } = fonteSintetica(
    { tipo: 'api-sql' },
    { transporte: 'bigquery-sql', metodo: 'POST', caminho: '/projects/{projeto}/queries' },
  )
  recurso.parametros = [{ nome: 'projeto', descricao: 'proj', obrigatorio: true, exemplo: 'meu-projeto' }]

  let corpoEnviado = ''
  const buscar: Buscar = async (_url, init) => {
    corpoEnviado = String(init.body ?? '')
    return resposta('{"schema":{"fields":[]},"rows":[]}')
  }

  const chamadas = expandirChamadas(fonte, recurso, {
    fonteId: 'f',
    recursoId: 'r',
    corpo: 'SELECT 1',
  })
  const r = await coletarRecurso(fonte, recurso, chamadas[0]!, depsDe(buscar))

  assert.equal(r.estado, 'sucesso')
  assert.equal(JSON.parse(corpoEnviado).query, 'SELECT 1')
})

// ---------------------------------------------------------------------------
// 9. Catálogo real
// ---------------------------------------------------------------------------

test('catálogo real: uma fonte do TSE, e urlBaseEfetiva resolve o CDN', () => {
  const tse = buscarFonte('tse')
  assert.ok(tse, 'fonte tse deve existir')
  const cdn = buscarRecurso('tse', 'cdn-dados-abertos')
  assert.ok(cdn, 'recurso cdn-dados-abertos deve existir')

  const chamada = expandirChamadas(tse!, cdn!, {
    fonteId: 'tse',
    recursoId: 'cdn-dados-abertos',
    dimensoes: { ano: ['2024'] },
    parametros: { conjunto: 'consulta_cand' },
  })[0]!
  assert.match(chamada.url, /^https:\/\/cdn\.tse\.jus\.br\//)
  assert.match(chamada.url, /consulta_cand_2024\.zip$/)
})

test('catálogo real: ibge-localidades/estados é uma chamada simples', () => {
  const fonte = buscarFonte('ibge-localidades')!
  const recurso = buscarRecurso('ibge-localidades', 'estados')!
  const chamadas = expandirChamadas(fonte, recurso, { fonteId: fonte.id, recursoId: recurso.id })
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0]?.url, 'https://servicodados.ibge.gov.br/api/v1/localidades/estados')
})

test('catálogo real: siconfi/dca expande por ente e exercício', () => {
  const fonte = buscarFonte('siconfi')!
  const recurso = buscarRecurso('siconfi', 'dca')!
  const chamadas = expandirChamadas(fonte, recurso, {
    fonteId: fonte.id,
    recursoId: recurso.id,
    dimensoes: { ente: ['31', '3136702'], exercicio: ['2023'] },
  })
  assert.equal(chamadas.length, 2)
  assert.match(chamadas[0]!.url, /dca\?/)
  assert.match(chamadas[0]!.url, /id_ente=31/)
  assert.match(chamadas[0]!.url, /an_exercicio=2023/)
})

test('catálogo real: portal-transparencia sem chave falha antes da rede', async () => {
  const fonte = buscarFonte('portal-transparencia')!
  const recurso = buscarRecurso('portal-transparencia', 'orgaos-siafi')!
  const { buscar, chamadas } = buscarSequencia([
    () => resposta('[]'),
  ])
  const chamada = expandirChamadas(fonte, recurso, { fonteId: fonte.id, recursoId: recurso.id })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscar))
  assert.equal(r.estado, 'falha')
  assert.equal(r.motivo, 'credencial-ausente')
  assert.equal(chamadas.length, 0)
})

test('catálogo real: tse/portal-dados-abertos é manual', async () => {
  const fonte = buscarFonte('tse')!
  const recurso = buscarRecurso('tse', 'portal-dados-abertos')!
  const chamada = expandirChamadas(fonte, recurso, {
    fonteId: fonte.id,
    recursoId: recurso.id,
    dimensoes: { ano: ['2024'] },
  })[0]!

  const r = await coletarRecurso(fonte, recurso, chamada, depsDe(buscarComErro(new Error('não usar'))))
  assert.equal(r.estado, 'falha')
  assert.equal(r.motivo, 'manual')
})

test('catálogo real: todos os recursos usados são expansíveis', async () => {
  const { FONTES } = await import('../fontes/catalogo.js')
  let total = 0
  for (const fonte of FONTES) {
    for (const recurso of fonte.recursos) {
      const chamadas = expandirChamadas(fonte, recurso, { fonteId: fonte.id, recursoId: recurso.id })
      assert.ok(chamadas.length >= 1, `${fonte.id}/${recurso.id} não expandiu`)
      total++
    }
  }
  assert.equal(total, 25, 'o catálogo tem 25 recursos')
})
