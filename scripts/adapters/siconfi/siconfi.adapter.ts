/**
 * Adaptador: Siconfi / Tesouro Nacional
 *
 * Fonte oficial: https://apidatalake.tesouro.gov.br/ords/siconfi/tt/
 * Documentação: https://apidatalake.tesouro.gov.br/ords/siconfi/tt/swagger-ui/index.html
 *
 * Responsabilidade: consultar dados de execução orçamentária e fiscal
 * de estados e municípios brasileiros via API pública do Siconfi
 * (Sistema de Informações Contábeis e Fiscais do Setor Público Brasileiro).
 *
 * ⚠️  CÓDIGO IBGE NO SICONFI:
 *   O endpoint `/dca` usa o código IBGE COMPLETO:
 *     - Municípios: 7 dígitos (com dígito verificador). Ex.: '1100205'.
 *     - Estados: 2 dígitos. Ex.: '31'.
 *   Ao armazenar localmente, SEMPRE use o código IBGE completo para
 *   compatibilidade com os mapas e indicadores.
 *
 * ⚠️  RATE LIMITING RIGOROSO:
 *   A API do Tesouro Nacional bloqueia IPs com muitas requisições simultâneas
 *   (HTTP 429). Use execução sequencial ou lotes pequenos (≤2 simultâneas).
 *   O delay padrão deste adaptador é 300ms entre requisições.
 *
 * Endpoints utilizados:
 *   - DCA (Declaração de Contas Anuais): /dca
 *   - RREO (Relatório Resumido de Execução Orçamentária): /rreo
 *
 * Filtros de conta para extração:
 *   - Receita Total: Anexo I-C, conta "Receitas Orçamentárias"
 *   - Despesa Total: Anexo I-D, conta "Despesas Liquidadas"
 *   - Saúde (Função 10) e Educação (Função 12): Anexo I-E (despesas por função)
 *
 * Uso:
 *   import { SiconfiAdapter } from './siconfi.adapter.js'
 *   const adapter = new SiconfiAdapter()
 *   const financas = await adapter.buscarFinancasEnte('31', 2023)       // Minas Gerais
 *   const municipio = await adapter.buscarFinancasEnte('3136702', 2023) // São João del-Rei
 */

import { fetchJsonComRetry, pausar } from '../http-client.js'

const BASE_URL = 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt'

// ---------------------------------------------------------------------------
// Constantes de filtragem do DCA
// ---------------------------------------------------------------------------

/**
 * Anexos do DCA relevantes para extração de receita/despesa/funções.
 *
 * ⚠️ O valor de `anexo` retornado pela API usa HÍFEN ("DCA-Anexo I-C"),
 *    não espaço ("DCA Anexo I-C").
 */
const DCA_ANEXO_RECEITA = 'DCA-Anexo I-C'
const DCA_ANEXO_DESPESA = 'DCA-Anexo I-D'
const DCA_ANEXO_FUNCOES = 'DCA-Anexo I-E'

/**
 * Colunas (métricas) dentro de cada anexo.
 *
 * O formato "wide" do DCA retorna, para cada conta, várias linhas — uma por
 * `coluna`. As colunas relevantes para este dataset são:
 *   - Receitas Brutas Realizadas  (anexo I-C)
 *   - Despesas Liquidadas         (anexos I-D e I-E)
 */
const COLUNA_RECEITA = 'Receitas Brutas Realizadas'
const COLUNA_DESPESA_LIQUIDADA = 'Despesas Liquidadas'

/** Códigos estáveis de conta (`cod_conta`) para os totais do DCA */
const COD_CONTA_RECEITA = 'ReceitasExcetoIntraOrcamentarias'
const COD_CONTA_DESPESA = 'TotalDespesas'

/** Funções de governo (Anexo I-E) — prefixo da coluna `conta` */
const FUNCAO_SAUDE = '10 - Saúde'
const FUNCAO_EDUCACAO = '12 - Educação'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Item retornado pela API DCA do Siconfi */
export interface SiconfiDcaItem {
  exercicio: number
  instituicao: string
  cod_ibge: number
  uf: string
  populacao: number
  anexo: string
  coluna: string
  rotulo: string
  /** Código estável da conta (ex: "ReceitasExcetoIntraOrcamentarias", "TotalDespesas") */
  cod_conta: string
  conta: string
  valor: number
}

