/**
 * API do Observatório Econômico.
 *
 * Serve os datasets distribuídos (data/) para o frontend. As fontes externas
 * (IBGE, Siconfi, TSE) nunca são consultadas em runtime — apenas pelos scripts
 * de ingestão em `scripts/`.
 *
 * Endpoints:
 *   GET /api/health
 *   GET /api/maps/...
 *   GET /api/indicators/...
 *   GET /api/budget/...
 *   GET /api/elections/...
 */

import express from 'express'
import type { Request, Response } from 'express'
import { territorialRouter } from './modules/territory/territory.routes.js'
import { indicatorsRouter } from './modules/indicators/indicators.routes.js'
import { budgetRouter } from './modules/budget/budget.routes.js'
import { electionsRouter } from './modules/elections/elections.routes.js'

const app = express()
const PORT = Number(process.env.PORT ?? 3001)

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

app.use('/api/maps', territorialRouter)
app.use('/api/indicators', indicatorsRouter)
app.use('/api/budget', budgetRouter)
app.use('/api/elections', electionsRouter)

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`)
})
