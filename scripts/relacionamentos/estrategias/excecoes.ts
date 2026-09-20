/**
 * Caixa 5 — estratégia: exceções auditadas.
 *
 * Divergências históricas entre a grafia do TSE e a do IBGE que o casamento por
 * nome normalizado não resolve. Cada entrada precisa de MOTIVO — é uma decisão
 * humana revisável, não um remendo.
 *
 * No legado estas exceções viviam em código (`EXCECOES_CONHECIDAS` em
 * `tse-depara-builder.ts`). Aqui ficam em um módulo de dados auditável, como
 * o plano da Caixa 5 definiu.
 *
 * As 7 entradas abaixo foram derivadas do dado real: são exatamente as unidades
 * eleitorais do TSE que NÃO casam por nome normalizado contra o IBGE, depois de
 * a normalização tratar apóstrofo, hífen e artigos (incluindo o `d` solto de
 * "D'Oeste", que resolve Espigão D'Oeste e Alvorada D'Oeste sem exceção).
 */

/** Uma divergência conhecida entre TSE e IBGE. */
export interface ExcecaoTseIbge {
  /** Sigla da UF. */
  ufSigla: string
  /** Nome do município como o TSE escreve. */
  nomeTse: string
  /** Código IBGE (7 dígitos) do município correspondente. */
  codarea: string
  /** Por que esta exceção existe. Obrigatório: exceção sem justificativa é dívida. */
  motivo: string
}

/**
 * Exceções auditadas.
 *
 * Casos de denominação alternativa, grafia arcaica ou supressão de sufixo.
 * Todas verificadas contra o dado real do projeto.
 */
export const EXCECOES_TSE_IBGE: readonly ExcecaoTseIbge[] = [
  {
    ufSigla: 'BA',
    nomeTse: 'CAMACÃ',
    codarea: '2905602',
    motivo: 'Grafia divergente: o IBGE registra "Camacan", sem til.',
  },
  {
    ufSigla: 'MG',
    nomeTse: 'DONA EUSÉBIA',
    codarea: '3122900',
    motivo: 'Divergência ortográfica S vs Z: o IBGE registra "Dona Euzébia".',
  },
  {
    ufSigla: 'MG',
    nomeTse: 'SÃO THOMÉ DAS LETRAS',
    codarea: '3165206',
    motivo: 'O TSE preserva grafia arcaica com TH; o IBGE usa "São Tomé das Letras".',
  },
  {
    ufSigla: 'PA',
    nomeTse: 'SANTA ISABEL DO PARÁ',
    codarea: '1506500',
    motivo: 'O IBGE registra "Santa Izabel do Pará" (com Z).',
  },
  {
    ufSigla: 'RN',
    nomeTse: 'BOA SAÚDE',
    codarea: '2405306',
    motivo: 'Denominação alternativa oficial: o IBGE registra "Januário Cicco".',
  },
  {
    ufSigla: 'RR',
    nomeTse: 'SÃO LUIZ',
    codarea: '1400605',
    motivo: 'O TSE suprime o sufixo territorial; o IBGE registra "São Luiz do Anauá".',
  },
  {
    ufSigla: 'SP',
    nomeTse: 'SÃO LUÍS DO PARAITINGA',
    codarea: '3550001',
    motivo: 'Divergência ortográfica S vs Z: o IBGE registra "São Luiz do Paraitinga".',
  },
]

/** Chave de busca de uma exceção. */
export function chaveExcecao(ufSigla: string, nomeTse: string): string {
  return `${ufSigla.toUpperCase()}|${nomeTse.trim().toUpperCase()}`
}

/** Índice das exceções por UF+nome do TSE, para busca O(1). */
export function indexarExcecoes(
  excecoes: readonly ExcecaoTseIbge[] = EXCECOES_TSE_IBGE,
): Map<string, ExcecaoTseIbge> {
  const indice = new Map<string, ExcecaoTseIbge>()
  for (const e of excecoes) {
    indice.set(chaveExcecao(e.ufSigla, e.nomeTse), e)
  }
  return indice
}
