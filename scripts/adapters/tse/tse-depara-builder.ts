/**
 * Gerador da Tabela DE-PARA TSE ↔ IBGE
 *
 * O TSE usa código próprio de 5 dígitos para municípios, incompatível com
 * os 7 dígitos do IBGE. Este módulo constrói a tabela de correlação
 * cruzando os nomes de municípios do CSV do TSE com a API de Localidades do IBGE.
 *
 * Estratégia de matching:
 *  1. Normalizar nomes (lowercase, sem acentos, sem artigos)
 *  2. Filtrar por UF primeiro (restringe o espaço de busca)
 *  3. Match exato por nome normalizado (cobre ~95% dos casos)
 *  4. Match fuzzy por prefixo (para casos como "Grão Mogol" vs "Grão-Mogol")
 *  5. Casos sem match são registrados em warnings para revisão manual
 *
 * Saída: data/elections/de-para-tse-ibge.json
 *   [{ "codigoTse": "41238", "codareaIbge": "3136702", "nome": "São João del-Rei", "uf": "MG" }]
 *
 * Uso:
 *   import { TseDeParaBuilder } from './tse-depara-builder.js'
 *   const builder = new TseDeParaBuilder()
 *   await builder.construir('data/elections/raw/votacao_candidato_munzona_2024.zip')
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IbgeLocalidadesAdapter } from '../ibge/ibge-localidades.adapter.js'
import { TseCsvParser } from './tse-csv-parser.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..', '..')
const DEFAULT_OUTPUT = join(ROOT, 'data', 'elections', 'de-para-tse-ibge.json')

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface EntradaDePara {
  codigoTse: string
  codareaIbge: string
  nome: string
  nomeIbge: string
  uf: string
}

export interface ResultadoDePara {
  mapeados: EntradaDePara[]
  semMatch: Array<{ codigoTse: string; nomeTse: string; uf: string }>
  taxaSucesso: number
}

// ---------------------------------------------------------------------------
// Normalização de nomes para matching
// ---------------------------------------------------------------------------

/**
 * Normaliza nome de município para comparação:
 *  - Converte para minúsculas
 *  - Remove acentos (NFD + strip combining marks)
 *  - Remove artigos comuns
 *  - Remove hífens e apóstrofes
 *  - Remove espaços duplos
 */
