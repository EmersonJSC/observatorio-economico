/**
 * Orquestrador — liga as Caixas 1, 2 e 3 de ponta a ponta.
 *
 *   CAIXA 1  define O QUE coletar   (catálogo + rate limits)
 *   CAIXA 2  sabe COMO coletar      (bytes, tri-estado, paginação)
 *   CAIXA 3  sabe ONDE guardar      (imutabilidade, dedup, tentativas.jsonl)
 *
 * Nenhuma delas age sozinha. Este script inicia e gerencia o processo:
 * lê o catálogo, resolve o fan-out, executa em fila controlada, persiste o
 * resultado e registra o que aconteceu.
 *
 * O que ele NÃO faz: não implementa fallback entre fontes (regra de negócio
 * futura), não interpreta dados, não inventa parâmetros e não altera o código
 * das caixas.
 *
 * Parâmetros de fan-out: sem `--anos`, cada recurso usa o `exemplo` declarado
 * na Caixa 1 (TSE→2024, Siconfi→2023, …). Para varrer vários anos é preciso
 * informá-los explicitamente. Nunca há lista padrão genérica: pedir um ano que
 * a fonte não publica produz 404 (ex.: `consulta_cand_2023.zip`, que não existe
 * porque 2023 não teve eleição).
 *
 * Uso:
 *   npm run coletar -- --tudo
 *   npm run coletar -- --fonte siconfi
 *   npm run coletar -- --recurso dca --param ente=3136702
 *   npm run coletar -- --recurso cdn-dados-abertos --anos 2022,2024
 *   npm run coletar -- --fonte ibge-localidades --simular
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FONTES } from '../fontes/catalogo.js'
import type { Fonte, Recurso } from '../fontes/tipos.js'
import { coletar, concorrenciaPara, politicaPara } from '../coletor/index.js'
import type { ResultadoColeta } from '../coletor/index.js'
import { persistirResultado } from '../raw/index.js'
import { raizPadrao, type PersistenciaResultado } from '../raw/index.js'
import {
  ErroParametro,
  parseAnos,
  parseOverrides,
  resolverDimensoes,
  type ContextoParametro,
} from './parametros.js'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

/** Opções de linha de comando. */
export interface Args {
  tudo: boolean
  fontes: string[]
  recursos: string[]
  parametros: Record<string, string[]>
  /**
   * Anos de `--anos`. `null` quando não informado — nesse caso cada recurso
   * usa o `exemplo` declarado na Caixa 1 (TSE→2024, Siconfi→2023, …).
   *
   * Não existe lista padrão: uma lista genérica faria o orquestrador pedir
   * anos que a fonte não publica (ex.: `consulta_cand_2023.zip`, que não
   * existe porque 2023 não teve eleição).
   */
  anos: string[] | null
  simular: boolean
  semLegado: boolean
  limite: number
}

export function parseArgs(argv: readonly string[]): Args {
  /**
   * Lê um argumento com valor, aceitando as duas formas:
   *   `--fonte siconfi`  e  `--fonte=siconfi`
   */
  const pegar = (nome: string): string | undefined => {
    const comIgual = argv.find((a) => a.startsWith(`--${nome}=`))
    if (comIgual) return comIgual.slice(nome.length + 3)
    const i = argv.indexOf(`--${nome}`)
    const proximo = i >= 0 ? argv[i + 1] : undefined
    return proximo && !proximo.startsWith('--') ? proximo : undefined
  }

  /**
   * Coleta todas as ocorrências de um argumento com valor.
   *
   * @param separarVirgula `true` para `--fontes a,b`. Use `false` quando a
   *        vírgula pertence ao valor (`--param uf=31,35`), que é separado
   *        depois por `parseOverrides`.
   */
  const varios = (nome: string, separarVirgula = true): string[] => {
    const separador = separarVirgula ? ',' : '\u0000'
    const valores: string[] = []
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!
      if (arg.startsWith(`--${nome}=`)) {
        valores.push(...arg.slice(nome.length + 3).split(separador))
      } else if (arg === `--${nome}` && argv[i + 1] && !argv[i + 1]!.startsWith('--')) {
        valores.push(...argv[i + 1]!.split(separador))
        i++
      }
    }
    return valores.map((s) => s.trim()).filter(Boolean)
  }

  const fonteUnica = pegar('fonte')
  const recursoUnico = pegar('recurso')

  return {
    tudo: argv.includes('--tudo'),
    fontes: [...new Set([...varios('fontes'), ...(fonteUnica ? [fonteUnica] : [])])],
    recursos: [...new Set([...varios('recursos'), ...(recursoUnico ? [recursoUnico] : [])])],
    // A vírgula de `--param uf=31,35` separa VALORES da mesma dimensão, então
    // não pode ser quebrada aqui — `parseOverrides` faz isso.
    parametros: parseOverrides(varios('param', false)),
    anos: parseAnos(pegar('anos')),
    simular: argv.includes('--simular'),
    semLegado: argv.includes('--sem-legado'),
    limite: Number(pegar('limite') ?? '0') || 0,
  }
}

