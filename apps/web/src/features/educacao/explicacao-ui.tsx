/**
 * Interface da Politicopédia.
 *
 *  - ExplicacaoProvider: abre/fecha o cartão de qualquer verbete de qualquer
 *    lugar do site (um único cartão, sem duplicação).
 *  - Termo: palavra destacada dentro de um texto; ao passar o mouse mostra uma
 *    prévia e ao clicar abre o verbete completo (estilo Victoria 3).
 *  - TextoRico: interpreta [[chave|rótulo]] e transforma em <Termo />.
 *  - InfoExplicacao: o botão "?" de ajuda.
 *  - CartaoExplicacao: o verbete completo (o que é / como funciona / qual a função,
 *    o que faz, atenção e "veja também").
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { EXPLICACOES } from './explicacoes'
import './info-explicacao.css'

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

interface Contexto {
  abrir: (chave: string) => void
  fechar: () => void
}

const ExplicacaoContext = createContext<Contexto>({ abrir: () => {}, fechar: () => {} })

export const useExplicacao = () => useContext(ExplicacaoContext)

export function ExplicacaoProvider({ children }: { children: ReactNode }) {
  const [chave, setChave] = useState<string | null>(null)
  const valor = useMemo<Contexto>(
    () => ({ abrir: (c) => setChave(c), fechar: () => setChave(null) }),
    [],
  )
  return (
    <ExplicacaoContext.Provider value={valor}>
      {children}
      {chave && <CartaoExplicacao chave={chave} onFechar={() => setChave(null)} />}
    </ExplicacaoContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Termos destacados dentro de textos
// ---------------------------------------------------------------------------

/** Converte "texto com [[chave]] e [[chave|rótulo]]" em texto com termos clicáveis. */
export function TextoRico({ texto }: { texto: string }) {
  const partes: ReactNode[] = []
  const marcador = /\[\[([^\]]+)\]\]/g
  let ultimo = 0
  let achado: RegExpExecArray | null

  while ((achado = marcador.exec(texto)) !== null) {
    if (achado.index > ultimo) partes.push(texto.slice(ultimo, achado.index))
    const conteudo = achado[1] ?? ''
    const [chaveBruta, rotuloBruto] = conteudo.split('|')
    const chave = (chaveBruta ?? '').trim()
    const rotulo = (rotuloBruto ?? chave).trim()
    partes.push(
      <Termo key={`${chave}-${achado.index}`} chave={chave}>{rotulo}</Termo>,
    )
    ultimo = achado.index + achado[0].length
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo))
  return <>{partes}</>
}

/** Palavra destacada: prévia ao passar o mouse, verbete completo ao clicar. */
export function Termo({ chave, children }: { chave: string; children: ReactNode }) {
  const { abrir } = useExplicacao()
  const exp = EXPLICACOES[chave]
  if (!exp) return <>{children}</>
  return (
    <button
      type="button"
      className="termo"
      title={`${exp.titulo} — ${exp.resumo} (clique para saber mais)`}
      onClick={(e) => { e.stopPropagation(); abrir(chave) }}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Botão "?" de ajuda
// ---------------------------------------------------------------------------

interface PropsBotao {
  chave: string
  rotulo?: string
  pequeno?: boolean
}

export default function InfoExplicacao({ chave, rotulo, pequeno }: PropsBotao) {
  const { abrir } = useExplicacao()
  const exp = EXPLICACOES[chave]
  if (!exp) return null
  return (
    <button
      type="button"
      className={`info-botao${pequeno ? ' pequeno' : ''}`}
      aria-label={rotulo ?? `O que é ${exp.titulo}?`}
      title={`O que é ${exp.titulo}?`}
      onClick={(e) => { e.stopPropagation(); abrir(chave) }}
    >
      ?
    </button>
  )
}

// ---------------------------------------------------------------------------
// Cartão do verbete
// ---------------------------------------------------------------------------

export function CartaoExplicacao({ chave, onFechar }: { chave: string; onFechar: () => void }) {
  const { abrir } = useExplicacao()
  const exp = EXPLICACOES[chave]

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  if (!exp) return null

  return createPortal(
    // Portal para o <body>: o painel usa backdrop-filter, que "prende"
    // elementos position:fixed dentro dele.
    <div className="info-overlay" role="presentation" onClick={onFechar}>
      <div
        className="info-cartao"
        role="dialog"
        aria-modal="true"
        aria-label={exp.titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="info-cabecalho">
          <div>
            <span className="info-categoria">{exp.categoria}</span>
            <h3>{exp.titulo}</h3>
          </div>
          <button className="info-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </header>

        <p className="info-resumo">{exp.resumo}</p>

        <dl className="info-conteudo">
          <dt>O que é?</dt>
          <dd><TextoRico texto={exp.oQueE} /></dd>
          <dt>Como funciona?</dt>
          <dd><TextoRico texto={exp.comoFunciona} /></dd>
          <dt>Qual a função?</dt>
          <dd><TextoRico texto={exp.qualFuncao} /></dd>
        </dl>

        {exp.atribuicoes && exp.atribuicoes.length > 0 && (
          <>
            <h4 className="info-subtitulo">O que faz</h4>
            <ul className="info-atribuicoes">
              {exp.atribuicoes.map((item) => (
                <li key={item}><TextoRico texto={item} /></li>
              ))}
            </ul>
          </>
        )}

        {exp.atencao && <p className="info-atencao">Atenção: {exp.atencao}</p>}

        {exp.relacionados && exp.relacionados.length > 0 && (
          <>
            <h4 className="info-subtitulo">Veja também</h4>
            <div className="info-relacionados">
              {exp.relacionados.map((r) => {
                const alvo = EXPLICACOES[r]
                if (!alvo) return null
                return (
                  <button key={r} type="button" onClick={() => abrir(r)}>{alvo.titulo}</button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
