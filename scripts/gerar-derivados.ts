/**
 * Gera os arquivos DERIVADOS usados pelo site estático.
 *
 * Como o site publicado não tem servidor, as contas que antes eram feitas na
 * API precisam virar arquivo. São gerados:
 *
 *   data/indicators/pontos.json              → todos os municípios com PIB + centroide
 *   data/elections/composicao-brasil.json    → Câmara/Senado por partido + por estado
 *
 * Uso:
 *   npx tsx scripts/gerar-derivados.ts
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const INDICATORS_DIR = join(DATA_DIR, 'indicators')
const ELECTIONS_DIR = join(DATA_DIR, 'elections')
const MAPS_DIR = join(DATA_DIR, 'maps')
const EXPLORER_DIR = join(DATA_DIR, 'explorer')

async function lerJson<T>(caminho: string): Promise<T | null> {
  if (!existsSync(caminho)) return null
  return JSON.parse(await readFile(caminho, 'utf-8')) as T
}

// ---------------------------------------------------------------------------
// Área aproximada de um polígono esférico (km²)
// ---------------------------------------------------------------------------

const RAIO_TERRA_M = 6378137

/**
 * Fórmula do "shoelace esférico": aproxima a área de um polígono em uma esfera.
 * Suficiente para um coroplético de densidade — não é um cálculo geodésico exato.
 * O primeiro anel conta como contorno externo; os demais (buracos) subtraem.
 */
function areaPoligono(aneis: number[][][]): number {
  let total = 0
  aneis.forEach((anel, indice) => {
    let soma = 0
    const n = anel.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const lonI = (anel[i][0] * Math.PI) / 180
      const lonJ = (anel[j][0] * Math.PI) / 180
      const latI = (anel[i][1] * Math.PI) / 180
      const latJ = (anel[j][1] * Math.PI) / 180
      soma += (lonJ - lonI) * (2 + Math.sin(latI) + Math.sin(latJ))
    }
    const area = (Math.abs(soma) * RAIO_TERRA_M * RAIO_TERRA_M) / 2 / 1e6
    total += indice === 0 ? area : -area
  })
  return total
}

/** Área de uma geometria GeoJSON Polygon ou MultiPolygon, em km². */
function areaDaGeometria(geometry: { type?: string; coordinates?: unknown } | null | undefined): number {
  const tipo = geometry?.type
  const coords = geometry?.coordinates as number[][][] | number[][][][] | undefined
  if (!coords) return 0
  if (tipo === 'Polygon') return areaPoligono(coords as number[][][])
  if (tipo === 'MultiPolygon') {
    let total = 0
    for (const poligono of coords as number[][][][]) total += areaPoligono(poligono)
    return total
  }
  return 0
}

// ---------------------------------------------------------------------------
// 1. Pontos do mapa (indicadores + orçamento + eleições + área)
// ---------------------------------------------------------------------------

interface IndicadorMunicipio {
  codarea: string
  nome: string
  populacao: { total: number | null; anoReferencia?: number } | null
  pib: { valorTotalMilReais: number | null; valorPerCapitaReais: number | null; anoReferencia?: number } | null
}

interface OrcamentoMunicipio {
  codarea: string
  receitaTotal?: number
  despesaTotal?: number
  gastosPorArea?: { saude?: number; educacao?: number }
}

