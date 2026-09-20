/**
 * Caixa 7 — PUBLICAÇÃO: engrenagem principal.
 *
 * Fluxo:
 *   1. carrega organizado (C4), ponte (C5) e calculado (C6)
 *   2. formata cada domínio para o contrato do frontend
 *   3. grava em `data/published/`, com `.gz` ao lado
 *   4. grava o manifesto com contagens e ganho de compressão
 *
 * Ela NÃO calcula indicador nem limpa dado — só apresenta o que já existe.
 */

import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROTAS_FRONTEND, UFS, ufDoCodarea } from './contrato.js'
import {
  gravarJson,
  gravarTexto,
  limparDiretorio,
  registrarArtefato,
} from './escrita.js'
import {
  carregarAreas,
  carregarCandidatos,
  carregarEstados,
  carregarMunicipiosCalculados,
  carregarNomeMunicipios,
  carregarOrcamento,
  carregarPonte,
  indexarMalhas,
  lerMalhaUf,
  localizarMalhaUfs,
  type CaminhosPublicacao,
  type EstadoOrganizado,
  type NomeMunicipio,
} from './leitura.js'
import {
  ehFeatureCollectionValida,
  enriquecerMalhaMunicipios,
  enriquecerMalhaUfs,
  propriedadesCompletas,
  type ColecaoGeoJson,
} from './formatos/territorios.js'
import {
  dividirEmBlocos,
  extrairCoordenadas,
  formatarIndice,
  formatarMunicipio,
} from './formatos/municipios.js'
import {
  formatarIndicadores,
  formatarIndicadoresUf,
  formatarOrcamento,
  formatarRanking,
} from './formatos/dominios.js'
import type {
  ArtefatoPublicado,
  ManifestoPublicacao,
  MunicipioPublicado,
  OpcoesPublicacao,
  ResultadoPublicacao,
} from './tipos.js'
import { ErroPublicacao, VERSAO_PUBLICACAO } from './tipos.js'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Municípios por bloco, por padrão. */
const MUNICIPIOS_POR_BLOCO_PADRAO = 500

/**
 * Coordenadas dos municípios.
 *
 * A Caixa 6 não publica coordenadas (o mapa precisa delas, mas elas não são
 * métrica). Elas vêm da malha territorial: usamos o centroide do bounding box
 * de cada município, calculado da geometria do RAW.
 */
async function carregarCoordenadas(
  caminhos: CaminhosPublicacao,
): Promise<Map<string, { lng: number; lat: number }>> {
  const coordenadas = new Map<string, { lng: number; lat: number }>()
  const indice = await indexarMalhas(caminhos)

  for (const [uf, { arquivo }] of indice) {
    const texto = await lerMalhaUf(caminhos, arquivo)
    if (!texto) continue

    try {
      const colecao = JSON.parse(texto) as {
        features?: Array<{
          properties?: { codarea?: string }
          geometry?: { type?: string; coordinates?: unknown }
        }>
      }

      for (const feature of colecao.features ?? []) {
        const codarea = feature.properties?.codarea
        if (!codarea) continue
        const centro = centroide(feature.geometry)
        if (centro) coordenadas.set(String(codarea), centro)
      }
    } catch {
      // Uma malha ilegível não impede publicar o resto.
      void uf
    }
  }

  return coordenadas
}

/** Centro do bounding box de uma geometria GeoJSON. */
function centroide(
  geometria: { type?: string; coordinates?: unknown } | null | undefined,
): { lng: number; lat: number } | null {
  const coords: number[][] = []
  const percorrer = (no: unknown): void => {
    if (!Array.isArray(no)) return
    if (typeof no[0] === 'number' && typeof no[1] === 'number') {
      coords.push(no as number[])
      return
    }
    for (const filho of no) percorrer(filho)
  }
  percorrer(geometria?.coordinates)
  if (coords.length === 0) return null

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of coords) {
    if (x === undefined || y === undefined) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  return {
    lng: Number(((minX + maxX) / 2).toFixed(4)),
    lat: Number(((minY + maxY) / 2).toFixed(4)),
  }
}

/** Versão de uma pasta de origem, a partir do mtime mais recente. */
async function versaoDaPasta(caminho: string): Promise<string> {
  if (!existsSync(caminho)) return 'ausente'
  try {
    const info = await stat(caminho)
    return `${new Date(info.mtimeMs).toISOString()}`
  } catch {
    return 'erro'
  }
}

