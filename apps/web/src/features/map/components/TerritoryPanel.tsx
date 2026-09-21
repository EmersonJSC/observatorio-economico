import { useState, type ReactNode } from 'react'
import type { DadosTerritoriais } from '../mapFeatures'
import { useTerritoryData } from '../useTerritoryData'
import type { MandatoRepresentante } from '../../elections/electionsApi'
import {
  formatarInteiro,
  formatarMoeda,
  formatarMoedaCompacta,
  formatarPercentual,
  iniciais,
  milReaisParaReais,
} from '../../../lib/format'
import GraficoCadeiras from './GraficoCadeiras'
import InfoExplicacao from '../../educacao/explicacao-ui'
import './territory-panel.css'
import './territory-data.css'

type Tab = 'retrato' | 'gestao' | 'pessoas' | 'cadeiras' | 'comparar'
interface Props {
  territory: DadosTerritoriais
  selectedYear: number | null
  onClose: () => void
  onCompare: (query: string) => void
  /** Partido destacado no mapa — sincroniza o gráfico com o filtro territorial */
  partidoSelecionado?: string | null
  onSelecionarPartido?: (sigla: string | null) => void
}

const explanation = {
  prefeitura: 'Coordena a administração municipal e executa o orçamento aprovado.',
  vice: 'Substitui o prefeito quando necessário e pode coordenar áreas da gestão.',
  camara: 'Propõe, vota e fiscaliza leis e gastos municipais.',
  governo: 'Coordena a administração estadual e executa o orçamento do estado.',
  assembleia: 'Cria leis estaduais e fiscaliza as ações do governo estadual.',
  presidencia: 'Chefia o Poder Executivo federal e executa o orçamento da União.',
  congresso: 'Elabora leis, fiscaliza o Executivo e aprova o orçamento federal.',
}

/** Cargo exibido → chave da explicação educativa. */
const CHAVE_CARGO: Record<string, string> = {
  'Prefeito': 'prefeito',
  'Vice-Prefeito': 'vicePrefeito',
  'Vereador': 'vereador',
  'Governador': 'governador',
  'Vice-Governador': 'viceGovernador',
  'Senador': 'senador',
  'Deputado Federal': 'deputadoFederal',
  'Deputado Estadual': 'deputadoEstadual',
  'Deputado Distrital': 'deputadoDistrital',
  'Presidente': 'presidente',
  'Vice-Presidente': 'vicePresidente',
}

function Source({ referencia, children }: { referencia: string; children: string }) {
  return <p className="panel-source">Referência: {referencia} · Fonte oficial: {children}</p>
}

function EstadoVazio({ children }: { children: ReactNode }) {
  return <p className="data-empty">{children}</p>
}

function AvatarMandato({ mandato }: { mandato: MandatoRepresentante }) {
  const [falhou, setFalhou] = useState(false)
  if (mandato.fotoUrl && !falhou) {
    return (
      <img
        className="person-avatar person-foto"
        src={mandato.fotoUrl}
        alt={`Foto de ${mandato.nomeUrna}`}
        loading="lazy"
        onError={() => setFalhou(true)}
      />
    )
  }
  return <div className="person-avatar" aria-hidden="true">{iniciais(mandato.nomeUrna)}</div>
}

function PessoaCard({ papel, mandato }: { papel: string; mandato: MandatoRepresentante }) {
  return (
    <article className="person-card">
      <AvatarMandato mandato={mandato} />
      <div>
        <b>{mandato.nomeUrna}</b>
        <p>{mandato.nomeCompleto} · {mandato.partido}</p>
        <span>{papel} · {mandato.mandatoPeriodo}{CHAVE_CARGO[papel] && <InfoExplicacao chave={CHAVE_CARGO[papel]} pequeno />}</span>
      </div>
    </article>
  )
}

