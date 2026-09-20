# Documentação do Observatório Econômico

Este diretório é a referência do projeto. Comece pelo [README da raiz](../README.md)
e depois leia o documento relacionado à tarefa.

| Documento | Para que serve |
| --- | --- |
| [FUNCIONALIDADES.md](FUNCIONALIDADES.md) | O que o produto faz hoje, como navegar e o que ainda não existe. |
| [architecture/overview.md](architecture/overview.md) | Organização do código, dados e build. |
| [data-sources/README.md](data-sources/README.md) | Fontes oficiais, responsabilidade e critérios para novas integrações. |
| [APIS.md](APIS.md) | Documentação completa das APIs: endpoints, arquivos de uso, retornos, relações, `.env` e onde os dados são salvos. |
| [apis_mapping.md](apis_mapping.md) | Mapeamento técnico detalhado das APIs públicas externas usadas na ingestão. |
| [adr/](adr/) | Decisões técnicas que não devem ser revertidas sem nova decisão. |

## Configuração local

```bash
cp .env.example .env   # preencha PORTAL_API_KEY e, se usar, os fallbacks
```

O `.env` é lido por `scripts/lib/env.ts` (sem dependência externa). O arquivo
`.env` não é versionado; `.env.example` documenta cada variável.

## Regra de manutenção

Uma mudança que altere uma funcionalidade, fonte, dado publicado, comando de
desenvolvimento ou arquitetura deve atualizar este índice quando necessário e o
documento específico afetado.
