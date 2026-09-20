/**
 * Orquestrador — resolução de parâmetros de fan-out.
 *
 * A Caixa 1 declara QUE dimensões um recurso usa (`uf`, `ente`, `ano`, …), mas
 * não entrega os valores: "de onde vem a lista é decisão de quem chama"
 * (docs/PLANO_CAIXA_2_COLETOR.md §5). Este módulo é esse "quem chama".
 *
 * Resolvedores, em ordem de precedência:
 *
 *   1. `--param dimensao=v1,v2`  → override explícito do operador (sempre vence)
 *   2. cache em `data/raw/_parametros/<dimensao>.json`
 *   3. tabela estática  → dimensões fechadas (`uf`, `ano`, `exercicio`, …)
 *   4. bootstrap legado → `data/indicators/pontos.json` para `municipio`
 *
 * O passo 4 é explicitamente TRANSITÓRIO: existe só para a primeira execução,
 * enquanto não há cache no RAW. Ele é avisado no console e pode ser desligado.
 * Nada aqui acopla a arquitetura nova aos scripts legados de forma permanente.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Diretório de cache de parâmetros dentro do RAW. */
export const DIR_PARAMETROS = join(RAIZ_PROJETO, 'data', 'raw', '_parametros')

/** Códigos IBGE das 27 UFs — dimensão fechada, estável, sem necessidade de rede. */
export const UFS_IBGE: readonly string[] = [
  '11', '12', '13', '14', '15', '16', '17',
  '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '31', '32', '33', '35',
  '41', '42', '43',
  '50', '51', '52', '53',
]

/** Contexto de resolução de uma dimensão. */
export interface ContextoParametro {
  /** Valores vindos de `--param dimensao=v1,v2`. */
  overrides: Readonly<Record<string, readonly string[]>>
  /**
   * Anos informados explicitamente em `--anos`. `null` significa "não
   * informado" — nesse caso vale o `exemplo` declarado na Caixa 1.
   */
  anos: readonly string[] | null
  /** Permite o bootstrap transitório a partir do legado. */
  permitirLegado: boolean
  /** Avisos acumulados, impressos pelo orquestrador. */
  avisos: string[]
}

/** Lê o cache de uma dimensão em `data/raw/_parametros/`. */
async function lerCache(dimensao: string): Promise<string[] | null> {
  const caminho = join(DIR_PARAMETROS, `${dimensao}.json`)
  if (!existsSync(caminho)) return null
  try {
    const dados = JSON.parse(await readFile(caminho, 'utf-8')) as unknown
    const valores = Array.isArray(dados)
      ? dados
      : ((dados as { valores?: unknown }).valores ?? null)
    if (!Array.isArray(valores)) return null
    return valores.map((v) => String(v)).filter((v) => v.trim() !== '')
  } catch {
    return null
  }
}

/** Grava o cache de uma dimensão, para reuso nas próximas execuções. */
export async function gravarCache(dimensao: string, valores: readonly string[]): Promise<void> {
  await mkdir(DIR_PARAMETROS, { recursive: true })
  await writeFile(
    join(DIR_PARAMETROS, `${dimensao}.json`),
    `${JSON.stringify({ dimensao, geradoEm: new Date().toISOString(), valores }, null, 2)}\n`,
    'utf-8',
  )
}

/**
 * Bootstrap TRANSITÓRIO: lê `data/indicators/pontos.json` (derivado legado).
 *
 * Existe apenas para a primeira execução, enquanto o cache do RAW não existe.
 * Retorna `null` quando o arquivo não está disponível — nunca lança.
 */
async function lerLegadoMunicipios(): Promise<string[] | null> {
  const caminho = join(RAIZ_PROJETO, 'data', 'indicators', 'pontos.json')
  if (!existsSync(caminho)) return null
  try {
    const dados = JSON.parse(await readFile(caminho, 'utf-8')) as {
      pontos?: Array<{ codarea?: string | number }>
    }
    const codigos = (dados.pontos ?? [])
      .map((p) => String(p.codarea ?? '').trim())
      .filter((c) => c !== '')
    return codigos.length > 0 ? codigos : null
  } catch {
    return null
  }
}

/**
 * Tabela estática de dimensões FECHADAS e estáveis.
 *
 * Só entram aqui domínios que não dependem de escolha do operador nem do
 * recurso: as 27 UFs do IBGE são sempre as mesmas.
 *
 * ⚠️ `ano` e `exercicio` NÃO estão aqui de propósito. Quais anos a fonte
 * publica varia por recurso (o TSE só tem anos de eleição), então o default
 * vem do `exemplo` da Caixa 1 — ver `resolverDimensao`.
 */
function valoresEstaticos(dimensao: string): string[] | null {
  switch (dimensao) {
    case 'uf':
      return [...UFS_IBGE]
    default:
      return null
  }
}

/**
 * Resolve os valores de uma dimensão de fan-out.
 *
 * Precedência:
 *   1. `--param dimensao=v1,v2`            (operador manda)
 *   2. `--anos` para `ano`/`exercicio`     (varredura multi-ano explícita)
 *   3. cache em `data/raw/_parametros/`
 *   4. tabela estática de domínio fechado (`uf`)
 *   5. `exemplo` declarado na Caixa 1      (default por recurso)
 *   6. bootstrap transitório do legado (`municipio`)
 *
 * @returns Lista de valores, ou `null` quando não há resolvedor — o
 *          orquestrador transforma isso em erro explícito, em vez de coletar
 *          silenciosamente nada.
 */
