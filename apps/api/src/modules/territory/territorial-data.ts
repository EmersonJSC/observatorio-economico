/**
 * Serviço de dados territoriais.
 *
 * Estratégia de leitura: RAM → disco.
 *
 *  - RAM: um Map em memória guarda os GeoJSON já lidos, evitando I/O repetido.
 *  - Disco: `data/maps/` é o dataset distribuído, gerado pelo script
 *    `scripts/update-territorial-data.ts` (único ponto que fala com o IBGE).
 *
 * O servidor NUNCA consulta o IBGE em runtime.
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// apps/api/src/modules/territory → raiz do monorepo.
// O mesmo número de níveis vale após o build em apps/api/dist/modules/territory.
const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const DATA_DIR = join(ROOT, 'data', 'maps')
const UFS_DIR = join(DATA_DIR, 'ufs')

export interface GeoJsonCollection {
  type: string
  features: Array<{
    type: string
    properties?: Record<string, unknown>
    geometry?: unknown
  }>
}

export interface TerritorialMetadata {
  updatedAt: string
  source: string
  estados: number
  municipios: number
  ufs: string[]
  version: number
}

// Camada de RAM: evita ler o mesmo arquivo do disco mais de uma vez.
// Guarda também o mtime do arquivo para invalidar automaticamente quando o
// dataset for regenerado (evita servir dados antigos após um warm-up).
interface EntradaRam {
  geojson: GeoJsonCollection
  mtimeMs: number
}

const ramCache = new Map<string, EntradaRam>()

async function lerGeoJson(caminho: string, chave: string): Promise<GeoJsonCollection> {
  const { mtimeMs } = await stat(caminho)
  const emMemoria = ramCache.get(chave)

  // Só reutiliza a RAM se o arquivo em disco não mudou desde a última leitura.
  if (emMemoria && emMemoria.mtimeMs === mtimeMs) return emMemoria.geojson

  const conteudo = await readFile(caminho, 'utf-8')
  const geojson = JSON.parse(conteudo) as GeoJsonCollection
  ramCache.set(chave, { geojson, mtimeMs })
  return geojson
}

/** Malha das 27 UFs (Brasil). */
export async function getEstados(): Promise<GeoJsonCollection> {
  return lerGeoJson(join(DATA_DIR, 'brasil.geojson'), 'brasil')
}

/** Malha dos municípios de uma UF. */
export async function getMunicipios(uf: string): Promise<GeoJsonCollection> {
  return lerGeoJson(join(UFS_DIR, `${uf}.geojson`), `uf:${uf}`)
}

/** Metadados do dataset (data de atualização, contagens). */
export async function getMetadata(): Promise<TerritorialMetadata> {
  const conteudo = await readFile(join(DATA_DIR, 'metadata.json'), 'utf-8')
  return JSON.parse(conteudo) as TerritorialMetadata
}

/** Limpa a camada de RAM (útil após uma atualização do dataset). */
export function limparRamCache(): void {
  ramCache.clear()
}
