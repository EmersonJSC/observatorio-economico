/**
 * Caixa 4 — ORGANIZAÇÃO: porta de entrada.
 *
 * Lê o RAW (Caixa 3), aplica o tradutor da fonte e grava registros de domínio
 * limpos em `data/organized/<fonteId>/<recursoId>.jsonl`, com metadados em
 * `.meta.json`.
 *
 * Uso típico:
 *
 *   import { organizar, organizarTudo } from './scripts/organizacao/index.js'
 *
 *   // Um recurso
 *   await organizar('ibge-localidades', 'estados')
 *
 *   // Tudo o que tem tradutor
 *   await organizarTudo()
 *
 * CLI:
 *   npm run organizar -- --fonte ibge-localidades
 *   npm run organizar -- --recurso estados
 *   npm run organizar -- --tudo
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { organizarRecurso } from './organizar.js'
import { buscarTradutor, recursosComTradutor, TRADUTORES } from './tradutores/indice.js'
import type { OpcoesOrganizacao, ResultadoOrganizacao } from './tipos.js'
import { ErroOrganizacao, VERSAO_ORGANIZACAO } from './tipos.js'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export { organizarRecurso, lerManifesto } from './organizar.js'
export { TRADUTORES, buscarTradutor, recursosComTradutor } from './tradutores/indice.js'
export { VERSAO_ORGANIZACAO } from './tipos.js'
export type {
  Tradutor,
  CampoMapeado,
  TipoCampo,
  RegistroOrganizado,
  ResultadoValidacao,
  ResultadoOrganizacao,
  MetadadosOrganizacao,
  ContagensOrganizacao,
  OpcoesOrganizacao,
} from './tipos.js'

/** Raiz padrão da saída organizada. */
export function raizOrganizada(): string {
  return join(RAIZ_PROJETO, 'data', 'organized')
}

/** Organiza UM recurso pelo par fonte/recurso. */
export async function organizar(
  fonteId: string,
  recursoId: string,
  opcoes: OpcoesOrganizacao = {},
): Promise<ResultadoOrganizacao> {
  const tradutor = buscarTradutor(fonteId, recursoId)
  if (!tradutor) {
    throw new ErroOrganizacao(
      `não há tradutor implementado para ${fonteId}/${recursoId}.\n` +
        `  Disponíveis: ${recursosComTradutor()
          .map((r) => `${r.fonteId}/${r.recursoId}`)
          .join(', ')}`,
      fonteId,
      recursoId,
      'tradutor-ausente',
    )
  }
  return organizarRecurso(tradutor, opcoes)
}

/**
 * Organiza todos os recursos que têm tradutor.
 *
 * Uma falha em um recurso não impede os demais: os erros são coletados e
 * devolvidos junto com os sucessos, para que o operador veja o quadro inteiro.
 */
export async function organizarTudo(
  opcoes: OpcoesOrganizacao = {},
): Promise<{ resultados: ResultadoOrganizacao[]; erros: ErroOrganizacao[] }> {
  const resultados: ResultadoOrganizacao[] = []
  const erros: ErroOrganizacao[] = []

  for (const tradutor of TRADUTORES) {
    try {
      resultados.push(await organizarRecurso(tradutor, opcoes))
    } catch (err) {
      if (err instanceof ErroOrganizacao) erros.push(err)
      else throw err
    }
  }

  return { resultados, erros }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Executa a organização a partir da linha de comando. */
export async function executarCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const pegar = (nome: string): string | undefined => {
    const comIgual = argv.find((a) => a.startsWith(`--${nome}=`))
    if (comIgual) return comIgual.slice(nome.length + 3)
    const i = argv.indexOf(`--${nome}`)
    const proximo = i >= 0 ? argv[i + 1] : undefined
    return proximo && !proximo.startsWith('--') ? proximo : undefined
  }

  const tudo = argv.includes('--tudo')
  const fonte = pegar('fonte')
  const recurso = pegar('recurso')
  const limite = Number(pegar('limite') ?? '0') || undefined

  if (!tudo && !fonte && !recurso) {
    console.error('\n✗ informe --tudo, --fonte <id> ou --recurso <id>\n')
    console.error('Uso:')
    console.error('  npm run organizar -- --tudo')
    console.error('  npm run organizar -- --fonte ibge-localidades')
    console.error('  npm run organizar -- --recurso estados\n')
    return 1
  }

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Organização (Caixa 4)')
  console.log('╚══════════════════════════════════════════════════════════')
  console.log(`  Destino: ${raizOrganizada()}`)
  console.log('')

  const alvos = TRADUTORES.filter((t) => {
    if (fonte && t.fonteId !== fonte) return false
    if (recurso && t.recursoId !== recurso) return false
    return true
  })

  if (alvos.length === 0) {
    console.error('✗ nenhum tradutor corresponde ao filtro.\n')
    return 1
  }

  let falhas = 0

  for (const tradutor of alvos) {
    const rotulo = `${tradutor.fonteId}/${tradutor.recursoId}`
    try {
      const r = await organizarRecurso(tradutor, {
        ...(limite !== undefined ? { limiteObjetos: limite } : {}),
      })
      console.log(
        `[OK] ${rotulo} — lidas: ${r.contagens.lidas}, gravadas: ${r.contagens.gravadas}, ` +
          `quarentena: ${r.contagens.quarentenadas} -> ${r.saida}`,
      )
    } catch (err) {
      falhas++
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[FALHA] ${rotulo} — ${msg.split('\n')[0]}`)
      if (err instanceof ErroOrganizacao && err.motivo === 'raw-ausente') {
        console.error('        (o recurso ainda não foi coletado para o RAW)')
      }
    }
  }

  console.log('')
  console.log(`  Recursos organizados: ${alvos.length - falhas}/${alvos.length}`)
  console.log(`  Versão da Caixa 4:    ${VERSAO_ORGANIZACAO}`)
  console.log('')

  return falhas > 0 ? 1 : 0
}

const invocadoDiretamente =
  process.argv[1] !== undefined && /organizacao[\\/]index\.(ts|js|mts)$/.test(process.argv[1])

if (invocadoDiretamente) {
  executarCli()
    .then((codigo) => {
      if (codigo !== 0) process.exitCode = codigo
    })
    .catch((err) => {
      console.error('\n✗ Erro fatal na organização:', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
