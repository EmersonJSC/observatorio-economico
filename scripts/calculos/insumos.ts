/**
 * Caixa 6 — leitura dos insumos do município.
 *
 * Os insumos vêm de origens diferentes, e cada uma tem sua forma:
 *
 *   - Nome, código e UF: `data/organized/ibge-localidades/municipios-por-uf.jsonl`
 *     (Caixa 4). É a base canônica de municípios.
 *   - População e PIB: `data/organized/ibge-sidra/{populacao,pib}.jsonl`
 *     (Caixa 4, tradutor `ibge-sidra`). A Caixa 6 NÃO lê o RAW do SIDRA — fazer
 *     isso quebrava o isolamento entre as camadas.
 *   - Receita/despesa: RAW do Siconfi (`siconfi/dca`), porque a Caixa 4 ainda
 *     não tem tradutor para essa fonte.
 *   - Área: `data/organized/ibge-malhas/malha-municipios-por-uf.jsonl`
 *     (Caixa 4). A área é derivada da geometria pelo tradutor de malhas.
 *
 * Este módulo lê e normaliza essas formas para um `Map<codarea, InsumosMunicipio>`.
 * Ele NÃO calcula nada — só carrega e tipa.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { iterarJsonl } from './leitura.js'

/** Todos os insumos de um município, com o ano de cada um. */
export interface InsumosMunicipio {
  codarea: string
  nome: string
  ufSigla: string
  /** População estimada (SIDRA 6579). */
  populacao: { valor: number | null; ano: number }
  /** PIB a preços correntes, em milhares de reais (SIDRA 5938). */
  pibMilReais: { valor: number | null; ano: number }
  /** Área territorial em km². Sem ano: a malha é a vigente. */
  areaKm2: { valor: number | null; ano: number }
  /** Receita orçamentária realizada (Siconfi DCA). */
  receitaTotal: { valor: number | null; ano: number }
  /** Despesa orçamentária liquidada (Siconfi DCA). */
  despesaTotal: { valor: number | null; ano: number }
  /** Gasto na função Saúde (Siconfi DCA, Anexo I-E). */
  gastoSaude: { valor: number | null; ano: number }
  /** Gasto na função Educação (Siconfi DCA, Anexo I-E). */
  gastoEducacao: { valor: number | null; ano: number }
}

/** Anos de referência efetivamente encontrados nos insumos. */
export interface AnosInsumos {
  populacao: number
  pib: number
  area: number
  siconfi: number
}

/** Valor ausente com ano conhecido. */
function semValor(ano: number): { valor: number | null; ano: number } {
  return { valor: null, ano }
}

// ---------------------------------------------------------------------------
// População e PIB (SIDRA, lidos do ORGANIZADO da Caixa 4)
// ---------------------------------------------------------------------------

/**
 * Lê um recurso do SIDRA em `data/organized/ibge-sidra/<recurso>.jsonl` e
 * indexa por ano.
 *
 * A Caixa 6 NÃO lê mais o RAW do SIDRA: o tradutor da Caixa 4
 * (`tradutores/ibge-sidra.ts`) achata o aninhamento `resultados[].series[]` em
 * uma linha por (localidade, ano). Ler o RAW aqui era uma quebra de contrato
 * entre as camadas — corrigida nesta refatoração.
 *
 * @returns Um mapa `ano → (codarea → valor)`.
 */
async function lerSidraOrganizado(
  raizOrganizada: string,
  recursoId: string,
): Promise<Map<number, Map<string, number | null>>> {
  const caminho = join(raizOrganizada, 'ibge-sidra', `${recursoId}.jsonl`)
  const porAno = new Map<number, Map<string, number | null>>()

  if (!existsSync(caminho)) return porAno

  for await (const linha of iterarJsonl<{
    codarea?: string
    ano?: number
    populacao?: number | null
    pibMilReais?: number | null
  }>(caminho, `ibge-sidra/${recursoId}.jsonl`)) {
    const codarea = linha.codarea
    const ano = linha.ano
    if (!codarea || typeof ano !== 'number' || !Number.isFinite(ano)) continue

    const bruto = recursoId === 'pib' ? linha.pibMilReais : linha.populacao
    const valor = typeof bruto === 'number' && Number.isFinite(bruto) ? bruto : null

    let mapa = porAno.get(ano)
    if (!mapa) {
      mapa = new Map<string, number | null>()
      porAno.set(ano, mapa)
    }
    // O mesmo par (codarea, ano) pode aparecer em mais de um objeto do RAW
    // (uma vez por UF coletada); manter o primeiro é o comportamento correto.
    if (!mapa.has(codarea)) mapa.set(codarea, valor)
  }

  return porAno
}

