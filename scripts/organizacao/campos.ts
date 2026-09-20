/**
 * Caixa 4 — ORGANIZAÇÃO: conversores de campo.
 *
 * Converte valores da origem para o domínio, sem nunca produzir `NaN` nem
 * string vazia representando ausência.
 *
 * Regra central (corrige o problema P1 da auditoria): conversão que falha
 * devolve `null` e SINALIZA erro — nunca contamina somas com `NaN` em
 * silêncio, como fazia `Number(x ?? 0)` no legado.
 */

import type { CampoMapeado, TipoCampo } from './tipos.js'

/** Resultado de uma conversão. */
export type ResultadoConversao =
  | { ok: true; valor: string | number | boolean | null }
  | { ok: false; detalhe: string }

/**
 * Lê um valor da origem por caminho pontuado (`a.b.c`).
 *
 * Devolve `undefined` quando qualquer trecho do caminho não existe — o núcleo
 * distingue isso de `null` (ausência explícita).
 */
export function lerCaminho(origem: unknown, caminho: string): unknown {
  if (caminho === '') return origem
  let atual: unknown = origem
  for (const parte of caminho.split('.')) {
    if (atual === null || typeof atual !== 'object') return undefined
    atual = (atual as Record<string, unknown>)[parte]
  }
  return atual
}

/** `true` quando o valor representa ausência legítima declarada pelo tradutor. */
function ehNuloConhecido(valor: unknown, nulos?: readonly string[]): boolean {
  if (valor === null || valor === undefined) return true
  if (typeof valor === 'string' && valor.trim() === '') return true
  if (!nulos) return false
  return typeof valor === 'string' && nulos.includes(valor.trim())
}

/** Converte um valor bruto conforme o tipo declarado. */
export function converter(valor: unknown, tipo: TipoCampo): ResultadoConversao {
  switch (tipo) {
    case 'texto': {
      if (typeof valor === 'string') {
        const limpo = valor.trim()
        return { ok: true, valor: limpo === '' ? null : limpo }
      }
      if (typeof valor === 'number' || typeof valor === 'boolean') {
        return { ok: true, valor: String(valor) }
      }
      return { ok: false, detalhe: `esperado texto, recebido ${typeof valor}` }
    }

    case 'codigo': {
      // Identificadores preservam zeros à esquerda e nunca viram número.
      if (typeof valor === 'string') {
        const limpo = valor.trim()
        return { ok: true, valor: limpo === '' ? null : limpo }
      }
      if (typeof valor === 'number' && Number.isFinite(valor)) {
        return { ok: true, valor: String(valor) }
      }
      return { ok: false, detalhe: `esperado código, recebido ${typeof valor}` }
    }

    case 'inteiro': {
      const n = paraNumero(valor)
      if (n === null) return { ok: false, detalhe: `não é número: ${descrever(valor)}` }
      if (!Number.isInteger(n)) return { ok: false, detalhe: `não é inteiro: ${n}` }
      return { ok: true, valor: n }
    }

    case 'decimal': {
      const n = paraNumero(valor)
      if (n === null) return { ok: false, detalhe: `não é número: ${descrever(valor)}` }
      return { ok: true, valor: n }
    }

    case 'booleano': {
      if (typeof valor === 'boolean') return { ok: true, valor }
      if (typeof valor === 'number') {
        if (valor === 1) return { ok: true, valor: true }
        if (valor === 0) return { ok: true, valor: false }
        return { ok: false, detalhe: `booleano inválido: ${valor}` }
      }
      if (typeof valor === 'string') {
        const v = valor.trim().toUpperCase()
        if (['S', 'SIM', 'TRUE', '1'].includes(v)) return { ok: true, valor: true }
        if (['N', 'NAO', 'NÃO', 'FALSE', '0'].includes(v)) return { ok: true, valor: false }
        return { ok: false, detalhe: `booleano inválido: ${valor}` }
      }
      return { ok: false, detalhe: `esperado booleano, recebido ${typeof valor}` }
    }

    case 'data': {
      if (typeof valor !== 'string') {
        return { ok: false, detalhe: `esperada data textual, recebido ${typeof valor}` }
      }
      const texto = valor.trim()
      if (texto === '') return { ok: true, valor: null }
      // Aceita apenas ISO 8601 (YYYY-MM-DD), eventualmente com hora.
      const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(texto)
      if (!iso) return { ok: false, detalhe: `data fora do padrão ISO: ${texto}` }
      const [, a, m, d] = iso
      const normalizada = `${a}-${m}-${d}`
      const data = new Date(`${normalizada}T00:00:00Z`)
      if (Number.isNaN(data.getTime())) return { ok: false, detalhe: `data inválida: ${texto}` }
      return { ok: true, valor: normalizada }
    }

    default: {
      const exaustivo: never = tipo
      return { ok: false, detalhe: `tipo desconhecido: ${String(exaustivo)}` }
    }
  }
}

/** Converte para número aceitando o formato brasileiro (vírgula decimal). */
function paraNumero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor !== 'string') return null

  const texto = valor.trim()
  if (texto === '') return null

  // Formato brasileiro: "1.234,56" → "1234.56"
  const brasileiro = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/
  const normalizado = brasileiro.test(texto)
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto.replace(',', '.')

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/** Descrição curta de um valor, para mensagens de erro. */
function descrever(valor: unknown): string {
  if (valor === null) return 'null'
  if (valor === undefined) return 'ausente'
  if (typeof valor === 'string') return JSON.stringify(valor.slice(0, 40))
  return String(valor).slice(0, 40)
}

/**
 * Lê e converte um campo mapeado de um registro bruto.
 *
 * Distingue três situações:
 *   - `ausente`  → o campo não existe na origem (indica mudança de layout)
 *   - `nulo`     → existe mas representa ausência legítima
 *   - `ok`       → valor convertido
 */
export type ResultadoCampo =
  | { estado: 'ok'; valor: string | number | boolean | null }
  | { estado: 'ausente' }
  | { estado: 'invalido'; detalhe: string }

export function extrairCampo(bruto: unknown, campo: CampoMapeado): ResultadoCampo {
  const valorCru = lerCaminho(bruto, campo.origem)

  // `undefined` = o campo não existe na origem. Isso é DISTINTO de null:
  // é exatamente o sintoma de coluna renomeada (problema P2 da auditoria).
  if (valorCru === undefined) {
    if (campo.nulosConhecidos || campo.tipo === 'texto' || campo.tipo === 'codigo') {
      // Campo textual pode legitimamente não existir em algumas feições.
      return { estado: 'ausente' }
    }
    return { estado: 'ausente' }
  }

  if (ehNuloConhecido(valorCru, campo.nulosConhecidos)) {
    return { estado: 'ok', valor: null }
  }

  const convertido = converter(valorCru, campo.tipo)
  if (!convertido.ok) return { estado: 'invalido', detalhe: convertido.detalhe }
  return { estado: 'ok', valor: convertido.valor }
}
