/**
 * Caixa 4 — tradutor de `tse/cdn-dados-abertos` (consulta_cand).
 *
 * Traduz o CSV de candidaturas do TSE: nomes de coluna em MAIÚSCULAS do
 * legado → chaves limpas em camelCase. Colunas não mapeadas são ignoradas —
 * o CSV tem mais de 50 colunas e o projeto usa um subconjunto.
 *
 * Formato real do arquivo (verificado no RAW do projeto):
 *   - ZIP nacional com um CSV por UF + `consulta_cand_2024_BRASIL.csv`
 *   - separador `;`, campos entre aspas duplas
 *   - encoding latin1
 *   - valores sujos: `#NULO` (nulo) e `#NE` (não especificado)
 *
 * Escopo estrito da Caixa 4: limpar, tipar e renomear. NÃO há aqui:
 *   - cálculo de mandato ou período (CÁLCULOS)
 *   - junção com o código IBGE de município (RELACIONAMENTOS)
 */

import type { CampoMapeado, Tradutor } from '../tipos.js'

/** Marcadores de ausência usados pelo TSE no CSV. */
const NULOS_TSE = ['#NULO', '#NE', 'NULO', 'NE'] as const

/** Campos que carregam os marcadores de ausência com mais frequência. */
const camposComNulo = { nulosConhecidos: NULOS_TSE } as const

/**
 * Colunas essenciais do `consulta_cand`.
 *
 * `SG_UE` é a unidade eleitoral: código de 5 dígitos para município ou sigla
 * da UF. Guardamos os dois (`ufSigla` e `unidadeEleitoral`) porque converter
 * um no outro é RELACIONAMENTOS — aqui apenas preservamos o que a fonte diz.
 */
