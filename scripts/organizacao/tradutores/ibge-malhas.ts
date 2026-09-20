/**
 * Caixa 4 — tradutor de `ibge-malhas` (malhas territoriais municipais).
 *
 * Forma real da origem (verificada no RAW): um `FeatureCollection` do GeoJSON
 * com uma `Feature` por município. Cada `properties` traz apenas `codarea`;
 * a geometria é `Polygon` ou `MultiPolygon`.
 *
 * ── Por que este tradutor CALCULA ──────────────────────────────────────────
 *
 * A área territorial não é publicada pela API de Malhas: ela é derivada da
 * geometria. O projeto já fazia isso no legado (`gerar-derivados.ts`), com a
 * fórmula esférica de Shoelace. Trazer o cálculo para a Caixa 4 é o que
 * destrava a densidade na Caixa 6 sem que ela precise interpretar geometria.
 *
 * A fronteira se mantém: a Caixa 4 interpreta o dado da FONTE (a geometria é
 * o dado); a Caixa 6 combina métricas já prontas. Calcular densidade na Caixa 4
 * seria errado — calcular ÁREA a partir da geometria, não.
 *
 * ── Custo ─────────────────────────────────────────────────────────────────
 * As malhas somam ~50 MB e têm centenas de milhares de coordenadas. O cálculo
 * de área é O(nº de pontos) e acontece uma vez por município.
 */

import type { Tradutor } from '../tipos.js'

/** Raio médio da Terra em metros (mesmo valor usado pelo legado). */
const RAIO_TERRA_M = 6_371_000

/** Tipo mínimo de uma geometria GeoJSON. */
type Geometria = { type?: string; coordinates?: unknown }

/**
 * Área de um polígono pela fórmula esférica de Shoelace, em km².
 *
 * O primeiro anel é a borda externa; os demais são buracos e são SUBTRAÍDOS
 * (por isso a troca de sinal em `indice === 0`). Ignorar isso inflaria a área
 * de municípios com enclaves.
 */
function areaPoligono(aneis: number[][][]): number {
  let total = 0

  aneis.forEach((anel, indice) => {
    let soma = 0
    const n = anel.length

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const pontoI = anel[i]
      const pontoJ = anel[j]
      if (!pontoI || !pontoJ) continue

      const lonI = ((pontoI[0] ?? 0) * Math.PI) / 180
      const lonJ = ((pontoJ[0] ?? 0) * Math.PI) / 180
      const latI = ((pontoI[1] ?? 0) * Math.PI) / 180
      const latJ = ((pontoJ[1] ?? 0) * Math.PI) / 180

      soma += (lonJ - lonI) * (2 + Math.sin(latI) + Math.sin(latJ))
    }

    // m² → km² (divisão por 1e6).
    const area = (Math.abs(soma) * RAIO_TERRA_M * RAIO_TERRA_M) / 2 / 1e6
    total += indice === 0 ? area : -area
  })

  return total
}

/**
 * Área de uma geometria GeoJSON em km².
 *
 * Exportada para teste. Devolve 0 para tipo desconhecido ou sem coordenadas.
 */
export function areaDaGeometria(geometria: Geometria | null | undefined): number {
  const tipo = geometria?.type
  const coords = geometria?.coordinates
  if (!coords) return 0

  if (tipo === 'Polygon') return areaPoligono(coords as number[][][])
  if (tipo === 'MultiPolygon') {
    let total = 0
    for (const poligono of coords as number[][][][]) total += areaPoligono(poligono)
    return total
  }
  return 0
}

/** Uma `Feature` do GeoJSON do IBGE. */
interface FeatureMalha {
  properties?: { codarea?: string | number } | null
  geometry?: Geometria | null
}

/** `FeatureCollection` devolvido pela API de Malhas. */
interface ColecaoMalha {
  features?: FeatureMalha[]
}

/** Uma linha da saída: a área de um município. */
interface AreaMunicipio {
  codarea: string
  areaKm2: number | null
}

/**
 * Expande a `FeatureCollection` em uma linha por município.
 *
 * O núcleo da Caixa 4 recebe o arquivo inteiro como um registro (a coleção) e
 * este desmembramento produz as 5.571 linhas de área.
 */
export function desmembrarMalha(bruto: unknown): AreaMunicipio[] {
  const colecao = bruto as ColecaoMalha
  if (!colecao || !Array.isArray(colecao.features)) return []

  const linhas: AreaMunicipio[] = []

  for (const feature of colecao.features) {
    const codarea = feature.properties?.codarea
    if (codarea === undefined || codarea === null) continue

    const area = areaDaGeometria(feature.geometry)
    linhas.push({
      codarea: String(codarea),
      // Área zero significa geometria inválida — tratamos como ausência, não
      // como área real, para não gerar densidade infinita adiante.
      areaKm2: area > 0 ? Math.round(area * 100) / 100 : null,
    })
  }

  return linhas
}

/**
 * Tradutor de malhas municipais → área por município.
 *
 * O `recursoId` é `malha-municipios-por-uf` (o recurso real do catálogo), e a
 * saída é consumida pela Caixa 6 como insumo `areaKm2`.
 */
export const tradutorMalhaMunicipios: Tradutor = {
  fonteId: 'ibge-malhas',
  recursoId: 'malha-municipios-por-uf',
  versaoEsquema: 1,
  leitura: { tipo: 'json-objeto' },
  campos: [
    {
      origem: 'codarea',
      destino: 'codarea',
      tipo: 'codigo',
      obrigatorio: true,
      descricao: 'Código IBGE do município (7 dígitos)',
    },
    {
      origem: 'areaKm2',
      destino: 'areaKm2',
      tipo: 'decimal',
      obrigatorio: false,
      descricao: 'Área territorial em km², calculada da geometria da malha',
    },
  ],
  desmembrar: desmembrarMalha,
  validar: (bruto) => {
    if (bruto === null || typeof bruto !== 'object') {
      return { ok: false, motivo: 'registro-malformado', detalhe: 'esperado objeto de município' }
    }
    const r = bruto as { codarea?: string }
    if (!r.codarea) {
      return { ok: false, motivo: 'campo-obrigatorio-ausente', detalhe: 'feature sem codarea' }
    }
    return { ok: true }
  },
}

/** Tradutores desta fonte. */
export const tradutoresIbgeMalhas: readonly Tradutor[] = [tradutorMalhaMunicipios]