/** Valida a combinação de argumentos. */
export function validarArgs(args: Args): string | null {
  if (args.tudo && (args.fontes.length > 0 || args.recursos.length > 0)) {
    return '--tudo não pode ser combinado com --fonte/--recurso'
  }
  if (!args.tudo && args.fontes.length === 0 && args.recursos.length === 0) {
    return 'informe --tudo, ou ao menos um --fonte/--recurso (ex.: --fonte siconfi)'
  }
  return null
}

// ---------------------------------------------------------------------------
// Seleção de alvos
// ---------------------------------------------------------------------------

/** Um recurso a coletar, com sua fonte. */
export interface Alvo {
  fonte: Fonte
  recurso: Recurso
}

/**
 * Seleciona os recursos a coletar.
 *
 * Ignora recursos com `status !== 'usado'`: a Caixa 1 marca como `nao-usado` o
 * que existe mas o projeto não exercita (ex.: `siconfi/rreo`).
 */
export function selecionarAlvos(args: Args, fontes: readonly Fonte[] = FONTES): Alvo[] {
  const alvos: Alvo[] = []

  for (const fonte of fontes) {
    if (args.fontes.length > 0 && !args.fontes.includes(fonte.id)) continue

    for (const recurso of fonte.recursos) {
      if (recurso.status !== 'usado') continue
      if (args.recursos.length > 0 && !args.recursos.includes(recurso.id)) continue
      alvos.push({ fonte, recurso })
    }
  }

  return alvos
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

/** Resumo de uma execução. */
export interface Resumo {
  gravados: number
  deduplicados: number
  ignorados: number
  erros: number
  coletas: number
  /**
   * Descrição de cada chamada que falhou.
   *
   * Guardado em memória para ser reimpresso no fim: o resumo numérico diz
   * QUANTAS falharam, não QUAIS — e sem os identificadores não há como
   * recoletar só o que faltou.
   */
  falhas: string[]
}

const resumoVazio = (): Resumo => ({
  gravados: 0,
  deduplicados: 0,
  ignorados: 0,
  erros: 0,
  coletas: 0,
  falhas: [],
})

/** Contabiliza um resultado de persistência. */
function contar(resumo: Resumo, r: PersistenciaResultado): void {
  if (r.resultado === 'gravado') resumo.gravados++
  else if (r.resultado === 'deduplicado') resumo.deduplicados++
  else if (r.resultado === 'ignorado') resumo.ignorados++
  else {
    resumo.erros++
    resumo.falhas.push(`${r.fonteId}/${r.recursoId} — falha de persistência: ${r.mensagem}`)
  }
}

/**
 * Descrição curta dos parâmetros de uma coleta, para o log.
 *
 * Mostra apenas valores curtos (ente, uf, ano); listas grandes viram contagem.
 */
function descreverParametros(parametros: Readonly<Record<string, string>>): string {
  const partes = Object.entries(parametros).map(([k, v]) => `${k}: ${v}`)
  return partes.length > 0 ? partes.join(', ') : 'sem parâmetros'
}

/** Nome do primeiro objeto gravado, para o log. */
function nomeObjetoLog(r: PersistenciaResultado): string {
  const arquivo = r.gravados[0]?.arquivo
  if (!arquivo) return ''
  return arquivo.slice(arquivo.lastIndexOf('/') + 1)
}

/** Executa a coleta + persistência de UM conjunto de parâmetros. */
async function processarUma(
  alvo: Alvo,
  dimensoes: Record<string, string[]>,
  raiz: string,
  resumo: Resumo,
): Promise<void> {
  const rotulo = `${alvo.fonte.id}/${alvo.recurso.id}`
  const ctx = descreverParametros(
    Object.fromEntries(Object.entries(dimensoes).map(([k, v]) => [k, v.join(',')])),
  )

  let resultados: ResultadoColeta[]
  try {
    resultados = await coletar(
      {
        fonteId: alvo.fonte.id,
        recursoId: alvo.recurso.id,
        dimensoes,
      },
      {},
    )
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err)
    console.log(`[ERRO] ${rotulo} — ${ctx} -> ${mensagem}`)
    resumo.erros++
    resumo.falhas.push(`${rotulo} — ${ctx} -> ${mensagem}`)
    return
  }

  for (const resultado of resultados) {
    resumo.coletas++
    const persistido = await persistirResultado(raiz, resultado)
    contar(resumo, persistido)

    const detalhe = descreverParametros(resultado.procedencia.parametros)

    switch (persistido.resultado) {
      case 'gravado':
        console.log(`[GRAVADO]      ${rotulo} — ${detalhe} -> ${nomeObjetoLog(persistido)}`)
        break
      case 'deduplicado':
        console.log(
          `[DEDUPLICADO]  ${rotulo} — ${detalhe} -> ${(persistido.hashes[0] ?? '').slice(0, 12)}…`,
        )
        break
      case 'ignorado':
        console.log(
          `[SEM-DADO]     ${rotulo} — ${detalhe} -> ${resultado.estado}` +
            (resultado.motivo ? ` (${resultado.motivo})` : ''),
        )
        break
      default:
        console.log(`[ERRO]         ${rotulo} — ${detalhe} -> ${persistido.mensagem ?? 'falha'}`)
    }
  }
}