function normalizarNome(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/['-]/g, ' ')           // hífen e apóstrofe → espaço
    .replace(/\bde\b|\bda\b|\bdo\b|\bdas\b|\bdos\b|\be\b/g, '') // artigos
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Dicionário de Exceções Conhecidas (TSE ↔ IBGE)
// ---------------------------------------------------------------------------

/**
 * Dicionário auditável de exceções conhecidas onde a grafia oficial do TSE
 * diverge historicamente do IBGE, ou onde o TSE utiliza nome alternativo/antigo.
 * Chave: `${siglaUF}:${codigoTsePad5}`
 */
export const EXCECOES_CONHECIDAS: Record<string, { codareaIbge: string; nomeIbge: string; motivo: string }> = {
  'RN:17035': { codareaIbge: '2405306', nomeIbge: 'Januário Cicco', motivo: 'TSE utiliza denominação alternativa oficial Boa Saúde' },
  'RR:03158': { codareaIbge: '1400605', nomeIbge: 'São Luiz do Anauá', motivo: 'TSE suprime o sufixo territorial do Anauá' },
  'MG:53031': { codareaIbge: '3165206', nomeIbge: 'São Tomé das Letras', motivo: 'TSE preserva grafia arcaica com TH (São Thomé)' },
  'MG:44571': { codareaIbge: '3122900', nomeIbge: 'Dona Euzébia', motivo: 'Divergência ortográfica S vs Z (Dona Eusébia no TSE)' },
  'RO:00256': { codareaIbge: '1100098', nomeIbge: "Espigão D'Oeste", motivo: 'TSE utiliza preposição DO em vez de apóstrofo' },
  'RO:00337': { codareaIbge: '1100346', nomeIbge: "Alvorada D'Oeste", motivo: 'TSE utiliza preposição DO em vez de apóstrofo' },
  'SP:71013': { codareaIbge: '3550001', nomeIbge: 'São Luiz do Paraitinga', motivo: 'Divergência ortográfica S vs Z (São Luís no TSE)' },
  'GO:93998': { codareaIbge: '5210208', nomeIbge: 'Iporá', motivo: 'Código cadastral do TSE para Iporá' },
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class TseDeParaBuilder {
  private readonly ibge: IbgeLocalidadesAdapter
  private readonly parser: TseCsvParser
  private readonly outputPath: string

  constructor(options: { outputPath?: string } = {}) {
    this.ibge = new IbgeLocalidadesAdapter()
    this.parser = new TseCsvParser()
    this.outputPath = options.outputPath ?? DEFAULT_OUTPUT
  }

  /**
   * Constrói a tabela DE-PARA a partir de um arquivo ZIP de votação do TSE.
   * Recomenda-se usar o arquivo nacional (sem sufixo UF) para cobertura completa.
   *
   * @param zipPath - Caminho do ZIP (votacao_candidato_munzona ou consulta_cand)
   */
  async construir(zipPath: string): Promise<ResultadoDePara> {
    console.log('\n[DE-PARA Builder] Construindo tabela TSE ↔ IBGE...')
    console.log(`[DE-PARA Builder] Fonte TSE: ${zipPath}`)

    // 1. Extrair municípios únicos do CSV do TSE
    const municipiosTse = this.parser.extrairMunicipiosTse(zipPath)
    console.log(`[DE-PARA Builder] → ${municipiosTse.length} municípios TSE extraídos`)

    // 2. Agrupar municípios por UF para consulta eficiente ao IBGE
    const porUf = new Map<string, Array<{ codigoUeTse: string; nomeMunicipioTse: string }>>()
    for (const m of municipiosTse) {
      if (!m.uf) continue
      if (!porUf.has(m.uf)) porUf.set(m.uf, [])
      porUf.get(m.uf)!.push({ codigoUeTse: m.codigoUeTse, nomeMunicipioTse: m.nomeMunicipioTse })
    }

    // 3. Para cada UF, buscar municípios IBGE e fazer o matching
    const mapeados: EntradaDePara[] = []
    const semMatch: Array<{ codigoTse: string; nomeTse: string; uf: string }> = []

    const ufs = [...porUf.keys()].sort()
    console.log(`[DE-PARA Builder] → Processando ${ufs.length} UFs via API IBGE Localidades...`)

    for (const uf of ufs) {
      const municipiosTseUf = porUf.get(uf)!

      let municipiosIbge: Map<string, import('../ibge/ibge-localidades.adapter.js').MunicipioLocalidade>
      try {
        // Buscar municípios IBGE da UF e indexar por código
        const lista = await this.ibge.listarMunicipiosPorUf(uf)
        municipiosIbge = new Map(lista.map((m) => [String(m.id), m]))
      } catch (err) {
        console.warn(
          `  [DE-PARA Builder] ⚠ Falha ao buscar UF ${uf} no IBGE: ${err instanceof Error ? err.message : String(err)}`,
        )
        continue
      }

      // Criar índice por nome normalizado para lookup O(1)
      const ibgePorNome = new Map<string, { codarea: string; nome: string }>()
      for (const [codarea, mun] of municipiosIbge) {
        ibgePorNome.set(normalizarNome(mun.nome), { codarea, nome: mun.nome })
      }


      let matchesUf = 0
      for (const munTse of municipiosTseUf) {
        const codigoPad = munTse.codigoUeTse.padStart(5, '0')
        const chaveExcecao = `${uf}:${codigoPad}`

        // Verificação 0: Exceção auditada conhecida
        if (EXCECOES_CONHECIDAS[chaveExcecao]) {
          const exc = EXCECOES_CONHECIDAS[chaveExcecao]
          mapeados.push({
            codigoTse: codigoPad,
            codareaIbge: exc.codareaIbge,
            nome: munTse.nomeMunicipioTse,
            nomeIbge: exc.nomeIbge,
            uf,
          })
          matchesUf++
          continue
        }

        const nomeNorm = normalizarNome(munTse.nomeMunicipioTse)

        // Tentativa 1: match exato
        let ibge = ibgePorNome.get(nomeNorm)

        // Tentativa 2: match por prefixo (primeiros 10 caracteres)
        if (!ibge && nomeNorm.length >= 5) {
          const prefixo = nomeNorm.substring(0, Math.min(10, nomeNorm.length))
          for (const [nomeIbgeNorm, dadosIbge] of ibgePorNome) {
            if (nomeIbgeNorm.startsWith(prefixo) || prefixo.startsWith(nomeIbgeNorm.substring(0, Math.min(10, nomeIbgeNorm.length)))) {
              // Verificar se é mesmo parecido (evitar falsos positivos)
              const similaridade = calcularSimilaridade(nomeNorm, nomeIbgeNorm)
              if (similaridade >= 0.85) {
                ibge = dadosIbge
                break
              }
            }
          }
        }

        if (ibge) {
          mapeados.push({
            codigoTse: codigoPad,
            codareaIbge: ibge.codarea,
            nome: munTse.nomeMunicipioTse,
            nomeIbge: ibge.nome,
            uf,
          })
          matchesUf++
        } else {
          semMatch.push({
            codigoTse: codigoPad,
            nomeTse: munTse.nomeMunicipioTse,
            uf,
          })
        }
      }

      console.log(
        `  [DE-PARA Builder] ✓ UF ${uf}: ${matchesUf}/${municipiosTseUf.length} municípios mapeados`,
      )
    }

    const taxaSucesso = municipiosTse.length > 0
      ? Math.round((mapeados.length / municipiosTse.length) * 100)
      : 0

    // 4. Gravar o arquivo de saída
    await mkdir(join(this.outputPath, '..'), { recursive: true })
    await writeFile(
      this.outputPath,
      JSON.stringify(mapeados, null, 2),
      'utf-8',
    )

    console.log(`\n[DE-PARA Builder] ✅ Concluído:`)
    console.log(`  Mapeados:  ${mapeados.length}`)
    console.log(`  Sem match: ${semMatch.length}`)
    console.log(`  Taxa:      ${taxaSucesso}%`)
    console.log(`  Arquivo:   ${this.outputPath}`)

    if (semMatch.length > 0) {
      console.warn(`\n[DE-PARA Builder] ⚠ ${semMatch.length} municípios sem correspondência IBGE:`)
      // Mostrar apenas os primeiros 20 para não poluir o console
      const amostra = semMatch.slice(0, 20)
      for (const m of amostra) {
        console.warn(`  - [${m.uf}] ${m.nomeTse} (TSE: ${m.codigoTse})`)
      }
      if (semMatch.length > 20) {
        console.warn(`  ... e mais ${semMatch.length - 20}`)
      }
      // [SUPORTE HUMANO NECESSÁRIO]: Os municípios acima não foram mapeados automaticamente.
      // Podem ser municípios com grafia diferente entre TSE e IBGE (ex: abreviações, hífens, etc.).
      // Adicione-os manualmente em data/elections/de-para-tse-ibge.json se necessário.
    }

    return { mapeados, semMatch, taxaSucesso }
  }

  /**
   * Carrega a tabela DE-PARA existente do disco.
   */
  async carregar(): Promise<Map<string, string>> {
    const { readFile } = await import('node:fs/promises')
    const dePara = new Map<string, string>()

    try {
      const conteudo = await readFile(this.outputPath, 'utf-8')
      const itens: EntradaDePara[] = JSON.parse(conteudo)
      for (const item of itens) {
        dePara.set(item.codigoTse, item.codareaIbge)
      }
      console.log(`  [DE-PARA] ✓ ${dePara.size} municípios carregados de: ${this.outputPath}`)
    } catch (err) {
      // [SUPORTE HUMANO NECESSÁRIO]: Arquivo DE-PARA não encontrado.
      // Execute primeiro: npx tsx scripts/update-elections-data.ts --rebuild-depara
      throw new Error(
        `[DE-PARA] Tabela não encontrada: ${this.outputPath}\n` +
        '  Execute: npx tsx scripts/update-elections-data.ts --rebuild-depara',
      )
    }

    return dePara
  }
}

// ---------------------------------------------------------------------------
// Helpers de similaridade (Jaro-Winkler simplificado)
// ---------------------------------------------------------------------------

function calcularSimilaridade(a: string, b: string): number {
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  const matchRange = Math.floor(maxLen / 2) - 1
  if (matchRange < 0) return 0

  const aMatches = new Array(a.length).fill(false)
  const bMatches = new Array(b.length).fill(false)
  let matches = 0

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchRange)
    const end = Math.min(i + matchRange + 1, b.length)
    for (let j = start; j < end; j++) {
      if (!bMatches[j] && a[i] === b[j]) {
        aMatches[i] = true
        bMatches[j] = true
        matches++
        break
      }
    }
  }

  if (matches === 0) return 0
  return matches / Math.max(a.length, b.length)
}
