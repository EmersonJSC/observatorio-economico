/**
 * Camada de consulta do Explorador.
 *
 * Nenhum componente calcula indicadores aqui: os valores já vêm calculados pela
 * Caixa 6 e publicados pela Caixa 7 em `data/published/municipios/`.
 *
 * ── Estrutura publicada ───────────────────────────────────────────────────
 *
 *   municipios/indice.json     entradas enxutas (código, nome, UF, lng, lat)
 *   municipios/bloco-N.json    métricas de ~500 municípios cada
 *
 * O índice existe para listar e buscar municípios SEM carregar as métricas.
 * Antes havia um único arquivo de 14,8 MB com 13 chaves de métrica — 6 delas
 * aliases exatos do mesmo valor. Agora o nome canônico é único e os dados vêm
 * divididos em blocos.
 */

import { lerDados } from '../../lib/fontes'

export interface ValorTemporal {
  valor: number | null
  ano: number | null
}

/** Métricas de um município, no formato publicado pela Caixa 7. */
export interface MetricasMunicipio {
  populacao: number | null
  pib: number | null
  pibPerCapita: number | null
  densidade: number | null
  receita: number | null
  despesa: number | null
  saude: number | null
  educacao: number | null
  candidatos: number | null
  partidos: number | null
}

/** Anos de referência de cada bloco de métricas. */
export interface AnosMunicipio {
  populacao: number | null
  pib: number | null
  orcamento: number | null
  eleicao: number | null
}

/** Município como a Caixa 7 publica. */
export interface MunicipioPublicado {
  codarea: string
  nome: string
  uf: string
  lng: number
  lat: number
  anos: AnosMunicipio
  metricas: MetricasMunicipio
}

/** Formato interno consumido pelos componentes (preserva a API existente). */
export interface MunicipioExplorer {
  territorio: {
    codigoIbge: string
    nome: string
    uf: string
    longitude: number | null
    latitude: number | null
    areaKm2: number | null
  }
  fonte: Record<'populacao' | 'pib' | 'receita' | 'despesa' | 'saude' | 'educacao', ValorTemporal>
  derivado: Record<
    | 'pib_per_capita'
    | 'receita_per_capita'
    | 'despesa_per_capita'
    | 'saude_per_capita'
    | 'educacao_per_capita'
    | 'densidade',
    ValorTemporal
  >
}

export type IndicadorExplorer =
  | 'pib'
  | 'populacao'
  | 'receita'
  | 'despesa'
  | 'saude'
  | 'educacao'
  | 'pib_per_capita'
  | 'receita_per_capita'
  | 'despesa_per_capita'
  | 'saude_per_capita'
  | 'educacao_per_capita'
  | 'densidade'

export interface PontoExplorer extends MunicipioExplorer {
  codarea: string
  nome: string
  uf: string
  lng: number
  lat: number
  area: number | null
}

/** Entrada do índice publicado. */
interface EntradaIndice {
  codarea: string
  nome: string
  uf: string
  lng: number
  lat: number
}

let municipiosEmMemoria: Promise<MunicipioExplorer[]> | null = null

/**
 * Número máximo de blocos a tentar.
 *
 * A Caixa 7 publica blocos numerados a partir de 0 e não informa o total no
 * índice. Tentamos sequencialmente e paramos no primeiro ausente.
 */
const MAX_BLOCOS = 64

/** Carrega todos os blocos publicados e os concatena. */
async function carregarBlocos(): Promise<MunicipioPublicado[]> {
  const municipios: MunicipioPublicado[] = []

  for (let i = 0; i < MAX_BLOCOS; i++) {
    const bloco = await lerDados<{ municipios?: MunicipioPublicado[] }>(
      `municipios/bloco-${i}.json`,
    )
    if (!bloco?.municipios || bloco.municipios.length === 0) break
    municipios.push(...bloco.municipios)
  }

  return municipios
}

/** Converte o formato publicado para o formato consumido pelos componentes. */
function adaptar(m: MunicipioPublicado): MunicipioExplorer {
  const t = (valor: number | null, ano: number | null): ValorTemporal => ({ valor, ano })
  // Coordenada (0,0) significa ausência — nenhum município brasileiro fica lá.
  const semCoordenada = m.lng === 0 && m.lat === 0

  return {
    territorio: {
      codigoIbge: m.codarea,
      nome: m.nome,
      uf: m.uf,
      longitude: semCoordenada ? null : m.lng,
      latitude: semCoordenada ? null : m.lat,
      areaKm2: null,
    },
    fonte: {
      populacao: t(m.metricas.populacao, m.anos.populacao),
      pib: t(m.metricas.pib, m.anos.pib),
      receita: t(m.metricas.receita, m.anos.orcamento),
      despesa: t(m.metricas.despesa, m.anos.orcamento),
      saude: t(m.metricas.saude, m.anos.orcamento),
      educacao: t(m.metricas.educacao, m.anos.orcamento),
    },
    derivado: {
      pib_per_capita: t(m.metricas.pibPerCapita, m.anos.pib),
      densidade: t(m.metricas.densidade, m.anos.populacao),
      // Bloqueadas por ano divergente: a receita é de 2023 e a população
      // disponível é de 2021. O dado sai `null`, que é a resposta honesta.
      receita_per_capita: t(null, null),
      despesa_per_capita: t(null, null),
      saude_per_capita: t(null, null),
      educacao_per_capita: t(null, null),
    },
  }
}

export async function getMunicipios(): Promise<MunicipioExplorer[]> {
  municipiosEmMemoria ??= carregarBlocos().then((lista) => lista.map(adaptar))
  return municipiosEmMemoria
}

/** Carrega apenas o índice, sem as métricas — para listar e buscar rápido. */
export async function getIndice(): Promise<EntradaIndice[]> {
  const dados = await lerDados<{ municipios?: EntradaIndice[] }>('municipios/indice.json')
  return dados?.municipios ?? []
}

export async function getMunicipio(codigoIbge: string): Promise<MunicipioExplorer | null> {
  return (await getMunicipios()).find((m) => m.territorio.codigoIbge === codigoIbge) ?? null
}

/** Retorna o valor e o período associados a um indicador, sem recalcular nada. */
export function getIndicator(municipio: MunicipioExplorer, indicador: IndicadorExplorer): ValorTemporal {
  const chavesFonte = Object.keys(municipio.fonte)
  if (chavesFonte.includes(indicador)) {
    return municipio.fonte[indicador as keyof MunicipioExplorer['fonte']]
  }
  return municipio.derivado[indicador as keyof MunicipioExplorer['derivado']] ?? { valor: null, ano: null }
}

/** Adaptador para o mapa: conserva coordenadas fora dos indicadores. */
export async function getPontosExplorer(): Promise<PontoExplorer[]> {
  return (await getMunicipios())
    .filter((m) => m.territorio.longitude !== null && m.territorio.latitude !== null)
    .map((m) => ({
      ...m,
      codarea: m.territorio.codigoIbge,
      nome: m.territorio.nome,
      uf: m.territorio.uf,
      lng: m.territorio.longitude as number,
      lat: m.territorio.latitude as number,
      area: m.territorio.areaKm2,
    }))
}