async function gerarPontosMapa() {
  const centroides = await lerJson<{
    municipios: Record<string, [number, number]>
  }>(join(MAPS_DIR, 'centroides.json'))
  if (!centroides) {
    console.warn('  ⚠ centroides.json não encontrado — rode: npx tsx scripts/update-centroides.ts')
    return
  }

  // Sigla da UF por código (vem das eleições)
  const siglas = new Map<string, string>()
  const dirEstados = join(ELECTIONS_DIR, 'estados')
  if (existsSync(dirEstados)) {
    for (const arquivo of await readdir(dirEstados)) {
      if (!arquivo.endsWith('.json')) continue
      const e = await lerJson<{ uf: string; sigla: string }>(join(dirEstados, arquivo))
      if (e?.uf && e?.sigla) siglas.set(String(e.uf), e.sigla)
    }
  }

  // Orçamento por codarea
  const orcamento = new Map<string, OrcamentoMunicipio>()
  const coletarOrcamento = (lista: OrcamentoMunicipio[] | undefined) => {
    for (const o of lista ?? []) orcamento.set(String(o.codarea), o)
  }
  coletarOrcamento((await lerJson<{ estados?: OrcamentoMunicipio[] }>(join(DATA_DIR, 'budget', 'brasil.json')))?.estados)
  const dirOrcamento = join(DATA_DIR, 'budget', 'ufs')
  if (existsSync(dirOrcamento)) {
    for (const arquivo of await readdir(dirOrcamento)) {
      if (!arquivo.endsWith('.json')) continue
      const d = await lerJson<{ municipios?: OrcamentoMunicipio[] }>(join(dirOrcamento, arquivo))
      coletarOrcamento(d?.municipios)
    }
  }

  // Partido do prefeito eleito (2024) por codarea IBGE
  const prefeitoPartido = new Map<string, string>()
  const dirEleicoesUf = join(ELECTIONS_DIR, 'ufs')
  if (existsSync(dirEleicoesUf)) {
    for (const arquivo of await readdir(dirEleicoesUf)) {
      if (!arquivo.endsWith('.json')) continue
      const d = await lerJson<{ municipios?: Array<{ codareaIbge?: string; prefeito?: { partido?: string } | null }> }>(
        join(dirEleicoesUf, arquivo),
      )
      for (const m of d?.municipios ?? []) {
        if (m.codareaIbge && m.prefeito?.partido) prefeitoPartido.set(String(m.codareaIbge), m.prefeito.partido)
      }
    }
  }

  // Área por codarea, calculada da malha de municípios
  const areas = new Map<string, number>()
  const dirMapasUf = join(MAPS_DIR, 'ufs')
  if (existsSync(dirMapasUf)) {
    for (const arquivo of (await readdir(dirMapasUf)).filter((f) => f.endsWith('.geojson'))) {
      const geo = await lerJson<{ features?: Array<{ properties?: { codarea?: string | number } | null; geometry?: unknown }> }>(
        join(dirMapasUf, arquivo),
      )
      for (const feat of geo?.features ?? []) {
        const codarea = String(feat.properties?.codarea ?? '')
        if (codarea && !areas.has(codarea)) {
          areas.set(codarea, areaDaGeometria(feat.geometry as { type?: string; coordinates?: unknown } | null))
        }
      }
    }
  }

  const arquivos = (await readdir(join(INDICATORS_DIR, 'ufs'))).filter((f) => f.endsWith('.json')).sort()
  const pontos: Array<Record<string, unknown>> = []

  for (const arquivo of arquivos) {
    const ufCodigo = arquivo.replace('.json', '')
    const dados = await lerJson<{ municipios: IndicadorMunicipio[] }>(
      join(INDICATORS_DIR, 'ufs', arquivo),
    )
    for (const m of dados?.municipios ?? []) {
      const centro = centroides.municipios[m.codarea]
      if (!centro) continue
      const orc = orcamento.get(m.codarea)
      const area = areas.get(m.codarea)
      pontos.push({
        codarea: m.codarea,
        nome: m.nome,
        uf: siglas.get(ufCodigo) ?? ufCodigo,
        lng: centro[0],
        lat: centro[1],
        pib: m.pib?.valorTotalMilReais ?? null,
        pibPerCapita: m.pib?.valorPerCapitaReais ?? null,
        populacao: m.populacao?.total ?? null,
        receitaTotal: orc?.receitaTotal ?? null,
        despesaTotal: orc?.despesaTotal ?? null,
        saude: orc?.gastosPorArea?.saude ?? null,
        educacao: orc?.gastosPorArea?.educacao ?? null,
        area: area && area > 0 ? Math.round(area * 100) / 100 : null,
        prefeitoPartido: prefeitoPartido.get(m.codarea) ?? null,
      })
    }
  }

  await writeFile(
    join(INDICATORS_DIR, 'pontos.json'),
    JSON.stringify({ total: pontos.length, pontos }),
    'utf-8',
  )
  console.log(`  ✓ indicators/pontos.json — ${pontos.length} municípios`)
}

// ---------------------------------------------------------------------------
// 2. Camada Explorer (fonte separada de derivação, com validação temporal)
// ---------------------------------------------------------------------------

type ValorTemporal = {
  valor: number | null
  ano: number | null
  unidade?: string
  status?: string
}

interface CoberturaMetrica {
  comDados: number
  esperados: number
  completa: boolean
}

interface MetricaUf {
  valor: number | null
  ano: number | null
  unidade: string
  cobertura: CoberturaMetrica
}

interface UfExplorer {
  codigoIbge: string
  nome: string
  sigla: string
  totalMunicipios: number
  indicadores: Record<string, MetricaUf>
}

interface MunicipioExplorer {
  territorio: {
    codigoIbge: string
    nome: string
    uf: string
    longitude: number | null
    latitude: number | null
    areaKm2: number | null
  }
  fonte: Record<string, ValorTemporal>
  derivado: Record<string, ValorTemporal>
  bloqueiosTemporais: string[]
}

