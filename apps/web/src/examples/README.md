# Exemplos (não produção)

Esta pasta contém exemplos e experimentos que **não fazem parte do build de produção**.
Eles servem para estudar bibliotecas e validar ideias antes de integrá-las ao app.

## Mapa.tsx

Exemplo de mapa interativo do Brasil com **foco e isolamento** usando [deck.gl](https://deck.gl/).

### Fonte de dados

O frontend consome a **API própria do projeto** (`/api/maps/...`), que distribui o
dataset territorial gerado a partir do IBGE. O navegador **nunca** fala com o IBGE.

```
IBGE → scripts/update-territorial-data.ts → data/maps/ → API Express → navegador
```

| Endpoint | Descrição |
|----------|-----------|
| `GET /api/maps/states` | Malha das 27 UFs |
| `GET /api/maps/states/:uf/municipios` | Municípios de uma UF |
| `GET /api/maps/metadata` | Data de atualização e contagens |

Sem basemap comercial: nada de Carto, Mapbox ou Google Maps.

### Arquitetura (três regras de negócio)

1. **Regra da Câmera** — ao clicar em um estado **ou em um município**, a câmera "voa" até o
   ponto clicado usando `FlyToInterpolator`, aumentando o zoom e inclinando (`pitch: 45`) para
   dar perspectiva 3D. Estados vão para `zoom: 6.5`; municípios para `zoom: 9`.
2. **Regra do Isolamento (visual)** — aplicada nos **dois níveis**:
   - **Estadual**: o estado selecionado fica **transparente** para revelar os municípios por
     baixo, enquanto os demais estados ficam **escurecidos** (efeito "disabled").
   - **Municipal**: o município selecionado fica **destacado em azul** e os demais ficam
     **escurecidos**.
3. **Carga Preguiçosa (Lazy Loading)** — a camada de municípios **só é criada** quando um estado
   é selecionado, baixando apenas as cidades daquela UF.

### Interação (hover)

O hover usa um **popup próprio em React** ([`MapTooltip.tsx`](../features/map/components/MapTooltip.tsx)),
não o tooltip nativo do deck.gl. Ele acompanha o cursor com deslocamento e se reposiciona
automaticamente perto das bordas da viewport.

- **Estados**: nome oficial, rótulo "Estado" e código IBGE.
- **Municípios**: nome oficial, rótulo "Município", sigla da UF e código IBGE.
- **Capitais**: recebem um selo "Capital" no popup e uma cor de polígono distinta
  (âmbar discreto), sem marcadores grandes.

**Hierarquia visual**: `hover > selecionado > capital > normal`.

**Performance**: o hover **não dispara nenhuma requisição de rede**. Os nomes já vêm
embutidos no GeoJSON do dataset (enriquecido no script de atualização a partir da API de
Localidades do IBGE). O estado de hover guarda apenas `{ x, y, nome, codigo, nivel, uf, capital }`
— nunca a feature inteira — e não há listeners globais nem recálculo de listas por movimento
do mouse.

### Propriedades reais do GeoJSON

As malhas do IBGE trazem **apenas `codarea`**. O dataset distribuído é enriquecido no
momento da atualização:

| Nível | Propriedades |
|-------|--------------|
| Estados | `codarea`, `nome`, `sigla` |
| Municípios | `codarea`, `nome`, `uf`, `ufId` |

Nunca invente propriedades: use sempre os helpers de
[`mapFeatures.ts`](../features/map/mapFeatures.ts) (`extrairCodigo`, `extrairNome`, `extrairUf`,
`extrairDadosTerritoriais`).

### Capitais

A única lista mantida manualmente no front-end é
[`capitais.ts`](../features/map/data/capitais.ts), com os **27 códigos IBGE de município** das capitais.
Ela evita qualquer consulta à API do IBGE em tempo de execução. Os 27 códigos foram
validados contra o dataset gerado.

### Navegação em níveis

- **Federal** (Brasil) → clique em um estado → **Estadual** (municípios da UF)
- **Estadual** → clique em um município → **Municipal** (cidade focada)
- O botão de voltar é contextual: "← Voltar para o Estado" ou "← Voltar para Visão Federal".

### Como visualizar

Precisa de **dois processos** rodando (backend + frontend):

```bash
# 1. Backend (porta 3001)
npm run dev --prefix apps/api

# 2. Frontend (porta 5173) — em outro terminal
npm run dev --prefix apps/web
```

O Vite faz proxy de `/api` para `http://localhost:3001` (ver [`vite.config.ts`](../../vite.config.ts)).

Se o dataset ainda não existir, gere-o com:

```bash
npx tsx scripts/update-territorial-data.ts
```

### Dependências

Instaladas em [`apps/web/package.json`](../../package.json):

- `deck.gl`
- `@deck.gl/core`
- `@deck.gl/layers`
- `@deck.gl/react`
- `@deck.gl/geo-layers`

### Próximos passos sugeridos

- Exibir um painel lateral com dados econômicos do município clicado.
- Publicar `data/maps/` em CDN/object storage com `Cache-Control` longo.
- Se precisar de basemap vetorial, usar **MapLibre** (open-source) com tiles livres
  como os do OpenStreetMap, evitando provedores comerciais.