function ListaMandatos({ titulo, mandatos }: { titulo: string; mandatos: MandatoRepresentante[] }) {
  if (mandatos.length === 0) return null
  return (
    <div className="mandato-lista">
      <h3>{titulo} <small>({mandatos.length})</small></h3>
      <div className="mandato-scroll">
        {mandatos.map((m) => (
          <PessoaCard
            key={m.sqCandidato ?? `${m.nomeUrna}-${m.numeroCandidato}`}
            papel={m.cargo}
            mandato={m}
          />
        ))}
      </div>
    </div>
  )
}

export default function TerritoryPanel({ territory, selectedYear, onClose, onCompare, partidoSelecionado, onSelecionarPartido }: Props) {
  const [tab, setTab] = useState<Tab>('retrato')
  const [query, setQuery] = useState('')
  const dados = useTerritoryData(territory, selectedYear)
  const { indicadores, orcamento, carregando } = dados

  const municipal = territory.nivel === 'municipio'
  const federal = territory.nivel === 'brasil'
  const rotuloNivel = federal ? 'BRASIL' : municipal ? `MUNICÍPIO · ${territory.uf}` : 'ESTADO'

  const entities: Array<[string, string]> = municipal
    ? [['Prefeitura', explanation.prefeitura], ['Vice-prefeitura', explanation.vice], ['Câmara Municipal', explanation.camara]]
    : federal
      ? [['Presidência da República', explanation.presidencia], ['Congresso Nacional', explanation.congresso]]
      : [['Governo do Estado', explanation.governo], ['Assembleia Legislativa', explanation.assembleia]]

  const labels: Record<Tab, string> = { retrato: 'Retrato', gestao: 'Gestão', pessoas: 'Pessoas', cadeiras: 'Cadeiras', comparar: 'Comparar' }
  const anoPop = indicadores?.populacao?.anoReferencia
  const anoPib = indicadores?.pib?.anoReferencia

  return <aside className="territory-panel" aria-label={`Dados de ${territory.nome}`}>
    <header className="panel-header"><div><span className="eyebrow">{rotuloNivel}</span><h1>{territory.nome}</h1></div><button className="close-button" onClick={onClose} aria-label="Fechar detalhes">×</button></header>
    <nav className="panel-tabs" aria-label="Seções do território">{(Object.keys(labels) as Tab[]).map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{labels[item]}</button>)}</nav>
    <div className="panel-content">

      {tab === 'retrato' && <>
        <div className="panel-intro"><span>EM 30 SEGUNDOS · {selectedYear ?? 'SEM ANO'}</span><p>Conheça o território, quem toma decisões públicas e onde acompanhar a gestão.</p></div>
        <section>
          <h2>O retrato do lugar</h2>
          {carregando
            ? <p className="data-loading">Carregando indicadores…</p>
            : indicadores
              ? <div className="metric-grid">
                  <article><span>População<InfoExplicacao chave="populacao" pequeno /></span><strong>{formatarInteiro(indicadores.populacao?.total)}</strong><small>IBGE{anoPop ? ` · ${anoPop}` : ''}</small></article>
                  <article><span>PIB<InfoExplicacao chave="pib" pequeno /></span><strong>{formatarMoedaCompacta(milReaisParaReais(indicadores.pib?.valorTotalMilReais))}</strong><small>IBGE{anoPib ? ` · ${anoPib}` : ''}</small></article>
                  <article><span>PIB per capita<InfoExplicacao chave="pibPerCapita" pequeno /></span><strong>{formatarMoeda(indicadores.pib?.valorPerCapitaReais)}</strong><small>IBGE{anoPib ? ` · ${anoPib}` : ''}</small></article>
                </div>
              : <EstadoVazio>Sem indicadores disponíveis para {selectedYear ?? 'o ano selecionado'} neste território.</EstadoVazio>}
          {indicadores && <Source referencia={`${anoPop ?? '—'} (população) · ${anoPib ?? '—'} (PIB)`}>IBGE (SIDRA)</Source>}
        </section>
        <section>
          <h2>Quem atua aqui</h2>
          <p className="section-lead">Entenda a função antes de acompanhar uma pessoa ou gasto.</p>
          <div className="role-list">{entities.map(([name, text], index) => <button key={name} className="role-card" onClick={() => setTab('pessoas')}><span className="role-avatar">{index + 1}</span><span><b>{name}</b><small>{text}</small></span><i>›</i></button>)}</div>
        </section>
      </>}

      {tab === 'gestao' && <>
        <div className="panel-intro"><span>GESTÃO E ORÇAMENTO</span><p>Veja de onde vem o dinheiro público e como ele é aplicado, em linguagem direta.</p></div>
        <section>
          <h2>Finanças públicas</h2>
          {carregando
            ? <p className="data-loading">Carregando orçamento…</p>
            : orcamento
              ? <>
                  <div className="data-grid">
                    <article className="data-card"><span>Receita total<InfoExplicacao chave="receitaTotal" pequeno /></span><strong>{formatarMoedaCompacta(orcamento.receitaTotal)}</strong><small>Realizada</small></article>
                    <article className="data-card"><span>Despesa total<InfoExplicacao chave="despesaTotal" pequeno /></span><strong>{formatarMoedaCompacta(orcamento.despesaTotal)}</strong><small>Liquidada</small></article>
                    <article className="data-card"><span>Saúde<InfoExplicacao chave="saude" pequeno /></span><strong>{formatarMoedaCompacta(orcamento.gastosPorArea.saude)}</strong><small>{formatarPercentual(orcamento.gastosPorArea.saude, orcamento.despesaTotal)} da despesa</small></article>
                    <article className="data-card"><span>Educação<InfoExplicacao chave="educacao" pequeno /></span><strong>{formatarMoedaCompacta(orcamento.gastosPorArea.educacao)}</strong><small>{formatarPercentual(orcamento.gastosPorArea.educacao, orcamento.despesaTotal)} da despesa</small></article>
                  </div>
                  <Source referencia={String(orcamento.exercicio)}>Tesouro Nacional (Siconfi)</Source>
                </>
              : <EstadoVazio>{federal
                  ? 'Orçamento nacional (União) ainda não faz parte do dataset — a base cobre estados e municípios.'
                  : `Sem dados de orçamento para ${selectedYear ?? 'o ano selecionado'} neste território. A base cobre, por enquanto, os exercícios publicados.`}</EstadoVazio>}
        </section>
        <button className="link-action" onClick={() => setTab('pessoas')}>Ver quem fiscaliza estes gastos <span>→</span></button>
      </>}

      {tab === 'pessoas' && <>
        <div className="panel-intro"><span>PESSOAS E ELEIÇÕES</span><p>Representantes em exercício e o resultado eleitoral, com fontes verificáveis.</p></div>
        <section>
          <h2>Representação atual</h2>
          {carregando
            ? <p className="data-loading">Carregando mandatos…</p>
            : <PessoasConteudo dados={dados} nivel={territory.nivel} anoSelecionado={selectedYear} />}
        </section>
        <button className="link-action" onClick={() => setTab('gestao')}>Ver como estes mandatos aplicam o orçamento <span>→</span></button>
      </>}

      {tab === 'cadeiras' && <>
        <div className="panel-intro"><span>CADEIRAS POR PARTIDO</span><p>Como as cadeiras deste território se dividem entre os partidos. Clique em um partido para destacá-lo no mapa.</p></div>
        {carregando
          ? <p className="data-loading">Carregando composição…</p>
          : dados.composicao && dados.composicao.camaras.some((c) => c.total > 0)
            ? dados.composicao.camaras.filter((camara) => camara.total > 0).map((camara) => (
                <section key={camara.id}>
                  <h2>{camara.nome}<InfoExplicacao chave="cadeiras" pequeno /></h2>
                  <GraficoCadeiras
                    camara={camara}
                    partidoSelecionado={partidoSelecionado}
                    onSelecionarPartido={onSelecionarPartido}
                  />
                  <Source referencia={camara.id === 'camara-municipal' ? 'Eleição 2024' : 'Eleição 2022'}>
                    Justiça Eleitoral (TSE)
                  </Source>
                </section>
              ))
            : <EstadoVazio>Sem dados de composição de cadeiras para este território.</EstadoVazio>}
      </>}

      {tab === 'comparar' && <>
        <div className="panel-intro"><span>COMPARAR LUGARES</span><p>Escolha outro território para comparar medidas equivalentes e do mesmo período.</p></div>
        <label className="compare-label" htmlFor="compare">Outro estado ou município</label>
        <div className="compare-form"><input id="compare" value={query} onChange={e => setQuery(e.target.value)} placeholder="Ex.: Recife ou Pernambuco" /><button onClick={() => onCompare(query)} disabled={!query.trim()}>Comparar</button></div>
        <p className="empty-compare">A comparação será exibida lado a lado sem ranking automático.</p>
      </>}

    </div>
  </aside>
}