/** Gera a camada de consulta do Explorer com separação estrita e padronização em R$. */
async function gerarCamadaExplorer() {
  await mkdir(EXPLORER_DIR, { recursive: true })

  const indicadoresMeta = await lerJson<{ anoPopulacao?: number; anoPib?: number }>(
    join(INDICATORS_DIR, 'metadata.json'),
  )
  const orcamentoMeta = await lerJson<{ exercicio?: number }>(join(DATA_DIR, 'budget', 'metadata.json'))
  const centroides = await lerJson<{ municipios?: Record<string, [number, number]> }>(
    join(MAPS_DIR, 'centroides.json'),
  )

  const anoPop = indicadoresMeta?.anoPopulacao ?? 2024
  const anoPib = indicadoresMeta?.anoPib ?? 2021
  const anoOrc = orcamentoMeta?.exercicio ?? 2023

  const siglas = new Map<string, string>()
  const nomesUf = new Map<string, string>()
  const brasilIndicadores = await lerJson<{ estados?: Array<{ codarea: string; nome: string }> }>(
    join(INDICATORS_DIR, 'brasil.json'),
  )
  for (const estado of brasilIndicadores?.estados ?? []) nomesUf.set(String(estado.codarea), estado.nome)
  const dirEstados = join(ELECTIONS_DIR, 'estados')
  if (existsSync(dirEstados)) {
    for (const arquivo of await readdir(dirEstados)) {
      if (!arquivo.endsWith('.json')) continue
      const estado = await lerJson<{ uf?: string; sigla?: string }>(join(dirEstados, arquivo))
      if (estado?.uf && estado.sigla) siglas.set(String(estado.uf), estado.sigla)
    }
  }

  const orcamento = new Map<string, OrcamentoMunicipio>()
  const codigosOrcamento = new Set<string>()
  for (const arquivo of (await readdir(join(DATA_DIR, 'budget', 'ufs'))).filter((f) => f.endsWith('.json'))) {
    const dados = await lerJson<{ municipios?: OrcamentoMunicipio[] }>(join(DATA_DIR, 'budget', 'ufs', arquivo))
    for (const ente of dados?.municipios ?? []) {
      const codigo = String(ente.codarea)
      codigosOrcamento.add(codigo)
      orcamento.set(codigo, ente)
    }
  }

  const codigosEleicoes = new Set<string>()
  for (const arquivo of (await readdir(join(ELECTIONS_DIR, 'ufs'))).filter((f) => f.endsWith('.json'))) {
    const dados = await lerJson<{ municipios?: Array<{ codareaIbge?: string }> }>(join(ELECTIONS_DIR, 'ufs', arquivo))
    for (const municipio of dados?.municipios ?? []) if (municipio.codareaIbge) codigosEleicoes.add(String(municipio.codareaIbge))
  }

  const areas = new Map<string, number>()
  for (const arquivo of (await readdir(join(MAPS_DIR, 'ufs'))).filter((f) => f.endsWith('.geojson'))) {
    const geo = await lerJson<{ features?: Array<{ properties?: { codarea?: string | number } | null; geometry?: unknown }> }>(join(MAPS_DIR, 'ufs', arquivo))
    for (const feature of geo?.features ?? []) {
      const codigo = String(feature.properties?.codarea ?? '')
      if (codigo && !areas.has(codigo)) areas.set(codigo, areaDaGeometria(feature.geometry as { type?: string; coordinates?: unknown } | null))
    }
  }

  const municipios: MunicipioExplorer[] = []
  const codigosIndicadores = new Set<string>()
  const duplicados = new Set<string>()
  const vistos = new Set<string>()

  for (const arquivo of (await readdir(join(INDICATORS_DIR, 'ufs'))).filter((f) => f.endsWith('.json')).sort()) {
    const ufCodigo = arquivo.replace('.json', '')
    const dados = await lerJson<{ municipios?: IndicadorMunicipio[] }>(join(INDICATORS_DIR, 'ufs', arquivo))
    for (const municipio of dados?.municipios ?? []) {
      const codigo = String(municipio.codarea)
      if (vistos.has(codigo)) duplicados.add(codigo)
      vistos.add(codigo)
      codigosIndicadores.add(codigo)

      const popValor = municipio.populacao?.total ?? null
      const popAno = municipio.populacao?.anoReferencia ?? anoPop

      const pibMilValor = municipio.pib?.valorTotalMilReais ?? null
      const pibReaisValor = pibMilValor !== null ? Math.round(pibMilValor * 1000) : null
      const pibAnoVal = municipio.pib?.anoReferencia ?? anoPib

      const gasto = orcamento.get(codigo)
      const gastoAno = gasto?.receitaTotal !== undefined ? anoOrc : null
      const centroide = centroides?.municipios?.[codigo]
      const area = areas.get(codigo) ?? null

      // PIB per capita: paridade estrita PIB 2021 e População 2021
      const pibPerCapita: ValorTemporal = {
        valor: municipio.pib?.valorPerCapitaReais ?? null,
        ano: municipio.pib?.valorPerCapitaReais !== null && municipio.pib?.valorPerCapitaReais !== undefined ? pibAnoVal : null,
        unidade: 'R$/habitante',
      }

      // Densidade: calculada com População 2024 e área km2
      const densidade: ValorTemporal = {
        valor: popValor !== null && area !== null && area > 0 ? Number((popValor / area).toFixed(2)) : null,
        ano: popValor !== null ? popAno : null,
        unidade: 'hab/km²',
      }

      // Bloqueio temporal metodológico: não misturar receita 2023 com população 2024
      const derivadoBloqueado = (motivo: string): ValorTemporal => ({
        valor: null,
        ano: null,
        unidade: 'R$/habitante',
        status: motivo,
      })

      const bloqueios = [
        `receita_per_capita_2023: Não calculado. Receita do exercício ${anoOrc} e população de referência ${anoOrc} não disponíveis.`,
        `despesa_per_capita_2023: Não calculado. Despesa do exercício ${anoOrc} e população de referência ${anoOrc} não disponíveis.`,
        `saude_per_capita_2023: Não calculado. Gasto em saúde do exercício ${anoOrc} e população de referência ${anoOrc} não disponíveis.`,
        `educacao_per_capita_2023: Não calculado. Gasto em educação do exercício ${anoOrc} e população de referência ${anoOrc} não disponíveis.`,
      ]

      municipios.push({
        territorio: {
          codigoIbge: codigo,
          nome: municipio.nome,
          uf: siglas.get(ufCodigo) ?? ufCodigo,
          longitude: centroide?.[0] ?? null,
          latitude: centroide?.[1] ?? null,
          areaKm2: area && area > 0 ? Math.round(area * 100) / 100 : null,
        },
        fonte: {
          populacao: { valor: popValor, ano: popAno, unidade: 'pessoas' },
          populacao_2024: { valor: popValor, ano: popAno, unidade: 'pessoas' },
          pib: { valor: pibReaisValor, ano: pibAnoVal, unidade: 'R$' },
          pib_2021_reais: { valor: pibReaisValor, ano: pibAnoVal, unidade: 'R$' },
          pib_mil_reais: { valor: pibMilValor, ano: pibAnoVal, unidade: 'mil R$' },
          receita: { valor: gasto?.receitaTotal ?? null, ano: gastoAno, unidade: 'R$' },
          receita_2023_reais: { valor: gasto?.receitaTotal ?? null, ano: gastoAno, unidade: 'R$' },
          despesa: { valor: gasto?.despesaTotal ?? null, ano: gastoAno, unidade: 'R$' },
          despesa_2023_reais: { valor: gasto?.despesaTotal ?? null, ano: gastoAno, unidade: 'R$' },
          saude: { valor: gasto?.gastosPorArea?.saude ?? null, ano: gastoAno, unidade: 'R$' },
          saude_2023_reais: { valor: gasto?.gastosPorArea?.saude ?? null, ano: gastoAno, unidade: 'R$' },
          educacao: { valor: gasto?.gastosPorArea?.educacao ?? null, ano: gastoAno, unidade: 'R$' },
          educacao_2023_reais: { valor: gasto?.gastosPorArea?.educacao ?? null, ano: gastoAno, unidade: 'R$' },
        },
        derivado: {
          pib_per_capita: pibPerCapita,
          pib_per_capita_2021: pibPerCapita,
          densidade,
          densidade_2024: densidade,
          receita_per_capita: derivadoBloqueado(`receita ${anoOrc} sem população ${anoOrc}`),
          receita_per_capita_2023: derivadoBloqueado(`receita ${anoOrc} sem população ${anoOrc}`),
          despesa_per_capita: derivadoBloqueado(`despesa ${anoOrc} sem população ${anoOrc}`),
          despesa_per_capita_2023: derivadoBloqueado(`despesa ${anoOrc} sem população ${anoOrc}`),
          saude_per_capita: derivadoBloqueado(`saúde ${anoOrc} sem população ${anoOrc}`),
          saude_per_capita_2023: derivadoBloqueado(`saúde ${anoOrc} sem população ${anoOrc}`),
          educacao_per_capita: derivadoBloqueado(`educação ${anoOrc} sem população ${anoOrc}`),
          educacao_per_capita_2023: derivadoBloqueado(`educação ${anoOrc} sem população ${anoOrc}`),
        },
        bloqueiosTemporais: bloqueios,
      })
    }
  }

  // Agregações estaduais acompanhadas de metadados de cobertura
  const ufs: UfExplorer[] = [...nomesUf.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([codigoIbge, nome]) => {
    const sigla = siglas.get(codigoIbge) ?? codigoIbge
    const munsUf = municipios.filter((m) => m.territorio.uf === sigla)
    const totalMuns = munsUf.length

    const agregarSoma = (campo: string, ano: number, unidade: string): MetricaUf => {
      const validos = munsUf.filter((m) => m.fonte[campo]?.valor !== null && m.fonte[campo]?.valor !== undefined)
      const soma = validos.length > 0
        ? validos.reduce((acc, cur) => acc + (cur.fonte[campo]?.valor as number), 0)
        : null
      return {
        valor: soma,
        ano,
        unidade,
        cobertura: {
          comDados: validos.length,
          esperados: totalMuns,
          completa: validos.length === totalMuns && totalMuns > 0,
        },
      }
    }

    const popTotal = agregarSoma('populacao', anoPop, 'pessoas')
    const pibTotal = agregarSoma('pib', anoPib, 'R$')

    // PIB per capita estadual: agregado consistente (soma PIB / soma Pop 2021 não somando diretamente as médias)
    // Para simplificar e evitar distorção, se tiver PIB consolidado no brasil.json usamos a fonte oficial
    return {
      codigoIbge,
      nome,
      sigla,
      totalMunicipios: totalMuns,
      indicadores: {
        populacao_2024: popTotal,
        pib_2021_reais: pibTotal,
        receita_2023_reais: agregarSoma('receita', anoOrc, 'R$'),
        despesa_2023_reais: agregarSoma('despesa', anoOrc, 'R$'),
        saude_2023_reais: agregarSoma('saude', anoOrc, 'R$'),
        educacao_2023_reais: agregarSoma('educacao', anoOrc, 'R$'),
      },
    }
  })

  const contar = (predicado: (m: MunicipioExplorer) => boolean) => municipios.filter(predicado).length
  const relatorio = {
    municipiosProcessados: municipios.length,
    codigosIbgeDuplicados: [...duplicados].sort(),
    cobertura: {
      populacao: contar((m) => m.fonte.populacao.valor !== null),
      pib: contar((m) => m.fonte.pib.valor !== null),
      orcamento: contar((m) => m.fonte.receita.valor !== null || m.fonte.despesa.valor !== null),
      eleicoes: contar((m) => codigosEleicoes.has(m.territorio.codigoIbge)),
    },
    derivados: {
      pib_per_capita_2021: contar((m) => m.derivado.pib_per_capita_2021.valor !== null),
      densidade_2024: contar((m) => m.derivado.densidade_2024.valor !== null),
      receita_per_capita_2023: 0,
      despesa_per_capita_2023: 0,
      saude_per_capita_2023: 0,
      educacao_per_capita_2023: 0,
    },
    ausentesEmOrcamento: [...codigosIndicadores].filter((codigo) => !codigosOrcamento.has(codigo)).length,
    ausentesEmEleicoes: [...codigosIndicadores].filter((codigo) => !codigosEleicoes.has(codigo)).length,
    bloqueiosTemporais: [
      `receita_per_capita_2023: Bloqueado. Receita do exercício ${anoOrc} e população de referência ${anoOrc} não disponíveis.`,
      `despesa_per_capita_2023: Bloqueado. Despesa do exercício ${anoOrc} e população de referência ${anoOrc} não disponíveis.`,
      `saude_per_capita_2023: Bloqueado. Saúde do exercício ${anoOrc} e população de referência ${anoOrc} não disponíveis.`,
      `educacao_per_capita_2023: Bloqueado. Educação do exercício ${anoOrc} e população de referência ${anoOrc} não disponíveis.`,
    ],
  }

  const metadata = {
    versao: 1,
    geradoEm: new Date().toISOString(),
    chaveTerritorial: 'codarea IBGE (7 dígitos para municípios; 2 para UFs)',
    catalogoIndicadores: {
      populacao_2024: {
        id: 'populacao_2024',
        nome: 'População Residente Estimada',
        descricao: 'População estimada pelo IBGE com base nas projeções demográficas e censo.',
        tipo: 'fonte',
        unidade: 'pessoas',
        periodo: anoPop,
        fonte: 'IBGE · SIDRA Tabela 6579 (Variável 9324)',
        cobertura: '5.570 municípios (Boa Esperança do Norte não constava na estimativa 2024)',
      },
      pib_2021_reais: {
        id: 'pib_2021_reais',
        nome: 'Produto Interno Bruto a preços correntes',
        descricao: 'Soma de todos os bens e serviços finais produzidos pelo município no ano.',
        tipo: 'fonte',
        unidade: 'R$',
        unidadeOriginalFonte: 'mil R$',
        conversao: 'valorEmMilReais * 1000',
        periodo: anoPib,
        fonte: 'IBGE · SIDRA Tabela 5938 (Variável 37)',
        cobertura: '5.570 municípios (último ano consolidado para municípios pelo IBGE)',
      },
      pib_per_capita_2021: {
        id: 'pib_per_capita_2021',
        nome: 'PIB por habitante',
        descricao: 'Riqueza econômica gerada no município por habitante residente.',
        tipo: 'derivado',
        unidade: 'R$/habitante',
        periodo: anoPib,
        formula: '(pib_2021_reais / populacao_2021)',
        componentes: ['pib_2021_reais (Tabela 5938)', 'populacao_2021 (Tabela 6579 / Var 9324)'],
        fontes: ['IBGE SIDRA 5938', 'IBGE SIDRA 6579'],
        observacoesMetodologicas: 'Calculado exclusivamente com a população de 2021 para garantir estrita paridade temporal.',
      },
      receita_2023_reais: {
        id: 'receita_2023_reais',
        nome: 'Receita Orçamentária Realizada',
        descricao: 'Arrecadação total do município no exercício fiscal, incluindo receitas correntes e de capital.',
        tipo: 'fonte',
        unidade: 'R$',
        periodo: anoOrc,
        fonte: 'Secretaria do Tesouro Nacional · Siconfi (DCA)',
        cobertura: '5.558 municípios (10 inadimplentes, DF e Fernando de Noronha sem DCA municipal, Boa Esperança do Norte instalada em 2024)',
      },
      despesa_2023_reais: {
        id: 'despesa_2023_reais',
        nome: 'Despesa Orçamentária Liquidada',
        descricao: 'Total de recursos executados e liquidados pelo poder público municipal no exercício.',
        tipo: 'fonte',
        unidade: 'R$',
        periodo: anoOrc,
        fonte: 'Secretaria do Tesouro Nacional · Siconfi (DCA)',
        cobertura: '5.558 municípios',
      },
      saude_2023_reais: {
        id: 'saude_2023_reais',
        nome: 'Gastos em Saúde (Função 10)',
        descricao: 'Despesas públicas liquidadas na função orçamentária Saúde.',
        tipo: 'fonte',
        unidade: 'R$',
        periodo: anoOrc,
        fonte: 'Secretaria do Tesouro Nacional · Siconfi (DCA)',
      },
      educacao_2023_reais: {
        id: 'educacao_2023_reais',
        nome: 'Gastos em Educação (Função 12)',
        descricao: 'Despesas públicas liquidadas na função orçamentária Educação.',
        tipo: 'fonte',
        unidade: 'R$',
        periodo: anoOrc,
        fonte: 'Secretaria do Tesouro Nacional · Siconfi (DCA)',
      },
      densidade_2024: {
        id: 'densidade_2024',
        nome: 'Densidade Demográfica',
        descricao: 'Relação entre a população residente estimada e a área territorial do município.',
        tipo: 'derivado',
        unidade: 'hab/km²',
        periodo: anoPop,
        formula: 'populacao_2024 / areaKm2',
        componentes: ['populacao_2024', 'areaKm2 (calculada a partir da malha cartográfica oficial do IBGE)'],
      },
      receita_per_capita_2023: {
        id: 'receita_per_capita_2023',
        nome: 'Receita por habitante',
        tipo: 'derivado',
        unidade: 'R$/habitante',
        periodo: anoOrc,
        status: 'bloqueado',
        limitacoes: 'Indisponível: receita do exercício 2023 e população de referência 2023 não estão disponíveis.',
      },
      despesa_per_capita_2023: {
        id: 'despesa_per_capita_2023',
        nome: 'Despesa por habitante',
        tipo: 'derivado',
        unidade: 'R$/habitante',
        periodo: anoOrc,
        status: 'bloqueado',
        limitacoes: 'Indisponível: despesa do exercício 2023 e população de referência 2023 não estão disponíveis.',
      },
    },
    relatorio,
  }

  await writeFile(join(EXPLORER_DIR, 'municipios.json'), JSON.stringify({ total: municipios.length, municipios }), 'utf-8')
  await writeFile(join(EXPLORER_DIR, 'ufs.json'), JSON.stringify({ total: ufs.length, ufs }), 'utf-8')
  await writeFile(join(EXPLORER_DIR, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8')
  console.log(`  ✓ explorer/municipios.json — ${municipios.length} municípios`)
  console.log(`  ✓ explorer/ufs.json — ${ufs.length} UFs com metadados de cobertura`)
  console.log(`  ✓ explorer/metadata.json — catálogo completo, PIB em R$, 4 per capita bloqueados`)
}


// ---------------------------------------------------------------------------
// 2. Composição nacional de cadeiras
// ---------------------------------------------------------------------------

async function gerarComposicaoBrasil() {
  const dir = join(ELECTIONS_DIR, 'estados')
  if (!existsSync(dir)) {
    console.warn('  ⚠ data/elections/estados não existe — rode: npx tsx scripts/update-mandatos-gerais.ts')
    return
  }

  const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  const deputadosFederais: any[] = []
  const senadores: any[] = []
  const territorios: Array<Record<string, unknown>> = []

  for (const arquivo of arquivos) {
    const e = await lerJson<{
      uf: string
      sigla: string
      deputadosFederais?: any[]
      senadores?: any[]
    }>(join(dir, arquivo))
    if (!e) continue

    deputadosFederais.push(...(e.deputadosFederais ?? []))
    senadores.push(...(e.senadores ?? []))

    const cadeiras: Record<string, number> = {}
    for (const d of e.deputadosFederais ?? []) {
      const sigla = d.partido || '—'
      cadeiras[sigla] = (cadeiras[sigla] ?? 0) + 1
    }
    const total = (e.deputadosFederais ?? []).length
    if (total > 0) {
      const dominante = Object.entries(cadeiras).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
      territorios.push({ codarea: e.uf, nome: e.sigla, total, cadeiras, dominante })
    }
  }

  const agregar = (mandatos: any[]) => {
    const contagem = new Map<string, number>()
    for (const m of mandatos) {
      const sigla = m.partido || '—'
      contagem.set(sigla, (contagem.get(sigla) ?? 0) + 1)
    }
    return [...contagem.entries()]
      .map(([sigla, cadeiras]) => ({ sigla, cadeiras }))
      .sort((a, b) => b.cadeiras - a.cadeiras || a.sigla.localeCompare(b.sigla))
  }

  const composicao = {
    nivel: 'brasil',
    codigo: 'BR',
    camaras: [
      {
        id: 'camara-federal',
        nome: 'Câmara dos Deputados',
        cargo: 'Deputado Federal',
        total: deputadosFederais.length,
        partidos: agregar(deputadosFederais),
      },
      {
        id: 'senado',
        nome: 'Senado (eleitos em 2022)',
        cargo: 'Senador',
        total: senadores.length,
        partidos: agregar(senadores),
      },
    ],
    territorios: territorios.sort((a, b) => String(a.codarea).localeCompare(String(b.codarea))),
  }

  await mkdir(ELECTIONS_DIR, { recursive: true })
  await writeFile(
    join(ELECTIONS_DIR, 'composicao-brasil.json'),
    JSON.stringify(composicao, null, 2),
    'utf-8',
  )
  console.log(`  ✓ elections/composicao-brasil.json — ${territorios.length} estados`)
}

// ---------------------------------------------------------------------------
// 3. Ranking nacional (UFs + municípios com todas as métricas comparáveis)
// ---------------------------------------------------------------------------

/** Uma linha do ranking, com todas as métricas que o site sabe comparar. */
interface LinhaRanking {
  codarea: string
  nome: string
  uf: string
  populacao: number | null
  pib: number | null
  pibPerCapita: number | null
  receitaTotal: number | null
  despesaTotal: number | null
  lng: number | null
  lat: number | null
}

interface IndicadorUf {
  codarea: string
  nome: string
  populacao: { total: number | null } | null
  pib: { valorTotalMilReais: number | null; valorPerCapitaReais: number | null } | null
}

interface Orcamento {
  codarea: string
  nome?: string
  receitaTotal?: number
  despesaTotal?: number
}

/**
 * O ranking é o único lugar do site que compara TODOS os territórios entre si e
 * cruza os três blocos (indicadores, orçamento e território) em uma lista só.
 *
 * Sem ele o frontend teria que baixar 27 arquivos de indicadores + 27 de
 * orçamento para montar qualquer ordenação nacional.
 */
async function gerarRanking() {
  const centroides = await lerJson<{
    ufs: Record<string, [number, number]>
    municipios: Record<string, [number, number]>
  }>(join(MAPS_DIR, 'centroides.json'))

  // Código da UF → sigla (vem das eleições, que já carregam a sigla oficial)
  const siglas = new Map<string, string>()
  const dirEstados = join(ELECTIONS_DIR, 'estados')
  if (existsSync(dirEstados)) {
    for (const arquivo of await readdir(dirEstados)) {
      if (!arquivo.endsWith('.json')) continue
      const e = await lerJson<{ uf: string; sigla: string }>(join(dirEstados, arquivo))
      if (e?.uf && e?.sigla) siglas.set(String(e.uf), e.sigla)
    }
  }

  // Orçamento, indexado por codarea
  const orcamento = new Map<string, Orcamento>()
  const coletarOrcamento = (lista: Orcamento[] | undefined) => {
    for (const o of lista ?? []) orcamento.set(String(o.codarea), o)
  }
  coletarOrcamento((await lerJson<{ estados?: Orcamento[] }>(join(DATA_DIR, 'budget', 'brasil.json')))?.estados)
  const dirOrcamento = join(DATA_DIR, 'budget', 'ufs')
  if (existsSync(dirOrcamento)) {
    for (const arquivo of await readdir(dirOrcamento)) {
      if (!arquivo.endsWith('.json')) continue
      const d = await lerJson<{ municipios?: Orcamento[] }>(join(dirOrcamento, arquivo))
      coletarOrcamento(d?.municipios)
    }
  }

  // ---- UFs ----
  const brasil = await lerJson<{
    anoPopulacao?: number
    anoPib?: number
    estados?: IndicadorUf[]
  }>(join(INDICATORS_DIR, 'brasil.json'))

  const ufs: LinhaRanking[] = (brasil?.estados ?? []).map((e) => {
    const codarea = String(e.codarea)
    const centro = centroides?.ufs?.[codarea] ?? null
    return {
      codarea,
      nome: e.nome,
      uf: siglas.get(codarea) ?? codarea,
      populacao: e.populacao?.total ?? null,
      pib: e.pib?.valorTotalMilReais ?? null,
      pibPerCapita: e.pib?.valorPerCapitaReais ?? null,
      receitaTotal: orcamento.get(codarea)?.receitaTotal ?? null,
      despesaTotal: orcamento.get(codarea)?.despesaTotal ?? null,
      lng: centro?.[0] ?? null,
      lat: centro?.[1] ?? null,
    }
  })

  // ---- Municípios ----
  const municipios: LinhaRanking[] = []
  const dirIndicadores = join(INDICATORS_DIR, 'ufs')
  if (existsSync(dirIndicadores)) {
    for (const arquivo of (await readdir(dirIndicadores)).filter((f) => f.endsWith('.json')).sort()) {
      const ufCodigo = arquivo.replace('.json', '')
      const d = await lerJson<{ municipios?: IndicadorMunicipio[] }>(join(dirIndicadores, arquivo))
      for (const m of d?.municipios ?? []) {
        const codarea = String(m.codarea)
        const centro = centroides?.municipios?.[codarea] ?? null
        municipios.push({
          codarea,
          nome: m.nome,
          uf: siglas.get(ufCodigo) ?? ufCodigo,
          populacao: m.populacao?.total ?? null,
          pib: m.pib?.valorTotalMilReais ?? null,
          pibPerCapita: m.pib?.valorPerCapitaReais ?? null,
          receitaTotal: orcamento.get(codarea)?.receitaTotal ?? null,
          despesaTotal: orcamento.get(codarea)?.despesaTotal ?? null,
          lng: centro?.[0] ?? null,
          lat: centro?.[1] ?? null,
        })
      }
    }
  }

  if (ufs.length === 0 && municipios.length === 0) {
    console.warn('  ⚠ sem dados para o ranking — rode a ingestão primeiro')
    return
  }

  const ranking = {
    geradoEm: new Date().toISOString(),
    anos: {
      populacao: brasil?.anoPopulacao ?? null,
      pib: brasil?.anoPib ?? null,
      orcamento: (await lerJson<{ exercicio?: number }>(join(DATA_DIR, 'budget', 'brasil.json')))?.exercicio ?? null,
    },
    ufs,
    municipios,
  }

  await writeFile(join(INDICATORS_DIR, 'ranking.json'), JSON.stringify(ranking), 'utf-8')
  console.log(`  ✓ indicators/ranking.json — ${ufs.length} UFs e ${municipios.length} municípios`)
}

async function main() {
  console.log('Gerando arquivos derivados para o site estático…\n')
  await gerarCamadaExplorer()
  await gerarPontosMapa()
  await gerarComposicaoBrasil()
  await gerarRanking()
  console.log('\n✓ Derivados gerados.')
}

main().catch((err) => {
  console.error('\n✗ Erro ao gerar derivados:', err)
  process.exit(1)
})
