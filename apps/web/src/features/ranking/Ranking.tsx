/**
 * Ranking — o "livro de potências" do observatório.
 *
 * Compara todos os territórios do Brasil entre si, agrupados em faixas. A
 * apresentação é inspirada no ledger de potências de Victoria 3: posição à
 * esquerda, valor à direita e um agrupamento por faixa que dá o contexto de
 * escala — sem ele, "R$ 40 bi" não significa nada para quem lê.
 *
 * Clicar em uma linha leva o mapa até aquele território.
 */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatarInteiro, formatarMoeda, formatarMoedaCompacta } from '../../lib/format'
import { buscarRanking } from './rankingApi'
import type { LinhaRanking, NivelRanking, RankingNacional } from './rankingApi'
import InfoExplicacao from '../educacao/explicacao-ui'
import './ranking.css'

type Metrica = 'pib' | 'pibPerCapita' | 'populacao' | 'receitaTotal' | 'despesaTotal'

interface DefMetrica {
  rotulo: string
  /** Chave do verbete explicativo aberto ao lado do seletor. */
  explicacao: string
  /** Uma linha dizendo o que a métrica mede — evita leitura errada do número. */
  ajuda: string
  /** Soma faz sentido? Só então dá para falar em "% do total nacional". */
  aditiva: boolean
  formatar: (valor: number) => string
  faixa: (valor: number, total: number) => string
}

/** Faixas por participação no total — usadas nas métricas que somam. */
function faixaPorParticipacao(valor: number, total: number): string {
  const p = total > 0 ? (valor / total) * 100 : 0
  if (p >= 10) return '10% ou mais do total nacional'
  if (p >= 5) return 'de 5% a 10% do total'
  if (p >= 1) return 'de 1% a 5% do total'
  if (p >= 0.25) return 'de 0,25% a 1% do total'
  return 'menos de 0,25% do total'
}

/** Faixas por valor absoluto — para PIB per capita, que não é somável. */
function faixaPerCapita(valor: number): string {
  if (valor >= 100000) return 'R$ 100 mil ou mais por habitante'
  if (valor >= 50000) return 'de R$ 50 mil a R$ 100 mil'
  if (valor >= 25000) return 'de R$ 25 mil a R$ 50 mil'
  if (valor >= 15000) return 'de R$ 15 mil a R$ 25 mil'
  return 'menos de R$ 15 mil'
}

const METRICAS: Record<Metrica, DefMetrica> = {
  pib: {
    rotulo: 'PIB',
    explicacao: 'pib',
    ajuda: 'Tudo que o território produziu no ano, somado. Mede o tamanho da economia.',
    aditiva: true,
    // O IBGE publica o PIB em Mil Reais; exibimos em Reais.
    formatar: (v) => formatarMoedaCompacta(v * 1000),
    faixa: faixaPorParticipacao,
  },
  pibPerCapita: {
    rotulo: 'PIB per capita',
    explicacao: 'pibPerCapita',
    ajuda:
      'O PIB dividido pela população. Mede riqueza por habitante, não tamanho da economia — por isso municípios pequenos com mineração aparecem no topo.',
    aditiva: false,
    formatar: formatarMoeda,
    faixa: (v) => faixaPerCapita(v),
  },
  populacao: {
    rotulo: 'População',
    explicacao: 'populacao',
    ajuda: 'Habitantes residentes no território.',
    aditiva: true,
    formatar: formatarInteiro,
    faixa: faixaPorParticipacao,
  },
  receitaTotal: {
    rotulo: 'Receita',
    explicacao: 'receitaTotal',
    ajuda: 'Tudo que o poder público arrecadou no exercício, efetivamente realizado.',
    aditiva: true,
    formatar: formatarMoedaCompacta,
    faixa: faixaPorParticipacao,
  },
  despesaTotal: {
    rotulo: 'Despesa',
    explicacao: 'despesaTotal',
    ajuda: 'Tudo que o poder público pagou no exercício, já liquidado.',
    aditiva: true,
    formatar: formatarMoedaCompacta,
    faixa: faixaPorParticipacao,
  },
}

const ORDEM: Metrica[] = ['pib', 'pibPerCapita', 'populacao', 'receitaTotal', 'despesaTotal']