/** Bloco de representação conforme o nível territorial. */
function PessoasConteudo({ dados, nivel, anoSelecionado }: { dados: ReturnType<typeof useTerritoryData>; nivel: DadosTerritoriais['nivel']; anoSelecionado: number | null }) {
  if (nivel === 'brasil') {
    const { presidente, vicePresidente, congresso } = dados.mandatoBrasil ?? {}
    if (!presidente && !vicePresidente) {
      return <EstadoVazio>Sem mandatos nacionais publicados para {anoSelecionado ?? 'o ano selecionado'}.</EstadoVazio>
    }
    return <>
      {presidente && <div className="people-list"><PessoaCard papel="Presidente" mandato={presidente} />
        {vicePresidente && <PessoaCard papel="Vice-Presidente" mandato={vicePresidente} />}</div>}
      {congresso && <div className="data-grid" style={{ marginTop: 10 }}>
        <article className="data-card"><span>Senadores (2022)</span><strong>{congresso.senadores}</strong><small>Senado Federal</small></article>
        <article className="data-card"><span>Deputados federais</span><strong>{congresso.deputadosFederais}</strong><small>Câmara dos Deputados</small></article>
      </div>}
      <p className="section-lead" style={{ marginTop: 10 }}>Os deputados e senadores de cada estado aparecem ao selecionar o estado no mapa.</p>
    </>
  }

  if (nivel === 'estado') {
    const estado = dados.mandatoEstado
    if (!estado) {
      return <EstadoVazio>Sem mandatos estaduais publicados para {anoSelecionado ?? 'o ano selecionado'}.</EstadoVazio>
    }
    return <>
      <div className="people-list">
        {estado.governador && <PessoaCard papel="Governador" mandato={estado.governador} />}
        {estado.viceGovernador && <PessoaCard papel="Vice-Governador" mandato={estado.viceGovernador} />}
      </div>
      <ListaMandatos titulo="Senadores" mandatos={estado.senadores} />
      <ListaMandatos titulo="Deputados federais" mandatos={estado.deputadosFederais} />
      <ListaMandatos titulo="Deputados estaduais" mandatos={estado.deputadosEstaduais} />
    </>
  }

  const municipio = dados.mandatoMunicipio
  if (!municipio || (!municipio.prefeito && !municipio.vicePrefeito)) {
    return <EstadoVazio>Sem dados de mandato para {anoSelecionado ?? 'o ano selecionado'} neste município.</EstadoVazio>
  }
  return <>
    <div className="people-list">
      {municipio.prefeito && <PessoaCard papel="Prefeito" mandato={municipio.prefeito} />}
      {municipio.vicePrefeito && <PessoaCard papel="Vice-Prefeito" mandato={municipio.vicePrefeito} />}
    </div>
    <ListaMandatos titulo="Vereadores" mandatos={municipio.vereadores ?? []} />
  </>
}
