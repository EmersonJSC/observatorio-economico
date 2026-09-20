/**
 * Caixa 5 — RELACIONAMENTOS: normalização de nomes.
 *
 * Função ÚNICA e definitiva de normalização. O legado tinha duas cópias com o
 * mesmo corpo (`tse-depara-builder.ts` e `brasilio.adapter.ts`) — correção em
 * uma não propagava para a outra.
 *
 * As regras abaixo foram validadas contra o dado real do projeto: com elas,
 * 5.560 das 5.569 unidades eleitorais do TSE casam com o IBGE por nome
 * normalizado exato (99,84%). As 9 restantes são divergências históricas
 * conhecidas, tratadas como exceções auditadas.
 */

/**
 * Normaliza um nome de município para comparação.
 *
 * Regras, na ordem:
 *   1. minúsculas;
 *   2. remove acentos (NFD + descarte de marcas combinantes);
 *   3. apóstrofo e hífen viram espaço — o TSE escreve "OLHO D'ÁGUA" e o IBGE
 *      "Olho d'Água", e há casos sem apóstrofo dos dois lados;
 *   4. remove artigos e conectivos (`de`, `da`, `do`, `das`, `dos`, `e`) e
 *      também o `d` solto que sobra do apóstrofo (`D'Oeste` → `d oeste`);
 *   5. colapsa espaços e apara as pontas.
 *
 * O passo 4 incluir `d` é o que faz "Espigão D'Oeste" (IBGE) casar com
 * "ESPIGÃO DO OESTE" (TSE) por normalização, sem precisar de exceção auditada.
 *
 * Não remove números: "União da Vitória" e "União da Vitória II" são lugares
 * diferentes, e distritos homônimos existem no IBGE.
 */
export function normalizarNome(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/['\u2019-]/g, ' ') // apóstrofo (reto e curvo) e hífen → espaço
    .replace(/\s+/g, ' ')
    .replace(/\b(de|da|do|das|dos|e|d)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Chave de casamento: UF + nome normalizado.
 *
 * A UF entra na chave de propósito. "Bom Jesus" existe em várias UFs, e casar
 * só por nome produziria vínculo errado entre municípios de estados
 * diferentes — exatamente o tipo de erro que coloca um prefeito no município
 * errado.
 */
export function chaveCasamento(ufSigla: string, nome: string): string {
  return `${ufSigla.toUpperCase()}|${normalizarNome(nome)}`
}

/**
 * Normaliza um código de município do IBGE para 7 dígitos.
 *
 * O código do IBGE tem 7 dígitos com dígito verificador. Algumas fontes
 * emitem sem zeros à esquerda; preservamos `codigo` como string para não
 * perder zeros (o tipo `number` transformaria "1100015" em 1100015 e "0011000"
 * em 11000).
 */
export function normalizarCodarea(codigo: string | number): string {
  return String(codigo).trim().padStart(7, '0')
}

/** Normaliza um código de unidade eleitoral do TSE (5 dígitos). */
export function normalizarCodigoTse(codigo: string | number): string {
  return String(codigo).trim().padStart(5, '0')
}
