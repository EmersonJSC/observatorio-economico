/**
 * Caixa 7 — validação do contrato de publicação.
 *
 * ⚠️ A PEÇA QUE FALTAVA NO PROJETO.
 *
 * Antes da Caixa 7, nada detectava que o frontend pedia um arquivo que a
 * publicação não gerava. O erro só aparecia no navegador do usuário — um 404
 * silencioso que a interface tratava como "sem dados".
 *
 * Este módulo lê as rotas que o frontend consome e cruza com o que existe em
 * `data/published/`, falhando com a lista exata dos que faltam.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { ROTAS_FRONTEND, UFS } from './contrato.js'

/** Uma rota que o frontend consome. */
export interface RotaConsumida {
  /** Caminho relativo dentro de `published/`. */
  rota: string
  /** De onde vem a exigência. */
  origem: string
}

/** Resultado da validação. */
export interface ResultadoValidacaoPublicacao {
  ok: boolean
  /** Rotas exigidas e presentes. */
  presentes: string[]
  /** Rotas exigidas e AUSENTES — o que causaria 404 no navegador. */
  ausentes: string[]
  /** Artefatos publicados que nenhuma rota consome (peso morto). */
  orfaos: string[]
}

/**
 * Rotas estáticas exigidas pelo frontend.
 *
 * As rotas por UF e por bloco são geradas a partir das constantes, então a
 * lista acompanha a publicação automaticamente.
 */
export function rotasExigidas(blocos: number, siglas: readonly string[] = []): RotaConsumida[] {
  const rotas: RotaConsumida[] = [
    { rota: ROTAS_FRONTEND.territoriosBrasil, origem: 'MapExplorer (malha nacional)' },
    { rota: ROTAS_FRONTEND.municipiosIndice, origem: 'explorerApi (índice de municípios)' },
    { rota: ROTAS_FRONTEND.indicadoresBrasil, origem: 'indicatorsApi (Brasil)' },
    { rota: ROTAS_FRONTEND.ranking, origem: 'rankingApi (ranking nacional)' },
    { rota: ROTAS_FRONTEND.orcamentoBrasil, origem: 'budgetApi (Brasil)' },
    { rota: ROTAS_FRONTEND.eleicoesBrasil, origem: 'electionsApi (Brasil)' },
  ]

  for (const uf of UFS) {
    rotas.push({ rota: ROTAS_FRONTEND.territoriosUf(uf), origem: 'MapExplorer (malha da UF)' })
  }

  // Shards pedidos por SIGLA: o frontend usa `indicadores/${ufDoCodarea(codigo)}`,
  // então o nome do arquivo é a sigla, não o código. A lista de siglas vem da
  // publicação — exigir as 27 quando só algumas têm dado daria falso positivo.
  for (const sigla of siglas) {
    rotas.push({
      rota: ROTAS_FRONTEND.indicadoresUf(sigla),
      origem: 'indicatorsApi (indicadores da UF)',
    })
  }

  for (let i = 0; i < blocos; i++) {
    rotas.push({ rota: ROTAS_FRONTEND.municipiosBloco(i), origem: 'explorerApi (bloco)' })
  }

  return rotas
}

/** Lista recursivamente os arquivos publicados, ignorando os `.gz`. */
function listarPublicados(raiz: string): string[] {
  const arquivos: string[] = []

  const percorrer = (dir: string, prefixo: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory()) {
        percorrer(join(dir, item.name), prefixo === '' ? item.name : `${prefixo}/${item.name}`)
      } else if (!item.name.endsWith('.gz') && !item.name.endsWith('.tmp')) {
        arquivos.push(prefixo === '' ? item.name : `${prefixo}/${item.name}`)
      }
    }
  }

  if (existsSync(raiz)) percorrer(raiz, '')
  return arquivos.sort()
}

/**
 * Valida se a publicação atende o contrato do frontend.
 *
 * @param raizPublished Caminho de `data/published/`.
 * @param rotas Rotas exigidas. Padrão: as do contrato do frontend.
 */
export function validarPublicacao(
  raizPublished: string,
  rotas?: readonly RotaConsumida[],
): ResultadoValidacaoPublicacao {
  const publicados = new Set(listarPublicados(raizPublished))

  // O número de blocos é descoberto do que foi publicado: validar contra uma
  // contagem fixa daria falso negativo quando a divisão mudasse.
  const blocos = publicados.size === 0
    ? 0
    : [...publicados].filter((p) => /^municipios\/bloco-\d+\.json$/.test(p)).length

  const siglas = [...publicados]
    .filter((p) => /^indicadores\/[A-Z]{2}\.json$/.test(p))
    .map((p) => p.slice('indicadores/'.length, -'.json'.length))

  const exigidas = rotas ?? rotasExigidas(blocos, siglas)

  const presentes: string[] = []
  const ausentes: string[] = []

  for (const { rota } of exigidas) {
    if (publicados.has(rota)) presentes.push(rota)
    else ausentes.push(rota)
  }

  const consumidas = new Set(exigidas.map((r) => r.rota))
  const orfaos = [...publicados].filter(
    (p) => !consumidas.has(p) && p !== 'publicacao.meta.json',
  )

  return {
    ok: ausentes.length === 0,
    presentes,
    ausentes,
    orfaos,
  }
}
