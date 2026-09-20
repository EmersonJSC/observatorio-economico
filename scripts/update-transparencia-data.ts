/**
 * Ingestão: Portal da Transparência — API de Dados
 *
 * Fonte: https://portaldatransparencia.gov.br/api-de-dados
 * Adaptador: scripts/adapters/portal-transparencia/portal-transparencia.adapter.ts
 *
 * 🔑 Exige PORTAL_API_KEY em `.env`.
 *
 * Grava:
 *   data/transparencia/despesas-orgaos.json  — despesa federal por órgão
 *   data/transparencia/emendas.json          — emendas parlamentares
 *   data/transparencia/programas-sociais.json — programa social por município
 *   data/transparencia/orgaos.json           — dicionário SIAFI/SIAPE
 *   data/transparencia/metadata.json         — cobertura e data de atualização
 *
 * Uso:
 *   npx tsx scripts/update-transparencia-data.ts
 *   npx tsx scripts/update-transparencia-data.ts --ano=2023 --sem-programas
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PortalTransparenciaAdapter,
} from './adapters/portal-transparencia/portal-transparencia.adapter.js'
import { carregarEnv, lerEnv } from './lib/env.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data', 'transparencia')

interface Municipio {
  codarea: string
  nome: string
  uf: string
}

const args = process.argv.slice(2)
const anoDosArgs = args.find((a) => a.startsWith('--ano='))?.slice('--ano='.length)
const semProgramas = args.includes('--sem-programas')

/**
 * Lista de municípios para varrer nos endpoints "por município".
 *
 * Lê `data/indicators/pontos.json` (derivado do IBGE) porque é o arquivo que
 * já traz `codarea` + nome + UF dos 5.570 municípios em um só lugar. Se não
 * existir, a etapa de programas sociais é pulada em vez de falhar.
 */
async function carregarMunicipios(): Promise<Municipio[]> {
  const caminho = join(ROOT, 'data', 'indicators', 'pontos.json')
  if (!existsSync(caminho)) return []

  try {
    const dados = JSON.parse(await readFile(caminho, 'utf-8')) as {
      pontos?: Array<{ codarea: string; nome: string; uf: string }>
    }
    return (dados.pontos ?? []).map((p) => ({ codarea: p.codarea, nome: p.nome, uf: p.uf }))
  } catch {
    return []
  }
}