const CAMPOS: readonly CampoMapeado[] = [
  // --- identificação da eleição ---
  {
    origem: 'ANO_ELEICAO',
    destino: 'anoEleicao',
    tipo: 'inteiro',
    obrigatorio: true,
    descricao: 'Ano da eleição',
  },
  {
    origem: 'NR_TURNO',
    destino: 'turno',
    tipo: 'inteiro',
    obrigatorio: false,
    descricao: 'Turno da eleição',
  },
  {
    origem: 'NM_TIPO_ELEICAO',
    destino: 'tipoEleicao',
    tipo: 'texto',
    obrigatorio: false,
    ...camposComNulo,
  },

  // --- localização ---
  {
    origem: 'SG_UF',
    destino: 'ufSigla',
    tipo: 'texto',
    obrigatorio: true,
    descricao: 'Sigla da UF',
  },
  {
    origem: 'SG_UE',
    destino: 'unidadeEleitoral',
    tipo: 'codigo',
    obrigatorio: true,
    descricao: 'Código TSE da unidade eleitoral (5 dígitos) ou sigla da UF',
  },
  {
    origem: 'NM_UE',
    destino: 'nomeUnidadeEleitoral',
    tipo: 'texto',
    obrigatorio: false,
    ...camposComNulo,
  },

  // --- cargo ---
  {
    origem: 'CD_CARGO',
    destino: 'codigoCargo',
    tipo: 'inteiro',
    obrigatorio: true,
    descricao: 'Código do cargo no TSE',
  },
  {
    origem: 'DS_CARGO',
    destino: 'cargo',
    tipo: 'texto',
    obrigatorio: true,
    descricao: 'Nome do cargo',
  },

  // --- candidato ---
  {
    origem: 'SQ_CANDIDATO',
    destino: 'sequencialCandidato',
    tipo: 'codigo',
    obrigatorio: true,
    descricao: 'Sequencial único do candidato no TSE',
  },
  {
    origem: 'NR_CANDIDATO',
    destino: 'numeroCandidato',
    tipo: 'inteiro',
    obrigatorio: false,
    descricao: 'Número na urna',
  },
  {
    origem: 'NM_CANDIDATO',
    destino: 'nomeCompleto',
    tipo: 'texto',
    obrigatorio: true,
    descricao: 'Nome civil do candidato',
  },
  {
    origem: 'NM_URNA_CANDIDATO',
    destino: 'nomeUrna',
    tipo: 'texto',
    obrigatorio: false,
    ...camposComNulo,
  },
  {
    origem: 'NR_CPF_CANDIDATO',
    destino: 'cpf',
    tipo: 'codigo',
    obrigatorio: false,
    ...camposComNulo,
  },

  // --- situação ---
  {
    origem: 'DS_SITUACAO_CANDIDATURA',
    destino: 'situacaoCandidatura',
    tipo: 'texto',
    obrigatorio: false,
    descricao: 'Status cadastral (APTO, DEFERIDO, …)',
    ...camposComNulo,
  },
  {
    origem: 'DS_SIT_TOT_TURNO',
    destino: 'situacaoTotalizacao',
    tipo: 'texto',
    obrigatorio: false,
    descricao: 'Resultado eleitoral (ELEITO, NÃO ELEITO, …)',
    ...camposComNulo,
  },

  // --- partido ---
  {
    origem: 'NR_PARTIDO',
    destino: 'numeroPartido',
    tipo: 'inteiro',
    obrigatorio: false,
  },
  {
    origem: 'SG_PARTIDO',
    destino: 'partidoSigla',
    tipo: 'texto',
    obrigatorio: false,
    ...camposComNulo,
  },
  {
    origem: 'NM_PARTIDO',
    destino: 'partidoNome',
    tipo: 'texto',
    obrigatorio: false,
    ...camposComNulo,
  },

  // --- perfil (útil para enriquecimento futuro, sem cálculo aqui) ---
  {
    origem: 'DS_GENERO',
    destino: 'genero',
    tipo: 'texto',
    obrigatorio: false,
    ...camposComNulo,
  },
  {
    origem: 'DS_GRAU_INSTRUCAO',
    destino: 'grauInstrucao',
    tipo: 'texto',
    obrigatorio: false,
    ...camposComNulo,
  },
  {
    origem: 'DS_OCUPACAO',
    destino: 'ocupacao',
    tipo: 'texto',
    obrigatorio: false,
    ...camposComNulo,
  },
  {
    origem: 'DT_NASCIMENTO',
    destino: 'dataNascimento',
    tipo: 'texto',
    obrigatorio: false,
    descricao: 'Data no formato DD/MM/AAAA (mantida como texto: o tipo `data` exige ISO)',
    ...camposComNulo,
  },
]

/**
 * Tradutor do CSV de candidaturas.
 *
 * O recurso é `cdn-dados-abertos` (o ZIP nacional), porque é a unidade
 * coletável real: o catálogo não tem um recurso separado por arquivo.
 */
export const tradutorTseCandidatos: Tradutor = {
  fonteId: 'tse',
  recursoId: 'cdn-dados-abertos',
  versaoEsquema: 1,
  leitura: { tipo: 'zip-csv', arquivo: 'consulta_cand', separador: ';', encoding: 'latin1' },
  campos: CAMPOS,

  /**
   * Descarta linhas estruturalmente inúteis ANTES da conversão.
   *
   * O CSV traz o cabeçalho repetido dentro de cada arquivo de UF; o leitor já
   * o consome, mas uma linha sem `SQ_CANDIDATO` não identifica ninguém.
   */
  validar: (bruto) => {
    if (bruto === null || typeof bruto !== 'object') {
      return { ok: false, motivo: 'registro-malformado', detalhe: 'esperado objeto de colunas' }
    }
    const r = bruto as Record<string, unknown>
    const seq = r['SQ_CANDIDATO']
    if (seq === undefined || String(seq).trim() === '') {
      return {
        ok: false,
        motivo: 'campo-obrigatorio-ausente',
        detalhe: 'linha sem SQ_CANDIDATO (não identifica candidato)',
      }
    }
    return { ok: true }
  },
}

/** Tradutores desta fonte. */
export const tradutoresTse: readonly Tradutor[] = [tradutorTseCandidatos]
