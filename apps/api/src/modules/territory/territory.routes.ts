import { Router } from 'express'
import type { Request, Response } from 'express'
import { getEstados, getMetadata, getMunicipios } from './territorial-data.js'

export const territorialRouter = Router()

// O dataset muda raramente. O navegador revalida, mas pode continuar usando a
// versão anterior enquanto a atualização acontece em segundo plano.
const CACHE_HEADER = 'no-cache, stale-while-revalidate=604800'
const DATASET_ERROR =
  'Dataset territorial indisponível. Rode: npx tsx scripts/update-territorial-data.ts'

territorialRouter.get('/metadata', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getMetadata())
  } catch {
    res.status(503).json({ error: DATASET_ERROR })
  }
})

territorialRouter.get('/states', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getEstados())
  } catch {
    res.status(503).json({ error: DATASET_ERROR })
  }
})

territorialRouter.get('/states/:uf/municipios', async (req: Request, res: Response) => {
  const uf = String(req.params.uf ?? '')
  if (!/^\d{2}$/.test(uf)) {
    res.status(400).json({ error: 'Código de UF inválido (esperado 2 dígitos)' })
    return
  }

  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getMunicipios(uf))
  } catch {
    res.status(404).json({ error: `Municípios da UF ${uf} não encontrados no dataset.` })
  }
})
