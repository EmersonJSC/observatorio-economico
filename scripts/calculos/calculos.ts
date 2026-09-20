/**
 * Caixa 6 — CÁLCULOS: engrenagem principal.
 *
 * Fluxo:
 *   1. carrega os insumos (organizado + RAW + ponte)
 *   2. aplica o catálogo de métricas por município (motores puros)
 *   3. grava `data/calculated/municipio.jsonl`
 *   4. grava o resumo em `calculos.meta.json`, com cobertura e bloqueios
 *
 * Rigor metodológico: divisão entre anos divergentes devolve `null` com motivo
 * `ano-divergente`. NÃO há interpolação de população.
 */

import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile, appendFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { carregarInsumos, type AnosInsumos } from './insumos.js'
import {
  agregarCandidatosPorMunicipio,
  carregarPonte,
  caminhoPonte,
  caminhoTseOrganizado,
} from './agregacoes/tse-candidatos.js'
import { calcularMetricasMunicipio, type ValoresMunicipio } from './metricas/municipio.js'
import { METRICAS_MUNICIPIO } from './metricas/catalogo.js'
import type {
  CoberturaMetrica,
  MetadadosCalculos,
  MotivoNulo,
  OpcoesCalculos,
  ResultadoCalculos,
} from './tipos.js'
import { VERSAO_CALCULOS } from './tipos.js'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Uma linha do `municipio.jsonl`. */
export interface LinhaMunicipioCalculado {
  codarea: string
  nome: string
  ufSigla: string
  /** Valores calculados, por id de métrica. */
  metricas: ValoresMunicipio
}