export async function resolverDimensao(
  dimensao: string,
  ctx: ContextoParametro,
  recurso?: ParametrosDoRecurso,
): Promise<string[] | null> {
  // 1. Override explícito do operador.
  const override = ctx.overrides[dimensao]
  if (override && override.length > 0) return [...override]

  // 2. `--anos` cobre apenas as dimensões temporais, e só quando informado.
  if ((dimensao === 'ano' || dimensao === 'exercicio') && ctx.anos && ctx.anos.length > 0) {
    return [...ctx.anos]
  }

  // 3. Cache local no RAW.
  const cache = await lerCache(dimensao)
  if (cache && cache.length > 0) return cache

  // 4. Tabela estática (apenas domínios fechados).
  const estatico = valoresEstaticos(dimensao)
  if (estatico && estatico.length > 0) return estatico

  // 5. `exemplo` da Caixa 1 — o default é POR RECURSO, nunca genérico.
  if (recurso) {
    const exemplo = exemploDoRecurso(recurso, dimensao)
    if (exemplo) return exemplo
  }

  // 6. Bootstrap transitório a partir do legado.
  if (dimensao === 'municipio' && ctx.permitirLegado) {
    const legado = await lerLegadoMunicipios()
    if (legado) {
      ctx.avisos.push(
        `dimensão "municipio" veio do legado data/indicators/pontos.json ` +
          `(${legado.length} códigos) — bootstrap transitório; o cache em ` +
          `data/raw/_parametros/ passa a valer nas próximas execuções`,
      )
      return legado
    }
  }

  return null
}

/** Forma mínima de um recurso para resolução de parâmetros. */
export interface ParametrosDoRecurso {
  id: string
  parametros?: readonly {
    nome: string
    dimensao?: string
    exemplo?: string
    obrigatorio: boolean
  }[]
}

/**
 * Descobre todas as dimensões exigidas por um recurso.
 *
 * Considera apenas as que realmente geram fan-out: parâmetro com `dimensao`
 * declarada. Parâmetro obrigatório com valor fixo (`valores`) não entra.
 */
export function dimensoesDoRecurso(recurso: {
  parametros?: readonly { nome: string; dimensao?: string; obrigatorio: boolean }[]
}): string[] {
  return [
    ...new Set(
      (recurso.parametros ?? [])
        .map((p) => p.dimensao)
        .filter((d): d is string => typeof d === 'string' && d !== ''),
    ),
  ]
}

/**
 * Resolve o conjunto de valores de todas as dimensões de um recurso.
 *
 * @throws {ErroParametro} quando alguma dimensão não tem resolvedor.
 */
export async function resolverDimensoes(
  recurso: ParametrosDoRecurso,
  fonteId: string,
  ctx: ContextoParametro,
): Promise<Record<string, string[]>> {
  const dimensoes = dimensoesDoRecurso(recurso)
  const resolvido: Record<string, string[]> = {}

  for (const dim of dimensoes) {
    const valores = await resolverDimensao(dim, ctx, recurso)
    if (!valores) {
      throw new ErroParametro(
        `recurso ${fonteId}/${recurso.id}: dimensão "${dim}" não tem valores.\n` +
          `  Informe explicitamente:  --param ${dim}=valor1,valor2\n` +
          `  Ou crie o cache:          data/raw/_parametros/${dim}.json`,
      )
    }
    resolvido[dim] = valores
  }

  return resolvido
}

/** Dimensão sem resolvedor disponível. */
export class ErroParametro extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErroParametro'
  }
}

/** Parser de `--param dimensao=v1,v2`. */
export function parseOverrides(brutos: readonly string[]): Record<string, string[]> {
  const overrides: Record<string, string[]> = {}
  for (const bruto of brutos) {
    const igual = bruto.indexOf('=')
    if (igual <= 0) continue
    const chave = bruto.slice(0, igual).trim()
    const valores = bruto
      .slice(igual + 1)
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '')
    if (chave !== '' && valores.length > 0) overrides[chave] = valores
  }
  return overrides
}

/**
 * Lê os anos informados explicitamente em `--anos 2022,2024`.
 *
 * NÃO existe valor padrão aqui: o default é POR RECURSO, lido do campo
 * `exemplo` da Caixa 1 (ver `exemploDoRecurso`). Uma lista genérica faria o
 * orquestrador inventar parâmetros que a fonte não publica — foi assim que
 * `consulta_cand_2023.zip` virou um 404, já que 2023 não teve eleição.
 *
 * @returns Os anos informados, ou `null` quando o operador não passou nada.
 */
export function parseAnos(bruto: string | undefined): string[] | null {
  if (!bruto) return null
  const anos = bruto
    .split(',')
    .map((a) => a.trim())
    .filter((a) => /^\d{4}$/.test(a))
  return anos.length > 0 ? anos : null
}

/**
 * Descobre o valor padrão de uma dimensão a partir do `exemplo` declarado no
 * catálogo da Caixa 1 para o parâmetro correspondente.
 *
 * É a única fonte de default permitida: o catálogo é quem sabe o que a fonte
 * publica. O orquestrador nunca inventa um valor.
 *
 * @returns Lista com um valor, ou `null` quando o parâmetro não declara exemplo.
 */
export function exemploDoRecurso(
  recurso: {
    parametros?: readonly { nome: string; dimensao?: string; exemplo?: string }[]
  },
  dimensao: string,
): string[] | null {
  const parametro = (recurso.parametros ?? []).find((p) => p.dimensao === dimensao)
  const exemplo = parametro?.exemplo?.trim()
  return exemplo ? [exemplo] : null
}
