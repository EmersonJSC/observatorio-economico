# Arquitetura do projeto

O Observatório não usa MVC como organização principal. Ele é organizado por
**domínio**: mapa, território, orçamento e eleições. Isso mantém perto os
arquivos que resolvem o mesmo problema do produto.

## Mapa mental

```text
fontes oficiais → scripts de atualização → data/ → build estático → interface do mapa
```

O navegador nunca chama IBGE, TSE ou Siconfi diretamente. Os scripts baixam,
validam e guardam datasets em `data/`; o frontend lê esses JSONs estáticos via
`apps/web/src/lib/fontes.ts`. A API Express é opcional e serve apenas ao
desenvolvimento local.

## Pastas

```text
apps/web/src/features/  funcionalidades visíveis ao usuário
apps/api/src/modules/   domínios e rotas da API local
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
- `features/map`: mapa, camadas, busca, tooltip e painel territorial.
- `features/ranking`: ranking de territórios e navegação de volta ao mapa.
- `features/educacao`: Politicopédia e explicações em linguagem simples.
- `data/`: malhas, indicadores, orçamento, eleições e arquivos derivados.
