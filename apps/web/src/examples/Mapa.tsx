import { useCallback, useMemo, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { GeoJsonLayer } from '@deck.gl/layers'
import { FlyToInterpolator } from '@deck.gl/core'
import type { Layer, MapViewState, PickingInfo } from '@deck.gl/core'

import MapTooltip from '../features/map/components/MapTooltip'
import { ehCapital } from '../features/map/data/capitais'
import { extrairCodigo, extrairDadosTerritoriais } from '../features/map/mapFeatures'
import type { NivelTerritorial } from '../features/map/mapFeatures'

/**
 * Exemplo de mapa interativo do Brasil com "foco e isolamento" em dois níveis.
 *
 * Este arquivo é apenas um exemplo de estudo e NÃO deve ser usado em produção.
 *
 * Fonte de dados: API própria do projeto (`/api/maps/...`), que distribui o
 * dataset territorial gerado a partir do IBGE pelo script
 * `scripts/update-territorial-data.ts`. O navegador NUNCA fala com o IBGE.
 *
 * Arquitetura demonstrada:
 *  1. Regra da Câmera: ao clicar, a câmera "voa" (FlyToInterpolator) até o ponto.
 *  2. Regra do Isolamento: o elemento selecionado fica destacado e os demais
 *     escurecem. No nível estadual, o estado focado fica transparente para
 *     revelar os municípios por baixo.
 *  3. Carga Preguiçosa (Lazy Loading): a camada de municípios só é criada
 *     quando um estado é selecionado, baixando apenas as cidades daquela UF.
 *  4. Hover: popup próprio (React) que acompanha o cursor. Nenhuma requisição
 *     de rede é disparada no hover — os dados já estão no GeoJSON carregado.
 *
 * Níveis de navegação:
 *  - Federal (Brasil) → Estadual (municípios da UF) → Municipal (cidade focada)
 */

// Endpoints da API própria (proxy do dataset territorial)
// Versão do dataset: incrementar quando o formato das propriedades mudar.
// Serve como cache-buster para o navegador não reutilizar uma resposta antiga
// (ex.: GeoJSON sem `nome`) que ainda esteja no cache HTTP.
const DATASET_VERSION = '2'

const URL_ESTADOS = `/api/maps/states?v=${DATASET_VERSION}`
const URL_MUNICIPIOS_BASE = `/api/maps/states/`
const SUFIXO_MUNICIPIOS = `/municipios?v=${DATASET_VERSION}`

// Câmera inicial: visão federal (Brasil inteiro)
const CAMERA_FEDERAL: MapViewState = {
  longitude: -55,
  latitude: -15,
  zoom: 4,
  pitch: 0,
  bearing: 0,
}

// Paleta (tema escuro)
const COR_FUNDO = '#0f172a'
const COR_ESTADO = [45, 55, 72, 255] as [number, number, number, number]
const COR_ESTADO_DISABLED = [20, 25, 35, 100] as [number, number, number, number]
const COR_ESTADO_TRANSPARENTE = [0, 0, 0, 0] as [number, number, number, number]
const COR_ESTADO_HOVER = [71, 85, 105, 255] as [number, number, number, number]
const COR_MUNICIPIO = [65, 85, 110, 255] as [number, number, number, number]
const COR_MUNICIPIO_DISABLED = [30, 40, 55, 120] as [
  number,
  number,
  number,
  number,
]
const COR_MUNICIPIO_FOCADO = [56, 189, 248, 255] as [
  number,
  number,
  number,
  number,
]
const COR_MUNICIPIO_HOVER = [100, 130, 165, 255] as [
  number,
  number,
  number,
  number,
]
// Capitais: cor distinta, porém discreta (sem marcadores grandes)
const COR_CAPITAL = [251, 191, 36, 255] as [number, number, number, number]
const COR_CAPITAL_HOVER = [253, 224, 71, 255] as [
  number,
  number,
  number,
  number,
]
const COR_BORDA = [255, 255, 255, 100] as [number, number, number, number]
const COR_BORDA_MUNICIPIO = [255, 255, 255, 200] as [
  number,
  number,
  number,
  number,
]

/** Estado do hover. Guarda apenas o necessário — nunca a feature inteira. */
interface HoverInfo {
  x: number
  y: number
  nome: string
  codigo: string
  nivel: NivelTerritorial
  uf: string
  capital: boolean
}

export default function Mapa() {
  // A "verdade" da aplicação
  const [estadoFocado, setEstadoFocado] = useState<string | null>(null)
  const [municipioFocado, setMunicipioFocado] = useState<string | null>(null)
  const [viewState, setViewState] = useState<MapViewState>(CAMERA_FEDERAL)
  const [hover, setHover] = useState<HoverInfo | null>(null)

  // Regra da Câmera + seleção de estado
  const focarEstado = useCallback((info: PickingInfo) => {
    if (!info.object || !info.coordinate) return

    const idEstado = extrairCodigo(info.object)
    if (!idEstado) return

    const [cliqueLng, cliqueLat] = info.coordinate

    setEstadoFocado(idEstado)
    setMunicipioFocado(null)
    setViewState({
      longitude: cliqueLng,
      latitude: cliqueLat,
      zoom: 6.5,
      pitch: 45,
      bearing: 0,
      transitionDuration: 1500,
      transitionInterpolator: new FlyToInterpolator(),
    })
  }, [])

  // Regra da Câmera + seleção de município (mesma animação do estado)
  const focarMunicipio = useCallback((info: PickingInfo) => {
    if (!info.object || !info.coordinate) return

    const idMunicipio = extrairCodigo(info.object)
    if (!idMunicipio) return

    const [cliqueLng, cliqueLat] = info.coordinate

    setMunicipioFocado(idMunicipio)
    setViewState({
      longitude: cliqueLng,
      latitude: cliqueLat,
      zoom: 9,
      pitch: 45,
      bearing: 0,
      transitionDuration: 1500,
      transitionInterpolator: new FlyToInterpolator(),
    })
  }, [])

  // Volta um nível: municipal → estadual → federal
  const voltarNivel = useCallback(() => {
    if (municipioFocado) {
      // Volta para a visão estadual (mantém o estado focado)
      setMunicipioFocado(null)
      setViewState((vs) => ({
        ...vs,
        zoom: 6.5,
        pitch: 45,
        transitionDuration: 1000,
        transitionInterpolator: new FlyToInterpolator(),
      }))
      return
    }

    // Volta para a visão federal
    setEstadoFocado(null)
    setViewState({
      ...CAMERA_FEDERAL,
      transitionDuration: 1000,
      transitionInterpolator: new FlyToInterpolator(),
    })
  }, [municipioFocado])

  /**
   * Hover de estados. Usa apenas os dados já carregados no GeoJSON.
   * Não dispara nenhuma requisição.
   */
  const hoverEstado = useCallback((info: PickingInfo) => {
    if (!info.object) {
      setHover(null)
      return
    }

    const dados = extrairDadosTerritoriais(info.object, 'estado')
    if (!dados.codigo) {
      setHover(null)
      return
    }

    setHover({
      x: info.x,
      y: info.y,
      nome: dados.nome,
      codigo: dados.codigo,
      nivel: 'estado',
      uf: '',
      capital: false,
    })
  }, [])

  /**
   * Hover de municípios. Usa apenas os dados já carregados no GeoJSON da UF.
   * Não dispara nenhuma requisição.
   */
  const hoverMunicipio = useCallback((info: PickingInfo) => {
    if (!info.object) {
      setHover(null)
      return
    }

    const dados = extrairDadosTerritoriais(info.object, 'municipio')
    if (!dados.codigo) {
      setHover(null)
      return
    }

    setHover({
      x: info.x,
      y: info.y,
      nome: dados.nome,
      codigo: dados.codigo,
      nivel: 'municipio',
      uf: dados.uf,
      capital: ehCapital(dados.codigo),
    })
  }, [])

  const layers = useMemo<Layer[]>(() => {
    // Camada 1: Estados (malha federal)
    const camadaEstados = new GeoJsonLayer({
      id: 'camada-estados',
      data: URL_ESTADOS,
      filled: true,
      stroked: true,
      pickable: true,
      lineWidthMinPixels: 1,
      getLineColor: COR_BORDA,
      // Hierarquia visual: hover > selecionado > normal
      getFillColor: (f) => {
        const codarea = extrairCodigo(f)
        if (hover?.nivel === 'estado' && codarea === hover.codigo) {
          return COR_ESTADO_HOVER
        }
        if (!estadoFocado) return COR_ESTADO
        if (codarea === estadoFocado) return COR_ESTADO_TRANSPARENTE
        return COR_ESTADO_DISABLED
      },
      onClick: focarEstado,
      onHover: hoverEstado,
      updateTriggers: {
        getFillColor: [estadoFocado, hover?.codigo, hover?.nivel],
      },
    })

    // Camada 2: Municípios (lazy loading) — só existe se houver estado focado
    const camadaMunicipios = estadoFocado
      ? new GeoJsonLayer({
          id: 'camada-municipios',
          data: `${URL_MUNICIPIOS_BASE}${estadoFocado}${SUFIXO_MUNICIPIOS}`,
          filled: true,
          stroked: true,
          pickable: true,
          lineWidthMinPixels: 1,
          getLineColor: COR_BORDA_MUNICIPIO,
          // Hierarquia visual: hover > selecionado > capital > normal
          getFillColor: (f) => {
            const codarea = extrairCodigo(f)
            const emHover =
              hover?.nivel === 'municipio' && codarea === hover.codigo

            if (emHover) {
              return ehCapital(codarea) ? COR_CAPITAL_HOVER : COR_MUNICIPIO_HOVER
            }
            if (municipioFocado) {
              return codarea === municipioFocado
                ? COR_MUNICIPIO_FOCADO
                : COR_MUNICIPIO_DISABLED
            }
            if (ehCapital(codarea)) return COR_CAPITAL
            return COR_MUNICIPIO
          },
          onClick: focarMunicipio,
          onHover: hoverMunicipio,
          updateTriggers: {
            getFillColor: [municipioFocado, hover?.codigo, hover?.nivel],
          },
        })
      : null

    const camadas: Layer[] = [camadaEstados]
    if (camadaMunicipios) camadas.push(camadaMunicipios)
    return camadas
  }, [
    estadoFocado,
    municipioFocado,
    hover,
    focarEstado,
    focarMunicipio,
    hoverEstado,
    hoverMunicipio,
  ])

  const rotuloVoltar = municipioFocado
    ? '← Voltar para o Estado'
    : '← Voltar para Visão Federal'

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        backgroundColor: COR_FUNDO,
      }}
    >
      {estadoFocado && (
        <button type="button" style={botaoStyle} onClick={voltarNivel}>
          {rotuloVoltar}
        </button>
      )}

      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) =>
          setViewState(vs as unknown as MapViewState)
        }
        controller={true}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
      />

      {hover && (
        <MapTooltip
          x={hover.x}
          y={hover.y}
          nome={hover.nome}
          codigo={hover.codigo}
          nivel={hover.nivel}
          uf={hover.uf}
          capital={hover.capital}
        />
      )}
    </div>
  )
}

const botaoStyle: React.CSSProperties = {
  position: 'absolute',
  top: 20,
  left: 20,
  zIndex: 10,
  padding: '10px 14px',
  borderRadius: 6,
  border: 'none',
  background: '#38bdf8',
  color: '#0f172a',
  fontFamily: 'sans-serif',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}
