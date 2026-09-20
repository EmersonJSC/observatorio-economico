/**
 * Caixa 4 — leitura de CSV e ZIP: verificação.
 *
 * Testes com ZIPs e CSVs sintéticos em diretório temporário. Nenhuma rede,
 * nenhum dado real de produção, nada gravado em `data/`.
 *
 * Uso:
 *   npx tsx --test scripts/organizacao/leitura-avancada.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { criarFluxoDecodificado, iterarCsv, lerCabecalhoDeArquivo, marcarComoTexto, quebrarLinha } from './leitura/csv.js'
import { ehConsolidadoBrasil, listarCsvsDoZip, iterarCsvsDoZip } from './leitura/zip.js'

// ---------------------------------------------------------------------------
// Ajuda
// ---------------------------------------------------------------------------

async function comTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'leitura-test-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Coleta um gerador assíncrono em array (apenas em teste). */
async function coletar<T>(it: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

/** Cria um ZIP com as entradas informadas (nome → conteúdo). */
async function criarZip(dir: string, nome: string, entradas: Record<string, string>): Promise<string> {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip()
  for (const [chave, conteudo] of Object.entries(entradas)) {
    // latin1 preserva os acentos que o TSE publica.
    zip.addFile(chave, Buffer.from(conteudo, 'latin1'))
  }
  const caminho = join(dir, nome)
  await writeFile(caminho, zip.toBuffer())
  return caminho
}

// ---------------------------------------------------------------------------
// 1. Quebra de linha CSV
// ---------------------------------------------------------------------------

test('csv: separa campos simples por ponto e vírgula', () => {
  assert.deepEqual(quebrarLinha('a;b;c', ';'), ['a', 'b', 'c'])
})

test('csv: remove aspas e trata separador dentro de aspas', () => {
  assert.deepEqual(quebrarLinha('"a;b";c', ';'), ['a;b', 'c'])
})

test('csv: trata aspa escapada ("")', () => {
  assert.deepEqual(quebrarLinha('"diz ""oi""";x', ';'), ['diz "oi"', 'x'])
})

test('csv: campo vazio é preservado', () => {
  assert.deepEqual(quebrarLinha('a;;c', ';'), ['a', '', 'c'])
})

// ---------------------------------------------------------------------------
// 2. Leitura de CSV em stream
// ---------------------------------------------------------------------------

test('csv: itera registros usando o cabeçalho como chave', async () => {
  const texto = 'A;B\n1;2\n3;4\n'
  const registros = await coletar(
    iterarCsv(marcarComoTexto(Readable.from(texto)), {
      separador: ';',
      encoding: 'utf-8',
      arquivo: 'teste.csv',
    }),
  )

  assert.equal(registros.length, 2)
  assert.deepEqual(registros[0]?.valor, { A: '1', B: '2' })
  assert.deepEqual(registros[1]?.valor, { A: '3', B: '4' })
})

test('csv: ignora linhas em branco', async () => {
  const texto = 'A;B\n1;2\n\n\n3;4\n'
  const registros = await coletar(
    iterarCsv(marcarComoTexto(Readable.from(texto)), {
      separador: ';',
      encoding: 'utf-8',
      arquivo: 't.csv',
    }),
  )
  assert.equal(registros.length, 2)
})

test('csv: numeração de origem começa em 1 no primeiro dado', async () => {
  const texto = 'A\nx\ny\n'
  const registros = await coletar(
    iterarCsv(marcarComoTexto(Readable.from(texto)), {
      separador: ';',
      encoding: 'utf-8',
      arquivo: 't.csv',
    }),
  )
  assert.equal(registros[0]?.origem.indice, 1)
  assert.equal(registros[1]?.origem.indice, 2)
})

test('csv: decodifica latin1 corretamente', async () => {
  // "ELEIÇÃO" com acentos em latin1 — passa pelo decodificador, como em produção.
  const bytes = Buffer.from('NOME\nELEIÇÃO ORDINÁRIA\n', 'latin1')
  const registros = await coletar(
    iterarCsv(criarFluxoDecodificado(Readable.from(bytes), 'latin1'), {
      separador: ';',
      encoding: 'latin1',
      arquivo: 't.csv',
    }),
  )
  assert.equal((registros[0]?.valor as Record<string, string>).NOME, 'ELEIÇÃO ORDINÁRIA')
})

test('csv: passar bytes crus falha alto em vez de corromper acentos', async () => {
  // Sem o decodificador, o resultado seria mojibake silencioso ("ELEI??O").
  const bytes = Buffer.from('NOME\nELEIÇÃO\n', 'latin1')
  await assert.rejects(
    () =>
      coletar(
        iterarCsv(Readable.from(bytes), { separador: ';', encoding: 'latin1', arquivo: 't.csv' }),
      ),
    /contém BYTES|criarFluxoDecodificado/,
  )
})

test('csv: cabeçalho pode ser reaproveitado', async () => {
  const registros = await coletar(
    iterarCsv(marcarComoTexto(Readable.from('1;2\n')),
      { separador: ';', encoding: 'utf-8', arquivo: 't.csv' },
      ['A', 'B'],
    ),
  )
  assert.deepEqual(registros[0]?.valor, { A: '1', B: '2' })
})

test('csv: lê o cabeçalho de um arquivo', async () => {
  await comTemp(async (dir) => {
    const caminho = join(dir, 'x.csv')
    await writeFile(caminho, Buffer.from('A;B;C\n1;2;3\n', 'latin1'))
    const cab = await lerCabecalhoDeArquivo(caminho, {
      separador: ';',
      encoding: 'latin1',
      arquivo: 'x.csv',
    })
    assert.deepEqual(cab, ['A', 'B', 'C'])
  })
})

test('csv: muitas linhas são lidas sem acumular em memória', async () => {
  const linhas = ['A;B', ...Array.from({ length: 20000 }, (_, i) => `${i};${i * 2}`)]
  const texto = `${linhas.join('\n')}\n`

  const antes = process.memoryUsage().heapUsed
  let contador = 0
  for await (const _ of iterarCsv(marcarComoTexto(Readable.from(texto)), {
    separador: ';',
    encoding: 'utf-8',
    arquivo: 'grande.csv',
  })) {
    contador++
  }
  const depois = process.memoryUsage().heapUsed

  assert.equal(contador, 20000)
  const crescimentoMb = (depois - antes) / 1024 / 1024
  assert.ok(crescimentoMb < 30, `crescimento suspeito: ${crescimentoMb.toFixed(1)}MB`)
})

// ---------------------------------------------------------------------------
// 3. ZIP: mitigação 3a
// ---------------------------------------------------------------------------

test('zip: identifica o consolidado _BRASIL.csv', () => {
  assert.equal(ehConsolidadoBrasil('consulta_cand_2024_BRASIL.csv'), true)
  assert.equal(ehConsolidadoBrasil('consulta_cand_2024_SP.csv'), false)
  assert.equal(ehConsolidadoBrasil('consulta_cand_2024_brasil.csv'), true)
})

test('zip: lista somente CSVs por UF, ignorando o consolidado e o PDF', async () => {
  await comTemp(async (dir) => {
    const zip = await criarZip(dir, 'x.zip', {
      'leiame.pdf': 'nao sou csv',
      'consulta_cand_2024_BRASIL.csv': 'A;B\n1;2\n',
      'consulta_cand_2024_SP.csv': 'A;B\n1;2\n',
      'consulta_cand_2024_AC.csv': 'A;B\n1;2\n',
    })

    const entradas = await listarCsvsDoZip(zip)
    assert.deepEqual(
      entradas.map((e) => e.uf),
      ['AC', 'SP'],
      'consolidado e PDF ficam de fora',
    )
  })
})

test('zip: filtra por UF quando solicitado', async () => {
  await comTemp(async (dir) => {
    const zip = await criarZip(dir, 'x.zip', {
      'consulta_cand_2024_SP.csv': 'A;B\n1;2\n',
      'consulta_cand_2024_MG.csv': 'A;B\n1;2\n',
      'consulta_cand_2024_AC.csv': 'A;B\n1;2\n',
    })

    const entradas = await listarCsvsDoZip(zip, ['MG', 'AC'])
    assert.deepEqual(entradas.map((e) => e.uf), ['AC', 'MG'])
  })
})

test('zip: itera os registros de todas as UFs em sequência', async () => {
  await comTemp(async (dir) => {
    const zip = await criarZip(dir, 'x.zip', {
      'consulta_cand_2024_BRASIL.csv': 'UF;N\nBR;999\n',
      'consulta_cand_2024_AC.csv': 'UF;N\nAC;1\nAC;2\n',
      'consulta_cand_2024_SP.csv': 'UF;N\nSP;3\n',
    })

    const registros = await coletar(iterarCsvsDoZip(zip, { separador: ';', encoding: 'latin1' }))

    assert.equal(registros.length, 3, 'consolidado não entra')
    assert.deepEqual(
      registros.map((r) => (r.valor as Record<string, string>).UF),
      ['AC', 'AC', 'SP'],
    )
  })
})

test('zip: origem registra de qual arquivo veio cada registro', async () => {
  await comTemp(async (dir) => {
    const zip = await criarZip(dir, 'x.zip', {
      'consulta_cand_2024_AC.csv': 'UF\nAC\n',
    })

    const registros = await coletar(iterarCsvsDoZip(zip, { separador: ';', encoding: 'latin1' }))
    assert.match(registros[0]!.origem.arquivo, /consulta_cand_2024_AC\.csv$/)
  })
})

test('zip: decodifica latin1 dentro do ZIP', async () => {
  await comTemp(async (dir) => {
    const zip = await criarZip(dir, 'x.zip', {
      'consulta_cand_2024_AC.csv': 'CARGO\nVEREADOR\n',
    })
    const registros = await coletar(iterarCsvsDoZip(zip, { separador: ';', encoding: 'latin1' }))
    assert.equal((registros[0]?.valor as Record<string, string>).CARGO, 'VEREADOR')
  })
})

test('zip: só consolidado disponível gera erro claro', async () => {
  await comTemp(async (dir) => {
    const zip = await criarZip(dir, 'x.zip', {
      'consulta_cand_2024_BRASIL.csv': 'A\n1\n',
    })
    await assert.rejects(
      () => coletar(iterarCsvsDoZip(zip, { separador: ';', encoding: 'latin1' })),
      /Miti?gação 3a|consolidado|nenhum CSV/i,
    )
  })
})
