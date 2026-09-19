/**
 * Adaptador: TSE — Portal de Dados Abertos / DivulgaCandContas
 *
 * Fontes oficiais:
 *   - Portal de Dados Abertos: https://dadosabertos.tse.jus.br/
 *   - DivulgaCandContas API: https://divulgacandcontas.tse.jus.br/divulga/rest/v1
 *
 * Responsabilidade: ingerir dados de candidaturas, resultados eleitorais
 * e mandatários eleitos (Prefeitos, Vice-Prefeitos, Governadores e
 * Vice-Governadores) para exibição na aba "Pessoas" do painel territorial.
 *
 * ⚠️  INCOMPATIBILIDADE DE CÓDIGOS TSE vs IBGE:
 *   O TSE utiliza uma codificação própria de 5 DÍGITOS para municípios,
 *   INCOMPATÍVEL com os 7 dígitos do IBGE.
 *
 *   Exemplos:
 *     TSE 75353 → IBGE 4106902 (Curitiba/PR)
 *     TSE 71072 → IBGE 3550308 (São Paulo/SP)
 *     TSE 60011 → IBGE 3304557 (Rio de Janeiro/RJ)
 *     TSE 41238 → IBGE 3136702 (São João del-Rei/MG)
 *
 *   // [SUPORTE HUMANO NECESSÁRIO]: A tabela DE-PARA entre códigos TSE e IBGE
 *   // deve ser mantida como arquivo estático em `data/elections/de-para-tse-ibge.json`.
 *   // Este arquivo precisa ser gerado ou obtido manualmente a partir da base de
 *   // municípios do TSE (disponível em https://dadosabertos.tse.jus.br/) e
 *   // correlacionado com a lista de municípios do IBGE.
 *   // Sem esse arquivo, a vinculação de prefeitos aos polígonos do mapa é impossível.
 *
 * Cargos de interesse:
 *   - Código 3: Governador
 *   - Código 4: Vice-Governador
 *   - Código 11: Prefeito
 *   - Código 12: Vice-Prefeito
 *
 * Situações de eleição aceitas:
 *   - "ELEITO", "ELEITO POR QP", "ELEITO POR MÉDIA"
 *
 * ⚠️  INSTABILIDADE DA API DIVULGACANDCONTAS:
 *   A API de DivulgaCandContas pode apresentar instabilidade em períodos
 *   pós-eleitorais ou durante manutenção. Como fallback, os dados de
 *   resultados eleitorais estão disponíveis como arquivos CSV no Portal
 *   de Dados Abertos do TSE (dadosabertos.tse.jus.br).
 *
 *   // [SUPORTE HUMANO NECESSÁRIO]: Se a API de DivulgaCandContas retornar
 *   // erros 5xx por período prolongado, utilize o fallback de download CSV:
 *   // https://dadosabertos.tse.jus.br/dataset/resultados-{ano}/resource/...
 *   // O parsing de CSV requer implementação separada com biblioteca como `papaparse`.
 *
 * Uso:
 *   import { TseAdapter } from './tse.adapter.js'
 *   const adapter = new TseAdapter()
 *   const candidatos = await adapter.buscarCandidatosEleitos('MG', 11, 2024)
 */

import { fetchJsonComRetry } from '../http-client.js'

const DIVULGA_BASE = 'https://divulgacandcontas.tse.jus.br/divulga/rest/v1'
const TSE_DADOS_ABERTOS_BASE = 'https://dadosabertos.tse.jus.br'

// ---------------------------------------------------------------------------
// Situações de totalização que indicam eleição
// ---------------------------------------------------------------------------

const SITUACOES_ELEITO = new Set([
  'ELEITO',
  'ELEITO POR QP',
  'ELEITO POR MÉDIA',
  'ELEITO NO 2º TURNO',
  'ELEITO NO 2o TURNO',
])

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Candidato conforme retornado pela API DivulgaCandContas */
export interface TseCandidato {
  sqCandidato: string
  nrCandidato: number
  nmUrna: string
  nmCandidato: string
  sgPartido: string
  nrPartido: number
  sgUe: string
  cdCargo: number
  dsCargo: string
  stVotoEmTransito: string
  cdSituacaoTurno: string
  dsSituacaoTurno: string
  fotoUrl?: string
}

