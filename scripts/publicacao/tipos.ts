/**
 * Caixa 7 — PUBLICAÇÃO: tipos.
 *
 * A Caixa 7 empacota o que as caixas anteriores produziram e emite os
 * artefatos estáticos que o navegador consome.
 *
 * Ela FAZ: selecionar, renomear para o contrato do frontend, achatar,
 * deduplicar aliases, dividir em blocos e comprimir.
 *
 * Ela NÃO FAZ: calcular indicador (Caixa 6), limpar/parsear (Caixa 4), cruzar
 * fontes (Caixa 5) nem decidir regra de negócio sobre validade do dado.
 *
 * Regra de desempate: se a decisão exige CALCULAR um valor novo, é Caixa 6.
 * Se exige escolher COMO APRESENTAR um valor que já existe, é Caixa 7.
 *
 * Referência: plano da Caixa 7.
 */

// ---------------------------------------------------------------------------
// Versão
// ---------------------------------------------------------------------------

/** Versão da Caixa 7, gravada no manifesto de publicação. */
export const VERSAO_PUBLICACAO = '1.0.0'

// ---------------------------------------------------------------------------
// Manifesto
// ---------------------------------------------------------------------------

/** Um artefato publicado. */
export interface ArtefatoPublicado {
  /** Caminho relativo a `data/published/`. */
  caminho: string
  /** Bytes do arquivo não comprimido. */
  bytes: number
  /** Bytes do arquivo `.gz`, quando gerado. */
  bytesGzip?: number
  /** Quantos registros o artefato carrega, quando aplicável. */
  registros?: number
}

/** Manifesto de uma publicação. */
export interface ManifestoPublicacao {
  versaoPublicacao: string
  publicadoEm: string
  /** Versões das camadas consumidas, para detectar publicação desatualizada. */
  origens: {
    organizada: string
    relacionada: string
    calculada: string
  }
  artefatos: readonly ArtefatoPublicado[]
  contagens: {
    municipios: number
    ufs: number
    blocos: number
    candidatos: number
  }
  totais: {
    bytes: number
    bytesGzip: number
  }
  avisos: readonly string[]
}

// ---------------------------------------------------------------------------
// Contrato de nomes
// ---------------------------------------------------------------------------

/**
 * Como um campo calculado aparece no payload publicado.
 *
 * O mapa existe porque a Caixa 6 usa nomes descritivos (`pibMilReais`,
 * `receitaTotal`) e o frontend usa nomes curtos e estáveis (`pib`, `receita`).
 * Centralizar a tradução aqui evita que cada formatador invente o seu.
 */
export interface MapeamentoCampo {
  /** Nome no dado calculado (Caixa 6). */
  origem: string
  /** Nome no payload publicado. */
  destino: string
}

// ---------------------------------------------------------------------------
// Formatos de saída
// ---------------------------------------------------------------------------

/** Entrada enxuta do índice de municípios (sem métricas). */
export interface MunicipioIndice {
  codarea: string
  nome: string
  uf: string
  lng: number
  lat: number
}

/** Métricas de um município no bloco. */
export interface MetricasMunicipio {
  populacao: number | null
  pib: number | null
  pibPerCapita: number | null
  densidade: number | null
  receita: number | null
  despesa: number | null
  saude: number | null
  educacao: number | null
  candidatos: number | null
  partidos: number | null
}

/** Registro completo de um município, como o frontend consome. */
export interface MunicipioPublicado extends MunicipioIndice {
  /** Ano de referência de cada métrica que tem ano próprio. */
  anos: {
    populacao: number | null
    pib: number | null
    orcamento: number | null
    eleicao: number | null
  }
  metricas: MetricasMunicipio
}

// ---------------------------------------------------------------------------
// Opções e resultado
// ---------------------------------------------------------------------------

/** Opções de publicação. */
export interface OpcoesPublicacao {
  /** Raiz do organizado. Padrão: `<projeto>/data/organized`. */
  raizOrganizada?: string
  /** Raiz da ponte. Padrão: `<projeto>/data/related`. */
  raizRelacionada?: string
  /** Raiz dos cálculos. Padrão: `<projeto>/data/calculated`. */
  raizCalculada?: string
  /** Raiz do RAW (para as malhas territoriais). Padrão: `<projeto>/data/raw`. */
  raizRaw?: string
  /** Raiz da saída. Padrão: `<projeto>/data/published`. */
  raizSaida?: string
  /** Municípios por bloco. Padrão: 500. */
  municipiosPorBloco?: number
  /** Gerar `.gz` ao lado de cada artefato. Padrão: true. */
  comprimir?: boolean
  /** Injetável para teste; padrão `new Date()`. */
  agora?: () => Date
}

/** Resultado de uma publicação. */
export interface ResultadoPublicacao {
  raiz: string
  artefatos: readonly ArtefatoPublicado[]
  totais: { bytes: number; bytesGzip: number }
  manifestoSaida: string
}

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/** Falha que impede a publicação. */
export class ErroPublicacao extends Error {
  constructor(
    message: string,
    readonly motivo: 'fonte-ausente' | 'contrato-invalido' | 'configuracao',
  ) {
    super(message)
    this.name = 'ErroPublicacao'
  }
}
