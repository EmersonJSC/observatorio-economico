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
import Ranking from '../../ranking/Ranking'
import type { LinhaRanking, NivelRanking } from '../../ranking/rankingApi'
import { corPartido, corPartidoRgb } from '../../elections/coresPartidos'
import { buscarComposicao } from '../../elections/electionsApi'
import type { Composicao, ComposicaoTerritorio } from '../../elections/electionsApi'
import { getPontosExplorer } from '../../explorer/explorerApi'
import type { PontoExplorer } from '../../explorer/explorerApi'
import {
  CATEGORIAS, LENTES, corSequencial, dominioPercentil, lentePorId,
  normalizar, valorDoEstado, valorDoPonto,
  indicadoresDoPonto, indicadoresDoEstado,
} from '../lentes'
import type { CategoriaLente, Lente } from '../lentes'
import './map-explorer.css'
import { useTemporal } from '../../timeline/TemporalContext'
import '../../timeline/temporal-map-context.css'

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

/**
 * Constantes de renderização do HexagonLayer. O raio inicial é 25000 m porque,
 * com ~5.570 pontos, raios pequenos fazem o mapa sumir: cada hexágono passa a
 * conter um único município e o desenho encolhe abaixo de um pixel.
 */
const RAIO_PADRAO = 25000
/** Raios oferecidos no painel. */
const RAIOS_HEXAGONO = [25000, 100000, 250000]
/** Quanto do raio o hexágono DESENHADO ocupa (1 = encosta no vizinho). */
const COBERTURA_PADRAO = 1
const COBERTURAS_HEXAGONO = [0.7, 0.85, 1]

type Camada = 'nenhuma' | 'forca' | 'informacao'
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
 * Converte uma cor RGB em RGBA sem depender de transparência herdada da camada.
 */
const comAlpha = (cor: [number, number, number], alpha = 225): Rgba => [...cor, alpha]

