/**
 * Caixa 7 — formatador: territórios (malhas GeoJSON).
 *
 * ── Por que este módulo existe ────────────────────────────────────────────
 *
 * A API de Malhas do IBGE devolve cada `Feature` com APENAS `codarea`:
 *
 *   { "properties": { "codarea": "1100015" }, "geometry": { … } }
 *
 * O mapa do frontend precisa de mais: `nome` (tooltip e painel), `sigla`
 * (UFs), `uf` e `ufId` (para saber a que UF um município pertence ao clicar).
 * O pipeline legado enriquecia isso durante a ingestão; a Caixa 7 precisa
 * fazer o mesmo na publicação, senão o mapa renderiza polígonos sem
 * identificação — ou, no caso dos estados, sem nem saber quais são.
 *
 * O enriquecimento NÃO é cálculo: os nomes vêm prontos do organizado
 * (`ibge-localidades`). Aqui apenas os anexamos às propriedades da geometria.
 */

import { ufDoCodarea } from '../contrato.js'
import type { EstadoOrganizado } from '../leitura.js'

/** Propriedades que o mapa do frontend consome. */
export interface PropriedadesTerritoriais {
  codarea: string
  nome?: string
  sigla?: string
  uf?: string
  ufId?: string
}

/** GeoJSON mínimo aceito/emitido. */
export interface ColecaoGeoJson {
  type: 'FeatureCollection'
  features: Array<{
    type?: string
    properties?: Record<string, unknown> | null
    geometry?: unknown
  }>
}

/** Nome e sigla de um município, para enriquecer a geometria. */
export interface NomeMunicipio {
  nome: string
  ufSigla: string
  ufCodigo: string
}

/**
 * Enriquece a malha das UFs com nome e sigla.
 *
 * @param geojson Malha nacional, com uma `Feature` por UF.
 * @param estados Estados organizados, indexados por codarea.
 */
export function enriquecerMalhaUfs(
  geojson: ColecaoGeoJson,
  estados: Map<string, EstadoOrganizado>,
): ColecaoGeoJson {
  const features = (geojson.features ?? []).map((feature) => {
    const codarea = String(feature.properties?.['codarea'] ?? '')
    const estado = estados.get(codarea)

    return {
      ...feature,
      properties: {
        ...feature.properties,
        codarea,
        nome: estado?.nome ?? codarea,
        sigla: estado?.sigla ?? '',
      },
    }
  })

  return { type: 'FeatureCollection', features }
}

/**
 * Enriquece a malha municipal de uma UF com nome, sigla e código da UF.
 *
 * O `ufId` é o código IBGE de 2 dígitos — o frontend usa para trocar de camada
 * sem depender do nome do arquivo.
 */
export function enriquecerMalhaMunicipios(
  geojson: ColecaoGeoJson,
  municipios: Map<string, NomeMunicipio>,
  ufCodigo: string,
  ufSigla: string,
): ColecaoGeoJson {
  const features = (geojson.features ?? []).map((feature) => {
    const codarea = String(feature.properties?.['codarea'] ?? '')
    const municipio = municipios.get(codarea)

    return {
      ...feature,
      properties: {
        ...feature.properties,
        codarea,
        nome: municipio?.nome ?? codarea,
        uf: municipio?.ufSigla ?? ufSigla,
        ufId: municipio?.ufCodigo ?? ufCodigo,
      },
    }
  })

  return { type: 'FeatureCollection', features }
}

/**
 * Verifica se um GeoJSON é uma `FeatureCollection` válida.
 *
 * Usado pela validação: um GeoJSON estruturalmente inválido faz o mapa sumir
 * SEM erro no console, porque a biblioteca simplesmente não desenha nada.
 */
export function ehFeatureCollectionValida(valor: unknown): valor is ColecaoGeoJson {
  if (valor === null || typeof valor !== 'object') return false
  const g = valor as { type?: unknown; features?: unknown }
  return g.type === 'FeatureCollection' && Array.isArray(g.features) && g.features.length > 0
}

/** Confere se as propriedades essenciais estão presentes em cada feature. */
export function propriedadesCompletas(
  geojson: ColecaoGeoJson,
  exigidas: readonly string[],
): { ok: boolean; faltando: string[] } {
  const faltando = new Set<string>()

  for (const feature of geojson.features) {
    for (const chave of exigidas) {
      const valor = feature.properties?.[chave]
      if (valor === undefined || valor === null || valor === '') faltando.add(chave)
    }
  }

  return { ok: faltando.size === 0, faltando: [...faltando] }
}

/** Código da UF a partir de um codarea municipal — reexportado por conveniência. */
export { ufDoCodarea }
