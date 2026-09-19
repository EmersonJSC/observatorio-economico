/**
 * Build do SITE ESTÁTICO — gera a pasta pronta para publicar (grátis) no
 * Cloudflare Pages, GitHub Pages, Netlify, etc.
 *
 * O que faz:
 *   1. Gera os arquivos derivados (pontos de PIB, composição nacional)
 *   2. Compila o frontend (Vite)
 *   3. Copia os datasets para `apps/web/dist/dados/` (sem os ZIPs brutos)
 *
 * Uso:
 *   npm run build:site
 *   VITE_BASE=/observatorio-economico/ npm run build:site   # GitHub Pages em subpasta
 *
 * Saída: apps/web/dist  (publique esta pasta)
 */

import { execFileSync } from 'node:child_process'
import { cp, readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const DIST_DIR = join(ROOT, 'apps', 'web', 'dist')
const DESTINO_DADOS = join(DIST_DIR, 'dados')
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx')

/** Pastas de `data/` publicadas no site. `elections/raw` (ZIPs) fica de fora. */
const PASTAS = ['maps', 'indicators', 'budget', 'elections']

/** Soma recursiva do tamanho em bytes. */
async function tamanhoBytes(caminho: string): Promise<number> {
  let total = 0
  for (const item of await readdir(caminho, { withFileTypes: true })) {
    const filho = join(caminho, item.name)
    if (item.isDirectory()) total += await tamanhoBytes(filho)
    else total += (await stat(filho)).size
  }
  return total
}

const emMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

function etapa(titulo: string) {
  console.log(`\n━━━ ${titulo} ━━━`)
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Build do site estático')
  console.log('╚══════════════════════════════════════════════════════════')

  const base = process.env.VITE_BASE ?? '/'
  console.log(`\n  base do site: ${base}`)

  // 1. Derivados
  etapa('1. Gerando arquivos derivados')
  execFileSync(TSX, [join('scripts', 'gerar-derivados.ts')], { stdio: 'inherit', cwd: ROOT })

  // 2. Frontend
  etapa('2. Compilando o frontend')
  execFileSync('npm', ['--prefix', 'apps/web', 'run', 'build'], {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, VITE_BASE: base },
  })

  // 3. Dados
  etapa('3. Copiando os datasets')
  for (const pasta of PASTAS) {
    const origem = join(DATA_DIR, pasta)
    if (!existsSync(origem)) {
      console.warn(`  ⚠ data/${pasta} não encontrada — pulando`)
      continue
    }
    const destino = join(DESTINO_DADOS, pasta)
    await cp(origem, destino, {
      recursive: true,
      // ZIPs brutos do TSE (raw/) não vão para o site
      filter: (src) => !src.includes(`${sep}raw${sep}`) && !src.endsWith(`${sep}raw`),
    })
    console.log(`  ✓ dados/${pasta} (${emMB(await tamanhoBytes(destino))} MB)`)
  }

  // 4. Detalhes de hospedagem
  // `.nojekyll` evita que o GitHub Pages passe os arquivos por Jekyll e
  // descarte pastas que começam com "_".
  await writeFile(join(DIST_DIR, '.nojekyll'), '')
  // Cloudflare Pages / Netlify: cacheia os datasets, que são imutáveis na prática.
  await writeFile(
    join(DIST_DIR, '_headers'),
    ['/dados/*', '  Cache-Control: public, max-age=86400', ''].join('\n'),
  )

  console.log('\n══════════════════════════════════════════════════════════')
  console.log(`  ✓ Site pronto em: ${DIST_DIR}`)
  console.log(`    Tamanho total: ${emMB(await tamanhoBytes(DIST_DIR))} MB`)
  console.log('')
  console.log('  Publique esta pasta em:')
  console.log('    • Cloudflare Pages  (grátis, banda ilimitada)')
  console.log('    • GitHub Pages      (grátis, 100 GB/mês)')
  console.log('    • Netlify / Vercel  (grátis, 100 GB/mês)')
  console.log('══════════════════════════════════════════════════════════')
}

main().catch((err) => {
  console.error('\n✗ Erro no build do site:', err)
  process.exit(1)
})
