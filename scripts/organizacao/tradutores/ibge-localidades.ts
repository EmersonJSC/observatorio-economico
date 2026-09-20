/**
 * Caixa 4 — tradutores de `ibge-localidades`.
 *
 * PoC da infraestrutura de organização. Cobre os dois recursos usados pelo
 * projeto: `estados` e `municipios-por-uf`.
 *
 * Escopo estrito da Caixa 4: limpar, tipar e renomear. NÃO há aqui:
 *   - junção de município com UF (isso é RELACIONAMENTOS)
 *   - cálculo de qualquer indicador (CÁLCULOS)
 *   - DE-PARA com códigos do TSE (RELACIONAMENTOS)
 *
 * O que fazemos com o aninhamento: a origem traz a UF dentro de
 * `microrregiao.mesorregiao.UF` (ou de `regiao-imediata.regiao-intermediaria.UF`).
 * Achatamos esse caminho para colunas planas — é interpretação da LINHA atual,
 * portanto pertence à Caixa 4.
 */

import type { CampoMapeado, Tradutor } from '../tipos.js'

// ---------------------------------------------------------------------------
// estados
// ---------------------------------------------------------------------------

const CAMPOS_ESTADOS: readonly CampoMapeado[] = [
  {
    origem: 'id',
    destino: 'codarea',
    tipo: 'codigo',
    obrigatorio: true,
    descricao: 'Código IBGE da UF (2 dígitos)',
  },
  { origem: 'sigla', destino: 'sigla', tipo: 'texto', obrigatorio: true, descricao: 'Sigla da UF' },
  { origem: 'nome', destino: 'nome', tipo: 'texto', obrigatorio: true, descricao: 'Nome da UF' },
  {
    origem: 'regiao.id',
    destino: 'regiaoCodigo',
    tipo: 'codigo',
    obrigatorio: false,
    descricao: 'Código IBGE da região',
  },
  {
    origem: 'regiao.sigla',
    destino: 'regiaoSigla',
    tipo: 'texto',
    obrigatorio: false,
    descricao: 'Sigla da região',
  },
  {
    origem: 'regiao.nome',
    destino: 'regiaoNome',
    tipo: 'texto',
    obrigatorio: false,
    descricao: 'Nome da região',
  },
]

export const tradutorEstados: Tradutor = {
  fonteId: 'ibge-localidades',
  recursoId: 'estados',
  versaoEsquema: 1,
  leitura: { tipo: 'json-colecao' },
  campos: CAMPOS_ESTADOS,
}

// ---------------------------------------------------------------------------
// municipios-por-uf
// ---------------------------------------------------------------------------

const CAMPOS_MUNICIPIOS: readonly CampoMapeado[] = [
  {
    origem: 'id',
    destino: 'codarea',
    tipo: 'codigo',
    obrigatorio: true,
    descricao: 'Código IBGE do município (7 dígitos)',
  },
  {
    origem: 'nome',
    destino: 'nome',
    tipo: 'texto',
    obrigatorio: true,
    descricao: 'Nome oficial do município',
  },
  // A UF aparece em um de dois caminhos, conforme o IBGE preencha
  // microrregião ou região imediata. Ambos são opcionais individualmente,
  // mas exigimos que ao menos um resolva (ver `validar`).
  {
    origem: 'microrregiao.mesorregiao.UF.id',
    destino: 'ufCodigo',
    tipo: 'codigo',
    obrigatorio: false,
    descricao: 'Código IBGE da UF (via mesorregião)',
  },
  {
    origem: 'microrregiao.mesorregiao.UF.sigla',
    destino: 'ufSigla',
    tipo: 'texto',
    obrigatorio: false,
    descricao: 'Sigla da UF (via mesorregião)',
  },
  {
    origem: 'regiao-imediata.regiao-intermediaria.UF.id',
    destino: 'ufCodigoAlternativo',
    tipo: 'codigo',
    obrigatorio: false,
    descricao: 'Código IBGE da UF (via região imediata)',
  },
  {
    origem: 'regiao-imediata.regiao-intermediaria.UF.sigla',
    destino: 'ufSiglaAlternativa',
    tipo: 'texto',
    obrigatorio: false,
    descricao: 'Sigla da UF (via região imediata)',
  },
  {
    origem: 'microrregiao.id',
    destino: 'microrregiaoCodigo',
    tipo: 'codigo',
    obrigatorio: false,
    descricao: 'Código da microrregião',
  },
  {
    origem: 'microrregiao.nome',
    destino: 'microrregiaoNome',
    tipo: 'texto',
    obrigatorio: false,
  },
  {
    origem: 'microrregiao.mesorregiao.id',
    destino: 'mesorregiaoCodigo',
    tipo: 'codigo',
    obrigatorio: false,
  },
  {
    origem: 'microrregiao.mesorregiao.nome',
    destino: 'mesorregiaoNome',
    tipo: 'texto',
    obrigatorio: false,
  },
  {
    origem: 'regiao-imediata.id',
    destino: 'regiaoImediataCodigo',
    tipo: 'codigo',
    obrigatorio: false,
  },
  {
    origem: 'regiao-imediata.nome',
    destino: 'regiaoImediataNome',
    tipo: 'texto',
    obrigatorio: false,
  },
]

export const tradutorMunicipios: Tradutor = {
  fonteId: 'ibge-localidades',
  recursoId: 'municipios-por-uf',
  versaoEsquema: 1,
  leitura: { tipo: 'json-colecao' },
  campos: CAMPOS_MUNICIPIOS,

  /**
   * Um município sem UF em nenhum dos dois caminhos é inutilizável para o
   * projeto (a UF é usada para agrupar e para o mapa).
   */
  validar: (bruto) => {
    if (bruto === null || typeof bruto !== 'object') {
      return { ok: false, motivo: 'registro-malformado', detalhe: 'esperado objeto' }
    }
    const r = bruto as Record<string, unknown>
    if (r.id === undefined) {
      return {
        ok: false,
        motivo: 'campo-obrigatorio-ausente',
        detalhe: 'município sem "id"',
      }
    }
    if (r.nome === undefined) {
      return { ok: false, motivo: 'campo-obrigatorio-ausente', detalhe: 'município sem "nome"' }
    }
    return { ok: true }
  },

  /**
   * Unifica os dois caminhos possíveis da UF em um par canônico.
   *
   * `ufCodigo`/`ufSigla` (via mesorregião) têm precedência; quando ausentes,
   * usamos os alternativos (via região imediata) e descartamos os duplicados
   * para não poluir o registro final.
   */
  refinar: (convertido) => {
    const codigo = convertido.ufCodigo ?? convertido.ufCodigoAlternativo ?? null
    const sigla = convertido.ufSigla ?? convertido.ufSiglaAlternativa ?? null

    const {
      ufCodigoAlternativo: _a,
      ufSiglaAlternativa: _b,
      ...resto
    } = convertido as Record<string, string | number | boolean | null>

    return { ...resto, ufCodigo: codigo, ufSigla: sigla }
  },
}

/** Tradutores desta fonte, indexados por `recursoId`. */
export const tradutoresIbgeLocalidades: readonly Tradutor[] = [
  tradutorEstados,
  tradutorMunicipios,
]
