import { Router } from 'express'
import type { Request, Response } from 'express'

import {
  getIndicadoresBrasil,
  getIndicadoresUf,
  getIndicadorMunicipio,
  getMetadataIndicadores,
  getPontosPib,
} from './indicators-data.js'

export const indicatorsRouter = Router()

const CACHE_HEADER = 'no-cache, stale-while-revalidate=604800'
const ERRO_DATASET =
  'Dataset de indicadores indisponível. Rode: npx tsx scripts/update-indicators-data.ts'

indicatorsRouter.get('/metadata', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getMetadataIndicadores())
  } catch {
    res.status(503).json({ error: ERRO_DATASET })
  }
})

indicatorsRouter.get('/brasil', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getIndicadoresBrasil())
  } catch {
    res.status(503).json({ error: ERRO_DATASET })
  }
})

// Pontos (municípios) com PIB + coordenadas — base da camada de hexágonos
indicatorsRouter.get('/pontos', async (_req: Request, res: Response) => {
  try {
    const pontos = await getPontosPib()
    res.set('Cache-Control', CACHE_HEADER).json({ total: pontos.length, pontos })
  } catch {
    res.status(503).json({
      error:
        'Pontos de PIB indisponíveis. Rode: npx tsx scripts/update-centroides.ts ' +
        'e npx tsx scripts/update-indicators-data.ts',
    })
  }
})

indicatorsRouter.get('/ufs/:uf', async (req: Request, res: Response) => {
  const uf = String(req.params.uf ?? '')
  if (!/^\d{2}$/.test(uf)) {
    res.status(400).json({ error: 'Código de UF inválido (esperado 2 dígitos)' })
    return
  }
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getIndicadoresUf(uf))
  } catch {
    res.status(404).json({ error: `Indicadores da UF ${uf} não encontrados no dataset.` })
  }
})

indicatorsRouter.get('/municipios/:codarea', async (req: Request, res: Response) => {
  const codarea = String(req.params.codarea ?? '')
  if (!/^\d{7}$/.test(codarea)) {
    res.status(400).json({ error: 'Código de município inválido (esperado 7 dígitos)' })
    return
  }
  try {
    const municipio = await getIndicadorMunicipio(codarea)
    if (!municipio) {
      res.status(404).json({ error: `Indicadores do município ${codarea} não encontrados.` })
      return
    }
    res.set('Cache-Control', CACHE_HEADER).json(municipio)
  } catch {
    res.status(404).json({ error: `Indicadores do município ${codarea} não encontrados.` })
  }
})
