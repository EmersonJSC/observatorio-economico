import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { lerDados } from '../../lib/fontes'

type TemporalContextValue = {
  years: number[]
  selectedYear: number | null
  setSelectedYear: (year: number) => void
  loading: boolean
}

const TemporalContext = createContext<TemporalContextValue | null>(null)

type IndicatorFile = {
  brasil?: {
    populacao?: { anoReferencia?: number }
    pib?: { anoReferencia?: number }
  } | null
}
type BudgetFile = { entes?: Array<{ exercicio?: number }> }
type ElectionFile = { municipios?: Array<{ anoEleicao?: number }> }

export function TemporalProvider({ children }: { children: ReactNode }) {
  const [years, setYears] = useState<number[]>([])
  const [selectedYear, setSelectedYearState] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ativo = true
    Promise.all([
      lerDados<IndicatorFile>('indicadores/brasil.json'),
      lerDados<BudgetFile>('orcamento/brasil.json'),
      lerDados<ElectionFile>('eleicoes/brasil.json'),
    ]).then(([indicadores, orcamento, eleicoes]) => {
      if (!ativo) return
      const encontrados = new Set<number>()
      const adicionar = (ano: number | undefined) => { if (ano) encontrados.add(ano) }
      adicionar(indicadores?.brasil?.populacao?.anoReferencia)
      adicionar(indicadores?.brasil?.pib?.anoReferencia)
      for (const ente of orcamento?.entes ?? []) adicionar(ente.exercicio)
      for (const municipio of eleicoes?.municipios ?? []) adicionar(municipio.anoEleicao)
      const disponiveis = [...encontrados].sort((a, b) => a - b)
      setYears(disponiveis)
      setSelectedYearState((atual) => atual && disponiveis.includes(atual) ? atual : disponiveis.at(-1) ?? null)
      setLoading(false)
    })
    return () => { ativo = false }
  }, [])

  const value = useMemo<TemporalContextValue>(() => ({
    years,
    selectedYear,
    setSelectedYear: (year) => {
      if (years.includes(year)) setSelectedYearState(year)
    },
    loading,
  }), [years, selectedYear, loading])

  return <TemporalContext.Provider value={value}>{children}</TemporalContext.Provider>
}

export function useTemporal() {
  const context = useContext(TemporalContext)
  if (!context) throw new Error('useTemporal deve ser usado dentro de TemporalProvider')
  return context
}
