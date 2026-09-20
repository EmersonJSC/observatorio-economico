/**
 * Caixa 1 — FONTES: tipos.
 *
 * A Caixa 1 é DECLARATIVA. Ela descreve de onde os dados vêm, quais recursos
 * podem ser coletados, como cada recurso é acessado e quais restrições
 * externas existem.
 *
 * Ela NÃO executa requisições, NÃO baixa arquivos, NÃO interpreta respostas,
 * NÃO transforma dados, NÃO cria relacionamentos, NÃO calcula indicadores,
 * NÃO grava RAW e NÃO altera o frontend.
 *
 * Fronteira:
 *   FONTE   = provedor/órgão + seus recursos      (este arquivo descreve)
 *   RECURSO = unidade coletável dentro da fonte   (este arquivo descreve)
 *   COLETOR = mecanismo que executa a coleta      (fora da Caixa 1)
 *   RAW     = conteúdo original coletado          (fora da Caixa 1)
 *
 * Referências: docs/AUDITORIA_CAIXA_1_FONTES.md e docs/PLANO_CAIXA_1_FONTES.md.
 */

// ---------------------------------------------------------------------------
// Vocabulários fechados
// ---------------------------------------------------------------------------

/** Natureza do provedor. */
export type TipoFonte =
  | 'api-rest'
  | 'api-sql'
  | 'arquivo-zip'
  | 'portal'

/**
 * Como o recurso é acessado.
 *
 * Diferença de transporte NÃO cria uma fonte nova: o TSE é uma única fonte com
 * recursos de transportes diferentes (`browser-download`, `http-json`, `manual`).
 */
export type Transporte =
  | 'http-json'
  | 'http-geojson'
  | 'bigquery-sql'
  | 'browser-download'
  | 'manual'

/** Se o recurso é exercitado hoje pelo projeto ou apenas conhecido/documentado. */
export type StatusRecurso = 'usado' | 'nao-usado'

/** Papel da fonte no pipeline: primária, alternativa, foto ou só documentação. */
export type PapelFonte =
  | 'primaria'
  | 'fallback'
  | 'somente-foto'
  | 'somente-documentacao'

/** Estratégia de paginação que a fonte oferece. */
export type Paginacao =
  | 'nenhuma'
  | 'pagina-numerada'
  | 'link-next'
  | 'envelope-offset'

/** Frequência com que a fonte publica o recurso. */
export type Periodicidade = 'anual' | 'mensal' | 'eventual' | 'unica-vigente'

/** Formato do conteúdo recebido (usado pela ORGANIZAÇÃO, apenas declarado aqui). */
export type Formato = 'json' | 'json-envelope' | 'geojson' | 'zip-csv' | 'imagem'

// ---------------------------------------------------------------------------
// Blocos reutilizáveis
// ---------------------------------------------------------------------------

/**
 * Credencial exigida pela fonte.
 *
 * Guarda SOMENTE o nome da variável de ambiente e onde ela é enviada.
 * O valor nunca entra no catálogo.
 */
export interface Credencial {
  /** Nome da variável de ambiente (ex.: 'PORTAL_API_KEY'). Nunca o valor. */
  env: string
  /** Header HTTP que recebe a credencial, quando aplicável. */
  header?: string
  /** Forma de envio, quando não é header simples. */
  esquema?: string
  /** Onde obter a credencial. */
  comoObter?: string
}

/**
 * Parâmetro aceito pelo recurso.
 *
 * O recurso representa a OPERAÇÃO; o conjunto de parâmetros representa o
 * fan-out da coleta. Ex.: o DCA do Siconfi é UM recurso com o parâmetro
 * `id_ente`, e não um recurso por município.
 */
export interface Parametro {
  /** Nome exato do parâmetro na fonte. */
  nome: string
  /** Para que serve. */
  descricao: string
  /** Se a fonte exige o parâmetro. */
  obrigatorio: boolean
  /**
   * Dimensão do fan-out, quando o parâmetro é repetido em várias chamadas.
   * Ex.: 'ente', 'uf', 'ano'. Ausente quando é um valor único.
   */
  dimensao?: string
  /** Exemplo de valor. */
  exemplo?: string
  /** Domínio de valores conhecidos, quando fechado. */
  valores?: readonly string[]
}

/** Restrição real imposta pela fonte. O coletor decide como obedecê-la. */
export interface RateLimit {
  /** Severidade declarada pela fonte ou observada. */
  nivel: 'desconhecido' | 'brando' | 'moderado' | 'critico'
  /** Limite numérico documentado, quando existe. */
  limite?: string
  /** Consequência de exceder. */
  consequencia?: string
  /** Observação factual (sem estratégia de execução). */
  observacao?: string
}

/**
 * Recorte temporal do recurso.
 *
 * `historico: true` quando a fonte publica série por período (SIDRA por ano,
 * DCA por exercício). `historico: false` quando o recurso é um retrato vigente
 * (malha territorial).
 */
