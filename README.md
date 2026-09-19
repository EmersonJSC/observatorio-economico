# Observatório Econômico

Plataforma de exploração de dados públicos do Brasil, orientada pelo mapa.

O site é **estático**: o frontend lê arquivos JSON já preparados e não depende de
servidor nem banco de dados em produção. Veja [como publicar de graça](DEPLOY.md).

## Onde encontrar cada coisa

- `apps/web`: interface React e experiência de exploração.
- `apps/api`: API Express usada no desenvolvimento local; não é necessária em produção.
- `scripts`: tarefas que baixam, transformam e publicam os dados de fontes oficiais.
- `data`: datasets gerados pelos scripts; **são versionados** e viram o conteúdo do site.
- `docs/architecture`: organização e decisões de arquitetura.
- `docs/data-sources`: origem, periodicidade e limitações de cada fonte pública.

É um monorepo npm workspaces (`apps/*`). Instale sempre pela raiz: `npm install`.
Adicionar dependência dentro de `apps/web` cria um lockfile separado que o CI ignora.

Leia primeiro: [visão da arquitetura](docs/architecture/overview.md) ou a [documentação completa do projeto](DOCUMENTACAO.md).

## Comandos

```bash
npm run dev:web         # interface em http://localhost:5173
npm run dev:api         # API local em http://localhost:3001 (opcional)

npm run ingest          # atualiza todos os dados a partir das fontes oficiais

npm run build:site      # gera a pasta publicável em apps/web/dist
npm run preview:site    # serve o build em http://localhost:4173
```

Para publicar, consulte **[DEPLOY.md](DEPLOY.md)**.
