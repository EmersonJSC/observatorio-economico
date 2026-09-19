/**
 * Cores por partido político — usadas no gráfico de cadeiras e no mapa
 * "força política". As cores são escolhas visuais para leitura de dados
 * (não são as cores oficiais das legendas).
 */

const CORES_PARTIDOS: Record<string, string> = {
  PT: '#e53935',
  PL: '#1e88e5',
  'UNIÃO': '#fb8c00',
  PP: '#43a047',
  PSD: '#3949ab',
  MDB: '#00897b',
  REPUBLICANOS: '#00acc1',
  PSB: '#fdd835',
  PSDB: '#1565c0',
  PDT: '#c62828',
  PODE: '#8e24aa',
  AVANTE: '#f4511e',
  PRD: '#6d4c41',
  SOLIDARIEDADE: '#ffb300',
  PV: '#7cb342',
  PSOL: '#8e0000',
  NOVO: '#ec407a',
  CIDADANIA: '#5e35b1',
  'PC do B': '#d81b60',
  'PC DO B': '#d81b60',
  REDE: '#00695c',
  DC: '#78909c',
  UP: '#ad1457',
  MOBILIZA: '#c0ca33',
  PRTB: '#a1887f',
  PSTU: '#6a1b9a',
  PCB: '#4a0072',
  AGIR: '#90a4ae',
  PMB: '#546e7a',
  PCO: '#37474f',
  PATRIOTA: '#8d6e63',
  PROS: '#795548',
  PSC: '#00838f',
  PSL: '#283593',
  PPL: '#9e9e9e',
  PMN: '#5c6bc0',
  PTC: '#26a69a',
  PSDC: '#66bb6a',
  PRONA: '#ab47bc',
  'SD': '#ff7043',
  '—': '#607d8b',
}

/** Paleta de reserva para partidos não mapeados (siglas novas, etc.). */
const PALETA_RESERVA = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ffa726', '#ab47bc',
  '#26c6da', '#d4e157', '#8d6e63', '#ec407a', '#5c6bc0',
]

function paletaReserva(sigla: string): string {
  let soma = 0
  for (let i = 0; i < sigla.length; i++) soma += sigla.charCodeAt(i)
  return PALETA_RESERVA[soma % PALETA_RESERVA.length] ?? '#90a4ae'
}

/** Cor (hex) de um partido. */
export function corPartido(sigla: string | null | undefined): string {
  if (!sigla) return CORES_PARTIDOS['—'] as string
  return CORES_PARTIDOS[sigla] ?? CORES_PARTIDOS[sigla.toUpperCase()] ?? paletaReserva(sigla)
}

/** Cor do partido como [r, g, b] (para camadas do deck.gl). */
export function corPartidoRgb(sigla: string | null | undefined): [number, number, number] {
  const hex = corPartido(sigla).replace('#', '')
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ]
}
