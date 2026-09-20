/**
 * Caixa 4 — tradutor do Siconfi (DCA — Declaração de Contas Anuais).
 *
 * Forma real da origem (verificada no RAW do projeto): um envelope `items[]`
 * com CENTENAS de linhas por ente, uma por (anexo, conta, coluna). Exemplo:
 *
 *   { exercicio: 2023, cod_ibge: 3100302, anexo: 'DCA-Anexo I-AB',
 *     cod_conta: 'P1.0.0.0.0.00.00', coluna: '31/12/2023', valor: 12345.67 }
 *
 * É o caso OPOSTO do SIDRA: lá um registro virava N linhas; aqui N linhas viram
 * UM registro. Por isso o tradutor não usa `desmembrar`, e sim **agregação
 * durante a tradução**: o envelope é uma linha de saída por ente, com os
 * totais já somados.
 *
 * A seleção de contas replica o mapeamento já validado no projeto:
 *   Receita Total  → Anexo I-C, conta `ReceitasExcetoIntraOrcamentarias`
 *   Despesa Total  → Anexo I-D, conta `TotalDespesas`
 *   Saúde          → Anexo I-E, conta iniciando em "10 - Saúde"
 *   Educação       → Anexo I-E, conta iniciando em "12 - Educação"
 */

import type { Tradutor } from '../tipos.js'

/** Contas e colunas usadas, conforme o mapeamento validado no projeto. */
const ANEXO_RECEITA = 'DCA-Anexo I-C'
const ANEXO_DESPESA = 'DCA-Anexo I-D'
const ANEXO_FUNCOES = 'DCA-Anexo I-E'
const COD_CONTA_RECEITA = 'ReceitasExcetoIntraOrcamentarias'
const COD_CONTA_DESPESA = 'TotalDespesas'
const COLUNA_RECEITA = 'Receitas Brutas Realizadas'
const COLUNA_DESPESA = 'Despesas Liquidadas'
const FUNCAO_SAUDE = '10 - Saúde'
const FUNCAO_EDUCACAO = '12 - Educação'

/** Uma linha do envelope `items[]` do Siconfi. */
interface ItemDca {
  exercicio?: number
  instituicao?: string
  cod_ibge?: number | string
  uf?: string
  anexo?: string
  coluna?: string
  cod_conta?: string
  conta?: string
  valor?: number
}

/** Envelope devolvido pela API do Siconfi. */
interface EnvelopeDca {
  items?: ItemDca[]
}

/** Acumulador por ente. */
interface AcumuladoEnte {
  exercicio: number
  instituicao: string
  codarea: string
  uf: string
  receitaTotal: number | null
  despesaTotal: number | null
  gastoSaude: number | null
  gastoEducacao: number | null
}

/** Soma um valor a um acumulador, tratando o primeiro caso. */
function acumular(atual: number | null, valor: number): number {
  return (atual ?? 0) + valor
}

/**
 * Normaliza o código do ente preservando a distinção UF × município.
 *
 * Regra real do Siconfi (verificada no RAW): estados vêm com 2 dígitos (`31`)
 * e municípios com 7 (`3136702`). Aplicar `padStart(7)` em tudo corromperia o
 * código do estado, transformando `31` em `0000031` — que não existe no IBGE e
 * quebraria qualquer junção posterior.
 *
 * Códigos de 3 a 6 dígitos são municípios incompletos (zeros à esquerda
 * perdidos na serialização) e são completados até 7.
 */
export function normalizarCodigoEnte(codigo: number | string): string {
  const texto = String(codigo).trim()
  if (texto.length <= 2) return texto.padStart(2, '0')
  return texto.padStart(7, '0')
}

/**
 * Agrega um envelope do DCA em uma linha por ente.
 *
 * Exportada para teste: é a peça que troca "muitas linhas por ente" por
 * "uma linha por ente".
 *
 * @returns Uma linha por `cod_ibge` presente no envelope.
 */