/** Escritor JSONL incremental com rename atômico. */
class Escritor {
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

/** Acumula cobertura por métrica durante a passagem pelos municípios. */
function acumularCobertura(
  acumulado: Map<string, { comValor: number; porMotivo: Partial<Record<MotivoNulo, number>> }>,
  valores: ValoresMunicipio,
): void {
  for (const [id, valor] of Object.entries(valores)) {
    const atual = acumulado.get(id) ?? { comValor: 0, porMotivo: {} }
    if (valor.valor !== null) {
      atual.comValor++
    } else if (valor.motivo) {
      atual.porMotivo[valor.motivo] = (atual.porMotivo[valor.motivo] ?? 0) + 1
    }
    acumulado.set(id, atual)
  }
}

/** Monta o texto dos bloqueios metodológicos ativos. */
function descreverBloqueios(
  cobertura: readonly CoberturaMetrica[],
  anos: AnosInsumos,
): string[] {
  const bloqueios: string[] = []

  for (const c of cobertura) {
    const divergentes = c.porMotivo['ano-divergente'] ?? 0
    if (divergentes > 0) {
      // A causa é sempre a mesma quando o motivo é ano-divergente: os insumos
      // vêm de exercícios diferentes. Damos o número para dimensionar.
      bloqueios.push(
        `${c.metricaId}: BLOQUEADO em ${divergentes} município(s) por ano divergente ` +
          `(população ${anos.populacao}, PIB ${anos.pib}, Siconfi ${anos.siconfi})`,
      )
    }
  }

  return bloqueios
}

/** Executa a Caixa 6. */
export async function calcular(opcoes: OpcoesCalculos = {}): Promise<ResultadoCalculos> {
  const raizOrganizada = opcoes.raizOrganizada ?? join(RAIZ_PROJETO, 'data', 'organized')
  const raizRelacionada = opcoes.raizRelacionada ?? join(RAIZ_PROJETO, 'data', 'related')
  const raizSaida = opcoes.raizSaida ?? join(RAIZ_PROJETO, 'data', 'calculated')
  const agora = (opcoes.agora ?? (() => new Date()))()

  // 1. Insumos — TODOS vêm do organizado (Caixa 4) e da ponte (Caixa 5).
  // A Caixa 6 não lê o RAW: o isolamento entre as camadas é de contrato.
  const { municipios, anos } = await carregarInsumos({
    raizOrganizada,
    raizRelacionada,
  })

  if (municipios.size === 0) {
    throw new Error('nenhum município encontrado no organizado — rode a Caixa 4')
  }

  // 2. Cálculo, com acumulação de cobertura em uma única passada.
  const caminhoSaida = join(raizSaida, 'municipio.jsonl')
  const escritor = new Escritor(caminhoSaida)
  await escritor.abrir()

  const cobertura = new Map<
    string,
    { comValor: number; porMotivo: Partial<Record<MotivoNulo, number>> }
  >()
  const avisos: string[] = []

  try {
    for (const insumos of municipios.values()) {
      const valores = calcularMetricasMunicipio(insumos)
      acumularCobertura(cobertura, valores)

      const linha: LinhaMunicipioCalculado = {
        codarea: insumos.codarea,
        nome: insumos.nome,
        ufSigla: insumos.ufSigla,
        metricas: valores,
      }
      await escritor.escrever(linha)
    }
    await escritor.fechar()
  } catch (err) {
    await escritor.abortar()
    throw err
  }

  // 3. Agregação do TSE por município (streaming, sem OOM).
  const agregacaoTse = await agregarCandidatos(raizOrganizada, raizRelacionada, raizSaida)

/** Resultado da agregação do TSE, para os metadados. */
interface ResumoAgregacaoTse {
  municipios: number
  candidatos: number
  naoVinculados: number
  saida: string
}

/**
 * Agrega as candidaturas do TSE por município e grava
 * `data/calculated/candidatos-por-municipio.jsonl`.
 *
 * Faz UMA passagem em 463.859 linhas mantendo apenas um acumulador por
 * município (~5.569), em vez de materializar todos os candidatos.
 */
async function agregarCandidatos(
  raizOrganizada: string,
  raizRelacionada: string,
  raizSaida: string,
): Promise<ResumoAgregacaoTse | null> {
  const caminhoTse = caminhoTseOrganizado(raizOrganizada)
  const caminhoDaPonte = caminhoPonte(raizRelacionada)

  if (!existsSync(caminhoTse) || !existsSync(caminhoDaPonte)) {
    // Sem o TSE organizado ou sem a ponte, a agregação não é possível — e isso
    // não deve derrubar o cálculo dos indicadores municipais.
    return null
  }

  const ponte = await carregarPonte(caminhoDaPonte)
  const { porMunicipio, naoVinculados } = await agregarCandidatosPorMunicipio(
    caminhoTse,
    ponte,
  )

  const destino = join(raizSaida, 'candidatos-por-municipio.jsonl')
  const escritor = new Escritor(destino)
  await escritor.abrir()

  let totalCandidatos = 0
  try {
    // Ordena por codarea para saída determinística.
    const linhas = [...porMunicipio.values()].sort((a, b) => a.codarea.localeCompare(b.codarea))
    for (const linha of linhas) {
      totalCandidatos += linha.totalCandidatos
      await escritor.escrever(linha)
    }
    await escritor.fechar()
  } catch (err) {
    await escritor.abortar()
    throw err
  }

  return {
    municipios: porMunicipio.size,
    candidatos: totalCandidatos,
    naoVinculados,
    saida: relative(RAIZ_PROJETO, destino),
  }
}

  // 4. Cobertura consolidada.
  const coberturaFinal: CoberturaMetrica[] = METRICAS_MUNICIPIO.map((m) => {
    const c = cobertura.get(m.id) ?? { comValor: 0, porMotivo: {} }
    return {
      metricaId: m.id,
      nome: m.nome,
      unidade: m.unidade,
      comValor: c.comValor,
      porMotivo: c.porMotivo,
    }
  })

  // Avisos sobre insumos que não existem no pipeline atual.
  const semPopulacao = coberturaFinal.find((c) => c.metricaId === 'populacao')
  if (semPopulacao && semPopulacao.comValor === 0) {
    avisos.push(
      'nenhum município tem população: o RAW do IBGE SIDRA não foi coletado. ' +
        'Rode: npm run coletar -- --fonte ibge-sidra',
    )
  }
  if (anos.siconfi === 0) {
    avisos.push(
      'nenhum dado orçamentário encontrado: o RAW do Siconfi não foi coletado.',
    )
  }
  const densidade = coberturaFinal.find((c) => c.metricaId === 'densidade')
  if (densidade && densidade.comValor === 0) {
    avisos.push(
      'densidade zerada: a área territorial por município ainda não está disponível ' +
        'em data/organized/ibge-localidades/areas.jsonl',
    )
  }

  const metadados: MetadadosCalculos = {
    versaoCalculos: VERSAO_CALCULOS,
    calculadoEm: agora.toISOString(),
    anosInsumos: {
      populacao: anos.populacao,
      pib: anos.pib,
      area: anos.area,
      siconfi: anos.siconfi,
    },
    metricas: METRICAS_MUNICIPIO,
    contagens: { municipios: municipios.size },
    cobertura: coberturaFinal,
    bloqueios: descreverBloqueios(coberturaFinal, anos),
    avisos,
    ...(agregacaoTse
      ? {
          agregacoes: {
            tseCandidatos: {
              municipios: agregacaoTse.municipios,
              candidatos: agregacaoTse.candidatos,
              naoVinculados: agregacaoTse.naoVinculados,
              saida: agregacaoTse.saida,
            },
          },
        }
      : {}),
  }

  const caminhoMeta = join(raizSaida, 'calculos.meta.json')
  await mkdir(dirname(caminhoMeta), { recursive: true })
  const metaTmp = `${caminhoMeta}.tmp`
  await writeFile(metaTmp, `${JSON.stringify(metadados, null, 2)}\n`, 'utf-8')
  await rename(metaTmp, caminhoMeta)

  return {
    saida: relative(RAIZ_PROJETO, caminhoSaida),
    contagens: { municipios: municipios.size },
    cobertura: coberturaFinal,
    metadados,
  }
}