export default function MapExplorer() {
  const { selectedYear } = useTemporal()
  const [states, setStates] = useState<FeatureTerritorial[]>([])
  const [cities, setCities] = useState<FeatureTerritorial[]>([])
  const [state, setState] = useState<DadosTerritoriais | null>(null)
  const [territory, setTerritory] = useState<DadosTerritoriais | null>(null)
  const [viewState, setViewState] = useState<MapViewState>(CAMERA)
  const [hover, setHover] = useState<Hover | null>(null)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [politicopediaAberta, setPoliticopediaAberta] = useState(false)
  const [rankingAberto, setRankingAberto] = useState(false)
  // Camadas analíticas: nenhuma | política | uma lente de dados públicos.
  const [camada, setCamada] = useState<Camada>('nenhuma')
  const [lenteId, setLenteId] = useState('pib')
  const [categoriaLente, setCategoriaLente] = useState<CategoriaLente>('economia')
  const [partidoSelecionado, setPartidoSelecionado] = useState<string | null>(null)
  const [composicao, setComposicao] = useState<Composicao | null>(null)
  const [pontosInformacao, setPontosInformacao] = useState<PontoExplorer[]>([])
  const [carregandoInformacao, setCarregandoInformacao] = useState(false)
  const [raioHexagono, setRaioHexagono] = useState(RAIO_PADRAO)
  const [coberturaHexagono, setCoberturaHexagono] = useState(COBERTURA_PADRAO)
  const [percentilInferior, setPercentilInferior] = useState(0)
  const [percentilSuperior, setPercentilSuperior] = useState(95)

  const modoForca = camada === 'forca'
  const modoInformacao = camada === 'informacao'
  const lente: Lente = lentePorId(lenteId) ?? LENTES[0]
  const lentesDaCategoria = LENTES.filter((item) => item.categoria === categoriaLente)
  const categoriasInformacao = CATEGORIAS.filter((item) => item.id !== 'politica')

  // Malhas territoriais lidas direto dos arquivos estáticos
  useEffect(() => {
    lerDados<{ features?: FeatureTerritorial[] }>('territorios/brasil.geojson')
      .then((d) => setStates(d?.features ?? []))
  }, [])
  useEffect(() => {
    if (!state) { setCities([]); return }
    let ativo = true
    lerDados<{ features?: FeatureTerritorial[] }>(`territorios/${state.codigo}.geojson`)
      .then((d) => { if (ativo) setCities(d?.features ?? []) })
    return () => { ativo = false }
  }, [state])

  // Composição usada na "força política": com estado selecionado → municípios; senão → estados
  useEffect(() => {
    if (!modoForca) { setComposicao(null); return }
    let ativo = true
    const nivel = state ? 'estado' : 'brasil'
    const codigo = state ? state.codigo : 'BR'
    buscarComposicao(nivel, codigo, selectedYear).then((c) => { if (ativo) setComposicao(c) })
    return () => { ativo = false }
  }, [modoForca, state, selectedYear])

  // Pontos com todos os indicadores — carregados uma única vez para as lentes.
  useEffect(() => {
    if (!modoInformacao) return
    let ativo = true
    setCarregandoInformacao(true)
    getPontosExplorer(selectedYear)
      .then((pontos) => { if (ativo) setPontosInformacao(pontos) })
      .finally(() => { if (ativo) setCarregandoInformacao(false) })
    return () => { ativo = false }
  }, [modoInformacao, pontosInformacao.length, selectedYear])

  // Inclina a câmera para ver os hexágonos em 3D
  useEffect(() => {
    setViewState((v) => ({
      ...v,
      pitch: modoInformacao ? 52 : 0,
      transitionDuration: 900,
      transitionInterpolator: new FlyToInterpolator(),
    }))
  }, [modoInformacao])

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
    setViewState({ longitude, latitude, zoom, pitch: modoInformacao ? 52 : 42, bearing: 0, transitionDuration: 900, transitionInterpolator: new FlyToInterpolator() })
    setTerritory(data)
  }
  const selectState = useCallback((info: PickingInfo) => { if (!info.object) return; const data = extrairDadosTerritoriais(info.object, 'estado'); if (!data.codigo) return; setState(data); fly(info, data, 6.4) }, [modoInformacao])
  const selectCity = useCallback((info: PickingInfo) => { if (!info.object) return; const data = extrairDadosTerritoriais(info.object, 'municipio'); if (!data.codigo) return; fly(info, data, 9) }, [modoInformacao])
  const onHover = useCallback((info: PickingInfo, level: NivelTerritorial) => { if (!info.object) return setHover(null); const data = extrairDadosTerritoriais(info.object, level); if (!data.codigo) return setHover(null); setHover({ x: info.x, y: info.y, data, capital: level === 'municipio' && ehCapital(data.codigo) }) }, [])
  const goHome = () => { setState(null); setTerritory(null); setViewState({ ...CAMERA, pitch: modoInformacao ? 52 : 0, transitionDuration: 700, transitionInterpolator: new FlyToInterpolator() }) }
  const selecionarBrasil = () => { setState(null); setTerritory(territorioBrasil()); setViewState({ ...CAMERA, pitch: modoInformacao ? 52 : 0, transitionDuration: 700, transitionInterpolator: new FlyToInterpolator() }) }
  const selectSearch = (data: DadosTerritoriais) => { const feature = data.nivel === 'estado' ? states.find(f => extrairCodigo(f) === data.codigo) : cities.find(f => extrairCodigo(f) === data.codigo); if (!feature) return; if (data.nivel === 'estado') setState(data); fly({ object: feature, coordinate: undefined } as PickingInfo, data, data.nivel === 'estado' ? 6.4 : 9); setSearch(''); setSearchOpen(false) }

  /**
   * Seleção vinda do ranking. Diferente da busca, o município escolhido pode ser
   * de qualquer UF — então o estado é carregado antes, para o mapa desenhar os
   * municípios. A câmera usa a coordenada que já vem no próprio ranking, sem
   * depender de a malha estar em memória.
   */
  const selecionarDoRanking = useCallback((linha: LinhaRanking, nivelRanking: NivelRanking) => {
    setRankingAberto(false)
    setHover(null)
    const voar = (zoom: number) => {
      if (linha.lng === null || linha.lat === null) return
      setViewState({
        longitude: linha.lng, latitude: linha.lat, zoom,
        pitch: modoInformacao ? 52 : 42, bearing: 0,
        transitionDuration: 900, transitionInterpolator: new FlyToInterpolator(),
      })
    }

    if (nivelRanking === 'ufs') {
      const feature = states.find((f) => extrairCodigo(f) === linha.codarea)
      const dados: DadosTerritoriais = feature
        ? extrairDadosTerritoriais(feature, 'estado')
        : { codigo: linha.codarea, nome: linha.nome, uf: '', nivel: 'estado' }
      setState(dados)
      setTerritory(dados)
      voar(6.4)
      return
    }

    const featureUf = states.find((f) => extrairCodigo(f) === linha.codarea.slice(0, 2))
    if (featureUf) setState(extrairDadosTerritoriais(featureUf, 'estado'))
    setTerritory({ codigo: linha.codarea, nome: linha.nome, uf: linha.uf, nivel: 'municipio' })
    voar(9)
  }, [states, modoInformacao])
  const searchable = [...states.map(f => extrairDadosTerritoriais(f, 'estado')), ...cities.map(f => extrairDadosTerritoriais(f, 'municipio'))]
  const results = search.trim() ? searchable.filter(item => item.nome.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).slice(0, 7) : []

  const siglaEstadoSelecionado = state
    ? String(states.find((feature) => extrairCodigo(feature) === state.codigo)?.properties?.sigla ?? '')
    : ''
  const pontosNoEscopo = useMemo(
    () => siglaEstadoSelecionado ? pontosInformacao.filter((ponto) => ponto.uf === siglaEstadoSelecionado) : pontosInformacao,
    [pontosInformacao, siglaEstadoSelecionado],
  )
  const pontosComValor = useMemo(() => {
    if (!lente.campo) return []
    return pontosNoEscopo.filter((ponto) => valorDoPonto(ponto, lente.campo!) !== null)
  }, [pontosNoEscopo, lente])
  const dominioDaLente = useMemo(() => {
    if (!lente.campo) return null
    return dominioPercentil(
      pontosComValor.map((ponto) => valorDoPonto(ponto, lente.campo!)).filter((valor): valor is number => valor !== null),
      percentilInferior,
      percentilSuperior,
    )
  }, [pontosComValor, lente, percentilInferior, percentilSuperior])
  const pontosPorCodigo = useMemo(() => new Map(pontosInformacao.map((ponto) => [ponto.codarea, ponto])), [pontosInformacao])

  /**
   * Indicadores exibidos no tooltip, conforme a lente ativa.
   *
   * Só há números em modo informação: nas demais camadas o popup identifica o
   * território, e inventar linhas vazias poluiria o hover. Quando os pontos
   * ainda estão carregando, o tooltip aparece sem indicadores em vez de
   * piscar "sem dado" — que seria uma afirmação falsa sobre o dado.
   */
  const indicadoresHover = useMemo(() => {
    if (!modoInformacao || !lente.campo || !hover || pontosInformacao.length === 0) return []
    const campo = lente.campo

    if (hover.data.nivel === 'municipio') {
      const ponto = pontosPorCodigo.get(hover.data.codigo)
      return ponto ? indicadoresDoPonto(ponto, campo) : []
    }

    const sigla = String(
      states.find((f) => extrairCodigo(f) === hover.data.codigo)?.properties?.sigla ?? '',
    )
    if (!sigla) return []
    return indicadoresDoEstado(pontosInformacao.filter((ponto) => ponto.uf === sigla), campo)
  }, [modoInformacao, lente, hover, pontosPorCodigo, pontosInformacao, states])

  const layers = useMemo<Layer[]>(() => {
    // Lentes numéricas: totais viram hexágonos; taxas viram cor nos territórios.
    if (modoInformacao) {
      const lista: Layer[] = []
      const campo = lente.campo

      if (campo && lente.tipo === 'agregacao') {
        lista.push(new HexagonLayer<PontoExplorer>({
          id: `informacao-hexagonos-${lente.id}`,
          data: pontosComValor,
          getPosition: (ponto) => [ponto.lng, ponto.lat],
          radius: raioHexagono,
          coverage: coberturaHexagono,
          extruded: true,
          elevationScale: 4500,
          lowerPercentile: percentilInferior,
          upperPercentile: percentilSuperior,
          colorRange: [
            [26, 52, 78], [32, 74, 102], [34, 98, 120], [40, 124, 134], [56, 150, 138],
            [90, 174, 128], [136, 194, 110], [190, 208, 90], [234, 212, 72], [255, 204, 58],
          ],
          opacity: 0.82,
          getColorValue: (grupo) => grupo.reduce((soma, ponto) => soma + (valorDoPonto(ponto, campo) ?? 0), 0),
          getElevationValue: (grupo) => grupo.reduce((soma, ponto) => soma + (valorDoPonto(ponto, campo) ?? 0), 0),
          pickable: false,
        }))
      }

      if (campo && lente.tipo === 'coropletico') {
        const corDoValor = (valor: number | null): Rgba => {
          return valor === null ? COLOR.semDados : comAlpha(corSequencial(normalizar(valor, dominioDaLente)))
        }

        if (state) {
          lista.push(new GeoJsonLayer({
            id: `informacao-municipios-${lente.id}`, data: cities as never, pickable: true, filled: true, stroked: true,
            lineWidthMinPixels: 0.7, getLineColor: [206, 232, 244, 125],
            getFillColor: (feature) => {
              const ponto = pontosPorCodigo.get(extrairCodigo(feature))
              return corDoValor(ponto ? valorDoPonto(ponto, campo) : null)
            },
            onClick: selectCity, onHover: (info) => onHover(info, 'municipio'),
            updateTriggers: { getFillColor: [pontosPorCodigo, dominioDaLente, lente.id] },
          }))
        } else {
          lista.push(new GeoJsonLayer({
            id: `informacao-estados-${lente.id}`, data: states as never, pickable: true, filled: true, stroked: true,
            lineWidthMinPixels: 1.2, getLineColor: [206, 232, 244, 145],
            getFillColor: (feature) => {
              const sigla = String((feature as FeatureTerritorial).properties?.sigla ?? '')
              return corDoValor(valorDoEstado(pontosInformacao.filter((ponto) => ponto.uf === sigla), campo))
            },
            onClick: selectState, onHover: (info) => onHover(info, 'estado'),
            updateTriggers: { getFillColor: [pontosInformacao, dominioDaLente, lente.id] },
          }))
        }
      }

      // Limites dos municípios da UF selecionada — dá a referência geográfica
      if (state && lente.tipo === 'agregacao') {
        lista.push(new GeoJsonLayer({
          id: 'contorno-municipios', data: cities as never, pickable: false, filled: false, stroked: true,
          lineWidthMinPixels: 0.6, getLineColor: [226, 243, 255, 140],
        }))
      }

      // Estados: preenchimento transparente (permite clicar) com contorno visível
      if (lente.tipo === 'agregacao') lista.push(new GeoJsonLayer({
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
  }, [states,cities,state,territory,hover,selectState,selectCity,onHover,modoForca,modoInformacao,pontosInformacao,pontosComValor,pontosPorCodigo,dominioDaLente,lente,partidoSelecionado,mapaComposicao,corForca,raioHexagono,coberturaHexagono,percentilInferior,percentilSuperior])

  const breadcrumb = territory?.nivel === 'municipio' ? ['Brasil', state?.nome ?? '', territory.nome] : state ? ['Brasil', state.nome] : ['Brasil']
  const escopoForca = state ? `câmaras municipais · ${state.nome}` : 'Câmara dos Deputados'

  return <div className="map-explorer">
    <DeckGL viewState={viewState} onViewStateChange={({viewState: next}) => setViewState(next as MapViewState)} controller layers={layers} getCursor={({isHovering}) => isHovering ? 'pointer' : 'grab'} />
    <header className="map-topbar"><button className="brand" onClick={goHome}><span>◈</span> observatório <b>brasil</b></button><div className="search-wrap"><label className="sr-only" htmlFor="territory-search">Buscar território</label><input id="territory-search" value={search} onFocus={() => setSearchOpen(true)} onChange={e => {setSearch(e.target.value);setSearchOpen(true)}} placeholder="Buscar estado ou município" />{searchOpen && results.length > 0 && <div className="search-results">{results.map(item => <button key={item.codigo} onMouseDown={() => selectSearch(item)}><b>{item.nome}</b><small>{item.nivel === 'estado' ? 'Estado' : `Município · ${item.uf}`}</small></button>)}</div>}</div><button className="rk-botao" onClick={() => setRankingAberto(true)}>Ranking</button><button className="pol-botao" onClick={() => setPoliticopediaAberta(true)}>Politicopédia</button></header>
    <div className="map-guide">
      <span>COMECE A EXPLORAR</span>
      <p>Escolha um estado, município ou pesquise um lugar.</p>
      <button className="guide-action" onClick={selecionarBrasil}>Ver o Brasil inteiro <span>→</span></button>
      <button className={`guide-action${modoForca ? ' ativo' : ''}`} onClick={() => { setCamada(modoForca ? 'nenhuma' : 'forca'); setPartidoSelecionado(null) }}>Força política <span>→</span></button>
      <button className={`guide-action${modoInformacao ? ' ativo' : ''}`} onClick={() => setCamada(modoInformacao ? 'nenhuma' : 'informacao')}>Informação <span>→</span></button>
    </div>

    {modoForca && <div className="camada-painel">
      <div className="camada-cabecalho"><span>FORÇA POLÍTICA<InfoExplicacao chave="forcaPolitica" pequeno /></span><small>{escopoForca} · por cadeiras</small></div>
      <div className="forca-partidos">
        {partidosForca.length === 0
          ? <p className="camada-vazio">Sem dados de cadeiras para este recorte.</p>
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

    {modoInformacao && <div className="camada-painel">
      <div className="camada-cabecalho">
        <span>INFORMAÇÃO<InfoExplicacao chave={lente.explicacao ?? 'hexagonosPib'} pequeno /></span>
        <small>{state ? `${state.nome} · recorte estadual` : 'Brasil inteiro'}</small>
      </div>

      <div className="tema-lista" role="group" aria-label="Categoria da informação">
        {categoriasInformacao.map((categoria) => (
          <button key={categoria.id} className={categoriaLente === categoria.id ? 'ativo' : ''} onClick={() => {
            setCategoriaLente(categoria.id)
            const primeiraLente = LENTES.find((item) => item.categoria === categoria.id)
            if (primeiraLente) setLenteId(primeiraLente.id)
          }}>{categoria.rotulo}</button>
        ))}
      </div>
      <div className="tema-lista" role="group" aria-label="Indicador no mapa">
        {lentesDaCategoria.map((item) => (
          <button key={item.id} className={lente.id === item.id ? 'ativo' : ''} onClick={() => setLenteId(item.id)}>{item.rotulo}</button>
        ))}
      </div>
      <p className="camada-ajuda">{lente.ajuda} Fonte: {lente.fonte}.</p>

      {carregandoInformacao
        ? <p className="camada-vazio">Carregando os municípios…</p>
        : pontosComValor.length === 0
          ? <p className="camada-vazio">Não há dados disponíveis para este indicador e recorte.</p>
          : <>
              <div className="escala-pib">{Array.from({ length: 10 }, (_, i) => {
                const cor = corSequencial(i / 9)
                return <span key={i} style={{ background: `rgb(${cor[0]},${cor[1]},${cor[2]})` }} />
              })}</div>
              <div className="escala-rotulos"><small>menor</small><small>maior</small></div>

              {lente.tipo === 'agregacao' && <>
                <label className="camada-controle">
                  <span>Raio da área</span>
                  <select value={raioHexagono} onChange={(e) => setRaioHexagono(Number(e.target.value))}>
                    {RAIOS_HEXAGONO.map((r) => <option key={r} value={r}>{r / 1000} km</option>)}
                  </select>
                </label>
                <label className="camada-controle">
                  <span>Tamanho desenhado <b>{(coberturaHexagono * 100).toFixed(0)}%</b></span>
                  <select value={coberturaHexagono} onChange={(e) => setCoberturaHexagono(Number(e.target.value))}>
                    {COBERTURAS_HEXAGONO.map((c) => <option key={c} value={c}>{(c * 100).toFixed(0)}% do raio</option>)}
                  </select>
                </label>
              </>}

              <label className="camada-controle">
                <span>Limite superior da escala <b>{percentilSuperior}%</b></span>
                <input type="range" min={50} max={100} value={percentilSuperior}
                  onChange={(e) => setPercentilSuperior(Math.max(Number(e.target.value), percentilInferior + 1))} />
              </label>

              <label className="camada-controle">
                <span>Limite inferior da escala <b>{percentilInferior}%</b></span>
                <input type="range" min={0} max={50} value={percentilInferior}
                  onChange={(e) => setPercentilInferior(Math.min(Number(e.target.value), percentilSuperior - 1))} />
              </label>

              <p className="camada-nota">
                {lente.tipo === 'agregacao'
                  ? 'Totais são somados por área. A altura e a cor mostram a escala do conjunto de municípios.'
                  : 'Taxas e valores por habitante são pintados em cada território, sem somá-los.'}
              </p>

              <p className="camada-vazio">
                {pontosComValor.length.toLocaleString('pt-BR')} municípios com dados
                {lente.tipo === 'agregacao' ? ` · áreas de ${raioHexagono / 1000} km` : ''}
              </p>
            </>}
    </div>}

    {breadcrumb.length > 1 && <nav className="breadcrumbs" aria-label="Caminho de navegação">{breadcrumb.map((item,index) => <span key={item}>{index > 0 && <i>/</i>}<button onClick={index === 0 ? goHome : undefined}>{item}</button></span>)}</nav>}
    {!modoInformacao && <div className="map-legend"><span><i className="dot capital"/>Capital</span><span><i className="dot selected"/>Território selecionado</span></div>}
    <div className="map-temporal-context">Contexto global: <b>{selectedYear ?? 'sem ano'}</b></div>
    {territory && <TerritoryPanel territory={territory} selectedYear={selectedYear} onClose={() => setTerritory(null)} onCompare={(q) => { setSearch(q); setSearchOpen(true) }} partidoSelecionado={partidoSelecionado} onSelecionarPartido={(sigla) => { setPartidoSelecionado(sigla); if (sigla) setCamada('forca') }} />}
    {hover && <MapTooltip x={hover.x} y={hover.y} nome={hover.data.nome} codigo={hover.data.codigo} nivel={hover.data.nivel} uf={hover.data.uf} capital={hover.capital} indicadores={indicadoresHover} />}
    {politicopediaAberta && <Politicopedia onFechar={() => setPoliticopediaAberta(false)} />}
    {rankingAberto && <Ranking onFechar={() => setRankingAberto(false)} onSelecionar={selecionarDoRanking} />}
  </div>
}
