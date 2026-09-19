/**
 * Gera os centróides das UFs e dos municípios a partir do dataset territorial.
 *
 * Serve para camadas de agregação espacial (ex.: HexagonLayer de PIB), que
 * precisam de PONTOS (longitude/latitude) em vez de polígonos.
 *
 * Lê:    data/maps/brasil.geojson  e  data/maps/ufs/*.geojson
 * Escreve: data/maps/centroides.json
 *   { "updatedAt", "ufs": { "<cod>": [lng, lat] }, "municipios": { "<cod>": [lng, lat] } }
 *
 * Uso:
 *   npx tsx scripts/update-centroides.ts
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const MAPS_DIR = join(ROOT, 'data', 'maps')
const UFS_DIR = join(MAPS_DIR, 'ufs')

interface Feature {
  properties?: { codarea?: string | number }
  geometry?: { type?: string; coordinates?: unknown }
}

/** Centro do retângulo envolvente (bounding box) de uma geometria GeoJSON. */
function centroide(geometria: unknown): [number, number] | null {
  const coords: number[][] = []
  const percorrer = (no: unknown): void => {
    if (!Array.isArray(no)) return
    if (typeof no[0] === 'number' && typeof no[1] === 'number') {
      coords.push(no as number[])
      return
    }
    for (const filho of no) percorrer(filho)
  }
  percorrer((geometria as { coordinates?: unknown } | undefined)?.coordinates)
  if (coords.length === 0) return null

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of coords) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  // Arredonda para 4 casas (~11 m de precisão) — suficiente para agregação
  return [Number(((minX + maxX) / 2).toFixed(4)), Number(((minY + maxY) / 2).toFixed(4))]
}

async function lerFeatures(caminho: string): Promise<Feature[]> {
  const conteudo = await readFile(caminho, 'utf-8')
  const geojson = JSON.parse(conteudo) as { features?: Feature[] }
  return geojson.features ?? []
}

function indexar(features: Feature[], destino: Record<string, [number, number]>): number {
  let n = 0
  for (const f of features) {
    const codarea = f.properties?.codarea
    if (codarea === undefined || codarea === null) continue
    const centro = centroide(f.geometry)
    if (!centro) continue
    destino[String(codarea)] = centro
    n++
  }
  return n
}

async function main() {
  console.log('Gerando centróides a partir do dataset territorial…\n')

  const ufs: Record<string, [number, number]> = {}
  const municipios: Record<string, [number, number]> = {}

  // Estados
  const caminhoBrasil = join(MAPS_DIR, 'brasil.geojson')
  if (existsSync(caminhoBrasil)) {
    const n = indexar(await lerFeatures(caminhoBrasil), ufs)
    console.log(`  ✓ ${n} UFs`)
  } else {
    console.warn('  ⚠ brasil.geojson não encontrado')
  }

  // Municípios (por UF)
  if (existsSync(UFS_DIR)) {
    const arquivos = (await readdir(UFS_DIR)).filter((f) => f.endsWith('.geojson')).sort()
    for (const arquivo of arquivos) {
      const n = indexar(await lerFeatures(join(UFS_DIR, arquivo)), municipios)
      console.log(`  ✓ ${arquivo.replace('.geojson', '')}: ${n} municípios`)
    }
  }

  await mkdir(MAPS_DIR, { recursive: true })
  await writeFile(
    join(MAPS_DIR, 'centroides.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), ufs, municipios }),
    'utf-8',
  )

  console.log(
    `\n✓ centroides.json gerado: ${Object.keys(ufs).length} UFs, ${Object.keys(municipios).length} municípios`,
  )
}

main().catch((err) => {
  console.error('\n✗ Erro ao gerar centróides:', err)
  process.exit(1)
})
