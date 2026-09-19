/**
 * Hook que reúne os dados de um território selecionado no mapa.
 *
 * As fontes (indicadores, orçamento, mandatos e composição de cadeiras) são
 * buscadas de forma tolerante a falhas: se uma delas não responder, o painel
 * ainda exibe as demais. O tipo de mandato depende do nível: município (2024),
 * estado ou Brasil (2022).
 */

import { useEffect, useState } from 'react'
import type { DadosTerritoriais } from './mapFeatures'
import { buscarIndicadores } from '../indicators/indicatorsApi'
import type { IndicadorLocalidade } from '../indicators/indicatorsApi'
import { buscarOrcamento } from '../budget/budgetApi'
import type { OrcamentoEnte } from '../budget/budgetApi'
import {
  buscarComposicao,
  buscarMandatoBrasil,
  buscarMandatoEstado,
  buscarMandatoMunicipio,
} from '../elections/electionsApi'
import type {
  Composicao,
  MandatoBrasil,
  MandatoEstado,
  MandatoMunicipio,
} from '../elections/electionsApi'

export interface DadosTerritorio {
  indicadores: IndicadorLocalidade | null
  orcamento: OrcamentoEnte | null
  mandatoMunicipio: MandatoMunicipio | null
  mandatoEstado: MandatoEstado | null
  mandatoBrasil: MandatoBrasil | null
  /** Composição de cadeiras por partido do território selecionado */
  composicao: Composicao | null
  carregando: boolean
}

const ESTADO_INICIAL: DadosTerritorio = {
  indicadores: null,
  orcamento: null,
  mandatoMunicipio: null,
  mandatoEstado: null,
  mandatoBrasil: null,
  composicao: null,
  carregando: true,
}

export function useTerritoryData(territory: DadosTerritoriais): DadosTerritorio {
  const [dados, setDados] = useState<DadosTerritorio>(ESTADO_INICIAL)

  useEffect(() => {
    let ativo = true
    setDados(ESTADO_INICIAL)

    const carregar = async () => {
      const [indicadores, orcamento, composicao] = await Promise.all([
        buscarIndicadores(territory.nivel, territory.codigo),
        buscarOrcamento(territory.nivel, territory.codigo),
        buscarComposicao(territory.nivel, territory.codigo),
      ])

      let mandatoMunicipio: MandatoMunicipio | null = null
      let mandatoEstado: MandatoEstado | null = null
      let mandatoBrasil: MandatoBrasil | null = null

      if (territory.nivel === 'municipio') {
        mandatoMunicipio = await buscarMandatoMunicipio(territory.codigo)
      } else if (territory.nivel === 'estado') {
        mandatoEstado = await buscarMandatoEstado(territory.codigo)
      } else {
        mandatoBrasil = await buscarMandatoBrasil()
      }

      if (!ativo) return
      setDados({
        indicadores,
        orcamento,
        mandatoMunicipio,
        mandatoEstado,
        mandatoBrasil,
        composicao,
        carregando: false,
      })
    }

    carregar()

    return () => {
      ativo = false
    }
  }, [territory.nivel, territory.codigo])

  return dados
}
