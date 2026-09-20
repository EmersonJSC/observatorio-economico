/**
 * Caixa 4 — ORGANIZAÇÃO: engrenagem principal.
 *
 * Fluxo:
 *   1. lê o `manifest.json` do RAW (Caixa 3) e resolve os objetos
 *   2. abre o JSONL de saída e o de quarentena
 *   3. para cada objeto, itera os registros e aplica o tradutor
 *   4. grava bons no JSONL e ruins na quarentena (contando ambos)
 *   5. verifica o limiar de quarentena e ABORTA se excedido
 *   6. grava o `.meta.json` no final
 *
 * Objetos paginados: TODOS os objetos do manifesto daquela coleta são lidos em
 * sequência e concatenados logicamente em um único JSONL de saída, conforme
 * diretriz aprovada.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { extrairCampo } from './campos.js'
import {
  caminhoQuarentena,
  caminhoSaida,
  contagensZeradas,
  EscritorJsonl,
  EscritorQuarentena,
  gravarMetadados,
} from './escritores/jsonl.js'
import { iterarJson, type RegistroBruto } from './leitura/json.js'
import { iterarCsvsDoZip } from './leitura/zip.js'
import type { FormaLettura } from './tipos.js'

/**
 * Itera os registros de UM objeto do RAW, escolhendo o leitor pela forma
 * declarada no tradutor. É o único ponto que decide JSON × CSV-em-ZIP.
 */
async function* iterarObjeto(
  caminhoAbsoluto: string,
  arquivoRelativo: string,
  forma: FormaLettura,
): AsyncGenerator<RegistroBruto> {
  if (forma.tipo === 'zip-csv') {
    yield* iterarCsvsDoZip(caminhoAbsoluto, {
      separador: forma.separador,
      encoding: forma.encoding as 'latin1' | 'windows-1252' | 'utf-8',
    })
    return
  }
  yield* iterarJson(caminhoAbsoluto, arquivoRelativo, forma)
}
import type {
  CampoMapeado,
  LinhaQuarentena,
  MetadadosOrganizacao,
  MotivoRejeicao,
  OpcoesOrganizacao,
  RegistroOrganizado,
  ResultadoOrganizacao,
  Tradutor,
} from './tipos.js'
import { ErroOrganizacao, VERSAO_ORGANIZACAO } from './tipos.js'

const RAIZ_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Fração máxima de linhas em quarentena antes de abortar (diretriz: 1%). */
const LIMIAR_QUARENTENA_PADRAO = 0.01

// ---------------------------------------------------------------------------
// Manifesto (contrato da Caixa 3)
// ---------------------------------------------------------------------------

/** Um objeto preservado no RAW, conforme o manifesto da Caixa 3. */
interface ObjetoRaw {
  hash: string
  arquivo: string
  extensao: string
  tamanho: number
  formato: string
  pagina?: number
}

interface ManifestoRaw {
  fonteId: string
  recursoId: string
  objetos: ObjetoRaw[]
}

