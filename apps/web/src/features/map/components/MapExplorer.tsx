import { useCallback, useEffect, useMemo, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { GeoJsonLayer } from '@deck.gl/layers'
import { HexagonLayer } from '@deck.gl/aggregation-layers'
import { FlyToInterpolator } from '@deck.gl/core'
import type { Layer, MapViewState, PickingInfo } from '@deck.gl/core'
import MapTooltip from './MapTooltip'
import TerritoryPanel from './TerritoryPanel'
import { ehCapital } from '../data/capitais'
import { extrairCodigo, extrairDadosTerritoriais, territorioBrasil } from '../mapFeatures'
import type { DadosTerritoriais, FeatureTerritorial, NivelTerritorial } from '../mapFeatures'
import { lerDados } from '../../../lib/fontes'
import InfoExplicacao from '../../educacao/explicacao-ui'
import Politicopedia from '../../educacao/Politicopedia'
import { corPartido, corPartidoRgb } from '../../elections/coresPartidos'
import { buscarComposicao } from '../../elections/electionsApi'
import type { Composicao, ComposicaoTerritorio } from '../../elections/electionsApi'
import { buscarPontosPib } from '../../indicators/indicatorsApi'
import type { PontoPib } from '../../indicators/indicatorsApi'
import './map-explorer.css'

const CAMERA: MapViewState = { longitude: -55, latitude: -15, zoom: 4, pitch: 0, bearing: 0 }
const COLOR = {
  state: [40,59,78,255] as [number,number,number,number],
  muted: [12,24,38,130] as [number,number,number,number],
  hover: [72,145,166,255] as [number,number,number,number],
  city: [50,83,104,255] as [number,number,number,number],
  selected: [70,207,224,255] as [number,number,number,number],
  capital: [237,177,75,255] as [number,number,number,number],
  semDados: [30,45,60,120] as [number,number,number,number],
}
type Rgba = [number, number, number, number]

/** Escala de cor sequencial para o PIB (do menor para o maior). */
const ESCALA_PIB: [number, number, number][] = [
  [26, 52, 78], [32, 74, 102], [34, 98, 120], [40, 124, 134],
  [56, 150, 138], [90, 174, 128], [136, 194, 110], [190, 208, 90],
  [234, 212, 72], [255, 204, 58],
]
/** Raio de cada hexágono, em metros (menor = mais hexágonos, mais detalhe). */
const RAIO_HEXAGONO = 10000

type Camada = 'nenhuma' | 'forca' | 'pib'
interface Hover { x:number; y:number; data:DadosTerritoriais; capital:boolean }

/** Centro (bounding box) de uma feature GeoJSON — usado para posicionar a câmera. */
function centroDaFeature(feature: unknown): [number, number] | null {
  const coords: number[][] = []
  const percorrer = (no: unknown): void => {
    if (!Array.isArray(no)) return
    if (typeof no[0] === 'number' && typeof no[1] === 'number') {
      coords.push(no as number[])
      return
    }
    for (const filho of no) percorrer(filho)
  }
  percorrer((feature as { geometry?: { coordinates?: unknown } } | null)?.geometry?.coordinates)
  if (coords.length === 0) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of coords) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2]
}

/**
 * Valor de um hexágono: soma do PIB dos municípios daquela área (em Mil Reais).
 * A distribuição é muito desigual, então o HexagonLayer corta os extremos por
 * percentil — sem isso, poucas colunas gigantes esconderiam todo o resto.
 */
const somaPib = (pontos: PontoPib[]) => pontos.reduce((s, p) => s + (p.pib ?? 0), 0)

/** Faixa de cor do azul (menor) ao amarelo (maior). */
const CORES_PIB: [number, number, number][] = ESCALA_PIB