/** Executa a publicação. */
export async function publicar(opcoes: OpcoesPublicacao = {}): Promise<ResultadoPublicacao> {
  const raizOrganizada = opcoes.raizOrganizada ?? join(RAIZ_PROJETO, 'data', 'organized')
  const raizRelacionada = opcoes.raizRelacionada ?? join(RAIZ_PROJETO, 'data', 'related')
  const raizCalculada = opcoes.raizCalculada ?? join(RAIZ_PROJETO, 'data', 'calculated')
  const raizRaw = opcoes.raizRaw ?? join(RAIZ_PROJETO, 'data', 'raw')
  const raizSaida = opcoes.raizSaida ?? join(RAIZ_PROJETO, 'data', 'published')
  const porBloco = opcoes.municipiosPorBloco ?? MUNICIPIOS_POR_BLOCO_PADRAO
  const comprimir = opcoes.comprimir ?? true
  const agora = (opcoes.agora ?? (() => new Date()))()

  const caminhos: CaminhosPublicacao = { raizOrganizada, raizRelacionada, raizCalculada, raizRaw }

  // 0. Limpa a saída anterior: publicação é substituição, não acumulação.
  // Sem isso, um artefato de build antigo sobreviveria ao novo.
  await limparDiretorio(raizSaida)

  // 1. Carrega as fontes.
  const calculados = await carregarMunicipiosCalculados(caminhos)
  if (calculados.size === 0) {
    throw new ErroPublicacao(
      'nenhum município calculado — rode as Caixas 4, 5 e 6 antes de publicar',
      'fonte-ausente',
    )
  }

  const candidatos = await carregarCandidatos(caminhos)
  const orcamento = await carregarOrcamento(caminhos)
  const estados = await carregarEstados(caminhos)
  const areas = await carregarAreas(caminhos)
  const ponte = await carregarPonte(caminhos)
  const coordenadas = await carregarCoordenadas(caminhos)

  const avisos: string[] = []
  if (coordenadas.size === 0) {
    avisos.push(
      'nenhuma coordenada territorial encontrada: o mapa ficará sem pontos. ' +
        'Verifique se as malhas do IBGE estão no RAW.',
    )
  }

  const artefatos: ArtefatoPublicado[] = []

  /** Grava, comprime e registra um artefato. */
  const emitir = async (relativo: string, dado: unknown, registros?: number): Promise<void> => {
    const destino = join(raizSaida, relativo)
    const bytes = await gravarJson(destino, dado)
    artefatos.push(await registrarArtefato(raizSaida, destino, bytes, comprimir, registros))
  }

  // 2. Municípios — índice + blocos.
  const publicados: MunicipioPublicado[] = []
  for (const calculado of calculados.values()) {
    // Apenas MUNICÍPIOS entram no índice e nos blocos. O Brasil ("1") e as UFs
    // (2 dígitos) existem no calculado para o consolidado, mas não têm
    // coordenada municipal nem lugar numa lista de municípios — incluí-los
    // criaria entradas fantasma em (0,0) no mapa.
    if (calculado.codarea.length !== 7) continue

    const linhaPonte = ponte.get(calculado.codarea)
    const uf = ufDoCodarea(calculado.codarea)
    publicados.push(
      formatarMunicipio(
        calculado,
        candidatos.get(calculado.codarea),
        coordenadas.get(calculado.codarea),
        linhaPonte?.ufSigla ?? calculado.ufSigla ?? uf,
        orcamento.get(calculado.codarea),
      ),
    )
  }

  const blocos = dividirEmBlocos(publicados, porBloco)
  const indice = [...publicados]
    .sort((a, b) => a.codarea.localeCompare(b.codarea))
    .map(formatarIndice)

  await emitir(ROTAS_FRONTEND.municipiosIndice, { total: indice.length, municipios: indice }, indice.length)
  for (const [i, bloco] of blocos.entries()) {
    await emitir(ROTAS_FRONTEND.municipiosBloco(i), { bloco: i, municipios: bloco }, bloco.length)
  }

  // 3. Indicadores — Brasil + shard por UF.
  const porUf = new Map<string, MunicipioPublicado[]>()
  for (const m of publicados) {
    const lista = porUf.get(m.uf)
    if (lista) lista.push(m)
    else porUf.set(m.uf, [m])
  }

  // O SIDRA usa o código "1" para o Brasil consolidado e 2 dígitos para as UFs.
  const brasilCalculado = calculados.get('1')
  const estadosPublicados = [...calculados.values()]
    .filter((c) => c.codarea.length === 2)
    .map(formatarIndicadores)
    .sort((a, b) => a.codarea.localeCompare(b.codarea))

  await emitir(
    ROTAS_FRONTEND.indicadoresBrasil,
    {
      brasil: brasilCalculado ? formatarIndicadores(brasilCalculado) : null,
      estados: estadosPublicados,
    },
    estadosPublicados.length + (brasilCalculado ? 1 : 0),
  )

  for (const uf of UFS) {
    const estado = estados.get(uf)
    if (!estado) continue
    const municipiosUf = [...calculados.values()].filter(
      (c) => c.codarea.length === 7 && ufDoCodarea(c.codarea) === uf,
    )
    await emitir(
      ROTAS_FRONTEND.indicadoresUf(estado.sigla),
      formatarIndicadoresUf(uf, municipiosUf),
      municipiosUf.length,
    )
  }

  // 4. Ranking.
  await emitir(
    ROTAS_FRONTEND.ranking,
    formatarRanking(publicados, estados, agora.toISOString()),
    publicados.length,
  )

  // 5. Territórios — malha nacional + shards por UF.
  const nomesMunicipios = await carregarNomeMunicipios(caminhos)
  await publicarTerritorios(
    caminhos,
    raizSaida,
    comprimir,
    artefatos,
    avisos,
    estados,
    nomesMunicipios,
  )

  // 6. Orçamento.
  const entes = [...orcamento.values()]
    .map((o) => formatarOrcamento(o, ponte.get(o.codarea)?.nome ?? o.instituicao ?? o.codarea))
    .sort((a, b) => a.codarea.localeCompare(b.codarea))

  await emitir(ROTAS_FRONTEND.orcamentoBrasil, { entes }, entes.length)

  const orcamentoPorUf = new Map<string, typeof entes>()
  for (const ente of entes) {
    if (ente.codarea.length !== 7) continue
    const uf = ufDoCodarea(ente.codarea)
    const lista = orcamentoPorUf.get(uf)
    if (lista) lista.push(ente)
    else orcamentoPorUf.set(uf, [ente])
  }

  for (const [uf, lista] of orcamentoPorUf) {
    const estado = estados.get(uf)
    const sigla = estado?.sigla ?? uf
    await emitir(ROTAS_FRONTEND.orcamentoUf(sigla), { uf, municipios: lista }, lista.length)
  }

  // 7. Eleições.
  const candidaturas = [...candidatos.values()]
    .map((c) => ({
      codarea: c.codarea,
      totalCandidatos: c.totalCandidatos,
      candidatosPrefeito: c.candidatosPrefeito,
      candidatosVereador: c.candidatosVereador,
      partidosDistintos: c.partidosDistintos,
      anoEleicao: c.anoEleicao,
    }))
    .sort((a, b) => a.codarea.localeCompare(b.codarea))

  await emitir(ROTAS_FRONTEND.eleicoesBrasil, { total: candidaturas.length, municipios: candidaturas }, candidaturas.length)

  // 8. Manifesto.
  const totais = artefatos.reduce(
    (acc, a) => ({
      bytes: acc.bytes + a.bytes,
      bytesGzip: acc.bytesGzip + (a.bytesGzip ?? a.bytes),
    }),
    { bytes: 0, bytesGzip: 0 },
  )

  const manifesto: ManifestoPublicacao = {
    versaoPublicacao: VERSAO_PUBLICACAO,
    publicadoEm: agora.toISOString(),
    origens: {
      organizada: await versaoDaPasta(raizOrganizada),
      relacionada: await versaoDaPasta(raizRelacionada),
      calculada: await versaoDaPasta(raizCalculada),
    },
    artefatos,
    contagens: {
      municipios: publicados.length,
      ufs: UFS.length,
      blocos: blocos.length,
      candidatos: candidaturas.reduce((s, c) => s + c.totalCandidatos, 0),
    },
    totais,
    avisos,
  }

  const caminhoManifesto = join(raizSaida, 'publicacao.meta.json')
  await gravarJson(caminhoManifesto, manifesto)

  return {
    raiz: relative(RAIZ_PROJETO, raizSaida),
    artefatos,
    totais,
    manifestoSaida: relative(RAIZ_PROJETO, caminhoManifesto),
  }
}

