import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Raiz do monorepo (apps/web → ../..)
const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const DADOS_DIR = join(RAIZ, 'data')

const TIPOS: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
}

/**
 * Em desenvolvimento, serve `data/` em `/dados/*` — o mesmo caminho que o site
 * publicado usa. Assim o frontend lê os arquivos direto, sem precisar da API.
 */
function servirDadosLocais(): Plugin {
  return {
    name: 'servir-dados-locais',
    configureServer(servidor) {
      servidor.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/dados/')) return next()

        const relativo = decodeURIComponent(url.slice('/dados/'.length).split('?')[0] ?? '')
        const caminho = normalize(join(DADOS_DIR, relativo))

        if (
          !caminho.startsWith(DADOS_DIR + sep) ||
          !existsSync(caminho) ||
          !statSync(caminho).isFile()
        ) {
          res.statusCode = 404
          res.end('arquivo não encontrado')
          return
        }

        res.setHeader('Content-Type', TIPOS[extname(caminho)] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(caminho).pipe(res)
      })
    },
    // Ao gerar o site, avisa que os dados são copiados pelo scripts/build-site.ts
    generateBundle() {
      this.info('datasets serão copiados para dist/dados pelo build:site')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Para GitHub Pages em subpasta: VITE_BASE=/nome-do-repo/ npm run build:site
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), servirDadosLocais()],
  server: {
    proxy: {
      // Mantido para quem quiser rodar a API local (não é mais necessária)
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
