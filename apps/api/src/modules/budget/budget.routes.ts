import { Router } from 'express'
import type { Request, Response } from 'express'

import {
  getOrcamentoBrasil,
  getOrcamentoUf,
  getOrcamentoMunicipio,
  getMetadataOrcamento,
} from './budget-data.js'

export const budgetRouter = Router()

const CACHE_HEADER = 'no-cache, stale-while-revalidate=604800'
const ERRO_DATASET =
  'Dataset orçamentário indisponível. Rode: npx tsx scripts/update-budget-data.ts'

budgetRouter.get('/metadata', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getMetadataOrcamento())
  } catch {
    res.status(503).json({ error: ERRO_DATASET })
  }
})

budgetRouter.get('/brasil', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getOrcamentoBrasil())
  } catch {
    res.status(503).json({ error: ERRO_DATASET })
  }
})

budgetRouter.get('/ufs/:uf', async (req: Request, res: Response) => {
  const uf = String(req.params.uf ?? '')
  if (!/^\d{2}$/.test(uf)) {
    res.status(400).json({ error: 'Código de UF inválido (esperado 2 dígitos)' })
    return
  }
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getOrcamentoUf(uf))
  } catch {
    res.status(404).json({ error: `Orçamento da UF ${uf} não encontrado no dataset.` })
  }
})

budgetRouter.get('/municipios/:codarea', async (req: Request, res: Response) => {
  const codarea = String(req.params.codarea ?? '')
  if (!/^\d{7}$/.test(codarea)) {
    res.status(400).json({ error: 'Código de município inválido (esperado 7 dígitos)' })
    return
  }
  try {
    const municipio = await getOrcamentoMunicipio(codarea)
    if (!municipio) {
      res.status(404).json({ error: `Orçamento do município ${codarea} não encontrado.` })
      return
    }
    res.set('Cache-Control', CACHE_HEADER).json(municipio)
  } catch {
    res.status(404).json({ error: `Orçamento do município ${codarea} não encontrado.` })
  }
})