/** Resposta envelopada da API Siconfi */
export interface SiconfiApiResponse<T> {
  items: T[]
  hasMore?: boolean
  limit?: number
  offset?: number
  count?: number
}

/** Métricas orçamentárias resumidas de um ente público */
export interface OrcamentoEnte {
  /** Código IBGE oficial (2 dígitos para estado, 7 dígitos para município) */
  codareaIbge: string
  /** Código de 6 dígitos utilizado nas consultas do Siconfi */
  siconfiId: string
  nome: string
  exercicio: number
  receitaTotal: number | null
  despesaTotal: number | null
  gastosPorArea: {
    saude: number | null
    educacao: number | null
  }
  fonte: string
  atualizadoEm: string
}

// ---------------------------------------------------------------------------
// Utilitários de conversão
// ---------------------------------------------------------------------------

/**
 * Normaliza o código IBGE para uso no parâmetro `id_ente` do Siconfi.
 *
 * ⚠️ VALIDADO EMPIRICAMENTE (não confiar na documentação antiga):
 *    O endpoint `/dca` do Siconfi espera o código IBGE COMPLETO:
 *      - Municípios: 7 dígitos (com o dígito verificador). Ex.: '1100205'.
 *        Passar apenas 6 dígitos ('110020') retorna `count: 0`.
 *      - Estados: 2 dígitos. Ex.: '31'.
 *    Portanto, NÃO removemos o dígito verificador final.
 */
export function ibgeParaSiconfi(codareaIbge: string): string {
  return codareaIbge
}

/**
 * Soma os valores dos itens que satisfazem o predicado.
 * Retorna `null` quando nenhum item casa (dado não declarado), distinguindo
 * "sem dado" de "total zero".
 */
