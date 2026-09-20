/**
 * Caixa 5 — RELACIONAMENTOS: construção da ponte canônica de municípios.
 *
 * Fluxo:
 *   1. carrega os municípios do IBGE (base canônica, ~5.571)
 *   2. reduz o JSONL do TSE (463.859 linhas) a ~5.569 unidades eleitorais
 *   3. casa por nome normalizado exato, dentro da mesma UF
 *   4. aplica as exceções auditadas para as divergências históricas
 *   5. grava a ponte e registra os órfãos
 *   6. aborta se os órfãos a corrigir passarem do limiar
 *
 * Escopo desta etapa: apenas municípios (IBGE × TSE).
 */

import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { appendFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { carregarMunicipiosIbge, type MunicipioIbge } from './entidades/ibge.js'
import { carregarUnidadesTse, type UnidadeTse } from './entidades/tse.js'
import { casarPorNome } from './estrategias/nome-normalizado.js'
import { chaveExcecao, indexarExcecoes } from './estrategias/excecoes.js'
import { normalizarCodarea } from './normalizacao.js'
import type {
  ClasseOrfao,
  ContagensRelacionamento,
  MetadadosRelacionamento,
  OpcoesRelacionamento,
  Orfao,
  PonteMunicipio,
  ResultadoRelacionamento,
} from './tipos.js'
import { ErroRelacionamento, VERSAO_RELACIONAMENTOS } from './tipos.js'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Fração máxima de órfãos a corrigir antes de abortar (diretriz: 1%). */
const LIMIAR_ORFAOS_PADRAO = 0.01

/** Caminhos das fontes da Caixa 4. */
function caminhosFontes(raizOrganizada: string) {
  return {
    ibge: join(raizOrganizada, 'ibge-localidades', 'municipios-por-uf.jsonl'),
    tse: join(raizOrganizada, 'tse', 'cdn-dados-abertos.jsonl'),
  }
}

// ---------------------------------------------------------------------------
// Classificação de órfãos
// ---------------------------------------------------------------------------

/**
 * Municípios do IBGE que legitimamente não têm eleição municipal.
 *
 * São a causa conhecida dos órfãos `ausente-na-fonte`: o DF não é município e
 * Fernando de Noronha é distrito estadual. Sem esta distinção, um órfão
 * legítimo apareceria como erro de casamento — que é exatamente o que
 * acontecia no legado.
 */
const SEM_ELEICAO_MUNICIPAL: Readonly<Record<string, string>> = {
  '5300108': 'Distrito Federal não é município — não participa de eleição municipal.',
  '2605459':
    'Fernando de Noronha é distrito estadual de PE — não participa de eleição municipal.',
}

/**
 * Classifica um município do IBGE que ficou sem par no TSE.
 *
 * A distinção entre `ausente-na-fonte` e `nao-correspondido` é o que permite
 * ao operador ignorar o primeiro e investigar o segundo.
 */
function classificarOrfaoIbge(municipio: MunicipioIbge): Orfao {
  const causa = SEM_ELEICAO_MUNICIPAL[municipio.codarea]

  if (causa) {
    return {
      lado: 'ibge',
      id: municipio.codarea,
      nome: municipio.nome,
      ufSigla: municipio.ufSigla,
      classe: 'ausente-na-fonte',
      detalhe: causa,
    }
  }

  return {
    lado: 'ibge',
    id: municipio.codarea,
    nome: municipio.nome,
    ufSigla: municipio.ufSigla,
    classe: 'nao-correspondido',
    detalhe:
      'Município do IBGE sem unidade eleitoral correspondente no TSE. ' +
      'Verifique se é município novo ou divergência de grafia não catalogada.',
  }
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** Escritor JSONL incremental com rename atômico. */
class EscritorJsonl {
  private readonly temporario: string

  constructor(private readonly destino: string) {
    this.temporario = `${destino}.tmp`
  }

  async abrir(): Promise<void> {
    await mkdir(dirname(this.destino), { recursive: true })
    await rm(this.temporario, { force: true })
    await writeFile(this.temporario, '', 'utf-8')
  }

  async escrever(registro: unknown): Promise<void> {
    await appendFile(this.temporario, `${JSON.stringify(registro)}\n`, 'utf-8')
  }

  async fechar(): Promise<void> {
    await rename(this.temporario, this.destino)
  }

  async abortar(): Promise<void> {
    await rm(this.temporario, { force: true })
  }
}

/** Marca de versão das fontes, para detectar ponte desatualizada. */
async function versaoDaFonte(caminho: string): Promise<string> {
  const { stat } = await import('node:fs/promises')
  const info = await stat(caminho)
  return `${info.size}b@${new Date(info.mtimeMs).toISOString()}`
}

// ---------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------

/** Constrói a ponte canônica de municípios (IBGE × TSE). */
export async function construirPonteMunicipios(
  opcoes: OpcoesRelacionamento = {},
): Promise<ResultadoRelacionamento> {
  const raizOrganizada = opcoes.raizOrganizada ?? join(RAIZ_PROJETO, 'data', 'organized')
  const raizSaida = opcoes.raizSaida ?? join(RAIZ_PROJETO, 'data', 'related')
  const limiar = opcoes.limiarOrfaos ?? LIMIAR_ORFAOS_PADRAO
  const agora = (opcoes.agora ?? (() => new Date()))()

  const fontes = caminhosFontes(raizOrganizada)
  for (const [nome, caminho] of Object.entries(fontes)) {
    if (!existsSync(caminho)) {
      throw new ErroRelacionamento(
        `fonte ausente: ${nome}\n  Caminho: ${caminho}\n  Rode a Caixa 4 antes.`,
        'fonte-ausente',
      )
    }
  }

  const avisos: string[] = []

  // 1. Base canônica: os municípios do IBGE.
  const indiceIbge = await carregarMunicipiosIbge(fontes.ibge)

  // 2. Reduz o TSE a unidades eleitorais distintas (memória O(municípios)).
  const unidadesTse = await carregarUnidadesTse(fontes.tse)

  const excecoes = indexarExcecoes()

  const ponte: PonteMunicipio[] = []
  const orfaos: Orfao[] = []
  const casados = new Set<string>() // codarea já vinculado
  let porExcecao = 0

  // 3. Casa cada unidade do TSE contra o IBGE.
  for (const unidade of unidadesTse.values()) {
    const excecao = excecoes.get(chaveExcecao(unidade.ufSigla, unidade.nome))

    if (excecao) {
      // Exceção auditada: vínculo revisado por humano.
      const municipio = buscarPorCodarea(indiceIbge, excecao.codarea)
      if (!municipio) {
        orfaos.push({
          lado: 'tse',
          id: unidade.codigoUe,
          nome: unidade.nome,
          ufSigla: unidade.ufSigla,
          classe: 'nao-correspondido',
          detalhe: `Exceção aponta para codarea ${excecao.codarea}, que não existe no IBGE.`,
        })
        continue
      }
      porExcecao++
      casados.add(municipio.codarea)
      ponte.push(montarLinha(municipio, unidade, 'excecao-auditada', 'revisada'))
      continue
    }

    const resultado = casarPorNome(unidade, indiceIbge)

    if (resultado.tipo === 'casado') {
      casados.add(resultado.municipio.codarea)
      ponte.push(montarLinha(resultado.municipio, unidade, 'nome-exato', 'alta'))
      continue
    }

    // Ambíguo: o casamento achou 2+ candidatos. NUNCA escolhemos sozinhos —
    // ligar o município errado colocaria um prefeito na cidade errada.
    if (resultado.tipo === 'ambiguo') {
      orfaos.push({
        lado: 'tse',
        id: unidade.codigoUe,
        nome: unidade.nome,
        ufSigla: unidade.ufSigla,
        classe: 'ambiguo',
        detalhe:
          `Casamento ambíguo para "${unidade.nome}" em ${unidade.ufSigla}: ` +
          `${resultado.candidatos.length} municípios do IBGE com o mesmo nome ` +
          `(${resultado.candidatos.map((c) => c.codarea).join(', ')}). ` +
          `Resolva com exceção auditada.`,
      })
      continue
    }

    orfaos.push({
      lado: 'tse',
      id: unidade.codigoUe,
      nome: unidade.nome,
      ufSigla: unidade.ufSigla,
      classe: 'nao-correspondido',
      detalhe:
        `Unidade eleitoral do TSE sem município correspondente no IBGE ` +
        `(nome normalizado: "${resultado.nomeNormalizado}"). ` +
        `Se for divergência conhecida, cadastre em estrategias/excecoes.ts.`,
    })
  }

  // 4. Municípios do IBGE que não receberam vínculo.
  for (const municipio of indiceIbge.values()) {
    if (casados.has(municipio.codarea)) continue
    orfaos.push(classificarOrfaoIbge(municipio))
  }

  // 5. Contagens e limiar.
  const orfaosACorrigir = orfaos.filter(
    (o) => o.classe === 'nao-correspondido' || o.classe === 'ambiguo',
  ).length

  const contagens: ContagensRelacionamento = {
    municipiosIbge: indiceIbge.size,
    unidadesTse: unidadesTse.size,
    casados: casados.size,
    porExcecao,
    orfaos: orfaos.length,
    orfaosACorrigir,
  }

  const base = Math.max(contagens.municipiosIbge, contagens.unidadesTse)
  const taxaOrfaos = base > 0 ? orfaosACorrigir / base : 0

  // O limiar é verificado ANTES de gravar: ponte fora do tolerável não deve
  // ser publicada nem parcialmente.
  if (taxaOrfaos > limiar) {
    throw new ErroRelacionamento(
      `órfãos acima do limiar: ${orfaosACorrigir}/${base} ` +
        `(${(taxaOrfaos * 100).toFixed(2)}% > ${(limiar * 100).toFixed(2)}%)\n` +
        `  Indica mudança de grafia ou de layout nas fontes.\n` +
        `  Inspecione os órfãos "nao-correspondido" antes de reprocessar.`,
      'limiar-orfaos',
    )
  }

  // 6. Grava a ponte e os órfãos.
  const caminhoPonte = join(raizSaida, 'municipio.jsonl')
  const caminhoOrfaos = join(raizSaida, 'orfaos.jsonl')

  const escritorPonte = new EscritorJsonl(caminhoPonte)
  const escritorOrfaos = new EscritorJsonl(caminhoOrfaos)

  await escritorPonte.abrir()
  await escritorOrfaos.abrir()

  try {
    // A ponte fica ordenada pela chave mestra — determinismo na saída.
    ponte.sort((a, b) => a.codarea.localeCompare(b.codarea))
    for (const linha of ponte) await escritorPonte.escrever(linha)
    for (const orfao of orfaos) await escritorOrfaos.escrever(orfao)

    await escritorPonte.fechar()
    await escritorOrfaos.fechar()
  } catch (err) {
    await escritorPonte.abortar()
    await escritorOrfaos.abortar()
    throw err
  }

  const metadados: MetadadosRelacionamento = {
    versaoRelacionamentos: VERSAO_RELACIONAMENTOS,
    construidoEm: agora.toISOString(),
    origens: {
      ibge: await versaoDaFonte(fontes.ibge),
      tse: await versaoDaFonte(fontes.tse),
    },
    contagens,
    taxaOrfaos,
    limiarOrfaos: limiar,
    avisos,
  }

  const caminhoMeta = join(raizSaida, 'relacionamentos.meta.json')
  await mkdir(dirname(caminhoMeta), { recursive: true })
  const metaTmp = `${caminhoMeta}.tmp`
  await writeFile(metaTmp, `${JSON.stringify(metadados, null, 2)}\n`, 'utf-8')
  await rename(metaTmp, caminhoMeta)

  return {
    ponte: relative(RAIZ_PROJETO, caminhoPonte),
    orfaos: relative(RAIZ_PROJETO, caminhoOrfaos),
    contagens,
    metadados,
  }
}

/** Busca um município por codarea (varredura rara: só nas exceções). */
function buscarPorCodarea(
  indice: Map<string, MunicipioIbge>,
  codarea: string,
): MunicipioIbge | undefined {
  const alvo = normalizarCodarea(codarea)
  for (const m of indice.values()) {
    if (m.codarea === alvo) return m
  }
  return undefined
}

/** Monta uma linha da ponte. */
function montarLinha(
  municipio: MunicipioIbge,
  unidade: UnidadeTse,
  metodo: PonteMunicipio['metodoMatch'],
  confianca: PonteMunicipio['confianca'],
): PonteMunicipio {
  return {
    codarea: municipio.codarea,
    nome: municipio.nome,
    ufSigla: municipio.ufSigla,
    ufCodigo: municipio.ufCodigo,
    origens: {
      ibge: { id: municipio.codarea, nome: municipio.nome, metodo: 'codigo-nativo' },
      tse: {
        id: unidade.codigoUe,
        nome: unidade.nome,
        metodo,
      },
    },
    metodoMatch: metodo,
    confianca,
  }
}

/** Exportado para teste: a lista de municípios sem eleição municipal. */
export { SEM_ELEICAO_MUNICIPAL }
export type { ClasseOrfao }
