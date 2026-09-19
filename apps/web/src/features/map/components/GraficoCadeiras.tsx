import { corPartido } from '../../elections/coresPartidos'
import type { ComposicaoCamara } from '../../elections/electionsApi'
import './grafico-cadeiras.css'

interface Props {
  camara: ComposicaoCamara
  /** Partido destacado (clique na legenda ou no gráfico) */
  partidoSelecionado?: string | null
  onSelecionarPartido?: (sigla: string | null) => void
}

const RAIO = 54
const CIRC = 2 * Math.PI * RAIO

export default function GraficoCadeiras({ camara, partidoSelecionado, onSelecionarPartido }: Props) {
  let acumulado = 0
  const segmentos = camara.partidos.map((p) => {
    const fracao = camara.total > 0 ? p.cadeiras / camara.total : 0
    const dash = fracao * CIRC
    const seg = { ...p, fracao, dash, offset: acumulado }
    acumulado += dash
    return seg
  })

  const alternar = (sigla: string) =>
    onSelecionarPartido?.(partidoSelecionado === sigla ? null : sigla)

  return (
    <div className="grafico-cadeiras">
      <svg viewBox="0 0 140 140" className="donut" role="img"
        aria-label={`${camara.nome}: ${camara.total} cadeiras em ${camara.partidos.length} partidos`}>
        <circle cx="70" cy="70" r={RAIO} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="18" />
        {segmentos.map((s) => {
          const apagado = partidoSelecionado != null && partidoSelecionado !== s.sigla
          return (
            <circle
              key={s.sigla}
              cx="70" cy="70" r={RAIO} fill="none"
              stroke={corPartido(s.sigla)}
              strokeWidth={apagado ? 11 : 18}
              strokeOpacity={apagado ? 0.22 : 1}
              strokeDasharray={`${s.dash} ${CIRC - s.dash}`}
              strokeDashoffset={-s.offset}
              transform="rotate(-90 70 70)"
              className="donut-segmento"
              onClick={() => alternar(s.sigla)}
            >
              <title>{`${s.sigla}: ${s.cadeiras} cadeiras (${(s.fracao * 100).toFixed(1)}%)`}</title>
            </circle>
          )
        })}
        <text x="70" y="67" textAnchor="middle" className="donut-total">{camara.total}</text>
        <text x="70" y="83" textAnchor="middle" className="donut-rotulo">cadeiras</text>
      </svg>

      <ul className="cadeiras-legenda">
        {camara.partidos.map((p) => {
          const ativo = partidoSelecionado === p.sigla
          const apagado = partidoSelecionado != null && !ativo
          return (
            <li key={p.sigla}>
              <button
                type="button"
                className={`legenda-item${ativo ? ' ativo' : ''}${apagado ? ' apagado' : ''}`}
                onClick={() => alternar(p.sigla)}
                title={`Destacar ${p.sigla} no mapa`}
              >
                <span className="legenda-cor" style={{ background: corPartido(p.sigla) }} />
                <b>{p.sigla}</b>
                <span className="legenda-num">{p.cadeiras}</span>
                <small>{camara.total > 0 ? ((p.cadeiras / camara.total) * 100).toFixed(1) : '0'}%</small>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
