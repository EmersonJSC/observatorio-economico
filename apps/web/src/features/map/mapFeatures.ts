/**
 * Helpers para extrair informações de features GeoJSON do dataset territorial.
 *
 * IMPORTANTE: as propriedades reais dos GeoJSON do IBGE (malhas v3) contêm
 * apenas `codarea`. O dataset distribuído pela aplicação é enriquecido no
 * script `scripts/update-territorial-data.ts` com os nomes oficiais vindos da
 * API de Localidades do IBGE. Portanto, os campos abaixo são os esperados:
 *
 *   Estados:       { codarea, nome, sigla }
 *   Municípios:    { codarea, nome, uf, ufId }
 *
 * Nunca invente propriedades: use sempre estes helpers para ler os dados.
 */

/** Propriedades possíveis de uma feature do dataset territorial. */
export interface PropriedadesTerritoriais {
  codarea?: string | number;
  nome?: string;
  sigla?: string;
  uf?: string;
  ufId?: string | number;
}

/** Feature GeoJSON mínima usada pelo mapa. */
export interface FeatureTerritorial {
  type?: string;
  properties?: PropriedadesTerritoriais | null;
  geometry?: unknown;
}

/** Nível territorial de uma feature ou seleção. */
export type NivelTerritorial = 'brasil' | 'estado' | 'municipio';

/** Dados normalizados de uma feature, prontos para exibição. */
export interface DadosTerritoriais {
  /** Código IBGE (codarea) como string. */
  codigo: string;
  /** Nome oficial do IBGE. */
  nome: string;
  /** Sigla da UF (apenas para municípios; vazio para estados). */
  uf: string;
  /** Nível territorial. */
  nivel: NivelTerritorial;
}

/**
 * Extrai o código IBGE (`codarea`) de uma feature como string.
 * Retorna string vazia quando ausente.
 */
export function extrairCodigo(feature: FeatureTerritorial | null | undefined): string {
  const codarea = feature?.properties?.codarea;
  if (codarea === undefined || codarea === null) return '';
  return String(codarea);
}

/**
 * Extrai o nome oficial de uma feature.
 * Faz fallback para o próprio código quando o nome não estiver presente,
 * evitando exibir "undefined" na interface.
 */
export function extrairNome(feature: FeatureTerritorial | null | undefined): string {
  const nome = feature?.properties?.nome;
  if (typeof nome === 'string' && nome.trim().length > 0) return nome;
  return extrairCodigo(feature);
}

/**
 * Extrai a sigla da UF de uma feature de município.
 * Retorna string vazia para estados ou quando ausente.
 */
export function extrairUf(feature: FeatureTerritorial | null | undefined): string {
  const uf = feature?.properties?.uf;
  if (typeof uf === 'string' && uf.trim().length > 0) return uf;
  return '';
}

/**
 * Normaliza uma feature em dados territoriais prontos para exibição.
 *
 * @param feature Feature GeoJSON (estado ou município).
 * @param nivel   Nível territorial da feature.
 */
export function extrairDadosTerritoriais(
  feature: FeatureTerritorial | null | undefined,
  nivel: NivelTerritorial,
): DadosTerritoriais {
  return {
    codigo: extrairCodigo(feature),
    nome: extrairNome(feature),
    uf: nivel === 'municipio' ? extrairUf(feature) : '',
    nivel,
  };
}

/** Seleção sintética do Brasil inteiro (não vem de uma feature do mapa). */
export function territorioBrasil(): DadosTerritoriais {
  return { codigo: 'BR', nome: 'Brasil', uf: '', nivel: 'brasil' };
}