export interface RecorteTemporal {
  /** Dimensão do recorte. */
  tipo: 'ano' | 'exercicio' | 'mes-ano' | 'vigente' | 'evento'
  /** Se a fonte permite recuperar períodos anteriores. */
  historico: boolean
  /** Formato do valor, quando aplicável (ex.: 'MM/AAAA'). */
  formato?: string
  /** Observação factual. */
  observacao?: string
}

/**
 * Identificador usado PELA FONTE.
 *
 * Registra apenas "a fonte usa X". A correspondência "X equivale a Y" é
 * RELACIONAMENTOS e não pertence à Caixa 1.
 */
export interface Identificador {
  /** Nome do campo/identificador na fonte. */
  nome: string
  /** O que ele identifica. */
  descricao: string
  /** Forma do valor (ex.: '7 dígitos', 'string'). */
  formato?: string
  /** Se identifica uma entidade territorial. */
  territorial?: boolean
  /** Observação factual (ex.: divergência de dígitos entre docs e prática). */
  observacao?: string
}

// ---------------------------------------------------------------------------
// Recurso
// ---------------------------------------------------------------------------

/** Unidade coletável dentro de uma fonte. */
export interface Recurso {
  /** Chave estável dentro da fonte. */
  id: string
  /** Para que serve, em uma frase. */
  finalidade: string
  /** Se o projeto já o utiliza. */
  status: StatusRecurso
  /** Como o recurso é acessado. */
  transporte: Transporte
  /** Método HTTP. Ausente quando o transporte não é HTTP. */
  metodo?: 'GET' | 'POST'
  /**
   * URL base DESTE recurso. Sobrescreve a `baseUrl` da fonte quando o
   * provedor serve recursos em hosts diferentes.
   *
   * O TSE é o caso real: o portal fica em `dadosabertos.tse.jus.br`, os
   * arquivos em `cdn.tse.jus.br` e a API de candidatos/fotos em
   * `divulgacandcontas.tse.jus.br`. A URL base, nesses casos, é atributo do
   * recurso, não do provedor. Ausente quando a `baseUrl` da fonte já serve.
   */
  baseUrl?: string
  /**
   * Caminho relativo à URL base efetiva do recurso, com placeholders entre
   * chaves. Ex.: '/dca', '/{tabela}/periodos/{ano}/variaveis/{variavel}'.
   */
  caminho: string
  /** Parâmetros aceitos. Ausente quando o recurso não aceita parâmetro. */
  parametros?: readonly Parametro[]
  /** Formato do conteúdo recebido. */
  formato: Formato
  /** Frequência de publicação pela fonte. */
  periodicidade: Periodicidade
  /** Recorte temporal. */
  recorteTemporal: RecorteTemporal
  /** Identificadores que a fonte usa neste recurso. */
  identificadores: readonly Identificador[]
  /** Estratégia de paginação oferecida pela fonte. */
  paginacao: Paginacao
  /** Restrição de taxa. */
  rateLimit: RateLimit
  /** Fatos declarativos que o coletor precisa respeitar. Sem código de parsing. */
  peculiaridades?: readonly string[]
  /** Observações factuais, divergências conhecidas, pendências. */
  observacoes?: readonly string[]
  /**
   * Onde o pipeline atual grava este recurso.
   *
   * TRANSITÓRIO — existe apenas para orientar a migração para RAW/ORGANIZAÇÃO
   * e não deve ser usado como definição arquitetural de nada.
   */
  salvoHojeEm?: readonly string[]
}

// ---------------------------------------------------------------------------
// Fonte
// ---------------------------------------------------------------------------

/** Provedor/órgão publicador e o conjunto de recursos que ele oferece. */
export interface Fonte {
  /** Chave estável da fonte. */
  id: string
  /** Rótulo legível. */
  nome: string
  /** Órgão/provedor responsável. */
  orgao: string
  /** Natureza do provedor. */
  tipo: TipoFonte
  /**
   * URL base PADRÃO dos recursos desta fonte. Um recurso pode sobrescrevê-la
   * com a sua própria `baseUrl` quando o provedor serve em hosts diferentes.
   * Ausente em fonte sem endpoint (portal/manual).
   */
  baseUrl?: string
  /** URL da documentação oficial. */
  documentacao: string
  /** Credencial exigida, quando houver. Somente o nome da variável. */
  credencial?: Credencial
  /** Papel no pipeline. */
  papel: PapelFonte
  /** Recursos da fonte. */
  recursos: readonly Recurso[]
}

// ---------------------------------------------------------------------------
// Metadado declarativo do TSE (ID_ELEICAO)
// ---------------------------------------------------------------------------

/**
 * Identificador da eleição no DivulgaCandContas, por ano.
 *
 * Hoje este mapa está duplicado em `apps/web/src/features/elections/electionsApi.ts`
 * e em `apps/api/src/modules/elections/foto-candidato.ts`. O catálogo é o lugar
 * natural para centralizá-lo. Nesta etapa o frontend e a API NÃO o consomem.
 */
export const TSE_ID_ELEICAO: Readonly<Record<number, number>> = {
  2020: 2030402020,
  2022: 2040602022,
  2024: 2045202024,
  2026: 20322002026,
}
