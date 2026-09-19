/**
 * Politicopédia — portal educativo com todos os verbetes do Observatório.
 *
 * Lista por categoria, com busca, e abre o verbete completo em um clique.
 */

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { EXPLICACOES, type Categoria } from './explicacoes'
import { useExplicacao } from './explicacao-ui'
import './politicopedia.css'

const CATEGORIAS: Categoria[] = [
  'Cargos',
  'Poderes',
  'Eleições',
  'Orçamento',
  'Indicadores',
  'Território',
]

export default function Politicopedia({ onFechar }: { onFechar: () => void }) {
  const { abrir } = useExplicacao()
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<Categoria | 'Tudo'>('Tudo')

  const entradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return Object.entries(EXPLICACOES)
      .filter(([, e]) => categoria === 'Tudo' || e.categoria === categoria)
      .filter(([, e]) =>
        !termo ||
        e.titulo.toLowerCase().includes(termo) ||
        e.resumo.toLowerCase().includes(termo),
      )
      .sort((a, b) => a[1].titulo.localeCompare(b[1].titulo, 'pt-BR'))
  }, [busca, categoria])

  return createPortal(
    <div className="pol-overlay" role="presentation" onClick={onFechar}>
      <div
        className="pol-painel"
        role="dialog"
        aria-modal="true"
        aria-label="Politicopédia"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pol-cabecalho">
          <div>
            <span className="pol-eyebrow">POLITICOPÉDIA</span>
            <h2>Entenda a política, termo por termo</h2>
            <p>
              Verbetes curtos sobre cargos, poderes, eleições, orçamento e indicadores.
              Clique em qualquer um para ler o que é, como funciona e para que serve.
            </p>
          </div>
          <button className="info-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </header>

        <div className="pol-filtros">
          <input
            className="pol-busca"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar um termo (ex.: vereador, PIB, orçamento)"
            aria-label="Buscar na Politicopédia"
          />
          <div className="pol-categorias">
            {(['Tudo', ...CATEGORIAS] as const).map((c) => (
              <button
                key={c}
                className={categoria === c ? 'ativo' : ''}
                onClick={() => setCategoria(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="pol-lista">
          {entradas.length === 0
            ? <p className="pol-vazio">Nenhum verbete encontrado.</p>
            : entradas.map(([chave, e]) => (
                <button key={chave} className="pol-item" onClick={() => abrir(chave)}>
                  <span className="pol-item-categoria">{e.categoria}</span>
                  <b>{e.titulo}</b>
                  <small>{e.resumo}</small>
                </button>
              ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
