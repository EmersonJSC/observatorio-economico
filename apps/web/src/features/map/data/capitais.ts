/**
 * Lista estática das 27 capitais brasileiras com seus códigos IBGE de
 * município (7 dígitos).
 *
 * Esta é a ÚNICA lista mantida manualmente no front-end. Ela existe para
 * destacar visualmente as capitais sem depender de nenhuma consulta à API
 * do IBGE em tempo de execução.
 *
 * Os códigos foram validados contra a API de Localidades do IBGE
 * (https://servicodados.ibge.gov.br/api/v1/localidades/municipios/{codigo}).
 */

/** Código IBGE do município da capital → sigla da UF. */
export const CAPITAIS: Readonly<Record<string, string>> = Object.freeze({
  '1200401': 'AC', // Rio Branco
  '2704302': 'AL', // Maceió
  '1600303': 'AP', // Macapá
  '1302603': 'AM', // Manaus
  '2927408': 'BA', // Salvador
  '2304400': 'CE', // Fortaleza
  '3205309': 'ES', // Vitória
  '5208707': 'GO', // Goiânia
  '2111300': 'MA', // São Luís
  '5103403': 'MT', // Cuiabá
  '5002704': 'MS', // Campo Grande
  '3106200': 'MG', // Belo Horizonte
  '1501402': 'PA', // Belém
  '2507507': 'PB', // João Pessoa
  '4106902': 'PR', // Curitiba
  '2611606': 'PE', // Recife
  '2211001': 'PI', // Teresina
  '3304557': 'RJ', // Rio de Janeiro
  '2408102': 'RN', // Natal
  '4314902': 'RS', // Porto Alegre
  '1100205': 'RO', // Porto Velho
  '1400100': 'RR', // Boa Vista
  '4205407': 'SC', // Florianópolis
  '3550308': 'SP', // São Paulo
  '2800308': 'SE', // Aracaju
  '1721000': 'TO', // Palmas
  '5300108': 'DF', // Brasília
});

/** Conjunto de códigos IBGE das capitais, para checagem O(1). */
export const CODIGOS_CAPITAIS: ReadonlySet<string> = new Set(Object.keys(CAPITAIS));

/**
 * Verifica se um código IBGE de município pertence a uma capital.
 * Checagem O(1), sem alocação.
 */
export function ehCapital(codigo: string): boolean {
  return CODIGOS_CAPITAIS.has(codigo);
}
