/**
 * Scraper TSE — download dos arquivos eleitorais oficiais via Playwright.
 *
 * ⚠️ IMPORTANTE — RODAR FORA DO SANDBOX (na sua máquina local):
 *   O TSE protege `dadosabertos.tse.jus.br` e `cdn.tse.jus.br` com WAF (Akamai).
 *   Acesso via curl/headless/API é bloqueado com HTTP 403 "Access Denied", e o
 *   modo headful (navegador real) não inicia dentro do sandbox de execução.
 *   Por isso, este script usa Playwright em modo **headful** e deve ser executado
 *   na sua máquina, onde um Chromium real abre normalmente e passa no WAF.
 *
 * ⚠️ ESTRUTURA DOS ARQUIVOS (válida para 2024):
 *   O TSE NÃO publica mais ZIP por UF para 2024. Publica apenas 2 arquivos
 *   NACIONAIS, e cada ZIP contém os CSVs de todas as 27 UFs dentro (ex:
 *   votacao_candidato_munzona_2024_RO.csv, ..._MG.csv, ..._BR.csv).
 *
 *   Arquivos baixados (para `data/elections/raw/`):
 *     - votacao_candidato_munzona_2024.zip  (votos + situação de eleito)
 *     - consulta_cand_2024.zip              (candidaturas: nome/partido/cargo)
 *
 * Uso:
 *   npx tsx scripts/scrape-tse.ts                # baixa os 2 ZIPs nacionais
 *   npx tsx scripts/scrape-tse.ts --skip-votacao # apenas consulta_cand
 *   npx tsx scripts/scrape-tse.ts --skip-consulta# apenas votação
 *   npx tsx scripts/scrape-tse.ts --headless     # fallback headless
 *   npx tsx scripts/scrape-tse.ts --year=2022    # eleição estadual (Governadores)
 *
 * Recursos:
 *   - Retomável: arquivos já baixados e íntegros são pulados.
 *   - Validação: verifica a assinatura ZIP (bytes "PK") antes de aceitar.
 */