function somarValor(
  itens: SiconfiDcaItem[],
  predicado: (i: SiconfiDcaItem) => boolean,
): number | null {
  const casados = itens.filter(predicado)
  if (casados.length === 0) return null
  return casados.reduce((acc, i) => acc + i.valor, 0)
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class SiconfiAdapter {
  private readonly delayMs: number
  private readonly timeoutMs: number

  constructor(options: { delayMs?: number; timeoutMs?: number } = {}) {
    this.delayMs = options.delayMs ?? 300
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  /**
   * Baixa a DCA (Declaração de Contas Anuais) completa de um ente público.
   *
   * Endpoint: GET /dca?an_exercicio={exercicio}&id_ente={siconfiId}
   *
   * @param siconfiId - Código de 6 dígitos (municípios) ou 2 dígitos (estados)
   */
  private async buscarDca(siconfiId: string, exercicio: number): Promise<SiconfiDcaItem[]> {
    const url = `${BASE_URL}/dca?an_exercicio=${exercicio}&id_ente=${siconfiId}`

    const { data } = await fetchJsonComRetry<SiconfiApiResponse<SiconfiDcaItem>>(url, {
      timeoutMs: this.timeoutMs,
      maxRetries: 4,
      baseDelayMs: 600,
    })

    return data.items ?? []
  }

  /**
   * Extrai e consolida as métricas orçamentárias de um ente público a partir
   * dos dados brutos do DCA.
   *
   * A lógica de filtro segue os anexos e rótulos oficiais do DCA:
   *   - Anexo I-C: Receitas Orçamentárias
   *   - Anexo I-D: Despesas Liquidadas
   *   - Anexo I-E: Despesas por Função de Governo (Saúde = Função 10, Educação = Função 12)
   *
   * @param codareaIbge - Código IBGE original (2 ou 7 dígitos) para armazenamento
   */
  async buscarFinancasEnte(codareaIbge: string, exercicio: number): Promise<OrcamentoEnte | null> {
    await pausar(this.delayMs)

    const siconfiId = ibgeParaSiconfi(codareaIbge)
    console.log(
      `  [Siconfi] → Buscando DCA ${exercicio} — IBGE: ${codareaIbge} / Siconfi: ${siconfiId}`,
    )

    let itens: SiconfiDcaItem[]
    try {
      itens = await this.buscarDca(siconfiId, exercicio)
    } catch (err) {
      console.warn(
        `  [Siconfi] ⚠ Falha ao buscar ente ${codareaIbge}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }

    if (itens.length === 0) {
      console.warn(
        `  [Siconfi] ⚠ Nenhum dado DCA retornado para ${codareaIbge} no exercício ${exercicio}. ` +
        'O ente pode não ter declarado dados ou o exercício ainda não está consolidado.',
      )
      return null
    }

    const nome = itens[0]?.instituicao ?? codareaIbge

    // Receita total: Anexo I-C, conta "ReceitasExcetoIntraOrcamentarias"
    const receitaTotal = somarValor(
      itens,
      (i) =>
        i.anexo === DCA_ANEXO_RECEITA &&
        i.cod_conta === COD_CONTA_RECEITA &&
        i.coluna === COLUNA_RECEITA,
    )

    // Despesa total liquidada: Anexo I-D, conta "TotalDespesas"
    const despesaTotal = somarValor(
      itens,
      (i) =>
        i.anexo === DCA_ANEXO_DESPESA &&
        i.cod_conta === COD_CONTA_DESPESA &&
        i.coluna === COLUNA_DESPESA_LIQUIDADA,
    )

    // Saúde (Função 10): Anexo I-E, conta "10 - Saúde"
    const gastoSaude = somarValor(
      itens,
      (i) =>
        i.anexo === DCA_ANEXO_FUNCOES &&
        (i.conta ?? '').startsWith(FUNCAO_SAUDE) &&
        i.coluna === COLUNA_DESPESA_LIQUIDADA,
    )

    // Educação (Função 12): Anexo I-E, conta "12 - Educação"
    const gastoEducacao = somarValor(
      itens,
      (i) =>
        i.anexo === DCA_ANEXO_FUNCOES &&
        (i.conta ?? '').startsWith(FUNCAO_EDUCACAO) &&
        i.coluna === COLUNA_DESPESA_LIQUIDADA,
    )

    return {
      codareaIbge,
      siconfiId,
      nome,
      exercicio,
      receitaTotal,
      despesaTotal,
      gastosPorArea: {
        saude: gastoSaude,
        educacao: gastoEducacao,
      },
      fonte: 'Secretaria do Tesouro Nacional — Siconfi (DCA)',
      atualizadoEm: new Date().toISOString(),
    }
  }

  /**
   * Processa múltiplos entes em lotes controlados, respeitando o rate limit.
   *
   * @param codareias - Lista de códigos IBGE (2 ou 7 dígitos)
   * @param exercicio - Ano do exercício contábil
   * @param concurrency - Máximo de requisições simultâneas (recomendado: ≤2)
   */
  async processarEmLote(
    codareias: string[],
    exercicio: number,
    concurrency: number = 2,
  ): Promise<OrcamentoEnte[]> {
    const resultados: OrcamentoEnte[] = []

    for (let i = 0; i < codareias.length; i += concurrency) {
      const lote = codareias.slice(i, i + concurrency)
      const promessas = lote.map((codarea) => this.buscarFinancasEnte(codarea, exercicio))
      const loteResultados = await Promise.all(promessas)

      for (const resultado of loteResultados) {
        if (resultado !== null) resultados.push(resultado)
      }
    }

    return resultados
  }

  /**
   * Valida a conectividade com a API do Siconfi (Tesouro Nacional).
   * Busca a DCA do estado de Minas Gerais como teste representativo.
   *
   * Código Siconfi de MG: '31' (igual ao IBGE para estados).
   */
  async testarConectividade(): Promise<boolean> {
    console.log('\n[Siconfi] Testando conectividade…')
    try {
      // Teste com Minas Gerais (código IBGE/Siconfi: 31) — Estado seguro para testar
      const url = `${BASE_URL}/dca?an_exercicio=2023&id_ente=31&limit=5`
      const { data, durationMs } = await fetchJsonComRetry<SiconfiApiResponse<SiconfiDcaItem>>(
        url,
        { timeoutMs: this.timeoutMs, maxRetries: 3 },
      )

      const total = data.count ?? data.items?.length ?? 0
      const primeiroItem = data.items?.[0]

      console.log(`[Siconfi] ✅ OK — Resposta em ${durationMs}ms`)
      console.log(`[Siconfi]    Ente: ${primeiroItem?.instituicao ?? 'MG'} | Exercício: 2023`)
      console.log(`[Siconfi]    Total de registros DCA: ${total}`)
      return true
    } catch (err) {
      console.error(`[Siconfi] ❌ Falha: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }
}
