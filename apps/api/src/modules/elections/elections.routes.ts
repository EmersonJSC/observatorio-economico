import { Router } from 'express'
import type { Request, Response } from 'express'

import {
  getEleicoesBrasil,
  getEleicoesUf,
  getMandatoMunicipio,
  getMandatoEstado,
  getMetadataEleicoes,
  getComposicaoBrasil,
  getComposicaoEstado,
  getComposicaoMunicipio,
} from './elections-data.js'

export const electionsRouter = Router()

const CACHE_HEADER = 'no-cache, stale-while-revalidate=604800'
const ERRO_DATASET =
  'Dataset eleitoral indisponível. Rode: npx tsx scripts/update-elections-data.ts'

electionsRouter.get('/metadata', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getMetadataEleicoes())
  } catch {
    res.status(503).json({ error: ERRO_DATASET })
  }
})

electionsRouter.get('/brasil', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getEleicoesBrasil())
  } catch {
    res.status(503).json({ error: ERRO_DATASET })
  }
})

electionsRouter.get('/ufs/:uf', async (req: Request, res: Response) => {
  const uf = String(req.params.uf ?? '')
  if (!/^\d{2}$/.test(uf)) {
    res.status(400).json({ error: 'Código de UF inválido (esperado 2 dígitos)' })
    return
  }
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getEleicoesUf(uf))
  } catch {
    res.status(404).json({ error: `Dados eleitorais da UF ${uf} não encontrados no dataset.` })
  }
})

// --- Composição de cadeiras por partido (gráfico + mapa "força política") ---

electionsRouter.get('/composicao/brasil', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', CACHE_HEADER).json(await getComposicaoBrasil())
  } catch {
    res.status(503).json({ error: ERRO_DATASET })
  }
})

electionsRouter.get('/composicao/estados/:uf', async (req: Request, res: Response) => {
  const uf = String(req.params.uf ?? '')
  if (!/^\d{2}$/.test(uf)) {
    res.status(400).json({ error: 'Código de UF inválido (esperado 2 dígitos)' })
    return
  }
  try {
    const composicao = await getComposicaoEstado(uf)
    if (!composicao) {
      res.status(404).json({
        error:
          `Composição da UF ${uf} não encontrada. ` +
          'Rode: npx tsx scripts/update-mandatos-gerais.ts',
      })
      return
    }
    res.set('Cache-Control', CACHE_HEADER).json(composicao)
  } catch {
    res.status(404).json({ error: `Composição da UF ${uf} não encontrada.` })
  }
})

electionsRouter.get('/composicao/municipios/:codarea', async (req: Request, res: Response) => {
  const codarea = String(req.params.codarea ?? '')
  if (!/^\d{7}$/.test(codarea)) {
    res.status(400).json({ error: 'Código de município inválido (esperado 7 dígitos)' })
    return
  }
  try {
    const composicao = await getComposicaoMunicipio(codarea)
    if (!composicao) {
      res.status(404).json({ error: `Composição do município ${codarea} não encontrada.` })
      return
    }
    res.set('Cache-Control', CACHE_HEADER).json(composicao)
  } catch {
    res.status(404).json({ error: `Composição do município ${codarea} não encontrada.` })
  }
})

electionsRouter.get('/estados/:uf', async (req: Request, res: Response) => {
  const uf = String(req.params.uf ?? '')
  if (!/^\d{2}$/.test(uf)) {
    res.status(400).json({ error: 'Código de UF inválido (esperado 2 dígitos)' })
    return
  }
  try {
    const estado = await getMandatoEstado(uf)
    if (!estado) {
      res.status(404).json({
        error:
          `Mandatos estaduais da UF ${uf} não encontrados. ` +
          'Rode: npx tsx scripts/update-mandatos-gerais.ts',
      })
      return
    }
    res.set('Cache-Control', CACHE_HEADER).json(estado)
  } catch {
    res.status(404).json({ error: `Mandatos estaduais da UF ${uf} não encontrados.` })
  }
})

electionsRouter.get('/municipios/:codarea', async (req: Request, res: Response) => {
  const codarea = String(req.params.codarea ?? '')
  if (!/^\d{7}$/.test(codarea)) {
    res.status(400).json({ error: 'Código de município inválido (esperado 7 dígitos)' })
    return
  }
  try {
    const municipio = await getMandatoMunicipio(codarea)
    if (!municipio) {
      res.status(404).json({ error: `Dados eleitorais do município ${codarea} não encontrados.` })
      return
    }
    res.set('Cache-Control', CACHE_HEADER).json(municipio)
  } catch {
    res.status(404).json({ error: `Dados eleitorais do município ${codarea} não encontrados.` })
  }
})
