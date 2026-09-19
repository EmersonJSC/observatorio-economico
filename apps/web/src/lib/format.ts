/**
 * Formatadores de exibição (pt-BR) para os dados do observatório.
 */

const formatadorInteiro = new Intl.NumberFormat('pt-BR')
const formatadorMoeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
})

/** Número inteiro com separador de milhar (ex: 212.583.750). */
export function formatarInteiro(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—'
  return formatadorInteiro.format(valor)
}

/** Valor monetário completo em R$ (ex: R$ 34.488.924,21). */
export function formatarMoeda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—'
  return formatadorMoeda.format(valor)
}

/** Valor monetário compacto (ex: R$ 2,4 bi). */
export function formatarMoedaCompacta(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—'
  const abs = Math.abs(valor)
  const compacto = (divisor: number, sufixo: string) =>
    `R$ ${(valor / divisor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${sufixo}`
  if (abs >= 1e12) return compacto(1e12, 'tri')
  if (abs >= 1e9) return compacto(1e9, 'bi')
  if (abs >= 1e6) return compacto(1e6, 'mi')
  if (abs >= 1e3) return compacto(1e3, 'mil')
  return formatadorMoeda.format(valor)
}

/** Converte PIB expresso em "Mil Reais" para Reais. */
export function milReaisParaReais(milReais: number | null | undefined): number | null {
  if (milReais === null || milReais === undefined || !Number.isFinite(milReais)) return null
  return milReais * 1000
}

/** Percentual de `parte` sobre `total` (ex: 22,6%). */
export function formatarPercentual(
  parte: number | null | undefined,
  total: number | null | undefined,
): string {
  if (
    parte === null || parte === undefined ||
    total === null || total === undefined ||
    !Number.isFinite(parte) || !Number.isFinite(total) || total === 0
  ) {
    return '—'
  }
  return `${((parte / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

/** Iniciais de um nome (para avatar), no máximo 2 letras. */
export function iniciais(nome: string | null | undefined): string {
  if (!nome) return '?'
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  const primeira = partes[0]?.[0] ?? ''
  const segunda = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : ''
  return (primeira + segunda).toUpperCase()
}
