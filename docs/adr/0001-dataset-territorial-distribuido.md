# ADR 0001 — Dataset territorial distribuído (não proxy em runtime)

- **Status:** Aceito
- **Data:** 2026-09-13

## Contexto

O mapa interativo do Brasil precisa das malhas territoriais (estados e municípios).
A primeira implementação consumia a API v3 de Malhas do IBGE **diretamente do navegador**:

```
Usuário → API IBGE
```

Isso é simples e barato, mas traz riscos:

- Cada usuário gera tráfego no IBGE.
- Dependência da disponibilidade da API de terceiros em runtime.
- Não há quota numérica pública garantida que se possa assumir.
- Latência e comportamento fora do nosso controle.

## Decisão

Tratar as malhas como um **dataset territorial que a aplicação distribui**, e não como
um "cache" de uma API externa. A diferença é conceitual: um cache pode ser perdido e
recuperado; um dataset é um artefato versionado do projeto.

Arquitetura adotada:

```
        PERIODICAMENTE
             │
             ▼
           IBGE
             │
             ▼
  scripts/update-territorial-data.ts
             │
             ▼
        data/maps/
             │
             ▼
      API (Express)
      RAM → disco
             │
             ▼
          usuários
```

- **Único ponto que fala com o IBGE:** [`scripts/update-territorial-data.ts`](../../scripts/update-territorial-data.ts).
- **Armazenamento:** arquivos GeoJSON em `data/maps/` (disco).
- **Leitura:** [`apps/api/src/territorial-data.ts`](../../apps/api/src/territorial-data.ts) com camada de RAM (`Map`) sobre o disco.
- **Frontend:** consome `/api/maps/...` e não sabe que os dados vieram do IBGE.

## Consequências

**Positivas**

- Requisições ao IBGE em runtime: **zero**.
- Escala independente: 10 ou 10 milhões de usuários não aumentam o tráfego ao IBGE.
- O gargalo passa a ser nosso servidor/CDN — onde queremos que ele esteja.
- Possibilidade de cache HTTP agressivo (`Cache-Control` longo) e CDN.
- Dados versionáveis e auditáveis (via `metadata.json`).

**Negativas / custos**

- Necessário rodar o script de atualização periodicamente (dados territoriais mudam pouco).
- O dataset ocupa ~50 MB em disco.
- Exige um processo de deploy que inclua o dataset (ou armazenamento externo/CDN).

## Alternativas consideradas

1. **Proxy com download sob demanda** — bom para protótipo, mas mantém dependência de runtime.
2. **PostgreSQL (jsonb)** — rejeitado: GeoJSON é um blob grande, não se beneficia de queries relacionais.
3. **Cache em memória apenas** — insuficiente: perde tudo ao reiniciar e não é distribuível.

## Notas

- O dataset **não é versionado** no Git (ver [`data/maps/.gitignore`](../../data/maps/.gitignore)).
- Em produção, recomenda-se publicar `data/maps/` em CDN/object storage e servir com
  `Cache-Control` longo + `stale-while-revalidate`.