export function agregarEnvelopeDca(bruto: unknown): AcumuladoEnte[] {
  const envelope = bruto as EnvelopeDca
  if (!envelope || !Array.isArray(envelope.items)) return []

  const porEnte = new Map<string, AcumuladoEnte>()

  for (const item of envelope.items) {
    // Sem código de ente não há como atribuir a linha a um município.
    if (item.cod_ibge === undefined || item.cod_ibge === null) continue

    const codarea = normalizarCodigoEnte(item.cod_ibge)
    const exercicio = typeof item.exercicio === 'number' ? item.exercicio : 0

    let acc = porEnte.get(codarea)
    if (!acc) {
      acc = {
        exercicio,
        instituicao: item.instituicao ?? '',
        codarea,
        uf: item.uf ?? '',
        receitaTotal: null,
        despesaTotal: null,
        gastoSaude: null,
        gastoEducacao: null,
      }
      porEnte.set(codarea, acc)
    }

    const valor = item.valor
    if (typeof valor !== 'number' || !Number.isFinite(valor)) continue

    if (
      item.anexo === ANEXO_RECEITA &&
      item.cod_conta === COD_CONTA_RECEITA &&
      item.coluna === COLUNA_RECEITA
    ) {
      acc.receitaTotal = acumular(acc.receitaTotal, valor)
    } else if (
      item.anexo === ANEXO_DESPESA &&
      item.cod_conta === COD_CONTA_DESPESA &&
      item.coluna === COLUNA_DESPESA
    ) {
      acc.despesaTotal = acumular(acc.despesaTotal, valor)
    } else if (item.anexo === ANEXO_FUNCOES && item.coluna === COLUNA_DESPESA) {
      const conta = item.conta ?? ''
      if (conta.startsWith(FUNCAO_SAUDE)) {
        acc.gastoSaude = acumular(acc.gastoSaude, valor)
      } else if (conta.startsWith(FUNCAO_EDUCACAO)) {
        acc.gastoEducacao = acumular(acc.gastoEducacao, valor)
      }
    }
  }

  return [...porEnte.values()]
}

/**
 * Expande o envelope em uma linha por ente.
 *
 * O núcleo da Caixa 4 itera os registros de `items[]` e chamaria `desmembrar`
 * por item — o que não serve, porque a agregação precisa do envelope INTEIRO.
 * Por isso o desmembramento é feito na raiz: `items[]` (um array) é recebido
 * como um único registro e devolve as linhas já agregadas.
 */
function desmembrarEnvelope(bruto: unknown): unknown[] {
  return agregarEnvelopeDca(bruto)
}

/**
 * Campos da saída.
 *
 * Os valores já vêm agregados de `desmembrarEnvelope`, então o mapeamento é
 * direto — o tipo `decimal` garante que nenhum `NaN` escape.
 */
export const tradutorSiconfiDca: Tradutor = {
  fonteId: 'siconfi',
  recursoId: 'dca',
  versaoEsquema: 1,
  // O RAW é um objeto único com `items[]` dentro.
  leitura: { tipo: 'json-objeto' },
  campos: [
    {
      origem: 'codarea',
      destino: 'codarea',
      tipo: 'codigo',
      obrigatorio: true,
      descricao: 'Código IBGE do ente (7 dígitos município, 2 estado)',
    },
    {
      origem: 'exercicio',
      destino: 'exercicio',
      tipo: 'inteiro',
      obrigatorio: true,
      descricao: 'Exercício contábil da declaração',
    },
    {
      origem: 'instituicao',
      destino: 'instituicao',
      tipo: 'texto',
      obrigatorio: false,
      descricao: 'Nome do ente conforme a declaração',
    },
    {
      origem: 'uf',
      destino: 'ufSigla',
      tipo: 'texto',
      obrigatorio: false,
    },
    {
      origem: 'receitaTotal',
      destino: 'receitaTotal',
      tipo: 'decimal',
      obrigatorio: false,
      descricao: 'Receita orçamentária realizada (Anexo I-C)',
    },
    {
      origem: 'despesaTotal',
      destino: 'despesaTotal',
      tipo: 'decimal',
      obrigatorio: false,
      descricao: 'Despesa liquidada (Anexo I-D)',
    },
    {
      origem: 'gastoSaude',
      destino: 'gastoSaude',
      tipo: 'decimal',
      obrigatorio: false,
      descricao: 'Despesa liquidada na função Saúde (10)',
    },
    {
      origem: 'gastoEducacao',
      destino: 'gastoEducacao',
      tipo: 'decimal',
      obrigatorio: false,
      descricao: 'Despesa liquidada na função Educação (12)',
    },
  ],
  desmembrar: desmembrarEnvelope,
  validar: (bruto) => {
    if (bruto === null || typeof bruto !== 'object') {
      return { ok: false, motivo: 'registro-malformado', detalhe: 'esperado objeto de ente' }
    }
    const r = bruto as { codarea?: string }
    if (!r.codarea) {
      return {
        ok: false,
        motivo: 'campo-obrigatorio-ausente',
        detalhe: 'ente sem código IBGE',
      }
    }
    return { ok: true }
  },
}

/** Tradutores desta fonte. */
export const tradutoresSiconfi: readonly Tradutor[] = [tradutorSiconfiDca]
