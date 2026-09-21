import type { CSSProperties } from 'react'
import { useTemporal } from './TemporalContext'
import './global-timeline.css'

export default function GlobalTimeline() {
  const { years, selectedYear, setSelectedYear, loading } = useTemporal()

  return (
    <section className="global-timeline" aria-label="Contexto temporal global">
      <div className="global-timeline-header">
        <div>
          <span className="global-timeline-eyebrow">CONTEXTO TEMPORAL</span>
          <h2>Tempo do Observatório</h2>
        </div>
        <span className="global-timeline-selection">
          {loading ? 'Carregando anos publicados…' : selectedYear ? `${selectedYear} selecionado` : 'Sem ano disponível'}
        </span>
      </div>
      {years.length > 0
        ? <div className="global-timeline-scroll">
            <div className="global-timeline-track" style={{ minWidth: `${Math.max(520, years.length * 110)}px`, '--timeline-count': years.length } as CSSProperties}>
              <div className="global-timeline-line" aria-hidden="true" />
              {years.map((year) => <button
                key={year}
                className={`global-timeline-year ${year === selectedYear ? 'selected' : ''}`}
                onClick={() => setSelectedYear(year)}
                aria-pressed={year === selectedYear}
              >
                <span className="global-timeline-dot" aria-hidden="true" />
                <strong>{year}</strong>
                <small>{year === selectedYear ? 'selecionado' : 'ver contexto'}</small>
              </button>)}
            </div>
          </div>
        : <p className="global-timeline-empty">{loading ? 'Lendo os datasets publicados…' : 'Os datasets publicados ainda não informam anos de referência.'}</p>}
      <p className="global-timeline-note">
        Anos encontrados nos datasets publicados. A seleção é global; os dados atuais de mapa e painel ainda exibem seus próprios anos de referência.
      </p>
    </section>
  )
}
