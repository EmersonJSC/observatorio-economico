/**
 * Caixa 4 — tradutores de `ibge-sidra` (API de Agregados do IBGE).
 *
 * Forma real da resposta (verificada no RAW do projeto):
 *
 *   [ { id, variavel, unidade, resultados: [ { series: [
 *       { localidade: { id, nome, nivel }, serie: { "2021": "16396" } },
 *       ...
 *   ] } ] } ]
 *
 * O aninhamento é o ponto central: um único registro na origem contém TODAS as
 * localidades de uma UF, com um dicionário de anos por localidade. Por isso o
 * tradutor declara `desmembrar`: ele expande cada série em uma linha plana,
 * uma por (localidade, ano).
 *
 * A saída é longa (tidy): uma linha por município e ano, em vez de colunas por
 * ano. Isso mantém o esquema estável quando o IBGE adiciona um ano novo.
 */

import type { CampoMapeado, Tradutor } from '../tipos.js'

/**
 * Marcadores de ausência do IBGE.
 *
 * Diferente do TSE (que usa `#NULO`), aqui o dado suprimido vem como `-`,
 * `...`, `X` ou `C`. Todos significam ausência, não zero.
 */
const NULOS_IBGE = ['-', '...', 'X', 'C'] as const

/** Campos comuns a população e PIB. */
const CAMPOS_BASE: readonly CampoMapeado[] = [
  {
    origem: 'localidade.id',
    destino: 'codarea',
    tipo: 'codigo',
    obrigatorio: true,
    descricao: 'Código IBGE da localidade (2 dígitos UF, 7 município)',
  },
  {
    origem: 'localidade.nome',
    destino: 'nomeLocalidade',
    tipo: 'texto',
    obrigatorio: false,
    descricao: 'Nome como o SIDRA devolve (inclui sufixo de UF)',
  },
  {
    origem: 'localidade.nivel.id',
    destino: 'nivel',
    tipo: 'texto',
    obrigatorio: false,
    descricao: 'Nível territorial: N1 Brasil, N3 UF, N6 município',
  },
  {
    origem: 'ano',
    destino: 'ano',
    tipo: 'inteiro',
    obrigatorio: true,
    descricao: 'Ano de referência da série',
  },
]

/**
 * Forma de um registro já desmembrado.
 *
 * É o que `desmembrar` produz: um objeto plano por (localidade, ano).
 */
interface SerieAchatada {
  localidade: { id?: string; nome?: string; nivel?: { id?: string } }
  ano: number
  valor: number | null
}

/** Registro cru da resposta do SIDRA. */
interface SidraItem {
  variavel?: string
  unidade?: string
  resultados?: Array<{
    series?: Array<{
      localidade?: { id?: string; nome?: string; nivel?: { id?: string } }
      serie?: Record<string, string>
    }>
  }>
}

/**
 * Converte o valor textual do SIDRA em número, tratando os marcadores.
 *
 * Aceita o formato brasileiro com separador de milhar (`1.234,5`), que é como
 * o SIDRA devolve valores quando a unidade é populacional ou monetária. Fazer
 * apenas `replace(',', '.')` transformaria `1.234,5` em `1.234.5`, que não é
 * número — e o valor viraria `null` em silêncio.
 */
export function parseValorSidra(texto: string | undefined): number | null {
  if (texto === undefined) return null
  const limpo = texto.trim()
  if (limpo === '') return null
  if ((NULOS_IBGE as readonly string[]).includes(limpo)) return null

  // Formato brasileiro completo: 1.234,56 → 1234.56
  const brasileiro = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/
  const normalizado = brasileiro.test(limpo)
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo.replace(',', '.')

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/**
 * Expande um item do SIDRA em uma linha por (série, ano).
 *
 * Exportada para teste: é a peça que faz o aninhamento virar tabela.
 */
export function desmembrarSidra(bruto: unknown): SerieAchatada[] {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return []

  const item = bruto as SidraItem
  const linhas: SerieAchatada[] = []

  for (const resultado of item.resultados ?? []) {
    for (const serie of resultado.series ?? []) {
      const localidade = serie.localidade

      for (const [anoTexto, valorTexto] of Object.entries(serie.serie ?? {})) {
        const ano = Number(anoTexto)
        if (!Number.isFinite(ano)) continue

        // Uma série sem código de localidade NÃO é descartada aqui: ela é
        // emitida para que `validar` a rejeite e ela apareça na quarentena.
        // Descartar em silêncio esconderia dado ruim em vez de reportá-lo.
        linhas.push({
          localidade: {
            ...(localidade?.id !== undefined ? { id: localidade.id } : {}),
            ...(localidade?.nome !== undefined ? { nome: localidade.nome } : {}),
            ...(localidade?.nivel !== undefined ? { nivel: localidade.nivel } : {}),
          },
          ano,
          valor: parseValorSidra(valorTexto),
        })
      }
    }
  }

  return linhas
}

/** Campos do recurso `populacao` (Tabela 6579, Variável 9324). */
const CAMPOS_POPULACAO: readonly CampoMapeado[] = [
  ...CAMPOS_BASE,
  {
    origem: 'valor',
    destino: 'populacao',
    tipo: 'inteiro',
    obrigatorio: false,
    descricao: 'Pessoas residentes estimadas',
    nulosConhecidos: NULOS_IBGE,
  },
]

/** Campos do recurso `pib` (Tabela 5938, Variável 37). */
const CAMPOS_PIB: readonly CampoMapeado[] = [
  ...CAMPOS_BASE,
  {
    origem: 'valor',
    destino: 'pibMilReais',
    tipo: 'decimal',
    obrigatorio: false,
    descricao: 'PIB a preços correntes, em milhares de reais',
    nulosConhecidos: NULOS_IBGE,
  },
]

/**
 * Validação comum: sem código de localidade ou sem ano não há série utilizável.
 */
function validarSerie(bruto: unknown): { ok: true } | { ok: false; motivo: 'campo-obrigatorio-ausente'; detalhe: string } {
  if (bruto === null || typeof bruto !== 'object') {
    return { ok: false, motivo: 'campo-obrigatorio-ausente', detalhe: 'esperado objeto' }
  }
  const r = bruto as { localidade?: { id?: string }; ano?: number }
  if (!r.localidade?.id) {
    return { ok: false, motivo: 'campo-obrigatorio-ausente', detalhe: 'série sem código de localidade' }
  }
  if (r.ano === undefined) {
    return { ok: false, motivo: 'campo-obrigatorio-ausente', detalhe: 'série sem ano' }
  }
  return { ok: true }
}

/** Tradutor de população (SIDRA 6579). */
export const tradutorSidraPopulacao: Tradutor = {
  fonteId: 'ibge-sidra',
  recursoId: 'populacao',
  versaoEsquema: 1,
  leitura: { tipo: 'json-colecao' },
  campos: CAMPOS_POPULACAO,
  desmembrar: desmembrarSidra,
  validar: validarSerie,
}

/** Tradutor de PIB (SIDRA 5938). */
export const tradutorSidraPib: Tradutor = {
  fonteId: 'ibge-sidra',
  recursoId: 'pib',
  versaoEsquema: 1,
  leitura: { tipo: 'json-colecao' },
  campos: CAMPOS_PIB,
  desmembrar: desmembrarSidra,
  validar: validarSerie,
}

/** Tradutores desta fonte. */
export const tradutoresIbgeSidra: readonly Tradutor[] = [
  tradutorSidraPopulacao,
  tradutorSidraPib,
]
