/**
 * Caixa 2 — transporte por navegador (`browser-download`) e `manual`.
 *
 * O TSE protege o CDN com WAF (Akamai): `curl` e navegador headless recebem
 * HTTP 403. A única forma conhecida de baixar é um Chromium headful que
 * aquece a sessão no portal e captura o evento de download — receita já
 * validada em produção por `scripts/scrape-tse.ts`.
 *
 * Este transporte preserva exatamente essa receita. A dependência do Playwright
 * é carregada sob demanda, para que o coletor funcione sem ele quando nenhum
 * recurso `browser-download` for usado.
 *
 * `manual` não executa nada: é um estado de primeira classe, não uma exceção.
 */

import type { ResultadoColeta } from '../tipos.js'
import { VERSAO_COLETOR } from '../tipos.js'

/** User-Agent de navegador real — parte da receita que passa pelo WAF. */
export const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** Portal usado para aquecer a sessão antes de baixar do CDN. */
export const URL_AQUECIMENTO = 'https://dadosabertos.tse.jus.br'

/** Opções do transporte por navegador. */
export interface OpcoesNavegador {
  /** Modo headful é o que passa pelo WAF. Padrão: `false` (headful). */
  headless?: boolean
  /** URL visitada antes do download, para estabelecer sessão. */
  urlAquecimento?: string
  /** Tempo máximo de espera pelo download, em ms. */
  timeoutDownloadMs?: number
  /** Espera após o aquecimento, em ms. */
  esperaAquecimentoMs?: number
}

const PADROES: Required<OpcoesNavegador> = {
  headless: false,
  urlAquecimento: URL_AQUECIMENTO,
  timeoutDownloadMs: 300_000,
  esperaAquecimentoMs: 5_000,
}

/** Download capturado do navegador. */
export interface DownloadCapturado {
  bytes: Uint8Array
  url: string
  tentativas: number
}

/**
 * Baixa uma URL usando a navegação real do Chromium.
 *
 * Navegar para uma URL de arquivo dispara o evento `download`, que é capturado
 * e lido em memória. O conteúdo NÃO é reinterpretado.
 *
 * @throws Quando o Playwright não está instalado ou o download não ocorre.
 */
export async function baixarComNavegador(
  url: string,
  opcoes: OpcoesNavegador = {},
): Promise<DownloadCapturado> {
  const opts = { ...PADROES, ...opcoes }

  let chromium: typeof import('playwright').chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    throw new Error(
      'transporte browser-download exige Playwright instalado.\n' +
        '  Instale com: npm install --save-dev playwright && npx playwright install chromium',
    )
  }

  const browser = await chromium.launch({
    headless: opts.headless,
    args: ['--disable-gpu', '--disable-software-rasterizer'],
  })

  try {
    const context = await browser.newContext({
      userAgent: UA_NAVEGADOR,
      viewport: { width: 1366, height: 768 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      acceptDownloads: true,
    })
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })
    const page = await context.newPage()

    // Aquecimento: passa pelo desafio do WAF antes de tocar no CDN.
    try {
      await page.goto(opts.urlAquecimento, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await page.waitForTimeout(opts.esperaAquecimentoMs)
      const titulo = await page.title()
      if (/access denied/i.test(titulo)) {
        throw new Error(
          'portal do TSE retornou "Access Denied" mesmo em navegador real — ' +
            'o bloqueio é por IP/reputação; tente outra rede ou o download manual',
        )
      }
    } catch (err) {
      if (err instanceof Error && /access denied/i.test(err.message)) throw err
      // Falha no aquecimento não impede a tentativa de download.
    }

    const downloadPromise = page.waitForEvent('download', { timeout: opts.timeoutDownloadMs })
    await page
      .goto(url, { waitUntil: 'commit', timeout: opts.timeoutDownloadMs })
      .catch(() => {
        /* a navegação aborta quando vira download — comportamento esperado */
      })

    const download = await downloadPromise
    const caminho = await download.path()
    if (!caminho) throw new Error('download do navegador não produziu arquivo local')

    const { readFile } = await import('node:fs/promises')
    const buffer = await readFile(caminho)

    return {
      bytes: new Uint8Array(buffer),
      url: download.url() || url,
      tentativas: 1,
    }
  } finally {
    await browser.close()
  }
}

/**
 * Resultado para recurso `manual`: requer intervenção humana.
 *
 * Não é falha de rede nem ausência de dado — é um recurso que o coletor não
 * pode executar sozinho. Registrado como `falha` com motivo `manual`, para que
 * quem orquestra saiba que precisa de uma pessoa.
 */
export function resultadoManual(
  fonteId: string,
  recursoId: string,
  url: string | undefined,
  peculiaridades: readonly string[],
  parametros: Readonly<Record<string, string>>,
): ResultadoColeta {
  return {
    estado: 'falha',
    motivo: 'manual',
    mensagem:
      'recurso exige intervenção humana: o coletor não executa transporte manual',
    procedencia: {
      fonteId,
      recursoId,
      transporte: 'manual',
      ...(url ? { url } : {}),
      parametros,
      tentativas: 0,
      versaoColetor: VERSAO_COLETOR,
      peculiaridades,
    },
  }
}
