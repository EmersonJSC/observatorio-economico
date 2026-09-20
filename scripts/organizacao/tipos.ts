/**
 * Caixa 4 — ORGANIZAÇÃO: tipos.
 *
 * A Caixa 4 lê o RAW (Caixa 3), aplica o tradutor da fonte e emite registros
 * de domínio limpos. Ela opera NO NÍVEL DA LINHA: interpreta, valida, tipa e
 * renomeia.
 *
 * O que ela NÃO faz:
 *   - joins entre fontes          → RELACIONAMENTOS
 *   - cálculo de indicador        → CÁLCULOS
 *   - escrita em `data/<área>/`   → PUBLICAÇÃO
 *   - cruzamento de identificadores (DE-PARA) → RELACIONAMENTOS
 *
 * Fronteira de desempate: se a decisão exige OUTRA fonte ou ARITMÉTICA
 * derivada, não é da Caixa 4. Se exige apenas interpretar a linha atual, é.
 *
 * Referência: plano da Caixa 4 (auditoria P1–P6).
 */

// ---------------------------------------------------------------------------
// Versão
// ---------------------------------------------------------------------------

/** Versão da Caixa 4, gravada nos metadados de cada organização. */
export const VERSAO_ORGANIZACAO = '1.0.0'

// ---------------------------------------------------------------------------
// Conversores de campo
// ---------------------------------------------------------------------------

/** Como um campo da origem é convertido para o domínio. */
export type TipoCampo =
  | 'texto' // string limpa (trim); vazio → null
  | 'inteiro' // número inteiro
  | 'decimal' // número com casas decimais
  | 'codigo' // identificador: sempre string, zeros à esquerda preservados
  | 'booleano' // aceita true/false e "S"/"N"/"1"/"0"
  | 'data' // ISO 8601 (YYYY-MM-DD)

