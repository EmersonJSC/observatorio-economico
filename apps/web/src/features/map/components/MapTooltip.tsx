import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { NivelTerritorial } from '../mapFeatures';

/** Deslocamento do cursor em relação ao popup. */
const OFFSET_X = 16;
const OFFSET_Y = 16;
/** Margem mínima em relação às bordas da viewport. */
const MARGEM_VIEWPORT = 12;

export interface MapTooltipProps {
  /** Posição X do cursor (clientX). */
  x: number;
  /** Posição Y do cursor (clientY). */
  y: number;
  /** Nome oficial do IBGE. */
  nome: string;
  /** Código IBGE (codarea). */
  codigo: string;
  /** Nível territorial. */
  nivel: NivelTerritorial;
  /** Sigla da UF (apenas para municípios). */
  uf?: string;
  /** Indica se a feature é uma capital. */
  capital?: boolean;
  /**
   * Linhas de indicadores a exibir, já formatadas por quem chama.
   *
   * O tooltip é apresentacional: ele NÃO consulta dataset nem calcula métrica.
   * A resolução do valor pertence a `lentes.ts`, que é quem conhece o campo da
   * lente ativa. Aqui só desenhamos.
   */
  indicadores?: LinhaIndicador[];
}

/** Uma linha de indicador no popup. */
export interface LinhaIndicador {
  /** Rótulo curto (ex.: "PIB"). */
  rotulo: string;
  /** Valor já formatado (ex.: "R$ 734,5 mil"). `null` = sem dado. */
  valor: string | null;
  /** Ano de referência do dado, quando houver. */
  ano?: number | null;
}

/**
 * Popup flutuante que acompanha o cursor.
 *
 * - Renderizado em `position: fixed` para não depender do canvas do deck.gl.
 * - `pointer-events: none` para nunca interferir no picking do mapa.
 * - Reposiciona automaticamente quando encostaria nas bordas da viewport.
 */
export default function MapTooltip({
  x,
  y,
  nome,
  codigo,
  nivel,
  uf,
  capital = false,
  indicadores = [],
}: MapTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + OFFSET_X, top: y + OFFSET_Y });

  // Reposiciona após o layout para conhecer as dimensões reais do popup.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const { width, height } = el.getBoundingClientRect();
    const larguraViewport = window.innerWidth;
    const alturaViewport = window.innerHeight;

    let left = x + OFFSET_X;
    let top = y + OFFSET_Y;

    // Se estourar a direita, joga o popup para a esquerda do cursor.
    if (left + width + MARGEM_VIEWPORT > larguraViewport) {
      left = x - width - OFFSET_X;
    }
    // Se estourar embaixo, joga o popup para cima do cursor.
    if (top + height + MARGEM_VIEWPORT > alturaViewport) {
      top = y - height - OFFSET_Y;
    }

    // Garante que nunca saia da viewport.
    left = Math.max(MARGEM_VIEWPORT, Math.min(left, larguraViewport - width - MARGEM_VIEWPORT));
    top = Math.max(MARGEM_VIEWPORT, Math.min(top, alturaViewport - height - MARGEM_VIEWPORT));

    setPos({ left, top });
  }, [x, y, nome, codigo, nivel, uf, capital, indicadores]);

  const rotuloNivel = nivel === 'estado' ? 'Estado' : 'Município';

  return (
    <div ref={ref} style={{ ...estiloContainer, left: pos.left, top: pos.top }}>
      <div style={estiloCabecalho}>
        <span style={estiloNome}>{nome}</span>
        {capital && <span style={estiloBadgeCapital}>Capital</span>}
      </div>

      <div style={estiloLinha}>
        <span style={estiloRotulo}>{rotuloNivel}</span>
        {nivel === 'municipio' && uf && <span style={estiloUf}>{uf}</span>}
      </div>

      <div style={estiloCodigo}>{codigo}</div>

      {/*
        Indicadores da lente ativa. Quando o dado não existe, dizemos "sem dado"
        em vez de esconder a linha: ausência de dado é informação, e o município
        sem valor não deve parecer igual ao que tem valor zero.
      */}
      {indicadores.length > 0 && (
        <div style={estiloLista}>
          {indicadores.map((item) => (
            <div key={item.rotulo} style={estiloLinha}>
              <span style={estiloRotulo}>{item.rotulo}</span>
              <span style={item.valor === null ? estiloSemDado : estiloValor}>
                {item.valor ?? 'sem dado'}
                {item.valor !== null && item.ano ? (
                  <small style={estiloAno}>{item.ano}</small>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const estiloContainer: CSSProperties = {
  position: 'fixed',
  zIndex: 20,
  pointerEvents: 'none',
  minWidth: 168,
  padding: '10px 12px',
  borderRadius: 10,
  background: 'rgba(15, 23, 42, 0.92)',
  border: '1px solid rgba(56, 189, 248, 0.35)',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(56, 189, 248, 0.08)',
  backdropFilter: 'blur(6px)',
  color: '#e2e8f0',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSize: 12,
  lineHeight: 1.35,
  userSelect: 'none',
  transition: 'opacity 120ms ease-out',
};

const estiloCabecalho: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};

const estiloNome: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#f8fafc',
  letterSpacing: '0.01em',
};

const estiloBadgeCapital: CSSProperties = {
  padding: '1px 6px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#0f172a',
  background: '#fbbf24',
};

const estiloLinha: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginTop: 2,
};

const estiloRotulo: CSSProperties = {
  color: '#94a3b8',
  fontSize: 11,
};

const estiloUf: CSSProperties = {
  color: '#38bdf8',
  fontSize: 11,
  fontWeight: 600,
};

const estiloCodigo: CSSProperties = {
  color: '#cbd5e1',
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
};

/** Bloco dos indicadores, separado do cabeçalho por um fio. */
const estiloLista: CSSProperties = {
  marginTop: 6,
  paddingTop: 6,
  borderTop: '1px solid rgba(148, 163, 184, 0.22)',
};

/** Valor numérico — tabular para os dígitos alinharem entre linhas. */
const estiloValor: CSSProperties = {
  color: '#f1f5f9',
  fontSize: 12,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 4,
};

/** Ausência de dado: legível, mas visivelmente vazia. */
const estiloSemDado: CSSProperties = {
  color: '#64748b',
  fontSize: 11,
  fontStyle: 'italic',
};

const estiloAno: CSSProperties = {
  color: '#7c8fa6',
  fontSize: 10,
  fontWeight: 400,
};