/**
 * Executa uma fila respeitando concorrência e pausa.
 *
 * A fila é processada em lotes do tamanho da concorrência efetiva (a MENOR
 * entre os recursos do lote), com pausa entre lotes. Nunca dispara todas as
 * promessas de uma vez — o caso real é `siconfi/dca` com 5.570 entes.
 */
async function executarFila<T>(
  itens: readonly T[],
  concorrencia: number,
  pausaMs: number,
  executar: (item: T) => Promise<void>,
): Promise<void> {
  const tamanhoLote = Math.max(1, concorrencia)

  for (let i = 0; i < itens.length; i += tamanhoLote) {
    const lote = itens.slice(i, i + tamanhoLote)
    await Promise.all(lote.map((item) => executar(item)))

    const ultimo = i + tamanhoLote >= itens.length
    if (!ultimo && pausaMs > 0) {
      await new Promise((r) => setTimeout(r, pausaMs))
    }
  }
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

async function main(args: Args): Promise<number> {
  const alvos = selecionarAlvos(args)
  if (alvos.length === 0) {
    console.error('\n✗ nenhum recurso `usado` corresponde ao filtro informado.\n')
    return 1
  }

  const raiz = raizPadrao()

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Orquestrador (Caixas 1 → 2 → 3)')
  console.log('╚══════════════════════════════════════════════════════════')
  console.log(`  Destino:        ${raiz}`)
  console.log(`  Recursos:       ${alvos.length}`)
  console.log(
    `  Anos:           ${args.anos ? args.anos.join(', ') : 'exemplo da Caixa 1 (por recurso)'}`,
  )
  if (Object.keys(args.parametros).length > 0) {
    console.log(
      `  Overrides:      ${Object.entries(args.parametros)
        .map(([k, v]) => `${k}=${v.length > 3 ? `${v.slice(0, 3).join(',')}… (${v.length})` : v.join(',')}`)
        .join(' | ')}`,
    )
  }
  console.log(`  Modo:           ${args.simular ? 'SIMULAÇÃO (não coleta)' : 'coleta real'}`)
  console.log('')

  const resumo = resumoVazio()

  for (const alvo of alvos) {
    const rotulo = `${alvo.fonte.id}/${alvo.recurso.id}`
    const politica = politicaPara(alvo.recurso)
    const concorrencia = concorrenciaPara(alvo.recurso)

    console.log(`━━━ ${rotulo} ━━━`)
    console.log(
      `  transporte=${alvo.recurso.transporte} paginacao=${alvo.recurso.paginacao} ` +
        `rateLimit=${alvo.recurso.rateLimit.nivel} concorrencia=${concorrencia} ` +
        `pausa=${politica.pausaEntreChamadasMs}ms`,
    )

    // Transporte manual não é executável pelo orquestrador.
    if (alvo.recurso.transporte === 'manual') {
      console.log('  ⏭  recurso manual — requer intervenção humana, pulando\n')
      continue
    }

    // Resolve o fan-out deste recurso.
    const ctx: ContextoParametro = {
      overrides: args.parametros,
      anos: args.anos,
      permitirLegado: !args.semLegado,
      avisos: [],
    }

    let dimensoes: Record<string, string[]>
    try {
      dimensoes = await resolverDimensoes(alvo.recurso, alvo.fonte.id, ctx)
    } catch (err) {
      if (err instanceof ErroParametro) {
        console.log(`  ⚠ ${err.message}\n`)
        continue
      }
      throw err
    }

    for (const aviso of ctx.avisos) console.log(`  ℹ ${aviso}`)

    // Monta a fila: produto cartesiano das dimensões (uma entrada por chamada).
    const nomes = Object.keys(dimensoes)
    let fila: Array<Record<string, string[]>> = [{}]
    for (const nome of nomes) {
      const proxima: Array<Record<string, string[]>> = []
      for (const combinacao of fila) {
        for (const valor of dimensoes[nome]!) {
          proxima.push({ ...combinacao, [nome]: [valor] })
        }
      }
      fila = proxima
    }

    const totalOriginal = fila.length
    if (args.limite > 0 && fila.length > args.limite) {
      fila = fila.slice(0, args.limite)
      console.log(`  ⚠ fila truncada em ${args.limite} de ${totalOriginal} combinações (--limite)`)
    }

    console.log(`  chamadas: ${fila.length}`)
    for (const [nome, valores] of Object.entries(dimensoes)) {
      console.log(`    ${nome}: ${valores.length} valor(es)`)
    }

    if (args.simular) {
      const amostra = fila
        .slice(0, 3)
        .map((c) => Object.entries(c).map(([k, v]) => `${k}=${v[0]}`).join(','))
        .join(' | ')
      console.log(`  → simulação: ${amostra}${fila.length > 3 ? ' | …' : ''}\n`)
      continue
    }

    await executarFila(fila, concorrencia, politica.pausaEntreChamadasMs, (combinacao) =>
      processarUma(alvo, combinacao, raiz, resumo),
    )
    console.log('')
  }

  console.log('══════════════════════════════════════════════════════════')
  console.log('  RESUMO')
  console.log('══════════════════════════════════════════════════════════')
  console.log(`  Coletas:       ${resumo.coletas}`)
  console.log(`  Gravados:      ${resumo.gravados}`)
  console.log(`  Deduplicados:  ${resumo.deduplicados}`)
  console.log(`  Sem dado:      ${resumo.ignorados}`)
  console.log(`  Erros:         ${resumo.erros}`)
  console.log(`  Destino:       ${raiz}`)
  console.log('══════════════════════════════════════════════════════════')

  // Repete os erros no FIM. Numa varredura de centenas de chamadas a linha de
  // erro sai no meio de milhares de linhas de progresso e passa despercebida —
  // foi assim que uma varredura de 854 entes terminou com 7 falhas que ninguém
  // viu. O resumo numérico sozinho não diz QUAIS chamadas falharam.
  if (resumo.falhas.length > 0) {
    console.log(`\n  ⚠ ${resumo.falhas.length} chamada(s) falharam:`)
    for (const falha of resumo.falhas) console.log(`    • ${falha}`)
    console.log('')
  }

  return resumo.erros > 0 ? 1 : 0
}

/**
 * Executa o orquestrador a partir da linha de comando.
 *
 * Fica atrás de guarda para que o módulo possa ser importado (funções puras
 * como `parseArgs` e `selecionarAlvos` são testáveis sem disparar a coleta).
 */
export async function executarCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv)

  const problema = validarArgs(args)
  if (problema) {
    console.error(`\n✗ ${problema}\n`)
    console.error('Uso:')
    console.error('  npm run coletar -- --tudo')
    console.error('  npm run coletar -- --fonte siconfi')
    console.error('  npm run coletar -- --recurso dca --param ente=3136702')
    console.error('  npm run coletar -- --recurso cdn-dados-abertos --anos 2022,2024')
    console.error('  npm run coletar -- --fonte ibge-localidades --simular\n')
    return 1
  }

  return main(args)
}

/** Só dispara quando executado diretamente (`tsx scripts/orquestrador/index.ts`). */
const invocadoDiretamente =
  process.argv[1] !== undefined && /orquestrador[\\/]index\.(ts|js|mts)$/.test(process.argv[1])

if (invocadoDiretamente) {
  executarCli()
    .then((codigo) => {
      if (codigo !== 0) process.exitCode = codigo
    })
    .catch((err) => {
      console.error('\n✗ Erro fatal no orquestrador:', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
