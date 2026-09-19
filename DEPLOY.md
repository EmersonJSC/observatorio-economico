# Publicar o site (hospedagem gratuita)

O site é **100% estático**: um conjunto de arquivos HTML, JS, CSS e JSON. Não existe
servidor, banco de dados nem API para manter no ar. Isso significa que ele roda em
qualquer hospedagem de arquivos estáticos — e todas as opções abaixo são gratuitas
para este tamanho de projeto.

## O que exatamente é publicado

Um único comando gera a pasta pronta para publicar:

```bash
npm run build:site
```

O resultado fica em `apps/web/dist/` (~85 MB):

| Parte | Tamanho | O que é |
|---|---|---|
| `assets/` | ~4 MB | Programa (HTML/JS/CSS) compilado |
| `dados/maps/` | ~50 MB | Malhas territoriais, centroides, hexágonos |
| `dados/elections/` | ~29 MB | Eleições e representação política |
| `dados/indicators/` | ~2,7 MB | População e PIB |
| `dados/budget/` | ~2,0 MB | Orçamento público (Siconfi) |

Os ZIPs brutos do TSE (`data/elections/raw/`, ~112 MB) **nunca** entram no site.

> A pasta `apps/web/dist/` está no `.gitignore`: ela é um artefato de build, gerado a
> partir do código e dos dados versionados.

---

## Opção 1 — Cloudflare Pages (recomendado)

**Por que:** banda ilimitada e sem cobrança por acesso. Se o site viralizar, a conta
continua zero. Limite de 25 MB por arquivo e 20.000 arquivos por deploy — o maior
arquivo aqui é `dados/maps/ufs/31.geojson` com 7,7 MB, então sobra folga.

**Passo a passo (conectado ao Git, com deploy automático):**

1. Suba o projeto para um repositório no GitHub.
2. Em <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** e escolha o repositório.
3. Em *Build settings*, preencha:
   - **Framework preset:** `None`
   - **Build command:** `npm run build:site`
   - **Build output directory:** `apps/web/dist`
4. **Save and Deploy.** Cada `git push` passa a republicar o site sozinho.

Como o site fica na raiz do domínio (`https://seu-projeto.pages.dev/`), **não** é
preciso configurar `VITE_BASE`.

**Alternativa sem Git (arrastar e soltar):** rode `npm run build:site` na sua máquina e
arraste a pasta `apps/web/dist` para o painel do Cloudflare Pages (*Upload assets*).

---

## Opção 2 — GitHub Pages

**Por que:** fica no mesmo lugar que o código, sem serviço extra. O limite é de
100 GB de tráfego por mês — bastante para uso normal, mas não é ilimitado.

Já existe um workflow pronto em `.github/workflows/deploy-pages.yml`. Para ativar:

1. Suba o projeto para o GitHub (branch `main`).
2. Vá em **Settings → Pages → Build and deployment → Source** e escolha
   **GitHub Actions**.
3. Rode o workflow (ele dispara sozinho no próximo push, ou manualmente em
   **Actions → Publicar site → Run workflow**).

O site fica em `https://<usuario>.github.io/<repositorio>/`.

> **Atenção à subpasta.** Em repositório de projeto o site não fica na raiz do domínio,
> então o build precisa saber disso. O workflow descobre o caminho automaticamente e
> passa `VITE_BASE=/<repositorio>/`. Se você publicar manualmente, faça o mesmo:
>
> ```bash
> VITE_BASE=/observatorio-economico/ npm run build:site
> ```
>
> Sem isso, o navegador procura os dados em `https://<usuario>.github.io/dados/...`
> e o mapa abre vazio. Se o repositório for do tipo `<usuario>.github.io`, use
> `VITE_BASE=/`.

---

## Opção 3 — Netlify ou Vercel

Mesmo modelo do Cloudflare Pages, com 100 GB/mês gratuitos:

- **Build command:** `npm run build:site`
- **Publish directory:** `apps/web/dist`

---

## Testar o build antes de publicar

Depois de `npm run build:site`:

```bash
npm run preview:site
```

Isso sobe o site compilado em <http://localhost:4173> exatamente como o visitante vai
receber — inclusive lendo os dados de `dist/dados/`, e não da pasta `data/` do
repositório. É a forma correta de confirmar que nada quebrou.

---

## Comparativo rápido

| Hospedagem | Custo | Tráfego grátis | Limite por arquivo | Deploy automático |
|---|---|---|---|---|
| Cloudflare Pages | R$ 0 | ilimitado | 25 MB | sim (Git) |
| GitHub Pages | R$ 0 | 100 GB/mês | 100 MB | sim (Actions) |
| Netlify | R$ 0 | 100 GB/mês | — | sim (Git) |
| Vercel | R$ 0 | 100 GB/mês | — | sim (Git) |

Para este projeto, **Cloudflare Pages** é a escolha mais barata e segura: banda
ilimitada e nenhuma peça de servidor para manter.

---

## Atualizar os dados

O site só muda quando o build é refeito. Para incorporar dados novos:

```bash
npm run ingest          # baixa e transforma os dados oficiais
npm run build:site      # regenera a pasta publicada
git add data            # os dados SÃO versionados (dist/ é artefato de build)
git commit -m "Atualiza dados"
git push                # o deploy automático cuida do resto
```

Os dados vivem em `data/` e são versionados junto com o código; é isso que permite a
qualquer pessoa reproduzir o site a partir do repositório.

---

## Duas armadilhas que já quebraram o deploy

Se o build falhar na hospedagem, quase certamente foi uma destas duas.

### 1. `sh: 1: tsc: not found`

O `apps/web` precisa do TypeScript para compilar, e ele é uma dependência daquele
workspace. Em CI, `npm ci` só instala o que o **`package-lock.json` da raiz** declara.

Este projeto é um monorepo npm workspaces: o campo `workspaces` no `package.json` da
raiz é o que faz o `npm ci` instalar as dependências de `apps/web` e `apps/api`.

Se você adicionar uma dependência, rode `npm install` **na raiz** (nunca dentro de
`apps/web`) e faça commit do `package-lock.json` junto. Lockfiles dentro das pastas dos
apps (`apps/web/package-lock.json`) quebram esse mecanismo e não existem mais aqui.

Para reproduzir o que a hospedagem vai fazer, antes de dar push:

```bash
rm -rf node_modules apps/*/node_modules
npm ci
npm run build:site
```

### 2. `⚠ centroides.json não encontrado` / mapa vazio

O build publica os dados de `data/`. Se eles não estiverem no repositório, o site sobe
sem dataset — o mapa abre vazio e o painel não mostra nada.

O dataset **é** versionado de propósito (~84 MB, sem os ZIPs brutos do TSE). Cada
subpasta de `data/` já teve um `.gitignore` com `*` que impedia qualquer arquivo de ser
rastreado; isso foi removido. Hoje o único arquivo ignorado é `data/elections/raw/`
(os ZIPs de origem, ~112 MB, baixáveis com `npm run scrape:tse`).

Para conferir que tudo entrou:

```bash
git check-ignore -v data/maps/centroides.json   # não deve imprimir nada
git add -An data | wc -l                        # deve passar de 100
```

Se o deploy reclamar de dados faltando, é sinal de que o commit não incluiu `data/`.

