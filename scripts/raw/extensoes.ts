/**
 * Caixa 3 — RAW: resolução de extensão.
 *
 * O nome do objeto no RAW é o hash do conteúdo, e hash não carrega tipo. A
 * extensão preserva a capacidade de reprocessar o arquivo com a ferramenta
 * certa depois — por isso ela é derivada do `formato` declarado na Caixa 1,
 * com o `content-type` da resposta como desempate.
 *
 * Mapa explícito e fechado: sem biblioteca de MIME, sem `mime-db`, sem
 * heurística sobre o conteúdo (a Caixa 3 não abre o arquivo).
 */

import type { Formato } from '../fontes/tipos.js'

/** Extensão usada quando nada permite inferir o tipo. Nunca inventa tipo. */
export const EXTENSAO_PADRAO = '.bin'

/** Mapa `formato` (Caixa 1) → extensão. */
const POR_FORMATO: Record<Formato, string> = {
  json: '.json',
  'json-envelope': '.json',
  geojson: '.geojson',
  'zip-csv': '.zip',
  // `imagem` depende do content-type: a Caixa 1 não distingue PNG de JPEG.
  imagem: EXTENSAO_PADRAO,
}

/**
 * Mapa `content-type` → extensão.
 *
 * Apenas os tipos que as fontes reais do projeto devolvem, mais os casos
 * triviais. Não é — e não pretende ser — uma tabela MIME completa.
 */
const POR_CONTENT_TYPE: ReadonlyArray<readonly [RegExp, string]> = [
  [/^application\/json\b/i, '.json'],
  [/^application\/geo\+json\b/i, '.geojson'],
  [/^application\/vnd\.geo\+json\b/i, '.geojson'],
  [/^application\/zip\b/i, '.zip'],
  [/^application\/x-zip-compressed\b/i, '.zip'],
  [/^text\/csv\b/i, '.csv'],
  [/^application\/csv\b/i, '.csv'],
  [/^text\/plain\b/i, '.txt'],
  [/^text\/html\b/i, '.html'],
  [/^image\/png\b/i, '.png'],
  [/^image\/jpeg\b/i, '.jpg'],
  [/^image\/webp\b/i, '.webp'],
  [/^image\/gif\b/i, '.gif'],
]

/** Extrai apenas o tipo, sem parâmetros (`;charset=...`). */
function tipoBase(contentType: string): string {
  const [tipo] = contentType.split(';')
  return (tipo ?? '').trim()
}

/** Resolve a extensão a partir do `content-type`. */
export function extensaoPorContentType(contentType?: string): string | undefined {
  if (!contentType) return undefined
  const tipo = tipoBase(contentType)
  if (tipo === '') return undefined
  for (const [padrao, ext] of POR_CONTENT_TYPE) {
    if (padrao.test(tipo)) return ext
  }
  return undefined
}

/**
 * Resolve a extensão de um objeto.
 *
 * Precedência:
 *   1. `formato` da Caixa 1, quando ele já determina a extensão;
 *   2. `content-type` da resposta, quando o formato é ambíguo (`imagem`);
 *   3. `content-type` como desempate geral;
 *   4. `.bin`.
 *
 * Nunca inspeciona os bytes.
 */
export function resolverExtensao(formato: Formato, contentType?: string): string {
  const porFormato = POR_FORMATO[formato]

  // Formato ambíguo (imagem) ou desconhecido: o content-type decide.
  if (porFormato !== EXTENSAO_PADRAO) return porFormato

  return extensaoPorContentType(contentType) ?? EXTENSAO_PADRAO
}

/** Todas as extensões conhecidas — usado em verificação. */
export function extensoesConhecidas(): string[] {
  const doFormato = Object.values(POR_FORMATO).filter((e) => e !== EXTENSAO_PADRAO)
  const doTipo = POR_CONTENT_TYPE.map(([, ext]) => ext)
  return [...new Set([...doFormato, ...doTipo])].sort()
}