/**
 * Escolhe os anos de população e PIB que PAREEIAM.
 *
 * O PIB é o insumo mais restrito (2021 é o último ano consolidado para
 * municípios). A população é escolhida para ser do MESMO ano — é assim que o
 * per capita fica metodologicamente válido. Se não houver população do ano do
 * PIB, usa-se a mais recente e o motor devolve `ano-divergente`, que é a
 * resposta honesta.
 */
async function lerIndicadoresSidra(
  raizOrganizada: string,
): Promise<{
  populacao: Map<string, number | null>
  pib: Map<string, number | null>
  anos: { populacao: number; pib: number }
}> {
  const popPorAno = await lerSidraOrganizado(raizOrganizada, 'populacao')
  const pibPorAno = await lerSidraOrganizado(raizOrganizada, 'pib')

  const anosPib = [...pibPorAno.keys()].sort((a, b) => b - a)
  const anosPop = [...popPorAno.keys()].sort((a, b) => b - a)

  const anoPib = anosPib[0] ?? 0
  const anoPop = popPorAno.has(anoPib) ? anoPib : (anosPop[0] ?? 0)

  return {
    populacao: popPorAno.get(anoPop) ?? new Map(),
    pib: pibPorAno.get(anoPib) ?? new Map(),
    anos: { populacao: anoPop, pib: anoPib },
  }
}

// ---------------------------------------------------------------------------
// Siconfi DCA (lido do ORGANIZADO da Caixa 4)
// ---------------------------------------------------------------------------

/**
 * Lê `data/organized/siconfi/dca.jsonl` e indexa por codarea.
 *
 * A Caixa 6 NÃO lê mais o RAW do Siconfi. O tradutor da Caixa 4
 * (`tradutores/siconfi-dca.ts`) já agregou as centenas de linhas do envelope
 * do DCA em UMA linha por ente, com receita, despesa e gastos por função.
 *
 * @returns O mapa por codarea e o exercício encontrado.
 */
async function lerSiconfiOrganizado(raizOrganizada: string): Promise<{
  porCodarea: Map<
    string,
    { receita: number | null; despesa: number | null; saude: number | null; educacao: number | null }
  >
  exercicio: number
}> {
  const caminho = join(raizOrganizada, 'siconfi', 'dca.jsonl')
  const porCodarea = new Map<
    string,
    { receita: number | null; despesa: number | null; saude: number | null; educacao: number | null }
  >()
  let exercicio = 0
  if (!existsSync(caminho)) return { porCodarea, exercicio }

  for await (const linha of iterarJsonl<{
    codarea?: string
    exercicio?: number
    receitaTotal?: number | null
    despesaTotal?: number | null
    gastoSaude?: number | null
    gastoEducacao?: number | null
  }>(caminho, 'siconfi/dca.jsonl')) {
    const codarea = linha.codarea
    if (!codarea) continue

    if (typeof linha.exercicio === 'number' && linha.exercicio > exercicio) {
      exercicio = linha.exercicio
    }

    porCodarea.set(codarea, {
      receita: linha.receitaTotal ?? null,
      despesa: linha.despesaTotal ?? null,
      saude: linha.gastoSaude ?? null,
      educacao: linha.gastoEducacao ?? null,
    })
  }

  return { porCodarea, exercicio }
}

// ---------------------------------------------------------------------------
// Área territorial (organizado)
// ---------------------------------------------------------------------------

/**
 * Lê a área (km²) por município.
 *
 * A área não vem do `municipios-por-uf.jsonl` (que traz só código e nome) —
 * ela é derivada da malha territorial. Enquanto a Caixa 6 não tiver uma fonte
 * direta de área, devolvemos um mapa vazio e a densidade sai como
 * `insumo-ausente`, que é o comportamento honesto.
 */
async function lerAreas(raizOrganizada: string): Promise<Map<string, number>> {
  // A área vem do tradutor de malhas (`ibge-malhas`), que calcula km² a partir
  // da geometria do GeoJSON do IBGE. Antes disso a densidade ficava eternamente
  // em `insumo-ausente`.
  const caminho = join(raizOrganizada, 'ibge-malhas', 'malha-municipios-por-uf.jsonl')
  const areas = new Map<string, number>()
  if (!existsSync(caminho)) return areas

  for await (const linha of iterarJsonl<{ codarea?: string; areaKm2?: number }>(
    caminho,
    'ibge-localidades/areas.jsonl',
  )) {
    if (linha.codarea && typeof linha.areaKm2 === 'number') {
      areas.set(linha.codarea, linha.areaKm2)
    }
  }
  return areas
}

// ---------------------------------------------------------------------------
// Carga completa
// ---------------------------------------------------------------------------

/** Localização das fontes da Caixa 6. Não inclui RAW: a Caixa 6 não o lê. */
export interface CaminhosInsumos {
  raizOrganizada: string
  raizRelacionada: string
}