/** Lê o manifesto de um recurso no RAW. */
export async function lerManifesto(
  raizRaw: string,
  fonteId: string,
  recursoId: string,
): Promise<ManifestoRaw | null> {
  const caminho = join(raizRaw, fonteId, recursoId, 'manifest.json')
  if (!existsSync(caminho)) return null
  try {
    const m = JSON.parse(await readFile(caminho, 'utf-8')) as ManifestoRaw
    if (!Array.isArray(m.objetos)) return null
    return m
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Conversão de um registro
// ---------------------------------------------------------------------------

/** Resultado da conversão de uma linha. */
type ResultadoLinha =
  | { ok: true; registro: RegistroOrganizado }
  | { ok: false; motivo: MotivoRejeicao; detalhe: string }

/**
 * Converte um registro bruto usando os campos do tradutor.
 *
 * Regra dura (diretriz aprovada): campo obrigatório ausente → ABORTA a
 * organização inteira, não apenas a linha. É o que protege contra renomeação
 * silenciosa no layout do governo (problema P2 da auditoria).
 */
function converterRegistro(
  bruto: unknown,
  campos: readonly CampoMapeado[],
  contexto: { fonteId: string; recursoId: string; arquivo: string; indice: number },
): ResultadoLinha {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return {
      ok: false,
      motivo: 'registro-malformado',
      detalhe: `esperado objeto, recebido ${bruto === null ? 'null' : Array.isArray(bruto) ? 'array' : typeof bruto}`,
    }
  }

  const registro: Record<string, string | number | boolean | null> = {}

  for (const campo of campos) {
    const resultado = extrairCampo(bruto, campo)

    if (resultado.estado === 'ausente') {
      if (campo.obrigatorio) {
        throw new ErroOrganizacao(
          `campo obrigatório ausente no layout da origem: "${campo.origem}" ` +
            `→ "${campo.destino}"${campo.descricao ? ` (${campo.descricao})` : ''}\n` +
            `  Recurso: ${contexto.fonteId}/${contexto.recursoId}\n` +
            `  Arquivo: ${contexto.arquivo}, registro ${contexto.indice}\n` +
            `  Provável mudança de layout na fonte. Ajuste o tradutor antes de reprocessar.`,
          contexto.fonteId,
          contexto.recursoId,
          'campo-obrigatorio-ausente',
        )
      }
      // Opcional ausente: ausência legítima, sem contar como erro.
      registro[campo.destino] = null
      continue
    }

    if (resultado.estado === 'invalido') {
      return {
        ok: false,
        motivo: 'tipo-invalido',
        detalhe: `campo "${campo.destino}" (origem "${campo.origem}"): ${resultado.detalhe}`,
      }
    }

    registro[campo.destino] = resultado.valor
  }

  return { ok: true, registro }
}

// ---------------------------------------------------------------------------
// Organização de um recurso
// ---------------------------------------------------------------------------

/** Organiza um recurso do RAW aplicando o tradutor. */
export async function organizarRecurso(
  tradutor: Tradutor,
  opcoes: OpcoesOrganizacao = {},
): Promise<ResultadoOrganizacao> {
  const raizRaw = opcoes.raizRaw ?? join(RAIZ_PROJETO, 'data', 'raw')
  const raizSaida = opcoes.raizSaida ?? join(RAIZ_PROJETO, 'data', 'organized')
  const limiar = opcoes.limiarQuarentena ?? LIMIAR_QUARENTENA_PADRAO
  const agora = (opcoes.agora ?? (() => new Date()))()

  const { fonteId, recursoId } = tradutor

  const manifesto = await lerManifesto(raizRaw, fonteId, recursoId)
  if (!manifesto || manifesto.objetos.length === 0) {
    throw new ErroOrganizacao(
      `não há objetos no RAW para ${fonteId}/${recursoId}. ` +
        `Rode a coleta antes de organizar.`,
      fonteId,
      recursoId,
      'raw-ausente',
    )
  }

  const objetos =
    opcoes.limiteObjetos !== undefined
      ? manifesto.objetos.slice(0, opcoes.limiteObjetos)
      : manifesto.objetos

  const saida = caminhoSaida(raizSaida, fonteId, recursoId)
  const caminhoQuar = caminhoQuarentena(raizSaida, fonteId, recursoId)

  const escritor = new EscritorJsonl(saida)
  const quarentena = new EscritorQuarentena(caminhoQuar)
  const contagens = contagensZeradas()
  const avisos: string[] = []

  await escritor.abrir()
  await quarentena.abrir()

  try {
    for (const objeto of objetos) {
      const caminhoAbsoluto = join(raizRaw, objeto.arquivo)

      const iterador = iterarObjeto(caminhoAbsoluto, objeto.arquivo, tradutor.leitura)

      for await (const bruto of iterador) {
        await processarRegistro(bruto, tradutor, {
          contagens,
          escritor,
          quarentena,
          avisos,
          limiar,
          fonteId,
          recursoId,
        })
      }
    }

    // O limiar é verificado sobre o total acumulado, ao final.
    verificarLimiar(contagens, limiar, fonteId, recursoId)

    await escritor.fechar()
    if (contagens.quarentenadas > 0) await quarentena.fechar()
    else await quarentena.abortar()

    const metadados: MetadadosOrganizacao = {
      fonteId,
      recursoId,
      versaoOrganizacao: VERSAO_ORGANIZACAO,
      versaoEsquema: tradutor.versaoEsquema,
      organizadoEm: agora.toISOString(),
      origensRaw: objetos.map((o) => o.hash),
      objetosRaw: objetos.length,
      contagens,
      avisos,
    }
    await gravarMetadados(raizSaida, metadados)

    return {
      fonteId,
      recursoId,
      saida: relative(RAIZ_PROJETO, saida),
      ...(contagens.quarentenadas > 0 ? { quarentena: relative(RAIZ_PROJETO, caminhoQuar) } : {}),
      contagens,
      metadados,
    }
  } catch (err) {
    // Execução abortada não deixa saída parcial parecendo boa.
    await escritor.abortar()
    await quarentena.abortar()
    throw err
  }
}

/** Processa um registro bruto: valida, converte e direciona. */
async function processarRegistro(
  bruto: RegistroBruto,
  tradutor: Tradutor,
  ctx: {
    contagens: ReturnType<typeof contagensZeradas>
    escritor: EscritorJsonl
    quarentena: EscritorQuarentena
    avisos: string[]
    limiar: number
    fonteId: string
    recursoId: string
  },
): Promise<void> {
  const { valor, origem } = bruto

  // Desmembramento: um registro aninhado pode virar vários registros planos
  // (caso do SIDRA, cujo `resultados[].series[]` traz uma localidade por série).
  //
  // O contador `lidas` conta LINHAS DE SAÍDA, não itens do arquivo: quando há
  // desmembramento, o container não conta — só os pedaços. Sem isso, um item
  // que vira 200 linhas contaria 201, e os totais deixariam de fechar.
  if (tradutor.desmembrar) {
    const pedacos = tradutor.desmembrar(valor)
    if (pedacos.length !== 1 || pedacos[0] !== valor) {
      for (const pedaco of pedacos) {
        await processarRegistro(
          { valor: pedaco, origem },
          { ...tradutor, desmembrar: undefined },
          ctx,
        )
      }
      return
    }
  }

  ctx.contagens.lidas++

  // Validação de negócio declarada pelo tradutor, antes da conversão.
  if (tradutor.validar) {
    const v = tradutor.validar(valor)
    if (!v.ok) {
      await mandarParaQuarentena(ctx, {
        linha: origem.indice,
        motivo: v.motivo,
        detalhe: v.detalhe,
        bruto: valor,
        origem: origem.arquivo,
      })
      return
    }
  }

  let resultado: ResultadoLinha
  try {
    resultado = converterRegistro(valor, tradutor.campos, {
      fonteId: ctx.fonteId,
      recursoId: ctx.recursoId,
      arquivo: origem.arquivo,
      indice: origem.indice,
    })
  } catch (err) {
    // ErroOrganizacao (campo obrigatório ausente) sobe: aborta tudo.
    if (err instanceof ErroOrganizacao) throw err
    resultado = {
      ok: false,
      motivo: 'erro-no-tradutor',
      detalhe: err instanceof Error ? err.message : String(err),
    }
  }

  if (!resultado.ok) {
    await mandarParaQuarentena(ctx, {
      linha: origem.indice,
      motivo: resultado.motivo,
      detalhe: resultado.detalhe,
      bruto: valor,
      origem: origem.arquivo,
    })
    return
  }

  const final = tradutor.refinar ? tradutor.refinar(resultado.registro, valor) : resultado.registro
  await ctx.escritor.escrever(final)
  ctx.contagens.gravadas++

  // Checa o limiar periodicamente, para abortar cedo em layout muito quebrado.
  if (ctx.contagens.lidas % 1000 === 0) {
    verificarLimiar(ctx.contagens, ctx.limiar, ctx.fonteId, ctx.recursoId)
  }
}

/** Envia uma linha para a quarentena. */
async function mandarParaQuarentena(
  ctx: { contagens: ReturnType<typeof contagensZeradas>; quarentena: EscritorQuarentena },
  linha: LinhaQuarentena,
): Promise<void> {
  await ctx.quarentena.escrever(linha)
  ctx.contagens.quarentenadas++
}

/**
 * Aborta quando a fração de linhas em quarentena excede o limiar.
 *
 * Um layout muito quebrado produz muitas linhas ruins; seguir em frente
 * publicaria um dataset quase vazio sem ninguém perceber.
 */
function verificarLimiar(
  contagens: ReturnType<typeof contagensZeradas>,
  limiar: number,
  fonteId: string,
  recursoId: string,
): void {
  if (contagens.lidas === 0) return
  const fracao = contagens.quarentenadas / contagens.lidas
  if (fracao > limiar) {
    throw new ErroOrganizacao(
      `quarentena acima do limiar: ${contagens.quarentenadas}/${contagens.lidas} ` +
        `(${(fracao * 100).toFixed(2)}% > ${(limiar * 100).toFixed(2)}%)\n` +
        `  Recurso: ${fonteId}/${recursoId}\n` +
        `  Indica mudança de layout na fonte. Inspecione o *.quarentena.jsonl`,
      fonteId,
      recursoId,
      'limiar-quarentena',
    )
  }
}
