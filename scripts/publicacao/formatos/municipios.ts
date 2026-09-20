/**
 * Caixa 7 — formatador: municípios.
 *
 * Transforma o monólito antigo (`explorer/municipios.json`, 14,8 MB num único
 * arquivo) em:
 *
 *   municipios/indice.json     5.571 entradas enxutas (código, nome, UF, lng, lat)
 *   municipios/bloco-N.json    métricas de ~500 municípios cada
 *   municipios/coordenadas.json  lng/lat por codarea (para o mapa)
 *
 * ── Duas decisões de payload ──────────────────────────────────────────────
 *
 * 1. **Índice separado das métricas.** O frontend precisa listar/buscar
 *    municípios sem carregar as 10 métricas de cada um. O índice é ~5% do peso
 *    do bloco completo.
 *
 * 2. **Aliases eliminados.** O arquivo antigo trazia 13 chaves de métrica,
 *    sendo 6 duplicatas exatas (`populacao` == `populacao_2024`, …). Metade do
 *    maior arquivo publicado era chave repetida. Aqui só o nome canônico vai.
 */

import { nomePublicado } from '../contrato.js'
import type {
  MetricasMunicipio,
  MunicipioIndice,
  MunicipioPublicado,
} from '../tipos.js'
import type {
  CandidatosCalculado,
  MunicipioCalculado,
  OrcamentoOrganizado,
} from '../leitura.js'

/** Coordenada geográfica de um município. */
export interface Coordenada {
  lng: number
  lat: number
}

/** Extrai o valor de uma métrica calculada, pelo nome publicado. */
function valorDe(
  metricas: MunicipioCalculado['metricas'],
  nomeCalculado: string,
): { valor: number | null; ano: number | null } {
  const publicado = nomePublicado(nomeCalculado) ?? nomeCalculado
  // Algumas métricas são publicadas com nome diferente do calculado; tentamos
  // os dois para não depender da ordem do mapa.
  const dado = metricas[nomeCalculado] ?? metricas[publicado]
  if (!dado) return { valor: null, ano: null }
  return { valor: dado.valor, ano: dado.ano ?? null }
}

/** Monta o registro publicado de um município. */
export function formatarMunicipio(
  calculado: MunicipioCalculado,
  candidatos: CandidatosCalculado | undefined,
  coordenada: Coordenada | undefined,
  ufSigla: string,
  orcamento?: OrcamentoOrganizado,
): MunicipioPublicado {
  const populacao = valorDe(calculado.metricas, 'populacao')
  const pib = valorDe(calculado.metricas, 'pib_mil_reais')
  const pibPerCapita = valorDe(calculado.metricas, 'pib_per_capita')
  const densidade = valorDe(calculado.metricas, 'densidade')
  const receita = valorDe(calculado.metricas, 'receita_total')
  const despesa = valorDe(calculado.metricas, 'despesa_total')

  const metricas: MetricasMunicipio = {
    populacao: populacao.valor,
    pib: pib.valor,
    pibPerCapita: pibPerCapita.valor,
    densidade: densidade.valor,
    receita: receita.valor,
    despesa: despesa.valor,
    // Saúde e educação vêm ABSOLUTAS do orçamento (Siconfi), não per capita:
    // o per capita está bloqueado por ano divergente (2023 vs 2021).
    saude: orcamento?.gastoSaude ?? null,
    educacao: orcamento?.gastoEducacao ?? null,
    candidatos: candidatos?.totalCandidatos ?? null,
    partidos: candidatos?.partidosDistintos ?? null,
  }

  return {
    codarea: calculado.codarea,
    nome: calculado.nome,
    uf: ufSigla,
    lng: coordenada?.lng ?? 0,
    lat: coordenada?.lat ?? 0,
    anos: {
      populacao: populacao.ano,
      pib: pib.ano,
      orcamento: receita.ano,
      eleicao: candidatos?.anoEleicao ?? null,
    },
    metricas,
  }
}

/** Monta a entrada enxuta do índice. */
export function formatarIndice(municipio: MunicipioPublicado): MunicipioIndice {
  return {
    codarea: municipio.codarea,
    nome: municipio.nome,
    uf: municipio.uf,
    lng: municipio.lng,
    lat: municipio.lat,
  }
}

/**
 * Divide os municípios em blocos.
 *
 * Ordena por `codarea` antes de dividir para que a composição dos blocos seja
 * determinística — sem isso, dois builds do mesmo dado gerariam arquivos
 * diferentes e o cache do navegador seria inútil.
 */
export function dividirEmBlocos(
  municipios: readonly MunicipioPublicado[],
  porBloco: number,
): MunicipioPublicado[][] {
  const ordenados = [...municipios].sort((a, b) => a.codarea.localeCompare(b.codarea))
  const blocos: MunicipioPublicado[][] = []

  for (let i = 0; i < ordenados.length; i += porBloco) {
    blocos.push(ordenados.slice(i, i + porBloco))
  }

  return blocos
}

/** Extrai o mapa de coordenadas (usado pela camada de mapa). */
export function extrairCoordenadas(
  municipios: readonly MunicipioPublicado[],
): Record<string, Coordenada> {
  const coords: Record<string, Coordenada> = {}
  for (const m of municipios) {
    coords[m.codarea] = { lng: m.lng, lat: m.lat }
  }
  return coords
}
