# Arquitetura do projeto

O Observatório não usa MVC como organização principal. Ele é organizado por
**domínio**: mapa, território, orçamento e eleições. Isso mantém perto os
arquivos que resolvem o mesmo problema do produto.

## Mapa mental

```text
fontes oficiais → scripts de atualização → data/ → API → interface do mapa
```

O navegador nunca chama IBGE, TSE ou Siconfi diretamente. A aplicação baixa,
valida e guarda os datasets no servidor; o frontend consome somente `/api`.

## Pastas

```text
apps/web/src/features/  funcionalidades visíveis ao usuário
apps/api/src/modules/   domínios e rotas da API
apps/api/src/shared/    código técnico reutilizável entre módulos
packages/contracts/     contratos que poderão ser compartilhados entre API e web
scripts/                importação e atualização de dados externos
data/                   dados gerados localmente, fora do Git
docs/                   decisões de produto, arquitetura e fontes
```

## Convenções

- Um novo recurso do produto entra em `features/<nome>` no frontend e
  `modules/<nome>` na API.
- Componentes que só servem a uma feature ficam dentro dela; não criar uma
  pasta global de componentes por conveniência.
- `shared` é reservado para código realmente reutilizado por dois ou mais
  módulos, como cliente HTTP, tratamento de erro e leitura de datasets.
- Cada fonte externa ganha um script de atualização e um documento em
  `docs/data-sources` antes de chegar ao frontend.
- O código IBGE é a chave territorial comum entre mapas, IBGE e Siconfi.

## Estado atual

- `features/map`: mapa, busca, tooltip, painel territorial e capitais.
- `modules/territory`: endpoints e leitura do dataset de malhas locais.
- Próximos módulos planejados: `indicators`, `budget` e `elections`.