import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { mkdir, open, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW_DIR = join(ROOT, 'data', 'elections', 'raw')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// CDN oficial do TSE (paths estáveis publicados em dadosabertos.tse.jus.br)
const CDN_VOTACAO =
  'https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona'
const CDN_CONSULTA =
  'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand'

interface Args {
  year: number
  headless: boolean
  skipVotacao: boolean
  skipConsulta: boolean
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const yearArg = args.find((a) => a.startsWith('--year='))?.slice('--year='.length)

  return {
    year: yearArg ? Number(yearArg) : 2024,
    headless: args.includes('--headless'),
    skipVotacao: args.includes('--skip-votacao'),
    skipConsulta: args.includes('--skip-consulta'),
  }
}

/** Verifica se o arquivo existe e tem assinatura ZIP válida (bytes "PK"). */
async function isZipValido(caminho: string): Promise<boolean> {
  if (!existsSync(caminho)) return false
  try {
    const info = await stat(caminho)
    if (info.size < 10_000) return false // menor que 10KB não é um ZIP do TSE
    const fh = await open(caminho, 'r')
    const buf = Buffer.alloc(2)
    await fh.read(buf, 0, 2, 0)
    await fh.close()
    return buf.toString('ascii') === 'PK'
  } catch {
    return false
  }
}

/**
 * Baixa um arquivo usando a navegação do navegador (a rede/stack TLS reais do
 * Chromium, com os cookies do WAF). Navegar para uma URL .zip dispara o evento
 * `download` no Chromium, que capturamos e salvamos.
 */
async function baixarViaBrowser(
  page: Page,
  url: string,
  destino: string,
): Promise<void> {
  const downloadPromise = page.waitForEvent('download', { timeout: 300_000 })
  await page.goto(url, { waitUntil: 'commit', timeout: 300_000 }).catch(() => {
    /* navegação aborta quando vira download — esperado */
  })
  const download = await downloadPromise
  await download.saveAs(destino)
}

async function main() {
  const { year, headless, skipVotacao, skipConsulta } = parseArgs()

  console.log('╔══════════════════════════════════════════════════════════')
  console.log('║  Observatório Econômico — Scraper TSE (Playwright)')
  console.log('╚══════════════════════════════════════════════════════════\n')
  console.log(`  Eleição: ${year}`)
  console.log(`  Modo: ${headless ? 'headless' : 'headful (navegador real)'}`)
  console.log(`  Votação: ${skipVotacao ? 'pular' : 'baixar'} | Candidatos: ${skipConsulta ? 'pular' : 'baixar'}`)
  console.log(`  Destino: ${RAW_DIR}\n`)

  await mkdir(RAW_DIR, { recursive: true })

  const browser: Browser = await chromium.launch({
    headless,
    args: ['--disable-gpu', '--disable-software-rasterizer'],
  })
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    acceptDownloads: true,
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
  })
  const page = await context.newPage()

  // Warm-up: passar pelo desafio do WAF no portal antes de baixar do CDN.
  console.log('→ Aquecendo sessão no portal do TSE (passando pelo WAF)…')
  try {
    await page.goto(`https://dadosabertos.tse.jus.br/dataset/resultados-${year}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await page.waitForTimeout(5000)
    const title = await page.title()
    console.log(`  Título: ${title}`)
    if (/access denied/i.test(title)) {
      console.error(
        '  ✗ O portal retornou "Access Denied" mesmo em navegador real.\n' +
        '  → O bloqueio é por IP/reputação. Tente outra rede ou o download manual.',
      )
      await browser.close()
      process.exit(1)
    }
  } catch (err) {
    console.warn(`  ⚠ Falha no warm-up: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Arquivos nacionais (contêm os CSVs de todas as UFs dentro do ZIP)
  interface Tarefa { url: string; nome: string }
  const tarefas: Tarefa[] = []
  if (!skipVotacao) {
    tarefas.push({
      nome: `votacao_candidato_munzona_${year}.zip`,
      url: `${CDN_VOTACAO}/votacao_candidato_munzona_${year}.zip`,
    })
  }
  if (!skipConsulta) {
    tarefas.push({
      nome: `consulta_cand_${year}.zip`,
      url: `${CDN_CONSULTA}/consulta_cand_${year}.zip`,
    })
  }

  console.log(`\n→ Baixando ${tarefas.length} arquivo(s)…\n`)

  const resumo = { ok: 0, skip: 0, erro: 0, erros: [] as string[] }

  for (let i = 0; i < tarefas.length; i++) {
    const t = tarefas[i]
    const destino = join(RAW_DIR, t.nome)
    const prefixo = `[${i + 1}/${tarefas.length}]`

    if (await isZipValido(destino)) {
      console.log(`${prefixo} ⏭  ${t.nome} (já baixado)`);
      resumo.skip++
      continue
    }

    // 2 tentativas por arquivo
    let ok = false
    let ultimoErro = ''
    for (let tentativa = 1; tentativa <= 2 && !ok; tentativa++) {
      try {
        await baixarViaBrowser(page, t.url, destino)
        if (await isZipValido(destino)) {
          ok = true
        } else {
          ultimoErro = 'arquivo baixado não é um ZIP válido (possível página de bloqueio)'
        }
      } catch (err) {
        ultimoErro = err instanceof Error ? err.message : String(err)
      }
      if (!ok && tentativa < 2) {
        console.log(`     ↻ tentativa ${tentativa} falhou: ${ultimoErro}. Repetindo…`)
        await page.waitForTimeout(3000)
      }
    }

    if (ok) {
      const { size } = await stat(destino)
      console.log(`${prefixo} ✓ ${t.nome} (${(size / 1024 / 1024).toFixed(1)} MB)`)
      resumo.ok++
    } else {
      console.log(`${prefixo} ✗ ${t.nome}: ${ultimoErro}`)
      resumo.erro++
      resumo.erros.push(t.nome)
    }
  }

  await browser.close()

  console.log('\n══════════════════════════════════════════════════════════')
  console.log(`  RESULTADO: ${resumo.ok} ok | ${resumo.skip} já existiam | ${resumo.erro} com erro`)
  if (resumo.erros.length > 0) {
    console.log('  Arquivos com erro:')
    for (const e of resumo.erros) console.log(`    - ${e}`)
  }
  console.log('══════════════════════════════════════════════════════════')

  if (resumo.erro > 0) process.exit(1)
}

main().catch((err) => {
  console.error('\n✗ Erro fatal no scraper:', err)
  process.exit(1)
})
