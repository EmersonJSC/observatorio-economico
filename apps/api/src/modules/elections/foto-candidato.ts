/**
 * URL das fotos oficiais de candidatos no DivulgaCandContas (TSE).
 *
 * Padrão confirmado a partir da fonte citada em uploads oficiais no Wikimedia:
 *   https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/{idEleicao}/{sqCandidato}/{sgUe}
 *
 * Onde:
 *   - idEleicao   = identificador da eleição no DivulgaCandContas (tabela abaixo)
 *   - sqCandidato = SQ_CANDIDATO, presente no consulta_cand do TSE
 *   - sgUe        = unidade eleitoral:
 *                     • municipal  → código TSE do município (ex: "70750")
 *                     • estadual   → sigla da UF (ex: "SP")
 *                     • nacional   → "BR"
 *
 * As fotos são servidas pelo próprio TSE; no frontend há fallback para as
 * iniciais do nome caso a imagem não carregue.
 */

const BASE = 'https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img'

/** Identificador da eleição por ano no DivulgaCandContas. */
const ID_ELEICAO: Record<number, number> = {
  2020: 2030402020,
  2022: 2040602022,
  2024: 2045202024,
  2026: 20322002026,
}

export function urlFotoCandidato(
  sqCandidato?: string,
  anoEleicao?: number,
  sgUe?: string,
): string | null {
  if (!sqCandidato || !anoEleicao || !sgUe) return null
  const id = ID_ELEICAO[anoEleicao]
  if (!id) return null
  // A unidade eleitoral vai sem barras/espaços
  return `${BASE}/${id}/${sqCandidato}/${sgUe.trim()}`
}