async function main(): Promise<void> {
  carregarEnv()

  const ano = Number(anoDosArgs ?? lerEnv('PORTAL_ANO') ?? 2024)
  const mesAno = lerEnv('PORTAL_MES_ANO') ?? '08/2024'
  const programa = lerEnv('PORTAL_PROGRAMA_SOCIAL') ?? 'bolsa-familia'
  const limiteMunicipios = Number(lerEnv('PORTAL_LIMITE_MUNICIPIOS') ?? 0)

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Portal da Transparência — API de Dados')
  console.log('╚══════════════════════════════════════════════════════════')
  console.log(`  Ano: ${ano}`)
  console.log(`  Programa social: ${programa} (${mesAno})`)
  console.log(`  Limite de municípios: ${limiteMunicipios === 0 ? 'todos' : limiteMunicipios}\n`)

  const adapter = new PortalTransparenciaAdapter()

  if (!adapter.temChave()) {
    throw new Error(
      'PORTAL_API_KEY não configurada.\n' +
      '  1. Cadastre-se em https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email\n' +
      '  2. Copie .env.example para .env e preencha PORTAL_API_KEY',
    )
  }

  // Valida a chave antes de começar: evita descobrir o 401 após minutos de varredura.
  console.log('  → Validando chave da API…')
  if (!(await adapter.verificarChave())) {
    throw new Error('Chave da API do Portal da Transparência inválida ou expirada.')
  }
  console.log('  ✓ Chave válida\n')

  await mkdir(DATA_DIR, { recursive: true })

  // 1. Despesas por órgão
  const despesas = await adapter.despesasPorOrgao(ano)

  // 2. Emendas parlamentares
  const emendas = await adapter.listarEmendas(ano)

  // 3. Dicionário de órgãos
  const orgaosSiafi = await adapter.listarOrgaosSiafi()
  const orgaosSiape = await adapter.listarOrgaosSiape()

  // 4. Programa social por município (uma requisição por município)
  let sociais: Array<Record<string, unknown>> = []
  let municipiosConsultados = 0

  if (!semProgramas) {
    const municipios = await carregarMunicipios()

    if (municipios.length === 0) {
      console.warn('  ⚠ data/indicators/pontos.json não encontrado — pulando programas sociais.')
      console.warn('     Rode antes: npx tsx scripts/gerar-derivados.ts')
    } else {
      const alvo = limiteMunicipios > 0 ? municipios.slice(0, limiteMunicipios) : municipios
      console.log(`\n  → ${programa} por município (${alvo.length} municípios)…`)
      console.log('     Uma requisição por município — etapa longa.\n')

      for (const [i, municipio] of alvo.entries()) {
        try {
          const parcelas = await adapter.programaSocialPorMunicipio(programa, municipio.codarea, mesAno)
          for (const parcela of parcelas) {
            sociais.push({ ...parcela, codarea: municipio.codarea, uf: municipio.uf })
          }
          municipiosConsultados++
        } catch (err) {
          // Município sem o programa no mês é normal, não é erro de pipeline.
          if (i < 3) console.warn(`    ⚠ ${municipio.nome}: ${(err as Error).message}`)
        }

        if ((i + 1) % 100 === 0 || i === alvo.length - 1) {
          console.log(`    … ${i + 1}/${alvo.length} municípios (${sociais.length} parcelas)`)
        }
      }
    }
  }

  // 5. Gravação
  await writeFile(
    join(DATA_DIR, 'despesas-orgaos.json'),
    JSON.stringify({ ano, total: despesas.length, despesas }, null, 0),
    'utf-8',
  )

  await writeFile(
    join(DATA_DIR, 'emendas.json'),
    JSON.stringify({ ano, total: emendas.length, emendas }, null, 0),
    'utf-8',
  )

  await writeFile(
    join(DATA_DIR, 'programas-sociais.json'),
    JSON.stringify({ programa, mesAno, total: sociais.length, parcelas: sociais }, null, 0),
    'utf-8',
  )

  await writeFile(
    join(DATA_DIR, 'orgaos.json'),
    JSON.stringify({ siafi: orgaosSiafi, siape: orgaosSiape }, null, 0),
    'utf-8',
  )

  await writeFile(
    join(DATA_DIR, 'metadata.json'),
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        source: 'Portal da Transparência — API de Dados',
        endpointBase: 'https://api.portaldatransparencia.gov.br/api-de-dados',
        autenticacao: 'header chave-api-dados (obrigatória)',
        ano,
        programaSocial: programa,
        mesAnoPrograma: mesAno,
        registros: {
          despesasPorOrgao: despesas.length,
          emendas: emendas.length,
          parcelasSociais: sociais.length,
          orgaosSiafi: orgaosSiafi.length,
          orgaosSiape: orgaosSiape.length,
        },
        municipiosConsultados,
        version: 1,
      },
      null,
      2,
    ),
    'utf-8',
  )

  console.log(`\n  ✓ transparencia/despesas-orgaos.json — ${despesas.length} registros`)
  console.log(`  ✓ transparencia/emendas.json — ${emendas.length} emendas`)
  console.log(`  ✓ transparencia/programas-sociais.json — ${sociais.length} parcelas`)
  console.log(`  ✓ transparencia/orgaos.json — ${orgaosSiafi.length} SIAFI / ${orgaosSiape.length} SIAPE`)
  console.log(`  ✓ transparencia/metadata.json`)
  console.log('\n✓ Ingestão do Portal da Transparência concluída.')
}

main().catch((err) => {
  console.error('\n✗ Erro na ingestão do Portal da Transparência:', err instanceof Error ? err.message : err)
  process.exit(1)
})