/** Um campo mapeado de origem → destino. */
export interface CampoMapeado {
  /** Caminho do valor na origem. Aceita `a.b.c` para objetos aninhados. */
  origem: string
  /** Nome do campo no registro organizado. */
  destino: string
  /** Conversão aplicada. */
  tipo: TipoCampo
  /**
   * Campo obrigatório: a AUSÊNCIA DA COLUNA na origem aborta a organização
   * inteira (não apenas a linha). Protege contra renomeação silenciosa no
   * layout do governo — o problema P2 da auditoria.
   */
  obrigatorio: boolean
  /** Texto de apoio para a mensagem de erro. */
  descricao?: string
  /**
   * Valores da origem que significam ausência legítima (ex.: `-`, `...`, `X`
   * do IBGE). São convertidos para `null` sem contar como erro.
   */
  nulosConhecidos?: readonly string[]
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

/** O que aconteceu ao validar uma linha. */
export type ResultadoValidacao =
  | { ok: true }
  | { ok: false; motivo: MotivoRejeicao; detalhe: string }

/** Por que uma linha foi rejeitada (vai para a quarentena). */
export type MotivoRejeicao =
  | 'campo-obrigatorio-ausente'
  | 'tipo-invalido'
  | 'valor-fora-do-dominio'
  | 'registro-malformado'
  | 'erro-no-tradutor'

/** Uma linha rejeitada, preservada para diagnóstico. */
export interface LinhaQuarentena {
  /** Posição da linha na origem (1-based), quando conhecida. */
  linha: number
  motivo: MotivoRejeicao
  detalhe: string
  /** Registro bruto original, para reproduzir o problema. */
  bruto: unknown
  /** Objeto do RAW de onde veio. */
  origem: string
}

// ---------------------------------------------------------------------------
// Registro e resultado
// ---------------------------------------------------------------------------

/**
 * Um registro de domínio já limpo e tipado.
 *
 * Os valores possíveis espelham `TipoCampo`. `null` significa ausência
 * legítima — nunca string vazia, nunca `NaN`.
 */
export type RegistroOrganizado = Readonly<Record<string, string | number | boolean | null>>

/** Contadores de uma organização. */
export interface ContagensOrganizacao {
  /** Linhas lidas da origem (antes de qualquer validação). */
  lidas: number
  /** Linhas gravadas no JSONL de saída. */
  gravadas: number
  /** Linhas enviadas para a quarentena. */
  quarentenadas: number
}

/** Metadados gravados em `<recursoId>.meta.json` ao final. */
export interface MetadadosOrganizacao {
  fonteId: string
  recursoId: string
  versaoOrganizacao: string
  versaoEsquema: number
  /** Quando a organização rodou (ISO 8601). */
  organizadoEm: string
  /** Hashes dos objetos do RAW que alimentaram esta saída. */
  origensRaw: readonly string[]
  /** Quantidade de objetos do RAW lidos. */
  objetosRaw: number
  contagens: ContagensOrganizacao
  /** Avisos não fatais (campos opcionais ausentes, etc.). */
  avisos: readonly string[]
}

// ---------------------------------------------------------------------------
// Contrato do tradutor
// ---------------------------------------------------------------------------

/** Como ler o conteúdo bruto do RAW. */
export type FormaLettura =
  | { tipo: 'json-colecao' } // array JSON na raiz
  | { tipo: 'json-envelope'; caminho: string } // array dentro de um envelope
  | { tipo: 'json-objeto' } // objeto único na raiz
  | { tipo: 'zip-csv'; arquivo: string; separador: string; encoding: string }

/** Tradutor de uma fonte/recurso: o contrato que a Caixa 4 consome. */
export interface Tradutor {
  fonteId: string
  recursoId: string
  /** Versão do esquema: incrementar quando o mapeamento mudar. */
  versaoEsquema: number
  /** Como interpretar o corpo do RAW. */
  leitura: FormaLettura
  /** Campos mapeados de origem → destino. */
  campos: readonly CampoMapeado[]
  /**
   * Validação adicional de negócio do registro BRUTO, antes da conversão.
   * Opcional: a validação de tipo/obrigatoriedade já é feita pelo núcleo.
   */
  validar?: (bruto: unknown) => ResultadoValidacao
  /**
   * Expande UM registro bruto em VÁRIOS registros brutos.
   *
   * Existe porque algumas fontes aninham coleções dentro do registro: a API de
   * Agregados do IBGE (SIDRA) devolve `resultados[].series[]`, em que cada
   * série é uma localidade com um dicionário de anos. Um registro na origem
   * produz N linhas na saída.
   *
   * O núcleo chama `desmembrar` ANTES de validar e converter, e trata cada
   * item devolvido como um registro independente.
   */
  desmembrar?: (bruto: unknown) => unknown[]
  /**
   * Ajustes finais no registro já convertido, quando a fonte exige algo que
   * não cabe em `campos` (ex.: achatar um objeto aninhado).
   */
  refinar?: (
    convertido: Record<string, string | number | boolean | null>,
    bruto: unknown,
  ) => Record<string, string | number | boolean | null>
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

/** Resultado de organizar um recurso. */
export interface ResultadoOrganizacao {
  fonteId: string
  recursoId: string
  /** Caminho do JSONL gravado, relativo à raiz do projeto. */
  saida: string
  /** Caminho da quarentena, quando houve alguma linha rejeitada. */
  quarentena?: string
  contagens: ContagensOrganizacao
  metadados: MetadadosOrganizacao
}

/** Falha que ABORTA a organização de um recurso. */
export class ErroOrganizacao extends Error {
  constructor(
    message: string,
    readonly fonteId: string,
    readonly recursoId: string,
    readonly motivo: MotivoRejeicao | 'limiar-quarentena' | 'raw-ausente' | 'tradutor-ausente',
  ) {
    super(message)
    this.name = 'ErroOrganizacao'
  }
}

// ---------------------------------------------------------------------------
// Opções
// ---------------------------------------------------------------------------

/** Opções de execução da organização. */
export interface OpcoesOrganizacao {
  /** Raiz do RAW. Padrão: `<projeto>/data/raw`. */
  raizRaw?: string
  /** Raiz da saída. Padrão: `<projeto>/data/organized`. */
  raizSaida?: string
  /**
   * Fração máxima de linhas em quarentena antes de abortar.
   * Padrão: 0.01 (1%), conforme diretriz aprovada.
   */
  limiarQuarentena?: number
  /** Injetável para teste; padrão `new Date()`. */
  agora?: () => Date
  /** Processa apenas estes objetos do RAW (teste). */
  limiteObjetos?: number
}
