# Instruções para agentes

Antes de investigar, planejar ou alterar este projeto, leia nesta ordem:

1. `README.md` — objetivo do produto, comandos e dados disponíveis.
2. `docs/FUNCIONALIDADES.md` — comportamento já entregue, fluxos e limites.
3. O documento de `docs/` ligado à área da tarefa, quando existir.

## Regras do projeto

- O site de produção é estático. O frontend lê os datasets em `data/` por meio
  de `apps/web/src/lib/fontes.ts`; não introduzir chamadas diretas do navegador
  a IBGE, TSE, Siconfi ou Banco Central.
- Não inventar números, nomes de mandatários ou datas. Dados ausentes devem ser
  tratados como ausentes na interface.
- Preservar o código IBGE (`codarea`) como chave de junção territorial.
- Ao alterar comportamento, fonte de dados, arquitetura ou comandos, atualize
  o `README.md` e/ou `docs/FUNCIONALIDADES.md` na mesma mudança.
- Antes de concluir uma alteração de frontend, rode `npm --prefix apps/web run build`.

## Onde trabalhar

- Mapa e camadas: `apps/web/src/features/map/`.
- Painel de território: `apps/web/src/features/map/components/TerritoryPanel.tsx`.
- Dados e ingestão: `scripts/` e `data/`.
- Explicações em linguagem simples: `apps/web/src/features/educacao/`.

Consulte `docs/README.md` como índice da documentação.