/**
 * Carrega os insumos de todos os municípios.
 *
 * A LISTA de municípios vem do organizado (Caixa 4) — é a base canônica. Os
 * valores são enriquecidos a partir do RAW e da ponte (Caixa 5).
 */
export async function carregarInsumos(
  caminhos: CaminhosInsumos,
): Promise<{ municipios: Map<string, InsumosMunicipio>; anos: AnosInsumos }> {
  const caminhoMunicipios = join(
    caminhos.raizOrganizada,
    'ibge-localidades',
    'municipios-por-uf.jsonl',
  )
  if (!existsSync(caminhoMunicipios)) {
    throw new Error(
      `base de municípios não encontrada: ${caminhoMunicipios}\n` +
        `  Rode a Caixa 4 antes de calcular.`,
    )
  }

  const sidra = await lerIndicadoresSidra(caminhos.raizOrganizada)
  const siconfi = await lerSiconfiOrganizado(caminhos.raizOrganizada)
  const areas = await lerAreas(caminhos.raizOrganizada)

  const municipios = new Map<string, InsumosMunicipio>()

  for await (const linha of iterarJsonl<{
    codarea?: string
    nome?: string
    ufSigla?: string
  }>(caminhoMunicipios, 'ibge-localidades/municipios-por-uf.jsonl')) {
    const codarea = linha.codarea
    if (!codarea) continue

    const orcamento = siconfi.porCodarea.get(codarea)
    const area = areas.get(codarea) ?? null

    municipios.set(codarea, {
      codarea,
      nome: linha.nome ?? codarea,
      ufSigla: linha.ufSigla ?? '',
      populacao: { valor: sidra.populacao.get(codarea) ?? null, ano: sidra.anos.populacao },
      pibMilReais: { valor: sidra.pib.get(codarea) ?? null, ano: sidra.anos.pib },
      // A área é atemporal: ano 0 sinaliza "sem ano de referência".
      areaKm2: area === null ? semValor(0) : { valor: area, ano: 0 },
      receitaTotal: { valor: orcamento?.receita ?? null, ano: siconfi.exercicio },
      despesaTotal: { valor: orcamento?.despesa ?? null, ano: siconfi.exercicio },
      gastoSaude: { valor: orcamento?.saude ?? null, ano: siconfi.exercicio },
      gastoEducacao: { valor: orcamento?.educacao ?? null, ano: siconfi.exercicio },
    })
  }

  // Entes NÃO municipais: Brasil (código "1") e as UFs (2 dígitos).
  //
  // O SIDRA publica agregados para esses níveis e o frontend exibe o
  // consolidado nacional e o painel por UF. Sem eles, `indicadores/brasil.json`
  // sairia com `brasil: null` e `estados: []` — que era exatamente o sintoma
  // da regressão.
  for await (const linha of iterarJsonl<{
    codarea?: string
    sigla?: string
    nome?: string
  }>(join(caminhos.raizOrganizada, 'ibge-localidades', 'estados.jsonl'), 'ibge-localidades/estados.jsonl')) {
    const codarea = linha.codarea
    if (!codarea) continue

    municipios.set(codarea, {
      codarea,
      nome: linha.nome ?? codarea,
      ufSigla: linha.sigla ?? '',
      populacao: { valor: sidra.populacao.get(codarea) ?? null, ano: sidra.anos.populacao },
      pibMilReais: { valor: sidra.pib.get(codarea) ?? null, ano: sidra.anos.pib },
      areaKm2: semValor(0),
      receitaTotal: { valor: null, ano: siconfi.exercicio },
      despesaTotal: { valor: null, ano: siconfi.exercicio },
      gastoSaude: { valor: null, ano: siconfi.exercicio },
      gastoEducacao: { valor: null, ano: siconfi.exercicio },
    })
  }

  // Brasil consolidado: o SIDRA usa o código "1" para o nível N1.
  if (sidra.populacao.has('1') || sidra.pib.has('1')) {
    municipios.set('1', {
      codarea: '1',
      nome: 'Brasil',
      ufSigla: 'BR',
      populacao: { valor: sidra.populacao.get('1') ?? null, ano: sidra.anos.populacao },
      pibMilReais: { valor: sidra.pib.get('1') ?? null, ano: sidra.anos.pib },
      areaKm2: semValor(0),
      receitaTotal: { valor: null, ano: siconfi.exercicio },
      despesaTotal: { valor: null, ano: siconfi.exercicio },
      gastoSaude: { valor: null, ano: siconfi.exercicio },
      gastoEducacao: { valor: null, ano: siconfi.exercicio },
    })
  }

  return {
    municipios,
    anos: {
      populacao: sidra.anos.populacao,
      pib: sidra.anos.pib,
      area: areas.size > 0 ? 0 : 0,
      siconfi: siconfi.exercicio,
    },
  }
}