export default function MapExplorer() {
  const [states, setStates] = useState<FeatureTerritorial[]>([])
  const [cities, setCities] = useState<FeatureTerritorial[]>([])
  const [state, setState] = useState<DadosTerritoriais | null>(null)
  const [territory, setTerritory] = useState<DadosTerritoriais | null>(null)
  const [viewState, setViewState] = useState<MapViewState>(CAMERA)
  const [hover, setHover] = useState<Hover | null>(null)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [politicopediaAberta, setPoliticopediaAberta] = useState(false)
  // Camadas analíticas: nenhuma | força política (cadeiras) | PIB (hexágonos)
  const [camada, setCamada] = useState<Camada>('nenhuma')
  const [partidoSelecionado, setPartidoSelecionado] = useState<string | null>(null)
  const [composicao, setComposicao] = useState<Composicao | null>(null)
  const [pontosPib, setPontosPib] = useState<PontoPib[]>([])
  const [carregandoPib, setCarregandoPib] = useState(false)

  const modoForca = camada === 'forca'
  const modoPib = camada === 'pib'

  // Malhas territoriais lidas direto dos arquivos estáticos
  useEffect(() => {
    lerDados<{ features?: FeatureTerritorial[] }>('maps/brasil.geojson')
      .then((d) => setStates(d?.features ?? []))
  }, [])
  useEffect(() => {
    if (!state) { setCities([]); return }
    let ativo = true
    lerDados<{ features?: FeatureTerritorial[] }>(`maps/ufs/${state.codigo}.geojson`)
      .then((d) => { if (ativo) setCities(d?.features ?? []) })
    return () => { ativo = false }
  }, [state])

  // Composição usada na "força política": com estado selecionado → municípios; senão → estados
  useEffect(() => {
    if (!modoForca) { setComposicao(null); return }
    let ativo = true
    const nivel = state ? 'estado' : 'brasil'
    const codigo = state ? state.codigo : 'BR'
    buscarComposicao(nivel, codigo).then((c) => { if (ativo) setComposicao(c) })
    return () => { ativo = false }
  }, [modoForca, state])

  // Pontos de PIB (todos os municípios) — carregados uma única vez
  useEffect(() => {
    if (!modoPib || pontosPib.length > 0) return
    let ativo = true
    setCarregandoPib(true)
    buscarPontosPib()
      .then((pontos) => { if (ativo) setPontosPib(pontos) })
      .finally(() => { if (ativo) setCarregandoPib(false) })
    return () => { ativo = false }
  }, [modoPib, pontosPib.length])

  // Inclina a câmera para ver os hexágonos em 3D
  useEffect(() => {
    setViewState((v) => ({
      ...v,
      pitch: modoPib ? 52 : 0,
      transitionDuration: 900,
      transitionInterpolator: new FlyToInterpolator(),
    }))
  }, [modoPib])

  const mapaComposicao = useMemo(() => {
    const m = new Map<string, ComposicaoTerritorio>()
    for (const t of composicao?.territorios ?? []) m.set(t.codarea, t)
    return m
  }, [composicao])

  /** Cor de "força" de um território: dominante ou intensidade do partido filtrado. */
  const corForca = useCallback((codarea: string): Rgba | null => {
    const t = mapaComposicao.get(codarea)
    if (!t) return null
    if (partidoSelecionado) {
      const cadeiras = t.cadeiras[partidoSelecionado] ?? 0
      if (cadeiras === 0) return [26, 40, 54, 120]
      const forca = cadeiras / Math.max(1, t.total)
      const alpha = 80 + Math.round(Math.min(1, forca * 2.2) * 175)
      return [...corPartidoRgb(partidoSelecionado), alpha] as Rgba
    }
    return [...corPartidoRgb(t.dominante), 205] as Rgba
  }, [mapaComposicao, partidoSelecionado])

  /** Partidos presentes nos territórios, por total de cadeiras (legenda do mapa). */
  const partidosForca = useMemo(() => {
    const contagem = new Map<string, number>()
    for (const t of composicao?.territorios ?? []) {
      for (const [sigla, n] of Object.entries(t.cadeiras)) contagem.set(sigla, (contagem.get(sigla) ?? 0) + n)
    }
    return [...contagem.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([sigla, cadeiras]) => ({ sigla, cadeiras }))
  }, [composicao])

  const fly = (info: PickingInfo, data: DadosTerritoriais, zoom: number) => {
    const [longitude, latitude] =
      info.coordinate ?? centroDaFeature(info.object) ?? [CAMERA.longitude, CAMERA.latitude]
    setViewState({ longitude, latitude, zoom, pitch: modoPib ? 52 : 42, bearing: 0, transitionDuration: 900, transitionInterpolator: new FlyToInterpolator() })
    setTerritory(data)
  }
  const selectState = useCallback((info: PickingInfo) => { if (!info.object) return; const data = extrairDadosTerritoriais(info.object, 'estado'); if (!data.codigo) return; setState(data); fly(info, data, 6.4) }, [modoPib])
  const selectCity = useCallback((info: PickingInfo) => { if (!info.object) return; const data = extrairDadosTerritoriais(info.object, 'municipio'); if (!data.codigo) return; fly(info, data, 9) }, [modoPib])
  const onHover = useCallback((info: PickingInfo, level: NivelTerritorial) => { if (!info.object) return setHover(null); const data = extrairDadosTerritoriais(info.object, level); if (!data.codigo) return setHover(null); setHover({ x: info.x, y: info.y, data, capital: level === 'municipio' && ehCapital(data.codigo) }) }, [])
  const goHome = () => { setState(null); setTerritory(null); setViewState({ ...CAMERA, pitch: modoPib ? 52 : 0, transitionDuration: 700, transitionInterpolator: new FlyToInterpolator() }) }
  const selecionarBrasil = () => { setState(null); setTerritory(territorioBrasil()); setViewState({ ...CAMERA, pitch: modoPib ? 52 : 0, transitionDuration: 700, transitionInterpolator: new FlyToInterpolator() }) }
  const selectSearch = (data: DadosTerritoriais) => { const feature = data.nivel === 'estado' ? states.find(f => extrairCodigo(f) === data.codigo) : cities.find(f => extrairCodigo(f) === data.codigo); if (!feature) return; if (data.nivel === 'estado') setState(data); fly({ object: feature, coordinate: undefined } as PickingInfo, data, data.nivel === 'estado' ? 6.4 : 9); setSearch(''); setSearchOpen(false) }
  const searchable = [...states.map(f => extrairDadosTerritoriais(f, 'estado')), ...cities.map(f => extrairDadosTerritoriais(f, 'municipio'))]
  const results = search.trim() ? searchable.filter(item => item.nome.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).slice(0, 7) : []

  const layers = useMemo<Layer[]>(() => {
    // Modo PIB: hexágonos agregando a soma do PIB dos municípios
    if (modoPib) {
      const hexagonos = new HexagonLayer<PontoPib>({
        id: 'pib-hexagonos',
        data: pontosPib,
        getPosition: (d: PontoPib) => [d.lng, d.lat],
        radius: RAIO_HEXAGONO,
        extruded: true,
        elevationScale: 4500,
        lowerPercentile: 10,
        upperPercentile: 92,
        colorRange: CORES_PIB,
        opacity: 0.82,
        getColorValue: somaPib,
        getElevationValue: somaPib,
        pickable: false,
      })

      const lista: Layer[] = [hexagonos]

      // Limites dos municípios da UF selecionada — dá a referência geográfica
      if (state) {
        lista.push(new GeoJsonLayer({
          id: 'contorno-municipios', data: cities as never, pickable: false, filled: false, stroked: true,
          lineWidthMinPixels: 0.6, getLineColor: [226, 243, 255, 140],
        }))
      }

      // Estados: preenchimento transparente (permite clicar) com contorno visível
      lista.push(new GeoJsonLayer({
        id: 'contorno-estados', data: states as never, pickable: true, filled: true, stroked: true,
        getFillColor: [0, 0, 0, 0],
        lineWidthMinPixels: 1.8,
        getLineColor: (f) => {
          const id = extrairCodigo(f)
          if (state && id !== state.codigo) return [140, 180, 205, 130]
          return [220, 242, 255, 240]
        },
        onClick: selectState,
        onHover: (i) => onHover(i, 'estado'),
        updateTriggers: { getLineColor: [state] },
      }))

      return lista
    }

    const stateLayer = new GeoJsonLayer({
      id:'states', data:states as never, pickable:true, filled:true, stroked:true, lineWidthMinPixels:1, getLineColor:[180,216,233,105],
      getFillColor:(f) => {
        const id=extrairCodigo(f)
        if (modoForca && !state) return corForca(id) ?? COLOR.semDados
        if (state && id!==state.codigo) return COLOR.muted
        if (hover?.data.nivel==='estado' && hover.data.codigo===id) return COLOR.hover
        return COLOR.state
      },
      onClick:selectState, onHover:i => onHover(i,'estado'),
      updateTriggers:{ getFillColor:[state,hover,modoForca,partidoSelecionado,mapaComposicao] },
    })
    const cityLayer = state ? new GeoJsonLayer({
      id:'cities', data:cities as never, pickable:true, filled:true, stroked:true, lineWidthMinPixels:.7, getLineColor:[200,228,241,150],
      getFillColor:(f) => {
        const id=extrairCodigo(f)
        if (modoForca) return corForca(id) ?? COLOR.semDados
        if (territory?.nivel==='municipio' && territory.codigo===id) return COLOR.selected
        if (hover?.data.nivel==='municipio' && hover.data.codigo===id) return COLOR.hover
        return ehCapital(id) ? COLOR.capital : COLOR.city
      },
      onClick:selectCity, onHover:i => onHover(i,'municipio'),
      updateTriggers:{ getFillColor:[territory,hover,modoForca,partidoSelecionado,mapaComposicao] },
    }) : null
    return cityLayer ? [stateLayer,cityLayer] : [stateLayer]
  }, [states,cities,state,territory,hover,selectState,selectCity,onHover,modoForca,modoPib,pontosPib,partidoSelecionado,mapaComposicao,corForca])

  const breadcrumb = territory?.nivel === 'municipio' ? ['Brasil', state?.nome ?? '', territory.nome] : state ? ['Brasil', state.nome] : ['Brasil']
  const escopoForca = state ? `câmaras municipais · ${state.nome}` : 'Câmara dos Deputados'

  return <div className="map-explorer">
    <DeckGL viewState={viewState} onViewStateChange={({viewState: next}) => setViewState(next as MapViewState)} controller layers={layers} getCursor={({isHovering}) => isHovering ? 'pointer' : 'grab'} />
    <header className="map-topbar"><button className="brand" onClick={goHome}><span>◈</span> observatório <b>brasil</b></button><div className="search-wrap"><label className="sr-only" htmlFor="territory-search">Buscar território</label><input id="territory-search" value={search} onFocus={() => setSearchOpen(true)} onChange={e => {setSearch(e.target.value);setSearchOpen(true)}} placeholder="Buscar estado ou município" />{searchOpen && results.length > 0 && <div className="search-results">{results.map(item => <button key={item.codigo} onMouseDown={() => selectSearch(item)}><b>{item.nome}</b><small>{item.nivel === 'estado' ? 'Estado' : `Município · ${item.uf}`}</small></button>)}</div>}</div><button className="pol-botao" onClick={() => setPoliticopediaAberta(true)}>Politicopédia</button></header>
    <div className="map-guide">
      <span>COMECE A EXPLORAR</span>
      <p>Escolha um estado, município ou pesquise um lugar.</p>
      <button className="guide-action" onClick={selecionarBrasil}>Ver o Brasil inteiro <span>→</span></button>
      <button className={`guide-action${modoForca ? ' ativo' : ''}`} onClick={() => { setCamada(modoForca ? 'nenhuma' : 'forca'); setPartidoSelecionado(null) }}>Força política <span>→</span></button>
      <button className={`guide-action${modoPib ? ' ativo' : ''}`} onClick={() => setCamada(modoPib ? 'nenhuma' : 'pib')}>PIB em hexágonos <span>→</span></button>
    </div>

    {modoForca && <div className="forca-painel">
      <div className="forca-cabecalho"><span>FORÇA POLÍTICA<InfoExplicacao chave="forcaPolitica" pequeno /></span><small>{escopoForca} · por cadeiras</small></div>
      <div className="forca-partidos">
        {partidosForca.length === 0
          ? <p className="forca-vazio">Sem dados de cadeiras para este recorte.</p>
          : partidosForca.map((p) => (
              <button key={p.sigla} className={partidoSelecionado === p.sigla ? 'ativo' : ''} onClick={() => setPartidoSelecionado(partidoSelecionado === p.sigla ? null : p.sigla)} title={`${p.sigla}: ${p.cadeiras} cadeiras`}>
                <span className="forca-cor" style={{ background: corPartido(p.sigla) }} />
                {p.sigla}
                <small>{p.cadeiras}</small>
              </button>
            ))}
      </div>
      {partidoSelecionado && <button className="forca-limpar" onClick={() => setPartidoSelecionado(null)}>limpar filtro ({partidoSelecionado})</button>}
    </div>}

    {modoPib && <div className="forca-painel">
      <div className="forca-cabecalho"><span>PIB EM HEXÁGONOS<InfoExplicacao chave="hexagonosPib" pequeno /></span><small>soma do PIB por área · hexágonos de {RAIO_HEXAGONO / 1000} km</small></div>
      {carregandoPib
        ? <p className="forca-vazio">Carregando os municípios…</p>
        : pontosPib.length === 0
          ? <p className="forca-vazio">Sem dados de PIB. Rode: npx tsx scripts/update-centroides.ts</p>
          : <>
              <div className="escala-pib">{ESCALA_PIB.map((c, i) => <span key={i} style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} />)}</div>
              <div className="escala-rotulos"><small>menor PIB</small><small>maior PIB</small></div>
              <p className="forca-vazio">{pontosPib.length.toLocaleString('pt-BR')} municípios · altura = soma do PIB</p>
            </>}
    </div>}

    {breadcrumb.length > 1 && <nav className="breadcrumbs" aria-label="Caminho de navegação">{breadcrumb.map((item,index) => <span key={item}>{index > 0 && <i>/</i>}<button onClick={index === 0 ? goHome : undefined}>{item}</button></span>)}</nav>}
    {!modoPib && <div className="map-legend"><span><i className="dot capital"/>Capital</span><span><i className="dot selected"/>Território selecionado</span></div>}
    {territory && <TerritoryPanel territory={territory} onClose={() => setTerritory(null)} onCompare={(q) => { setSearch(q); setSearchOpen(true) }} partidoSelecionado={partidoSelecionado} onSelecionarPartido={(sigla) => { setPartidoSelecionado(sigla); if (sigla) setCamada('forca') }} />}
    {hover && <MapTooltip x={hover.x} y={hover.y} nome={hover.data.nome} codigo={hover.data.codigo} nivel={hover.data.nivel} uf={hover.data.uf} capital={hover.capital} />}
    {politicopediaAberta && <Politicopedia onFechar={() => setPoliticopediaAberta(false)} />}
  </div>
}