/**
 * Publica as malhas territoriais.
 *
 * Duas correções em relação à primeira versão:
 *
 * 1. **A malha nacional (UFs) também é publicada.** O mapa carrega
 *    `territorios/brasil.geojson` para desenhar os estados antes de qualquer
 *    drill-down; sem ela, o mapa aparece vazio.
 *
 * 2. **As propriedades são enriquecidas.** O IBGE devolve só `codarea`; o
 *    frontend precisa de `nome`, `sigla`, `uf` e `ufId`. Sem isso os polígonos
 *    são desenhados sem identificação.
 */
async function publicarTerritorios(
  caminhos: CaminhosPublicacao,
  raizSaida: string,
  comprimir: boolean,
  artefatos: ArtefatoPublicado[],
  avisos: string[],
  estados: Map<string, EstadoOrganizado>,
  municipios: Map<string, NomeMunicipio>,
): Promise<void> {
  /** Lê, enriquece, grava e registra um GeoJSON. */
  const emitirGeoJson = async (
    relativo: string,
    bruto: string,
    enriquecer: (g: ColecaoGeoJson) => ColecaoGeoJson,
    exigidas: readonly string[],
  ): Promise<boolean> => {
    let geojson: ColecaoGeoJson
    try {
      geojson = JSON.parse(bruto) as ColecaoGeoJson
    } catch (err) {
      avisos.push(
        `${relativo}: GeoJSON ilegível — ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }

    if (!ehFeatureCollectionValida(geojson)) {
      avisos.push(`${relativo}: não é uma FeatureCollection válida — o mapa não desenharia nada`)
      return false
    }

    const enriquecido = enriquecer(geojson)
    const completude = propriedadesCompletas(enriquecido, exigidas)
    if (!completude.ok) {
      // Isto é o sintoma exato da regressão: o mapa desenha polígonos sem
      // nome/sigla e o painel mostra código cru.
      avisos.push(
        `${relativo}: propriedades ausentes ${completude.faltando.join(', ')} — ` +
          `o mapa perderia identificação`,
      )
    }

    const destino = join(raizSaida, relativo)
    const bytes = await gravarTexto(destino, JSON.stringify(enriquecido))
    artefatos.push(await registrarArtefato(raizSaida, destino, bytes, comprimir, enriquecido.features.length))
    return true
  }

  // 1. Malha nacional das UFs.
  const caminhoUfs = await localizarMalhaUfs(caminhos)
  if (caminhoUfs) {
    const bruto = await lerMalhaUf(caminhos, caminhoUfs)
    if (bruto) {
      await emitirGeoJson(
        ROTAS_FRONTEND.territoriosBrasil,
        bruto,
        (g) => enriquecerMalhaUfs(g, estados),
        ['codarea', 'nome', 'sigla'],
      )
    }
  } else {
    avisos.push(
      'malha das UFs não encontrada no RAW — o mapa abriria sem estados. ' +
        'Rode: npm run coletar -- --recurso malha-ufs',
    )
  }

  // 2. Malhas municipais, uma por UF.
  const indice = await indexarMalhas(caminhos)
  if (indice.size === 0) {
    avisos.push('nenhuma malha municipal encontrada no RAW — territórios municipais não publicados')
    return
  }

  let publicadas = 0
  for (const [uf, { arquivo }] of indice) {
    const bruto = await lerMalhaUf(caminhos, arquivo)
    if (!bruto) continue

    const estado = estados.get(uf)
    const ok = await emitirGeoJson(
      ROTAS_FRONTEND.territoriosUf(uf),
      bruto,
      (g) => enriquecerMalhaMunicipios(g, municipios, uf, estado?.sigla ?? uf),
      ['codarea', 'nome', 'uf', 'ufId'],
    )
    if (ok) publicadas++
  }

  if (publicadas === 0) {
    avisos.push('malhas indexadas mas nenhuma pôde ser publicada — territórios vazios')
  }
}