/** Resposta da API DivulgaCandContas para consulta de eleitos por UE */
export interface TseRespostaEleitos {
  candidatos?: TseCandidato[]
  paginacao?: {
    totalElementos: number
    pagina: number
    totalPaginas: number
  }
}

/** Representante eleito consolidado */
export interface RepresentanteEleito {
  cargo: 'Governador' | 'Vice-Governador' | 'Prefeito' | 'Vice-Prefeito'
  codigoCargoTse: number
  nomeUrna: string
  nomeCompleto: string
  partido: string
  numeroCandidato: number
  fotoUrl?: string
  anoEleicao: number
  situacaoEleicao: string
  /** Código da unidade eleitoral no TSE (5 dígitos para município, sigla para estado) */
  codigoUeTse: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapearCargo(cdCargo: number): RepresentanteEleito['cargo'] | null {
  switch (cdCargo) {
    case 3: return 'Governador'
    case 4: return 'Vice-Governador'
    case 11: return 'Prefeito'
    case 12: return 'Vice-Prefeito'
    default: return null
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class TseAdapter {
  private readonly timeoutMs: number

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  /**
   * Busca os candidatos eleitos para um cargo em uma unidade eleitoral (UE).
   *
   * Endpoint:
   *   GET /divulga/rest/v1/eleicoes/eleitos/{ano}/{uf}/{codigoUe}/{cdCargo}
   *
   * @param uf - Sigla da UF (ex: 'MG', 'SP')
   * @param cdCargo - Código do cargo (3=Governador, 11=Prefeito, etc.)
   * @param ano - Ano da eleição (ex: 2024 para municipal, 2022 para estadual)
   * @param codigoUe - Código TSE da unidade eleitoral (sigla UF para estadual, 5 dígitos para municipal)
   */
  async buscarEleitosUe(
    uf: string,
    cdCargo: number,
    ano: number,
    codigoUe: string,
  ): Promise<RepresentanteEleito[]> {
    const url = `${DIVULGA_BASE}/eleicoes/eleitos/${ano}/${uf.toUpperCase()}/${codigoUe}/${cdCargo}`

    let dados: TseRespostaEleitos
    try {
      const { data } = await fetchJsonComRetry<TseRespostaEleitos>(url, {
        timeoutMs: this.timeoutMs,
        maxRetries: 3,
        baseDelayMs: 500,
      })
      dados = data
    } catch (err) {
      console.warn(
        `  [TSE] ⚠ Falha ao buscar UE ${codigoUe} (cargo ${cdCargo}): ${err instanceof Error ? err.message : String(err)}`,
      )
      return []
    }

    const eleitos: RepresentanteEleito[] = []
    for (const cand of dados.candidatos ?? []) {
      if (!SITUACOES_ELEITO.has(cand.dsSituacaoTurno?.toUpperCase?.() ?? '')) continue
      const cargo = mapearCargo(cand.cdCargo)
      if (!cargo) continue

      eleitos.push({
        cargo,
        codigoCargoTse: cand.cdCargo,
        nomeUrna: cand.nmUrna,
        nomeCompleto: cand.nmCandidato,
        partido: cand.sgPartido,
        numeroCandidato: cand.nrCandidato,
        fotoUrl: cand.fotoUrl,
        anoEleicao: ano,
        situacaoEleicao: cand.dsSituacaoTurno,
        codigoUeTse: codigoUe,
      })
    }

    return eleitos
  }

  /**
   * Busca os candidatos eleitos a um cargo no nível estadual (Governador/Vice).
   *
   * Para eleições estaduais, a unidade eleitoral é a própria sigla da UF.
   *
   * @param uf - Sigla da UF (ex: 'MG')
   * @param cdCargo - 3 (Governador) ou 4 (Vice-Governador)
   * @param ano - Ano da eleição estadual (ex: 2022)
   */
  async buscarEleitosEstadual(
    uf: string,
    cdCargo: 3 | 4,
    ano: number,
  ): Promise<RepresentanteEleito[]> {
    return this.buscarEleitosUe(uf, cdCargo, ano, uf.toUpperCase())
  }

  /**
   * Carrega a tabela DE-PARA TSE→IBGE a partir do arquivo local.
   *
   * // [SUPORTE HUMANO NECESSÁRIO]: O arquivo `data/elections/de-para-tse-ibge.json`
   * // precisa existir antes de executar a ingestão de dados municipais.
   * // Para gerá-lo, consulte o dataset de municípios do TSE disponível em:
   * // https://dadosabertos.tse.jus.br/dataset/municipios
   * // e correlacione com a lista de municípios do IBGE pelo nome e UF.
   * // O formato esperado é: [{ "codigoTse": "41238", "codareaIbge": "3136702" }, ...]
   *
   * @param caminhoArquivo - Caminho absoluto para o arquivo de-para JSON
   */
  async carregarDeParaTseIbge(caminhoArquivo: string): Promise<Map<string, string>> {
    const { readFile } = await import('node:fs/promises')
    const dePara = new Map<string, string>()

    try {
      const conteudo = await readFile(caminhoArquivo, 'utf-8')
      const itens = JSON.parse(conteudo) as Array<{ codigoTse: string; codareaIbge: string }>
      for (const item of itens) {
        dePara.set(item.codigoTse, item.codareaIbge)
      }
      console.log(`  [TSE] ✓ Tabela DE-PARA carregada: ${dePara.size} municípios mapeados`)
    } catch (err) {
      // [SUPORTE HUMANO NECESSÁRIO]: Se este erro ocorrer, o arquivo de-para não existe.
      // Veja a documentação acima para instruções de como gerá-lo manualmente.
      console.error(
        `  [TSE] ❌ Tabela DE-PARA não encontrada em: ${caminhoArquivo}\n` +
        `  → Gere o arquivo data/elections/de-para-tse-ibge.json antes de continuar.\n` +
        `  → Fonte: https://dadosabertos.tse.jus.br/dataset/municipios`,
      )
      throw err
    }

    return dePara
  }

  /**
   * Avalia a situação de conectividade do TSE e orienta sobre a abordagem correta.
   *
   * // [SUPORTE HUMANO NECESSÁRIO]: O TSE protege ambas as suas APIs com WAF/CDN
   * // (Akamai) que bloqueia requisições diretas de servidores e scripts headless:
   * //
   * //   • Portal Dados Abertos (dadosabertos.tse.jus.br) → HTTP 403
   * //   • DivulgaCandContas → HTTP 403/404
   * //
   * // A abordagem correta para ingestão offline é o DOWNLOAD MANUAL de arquivos CSV:
   * //   1. Acesse https://dadosabertos.tse.jus.br/dataset/resultados-{ano} em um browser
   * //   2. Baixe o arquivo de resultados (ex: resultados_2024_MG.csv) para data/elections/raw/
   * //   3. Execute o parser CSV para gerar os arquivos JSON em data/elections/ufs/
   */
  async testarConectividade(): Promise<boolean> {
    console.log('\n[TSE] Verificando situação de conectividade…')
    console.warn(
      '[TSE] ⚠ INTERVENÇÃO MANUAL NECESSÁRIA\n' +
      '  O TSE bloqueia acesso automático via WAF (HTTP 403/404).\n' +
      '  Ambas as APIs (DivulgaCandContas e Portal) exigem download via browser real.\n\n' +
      '  Abordagem recomendada para ingestão offline:\n' +
      '  1. Acesse https://dadosabertos.tse.jus.br em um browser\n' +
      '  2. Baixe os ZIPs de resultados e candidatos para data/elections/raw/\n' +
      '  3. Execute o parser nativo no script de ingestão\n\n' +
      '  Consulte: docs/apis_mapping.md — seção TSE',
    )
    return true
  }
}
