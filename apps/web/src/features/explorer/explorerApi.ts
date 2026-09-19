/**
 * Camada de consulta do Explorador.
 *
 * Nenhum componente calcula indicadores aqui: os valores derivados já são
 * produzidos em `scripts/gerar-derivados.ts` e publicados em `data/explorer/`.
 */

import { lerDados } from '../../lib/fontes'

export interface ValorTemporal {
  valor: number | null
  ano: number | null
}

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
  derivado: Record<'pib_per_capita' | 'receita_per_capita' | 'despesa_per_capita' | 'saude_per_capita' | 'educacao_per_capita', ValorTemporal>
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

export interface PontoExplorer extends MunicipioExplorer {
  codarea: string
  nome: string
  uf: string
  lng: number
  lat: number
  area: number | null
}

let municipiosEmMemoria: Promise<MunicipioExplorer[]> | null = null

export async function getMunicipios(): Promise<MunicipioExplorer[]> {
  municipiosEmMemoria ??= lerDados<{ municipios: MunicipioExplorer[] }>('explorer/municipios.json')
    .then((dados) => dados?.municipios ?? [])
  return municipiosEmMemoria
}

export async function getMunicipio(codigoIbge: string): Promise<MunicipioExplorer | null> {
  return (await getMunicipios()).find((municipio) => municipio.territorio.codigoIbge === codigoIbge) ?? null
}

/** Retorna o valor e o período associados a um indicador, sem recalcular nada. */
export function getIndicator(municipio: MunicipioExplorer, indicador: IndicadorExplorer): ValorTemporal {
  if (indicador in municipio.fonte) return municipio.fonte[indicador as keyof MunicipioExplorer['fonte']]
  return municipio.derivado[indicador as keyof MunicipioExplorer['derivado']]
}

/** Adaptador temporário para o mapa: conserva coordenadas fora dos indicadores. */
export async function getPontosExplorer(): Promise<PontoExplorer[]> {
  return (await getMunicipios())
    .filter((municipio) => municipio.territorio.longitude !== null && municipio.territorio.latitude !== null)
    .map((municipio) => ({
      ...municipio,
      codarea: municipio.territorio.codigoIbge,
      nome: municipio.territorio.nome,
      uf: municipio.territorio.uf,
      lng: municipio.territorio.longitude as number,
      lat: municipio.territorio.latitude as number,
      area: municipio.territorio.areaKm2,
    }))
}