/** Quantas linhas mostrar antes do "mostrar mais". */
const PASSO = 100

interface Props {
  onFechar: () => void
  /** Leva o mapa até o território escolhido. */
  onSelecionar: (linha: LinhaRanking, nivel: NivelRanking) => void
}

export default function Ranking({ onFechar, onSelecionar }: Props) {
  const [dados, setDados] = useState<RankingNacional | null>(null)
  const [nivel, setNivel] = useState<NivelRanking>('ufs')
  const [metrica, setMetrica] = useState<Metrica>('pib')
  const [busca, setBusca] = useState('')
  const [visiveis, setVisiveis] = useState(PASSO)

  useEffect(() => {
    let ativo = true
    buscarRanking().then((d) => { if (ativo) setDados(d) })
    return () => { ativo = false }
  }, [])

  // Trocar de métrica, nível ou busca recomeça a paginação — feito no próprio
  // handler para não disparar um render extra via efeito.
  const trocarNivel = (n: NivelRanking) => { setNivel(n); setVisiveis(PASSO) }
  const trocarMetrica = (m: Metrica) => { setMetrica(m); setVisiveis(PASSO) }
  const trocarBusca = (valor: string) => { setBusca(valor); setVisiveis(PASSO) }

  useEffect(() => {
    const escapar = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', escapar)
    return () => window.removeEventListener('keydown', escapar)
  }, [onFechar])

  const def = METRICAS[metrica]

  const base = useMemo(
    () => (nivel === 'ufs' ? dados?.ufs ?? [] : dados?.municipios ?? []),
    [dados, nivel],
  )

  /**
   * Total nacional e valor máximo, calculados sobre a base INTEIRA (sem busca).
   * Se fossem calculados sobre o filtro, a barra e o percentual mudariam de
   * escala a cada letra digitada — o que enganaria a leitura.
   */
  const { total, maximo } = useMemo(() => {
    let soma = 0
    let max = 0
    for (const l of base) {
      const v = l[metrica]
      if (v === null || v === undefined) continue
      soma += v
      if (v > max) max = v
    }
    return { total: soma, maximo: max }
  }, [base, metrica])

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const lista = base
      .filter((l) => l[metrica] !== null && l[metrica] !== undefined)
      .filter((l) => !termo || l.nome.toLowerCase().includes(termo) || l.uf.toLowerCase() === termo)
    return lista.sort((a, b) => (b[metrica] ?? 0) - (a[metrica] ?? 0))
  }, [base, metrica, busca])

  const recorte = filtradas.slice(0, visiveis)

  /**
   * Agrupa em faixas consecutivas. A posição exibida é sempre a do ranking
   * completo (1..n), não a da faixa, senão o número perderia o sentido.
   */
  const grupos = useMemo(() => {
    const saida: Array<{ rotulo: string; itens: Array<{ linha: LinhaRanking; posicao: number }> }> = []
    recorte.forEach((linha, i) => {
      const rotulo = def.faixa(linha[metrica] ?? 0, total)
      const ultimo = saida[saida.length - 1]
      if (ultimo && ultimo.rotulo === rotulo) ultimo.itens.push({ linha, posicao: i + 1 })
      else saida.push({ rotulo, itens: [{ linha, posicao: i + 1 }] })
    })
    return saida
  }, [recorte, def, total, metrica])

  const anos = dados?.anos
  const legendaAnos = anos
    ? [
        metrica === 'populacao' ? `população ${anos.populacao ?? '—'}` : null,
        metrica === 'pib' || metrica === 'pibPerCapita' ? `PIB ${anos.pib ?? '—'}` : null,
        metrica === 'receitaTotal' || metrica === 'despesaTotal'
          ? `orçamento ${anos.orcamento ?? '—'}`
          : null,
      ].filter(Boolean).join(' · ')
    : ''

  return createPortal(
    <div className="rk-overlay" role="presentation" onClick={onFechar}>
      <div
        className="rk-painel"
        role="dialog"
        aria-modal="true"
        aria-label="Ranking dos territórios"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rk-cabecalho">
          <div>
            <span className="rk-eyebrow">RANKING</span>
            <h2>Quem pesa mais na economia brasileira</h2>
            <p>
              Todos os territórios ordenados pela métrica escolhida, agrupados em faixas
              para dar noção de escala. Clique em qualquer linha para ver o território no mapa.
            </p>
          </div>
          <button className="info-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </header>

        <div className="rk-filtros">
          <div className="rk-linha-controles">
            <div className="rk-niveis" role="group" aria-label="Nível territorial">
              <button className={nivel === 'ufs' ? 'ativo' : ''} onClick={() => trocarNivel('ufs')}>
                Estados <small>{dados?.ufs.length ?? 0}</small>
              </button>
              <button className={nivel === 'municipios' ? 'ativo' : ''} onClick={() => trocarNivel('municipios')}>
                Municípios <small>{dados?.municipios.length ?? 0}</small>
              </button>
            </div>
            <input
              className="rk-busca"
              value={busca}
              onChange={(e) => trocarBusca(e.target.value)}
              placeholder="Filtrar por nome ou UF"
              aria-label="Filtrar o ranking"
            />
          </div>

          <div className="rk-metricas" role="group" aria-label="Métrica">
            {ORDEM.map((m) => (
              <button key={m} className={metrica === m ? 'ativo' : ''} onClick={() => trocarMetrica(m)}>
                {METRICAS[m].rotulo}
              </button>
            ))}
          </div>

          {/* O ícone explica a métrica ATIVA — por isso fica nesta linha, e não
              solto no fim dos chips, onde pareceria explicar o último. */}
          <p className="rk-ajuda">
            <InfoExplicacao chave={def.explicacao} pequeno />
            <span>{def.ajuda}</span>
            {legendaAnos && <small className="rk-anos">{legendaAnos}</small>}
          </p>
        </div>

        <div className="rk-lista">
          {!dados && <p className="rk-vazio">Carregando o ranking…</p>}

          {dados && filtradas.length === 0 && (
            <p className="rk-vazio">Nenhum território encontrado para “{busca}”.</p>
          )}

          {dados && grupos.map((grupo) => (
            <section key={grupo.rotulo} className="rk-grupo">
              <h3 className="rk-grupo-titulo">
                {grupo.rotulo}
                <small>{grupo.itens.length === 1 ? '1 território' : `${grupo.itens.length} territórios`}</small>
              </h3>
              {grupo.itens.map(({ linha, posicao }) => {
                const valor = linha[metrica] ?? 0
                // Raiz quadrada: sem isso, a barra do 2º colocado já ficaria
                // invisível ao lado de São Paulo, que sozinho tem 9% do PIB.
                const largura = maximo > 0 ? Math.sqrt(valor / maximo) * 100 : 0
                const participacao = def.aditiva && total > 0 ? (valor / total) * 100 : null
                return (
                  <button
                    key={linha.codarea}
                    className="rk-linha"
                    onClick={() => onSelecionar(linha, nivel)}
                    title={`Ver ${linha.nome} no mapa`}
                  >
                    <span className={`rk-pos${posicao <= 3 ? ' destaque' : ''}`}>{posicao}</span>
                    <span className="rk-nome">
                      <b>{linha.nome}</b>
                      {nivel === 'municipios' && <small>{linha.uf}</small>}
                    </span>
                    <span className="rk-barra" aria-hidden="true">
                      <i style={{ width: `${largura}%` }} />
                    </span>
                    <span className="rk-valor">{def.formatar(valor)}</span>
                    <span className="rk-participacao">
                      {participacao === null
                        ? ''
                        : `${participacao.toLocaleString('pt-BR', { maximumFractionDigits: participacao < 1 ? 3 : 1 })}%`}
                    </span>
                  </button>
                )
              })}
            </section>
          ))}

          {dados && filtradas.length > visiveis && (
            <button className="rk-mais" onClick={() => setVisiveis((v) => v + PASSO)}>
              Mostrar mais {Math.min(PASSO, filtradas.length - visiveis)} de{' '}
              {(filtradas.length - visiveis).toLocaleString('pt-BR')} restantes
            </button>
          )}

          {dados && filtradas.length > 0 && (
            <p className="rk-rodape">
              {filtradas.length.toLocaleString('pt-BR')} territórios com dado disponível
              {def.aditiva ? ' · percentual sobre o total nacional' : ''}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
