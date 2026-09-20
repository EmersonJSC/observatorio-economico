/**
 * Caixa 1 — FONTES: catálogo (fonte única de verdade).
 *
 * Declara as fontes externas conhecidas pelo projeto e os recursos coletáveis
 * de cada uma. É consumido pelo COLETOR EXTERNO (ainda não implementado).
 *
 * Este arquivo é DECLARATIVO:
 *   - não faz requisição;
 *   - não lê `process.env` (declara apenas o NOME da variável de credencial);
 *   - não contém parsing, conversão, join, DE-PARA nem fórmula de indicador;
 *   - não contém política de execução (timeout, retry, delay, concorrência,
 *     ordem, backoff) — isso é decisão do COLETOR.
 *
 * Convenções:
 *   - `status: 'usado'`     → exercitado hoje pelo pipeline.
 *   - `status: 'nao-usado'` → conhecido/documentado, mas não exercitado.
 *   - `salvoHojeEm` é TRANSITÓRIO: existe só para orientar a migração.
 *
 * Base: docs/AUDITORIA_CAIXA_1_FONTES.md e docs/PLANO_CAIXA_1_FONTES.md.
 */

import type { Fonte } from './tipos.js'

// ---------------------------------------------------------------------------
// Vocabulário repetido (evita divergência de texto entre recursos)
// ---------------------------------------------------------------------------

const ID_CODAREA: {
  nome: string
  descricao: string
  formato: string
  territorial: boolean
} = {
  nome: 'codarea',
  descricao: 'Código de área do IBGE que identifica a localidade',
  formato: '2 dígitos (UF) ou 7 dígitos (município)',
  territorial: true,
}

const SEM_PAGINACAO = { nivel: 'desconhecido' } as const

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const FONTES: readonly Fonte[] = [
  // =========================================================================
  // IBGE
  // =========================================================================
  {
    id: 'ibge-malhas',
    nome: 'IBGE — Malhas Territoriais',
    orgao: 'IBGE — Instituto Brasileiro de Geografia e Estatística',
    tipo: 'api-rest',
    baseUrl: 'https://servicodados.ibge.gov.br/api/v3/malhas',
    documentacao: 'https://servicodados.ibge.gov.br/api/docs/malhas?versao=3',
    papel: 'primaria',
    recursos: [
      {
        id: 'malha-ufs',
        finalidade: 'Obter os polígonos das 27 Unidades Federativas do Brasil.',
        status: 'usado',
        transporte: 'http-geojson',
        metodo: 'GET',
        caminho: '/paises/{pais}',
        parametros: [
          {
            nome: 'pais',
            descricao: 'País da malha. O projeto usa apenas o Brasil.',
            obrigatorio: true,
            exemplo: 'BR',
          },
          {
            nome: 'formato',
            descricao: 'Formato de resposta que produz GeoJSON.',
            obrigatorio: true,
            valores: ['application/vnd.geo+json'],
            exemplo: 'application/vnd.geo+json',
          },
          {
            nome: 'intrarregiao',
            descricao: 'Nível das feições retornadas dentro do país.',
            obrigatorio: true,
            valores: ['UF'],
            exemplo: 'UF',
          },
        ],
        formato: 'geojson',
        periodicidade: 'unica-vigente',
        recorteTemporal: {
          tipo: 'vigente',
          historico: false,
          observacao: 'A malha publicada é sempre a vigente; não há série histórica no endpoint.',
        },
        identificadores: [ID_CODAREA],
        paginacao: 'nenhuma',
        rateLimit: SEM_PAGINACAO,
        peculiaridades: [
          'Cada Feature traz apenas `properties.codarea` — a malha não inclui nome de UF.',
          'Servida pela mesma API pública do IBGE usada por outros recursos.',
        ],
        observacoes: [
          'Nomes oficiais são obtidos da fonte `ibge-localidades` e embutidos no dataset; isso é enriquecimento, não parte deste recurso.',
        ],
        salvoHojeEm: ['data/maps/brasil.geojson'],
      },
      {
        id: 'malha-municipios-por-uf',
        finalidade: 'Obter os polígonos dos municípios de uma UF.',
        status: 'usado',
        transporte: 'http-geojson',
        metodo: 'GET',
        caminho: '/estados/{uf}',
        parametros: [
          {
            nome: 'uf',
            descricao: 'Código IBGE da Unidade Federativa.',
            obrigatorio: true,
            dimensao: 'uf',
            exemplo: '31',
          },
          {
            nome: 'formato',
            descricao: 'Formato de resposta que produz GeoJSON.',
            obrigatorio: true,
            valores: ['application/vnd.geo+json'],
            exemplo: 'application/vnd.geo+json',
          },
          {
            nome: 'intrarregiao',
            descricao: 'Nível das feições retornadas dentro da UF.',
            obrigatorio: true,
            valores: ['municipio'],
            exemplo: 'municipio',
          },
        ],
        formato: 'geojson',
        periodicidade: 'unica-vigente',
        recorteTemporal: {
          tipo: 'vigente',
          historico: false,
          observacao: 'Malha vigente; não há versão por ano.',
        },
        identificadores: [ID_CODAREA],
        paginacao: 'nenhuma',
        rateLimit: SEM_PAGINACAO,
        peculiaridades: [
          'Uma requisição por UF — o fan-out é a lista de UFs.',
          'Cada Feature traz apenas `properties.codarea`.',
        ],
        salvoHojeEm: ['data/maps/ufs/{uf}.geojson'],
      },
    ],
  },

  {
    id: 'ibge-localidades',
    nome: 'IBGE — Localidades',
    orgao: 'IBGE — Instituto Brasileiro de Geografia e Estatística',
    tipo: 'api-rest',
    baseUrl: 'https://servicodados.ibge.gov.br/api/v1/localidades',
    documentacao: 'https://servicodados.ibge.gov.br/api/docs/localidades',
    papel: 'primaria',
    recursos: [
      {
        id: 'estados',
        finalidade: 'Obter a lista oficial das 27 UFs com código, sigla e nome.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/estados',
        formato: 'json',
        periodicidade: 'eventual',
        recorteTemporal: {
          tipo: 'vigente',
          historico: false,
          observacao: 'Lista vigente; mudanças ocorrem por criação/alteração de municípios.',
        },
        identificadores: [
          { ...ID_CODAREA, observacao: 'Aqui o campo se chama `id`.' },
          { nome: 'sigla', descricao: 'Sigla da UF', formato: '2 letras', territorial: true },
        ],
        paginacao: 'nenhuma',
        rateLimit: SEM_PAGINACAO,
        peculiaridades: [
          'É a fonte dos nomes oficiais usados para enriquecer as malhas e demais datasets.',
        ],
        salvoHojeEm: [],
      },
      {
        id: 'municipios-por-uf',
        finalidade: 'Obter a lista oficial de municípios de uma UF com código e nome.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/estados/{uf}/municipios',
        parametros: [
          {
            nome: 'uf',
            descricao: 'Código IBGE da Unidade Federativa.',
            obrigatorio: true,
            dimensao: 'uf',
            exemplo: '31',
          },
        ],
        formato: 'json',
        periodicidade: 'eventual',
        recorteTemporal: { tipo: 'vigente', historico: false },
        identificadores: [
          { ...ID_CODAREA, observacao: 'Aqui o campo se chama `id`.' },
          { nome: 'nome', descricao: 'Nome oficial do município', formato: 'texto', territorial: true },
        ],
        paginacao: 'nenhuma',
        rateLimit: SEM_PAGINACAO,
        peculiaridades: [
          'Uma requisição por UF — o fan-out é a lista de UFs.',
          'Fornece também microrregião e região imediata, usadas no enriquecimento.',
        ],
        observacoes: [
          'É o insumo territorial de várias etapas: enriquecimento de malhas, varredura de indicadores, varredura de orçamento e construção do DE-PARA TSE (esta última é RELACIONAMENTOS, não Caixa 1).',
        ],
        salvoHojeEm: [],
      },
      {
        id: 'municipio-por-codigo',
        finalidade: 'Obter os dados de um município específico pelo código IBGE.',
        status: 'nao-usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/municipios/{codarea}',
        parametros: [
          {
            nome: 'codarea',
            descricao: 'Código IBGE de 7 dígitos do município.',
            obrigatorio: true,
            dimensao: 'municipio',
            exemplo: '3136702',
          },
        ],
        formato: 'json',
        periodicidade: 'eventual',
        recorteTemporal: { tipo: 'vigente', historico: false },
        identificadores: [ID_CODAREA],
        paginacao: 'nenhuma',
        rateLimit: SEM_PAGINACAO,
        observacoes: [
          'Existe no adaptador, mas nenhum script de ingestão o utiliza hoje.',
        ],
      },
    ],
  },

  {
    id: 'ibge-sidra',
    nome: 'IBGE — Agregados / SIDRA',
    orgao: 'IBGE — Instituto Brasileiro de Geografia e Estatística',
    tipo: 'api-rest',
    baseUrl: 'https://servicodados.ibge.gov.br/api/v3/agregados',
    documentacao: 'https://servicodados.ibge.gov.br/api/docs/agregados?versao=3',
    papel: 'primaria',
    recursos: [
      {
        id: 'populacao',
        finalidade: 'Obter a população residente estimada por localidade.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/{tabela}/periodos/{ano}/variaveis/{variavel}',
        parametros: [
          {
            nome: 'tabela',
            descricao: 'Tabela do SIDRA. População estimada.',
            obrigatorio: true,
            valores: ['6579'],
            exemplo: '6579',
          },
          {
            nome: 'variavel',
            descricao: 'Variável do SIDRA. Pessoas residentes estimadas.',
            obrigatorio: true,
            valores: ['9324'],
            exemplo: '9324',
          },
          {
            nome: 'ano',
            descricao: 'Ano de referência do período.',
            obrigatorio: true,
            dimensao: 'ano',
            exemplo: '2024',
          },
          {
            nome: 'localidades',
            descricao:
              'Nível territorial e filtro pai. Brasil e UFs usam N1[all]|N3[all]; municípios exigem N6[N3[uf]].',
            obrigatorio: true,
            dimensao: 'localidade',
            exemplo: 'N6[N3[31]]',
          },
        ],
        formato: 'json',
        periodicidade: 'anual',
        recorteTemporal: {
          tipo: 'ano',
          historico: true,
          observacao:
            'A série é recuperável por ano; o projeto usa um único ano por execução (padrão 2024).',
        },
        identificadores: [
          { ...ID_CODAREA, observacao: 'Aparece em `series[].localidade.id`.' },
          {
            nome: 'localidade.nivel.id',
            descricao: 'Nível territorial da localidade (N1 Brasil, N3 UF, N6 município)',
            formato: 'N1 | N3 | N6',
            territorial: true,
          },
        ],
        paginacao: 'nenhuma',
        rateLimit: SEM_PAGINACAO,
        peculiaridades: [
          'A variável 593 (PIB per capita) retorna HTTP 500 e não é utilizável.',
          'O IBGE devolve valores especiais para dado indisponível/suprimido.',
        ],
        observacoes: [
          'Tratar os valores especiais e calcular o per capita são responsabilidades de caixas posteriores, não desta.',
        ],
        salvoHojeEm: ['data/indicators/brasil.json', 'data/indicators/ufs/{uf}.json'],
      },
      {
        id: 'pib',
        finalidade: 'Obter o PIB a preços correntes por localidade.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/{tabela}/periodos/{ano}/variaveis/{variavel}',
        parametros: [
          {
            nome: 'tabela',
            descricao: 'Tabela do SIDRA. PIB a preços correntes.',
            obrigatorio: true,
            valores: ['5938'],
            exemplo: '5938',
          },
          {
            nome: 'variavel',
            descricao: 'Variável do SIDRA. PIB total.',
            obrigatorio: true,
            valores: ['37'],
            exemplo: '37',
          },
          {
            nome: 'ano',
            descricao: 'Ano de referência do período.',
            obrigatorio: true,
            dimensao: 'ano',
            exemplo: '2021',
          },
          {
            nome: 'localidades',
            descricao:
              'Nível territorial e filtro pai. Brasil e UFs usam N1[all]|N3[all]; municípios exigem N6[N3[uf]].',
            obrigatorio: true,
            dimensao: 'localidade',
            exemplo: 'N6[N3[31]]',
          },
        ],
        formato: 'json',
        periodicidade: 'anual',
        recorteTemporal: {
          tipo: 'ano',
          historico: true,
          observacao:
            '2021 é o último ano consolidado para municípios no momento da auditoria.',
        },
        identificadores: [{ ...ID_CODAREA, observacao: 'Aparece em `series[].localidade.id`.' }],
        paginacao: 'nenhuma',
        rateLimit: SEM_PAGINACAO,
        peculiaridades: [
          'O valor é publicado em milhares de reais — a unidade é informada pela própria resposta.',
        ],
        observacoes: [
          'A variável 593 de PIB per capita existe na tabela mas não é funcional; o per capita do projeto é calculado em CÁLCULOS.',
        ],
        salvoHojeEm: ['data/indicators/brasil.json', 'data/indicators/ufs/{uf}.json'],
      },
    ],
  },

  // =========================================================================
  // Tesouro Nacional
  // =========================================================================
  {
    id: 'siconfi',
    nome: 'Siconfi — Tesouro Nacional',
    orgao: 'Secretaria do Tesouro Nacional (STN)',
    tipo: 'api-rest',
    baseUrl: 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt',
    documentacao: 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt/swagger-ui/index.html',
    papel: 'primaria',
    recursos: [
      {
        id: 'dca',
        finalidade:
          'Obter a Declaração de Contas Anuais de um ente: receita, despesa e gastos por função.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/dca',
        parametros: [
          {
            nome: 'an_exercicio',
            descricao: 'Exercício contábil da declaração.',
            obrigatorio: true,
            dimensao: 'exercicio',
            exemplo: '2023',
          },
          {
            nome: 'id_ente',
            descricao: 'Código do ente público na base do Siconfi.',
            obrigatorio: true,
            dimensao: 'ente',
            exemplo: '31',
          },
        ],
        formato: 'json-envelope',
        periodicidade: 'anual',
        recorteTemporal: {
          tipo: 'exercicio',
          historico: true,
          observacao:
            'Um exercício por chamada; a série é recuperável repetindo a chamada por ano.',
        },
        identificadores: [
          {
            nome: 'id_ente',
            descricao: 'Código do ente no Siconfi',
            formato: '7 dígitos (município) ou 2 dígitos (estado)',
            territorial: true,
            observacao:
              'A documentação antiga afirma 6 dígitos (sem DV), mas a prática validada é o código completo de 7 dígitos: 6 dígitos retorna conjunto vazio.',
          },
          {
            nome: 'cod_ibge',
            descricao: 'Código IBGE do ente, devolvido na resposta',
            formato: '7 dígitos (município) ou 2 dígitos (estado)',
            territorial: true,
          },
          {
            nome: 'cod_conta',
            descricao: 'Código estável da conta contábil dentro do anexo',
            formato: 'texto',
          },
          { nome: 'anexo', descricao: 'Anexo da declaração (ex.: DCA-Anexo I-C)', formato: 'texto' },
          { nome: 'coluna', descricao: 'Métrica da conta (ex.: Despesas Liquidadas)', formato: 'texto' },
        ],
        paginacao: 'envelope-offset',
        rateLimit: {
          nivel: 'critico',
          consequencia:
            'Bloqueio temporário do IP com HTTP 429 quando há muitas requisições concorrentes.',
          observacao:
            'A restrição é por IP e a varredura completa do país é longa por construção (uma chamada por ente).',
        },
        peculiaridades: [
          'O recurso é UM só; o fan-out é a lista de entes, passada em `id_ente`.',
          'A resposta vem envelopada e pode sinalizar mais páginas além do primeiro lote.',
          'Os valores de `anexo` usam hífen (ex.: "DCA-Anexo I-C"), não espaço.',
        ],
        observacoes: [
          'A auditoria registra que o pipeline atual lê apenas o primeiro lote e ignora o envelope de paginação — decisão a revisar no COLETOR.',
          'Selecionar anexos/contas e somar valores é responsabilidade de caixas posteriores.',
        ],
        salvoHojeEm: ['data/budget/brasil.json', 'data/budget/ufs/{uf}.json'],
      },
      {
        id: 'rreo',
        finalidade: 'Obter o Relatório Resumido de Execução Orçamentária de um ente por período.',
        status: 'nao-usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/rreo',
        parametros: [
          {
            nome: 'an_exercicio',
            descricao: 'Exercício do relatório.',
            obrigatorio: true,
            dimensao: 'exercicio',
            exemplo: '2023',
          },
          {
            nome: 'id_ente',
            descricao: 'Código do ente público na base do Siconfi.',
            obrigatorio: true,
            dimensao: 'ente',
            exemplo: '31',
          },
          {
            nome: 'nr_periodo',
            descricao: 'Período (bimestre) do relatório.',
            obrigatorio: false,
            exemplo: '6',
          },
        ],
        formato: 'json-envelope',
        periodicidade: 'anual',
        recorteTemporal: { tipo: 'exercicio', historico: true },
        identificadores: [
          { nome: 'id_ente', descricao: 'Código do ente no Siconfi', territorial: true },
          { nome: 'nr_periodo', descricao: 'Período bimestral do relatório', formato: 'número' },
        ],
        paginacao: 'envelope-offset',
        rateLimit: {
          nivel: 'critico',
          consequencia: 'Mesma restrição do DCA: bloqueio por IP.',
        },
        observacoes: [
          'Documentado na API e na documentação do projeto, mas nenhum código o consome hoje.',
        ],
      },
    ],
  },

  // =========================================================================
  // TSE — UMA fonte, três recursos com transportes diferentes
  // =========================================================================
  {
    id: 'tse',
    nome: 'TSE — Tribunal Superior Eleitoral',
    orgao: 'Tribunal Superior Eleitoral (TSE)',
    tipo: 'portal',
    baseUrl: 'https://dadosabertos.tse.jus.br',
    documentacao: 'https://dadosabertos.tse.jus.br/',
    papel: 'primaria',
    recursos: [
      {
        id: 'cdn-dados-abertos',
        finalidade:
          'Baixar os arquivos nacionais de candidaturas e de votação por candidato/município/zona.',
        status: 'usado',
        transporte: 'browser-download',
        metodo: 'GET',
        baseUrl: 'https://cdn.tse.jus.br',
        caminho: '/estatistica/sead/odsele/{conjunto}/{conjunto}_{ano}.zip',
        parametros: [
          {
            nome: 'conjunto',
            descricao: 'Conjunto de arquivos publicado pelo TSE.',
            obrigatorio: true,
            valores: ['consulta_cand', 'votacao_candidato_munzona'],
            exemplo: 'consulta_cand',
          },
          {
            nome: 'ano',
            descricao: 'Ano da eleição.',
            obrigatorio: true,
            dimensao: 'ano',
            exemplo: '2024',
          },
        ],
        formato: 'zip-csv',
        periodicidade: 'eventual',
        recorteTemporal: {
          tipo: 'evento',
          historico: true,
          observacao:
            'Um arquivo por eleição. Eleições municipais e gerais ocorrem em anos alternados.',
        },
        identificadores: [
          {
            nome: 'SG_UE',
            descricao: 'Unidade eleitoral da candidatura',
            formato: '5 dígitos (município), sigla da UF, ou "BRASIL"',
            territorial: true,
          },
          {
            nome: 'CD_MUNICIPIO',
            descricao: 'Código do município na base do TSE, presente em alguns conjuntos',
            formato: '5 dígitos',
            territorial: true,
          },
          {
            nome: 'SQ_CANDIDATO',
            descricao: 'Sequencial único do candidato no TSE',
            formato: 'string',
          },
          { nome: 'CD_CARGO', descricao: 'Código do cargo disputado', formato: 'número' },
          { nome: 'NR_TURNO', descricao: 'Turno da eleição', formato: '1 ou 2' },
        ],
        paginacao: 'nenhuma',
        rateLimit: {
          nivel: 'critico',
          consequencia: 'HTTP 403 "Access Denied" para clientes automatizados simples.',
          observacao:
            'A proteção é um WAF/CDN (Akamai) que bloqueia requisições diretas de servidores e de navegadores headless.',
        },
        peculiaridades: [
          'Exige navegador real em modo headful: o download é feito pela própria navegação do Chromium, que carrega os cookies do WAF. Acesso direto é bloqueado com HTTP 403.',
          'Um aquecimento no portal do TSE antes do download é o que estabelece a sessão válida.',
          'Desde 2024 não há mais ZIP por UF: os arquivos são nacionais e cada ZIP contém um CSV por UF mais um consolidado.',
          'Os CSVs usam separador ";" e encoding latin1 (ISO-8859-1), com cabeçalho na primeira linha.',
          'Os arquivos de votação são muito grandes; o de candidaturas é suficiente para os mandatos.',
          'A URL base dos arquivos fica no CDN do TSE, distinta do portal.',
        ],
        observacoes: [
          'Converter encoding e escolher colunas é ORGANIZAÇÃO, não Caixa 1.',
          'O projeto já teve estrutura de arquivo por UF; o layout atual é nacional.',
        ],
        salvoHojeEm: ['data/elections/raw/'],
      },
      {
        id: 'divulgacandcontas-eleitos',
        finalidade: 'Consultar os candidatos eleitos de um cargo em uma unidade eleitoral.',
        status: 'nao-usado',
        transporte: 'http-json',
        metodo: 'GET',
        baseUrl: 'https://divulgacandcontas.tse.jus.br',
        caminho: '/divulga/rest/v1/eleicoes/eleitos/{ano}/{uf}/{codigoUe}/{cdCargo}',
        parametros: [
          {
            nome: 'ano',
            descricao: 'Ano da eleição.',
            obrigatorio: true,
            dimensao: 'ano',
            exemplo: '2024',
          },
          {
            nome: 'uf',
            descricao: 'Sigla da UF em maiúsculas.',
            obrigatorio: true,
            dimensao: 'uf',
            exemplo: 'MG',
          },
          {
            nome: 'codigoUe',
            descricao:
              'Unidade eleitoral: código do município (5 dígitos) ou sigla da UF em pleito estadual.',
            obrigatorio: true,
            dimensao: 'unidade-eleitoral',
            exemplo: '41238',
          },
          {
            nome: 'cdCargo',
            descricao: 'Código do cargo.',
            obrigatorio: true,
            valores: ['3', '4', '11', '12'],
            exemplo: '11',
          },
        ],
        formato: 'json',
        periodicidade: 'eventual',
        recorteTemporal: { tipo: 'evento', historico: true },
        identificadores: [
          { nome: 'sqCandidato', descricao: 'Sequencial único do candidato', formato: 'string' },
          { nome: 'cdCargo', descricao: 'Código do cargo', formato: 'número' },
          {
            nome: 'sgUe',
            descricao: 'Unidade eleitoral',
            formato: '5 dígitos ou sigla da UF',
            territorial: true,
          },
        ],
        paginacao: 'pagina-numerada',
        rateLimit: {
          nivel: 'desconhecido',
          observacao: 'A API apresenta instabilidade em períodos pós-eleitorais e de manutenção.',
        },
        peculiaridades: [
          'A resposta pode trazer bloco de paginação próprio.',
          'Está sujeita ao mesmo WAF do portal quando acessada de servidores.',
        ],
        observacoes: [
          'Implementado no adaptador do TSE, mas nenhum script de ingestão o consome hoje.',
          'O adaptador atual não trata a paginação da resposta.',
        ],
      },
      {
        id: 'foto-candidato',
        finalidade: 'Obter a foto oficial de um candidato.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        baseUrl: 'https://divulgacandcontas.tse.jus.br',
        caminho: '/divulga/rest/arquivo/img/{idEleicao}/{sqCandidato}/{sgUe}',
        parametros: [
          {
            nome: 'idEleicao',
            descricao: 'Identificador da eleição no DivulgaCandContas (ver TSE_ID_ELEICAO).',
            obrigatorio: true,
            dimensao: 'eleicao',
            exemplo: '2045202024',
          },
          {
            nome: 'sqCandidato',
            descricao: 'Sequencial único do candidato, vindo do conjunto de candidaturas.',
            obrigatorio: true,
            dimensao: 'candidato',
            exemplo: '250000000000',
          },
          {
            nome: 'sgUe',
            descricao: 'Unidade eleitoral do candidato.',
            obrigatorio: true,
            dimensao: 'unidade-eleitoral',
            exemplo: 'MG',
          },
        ],
        formato: 'imagem',
        periodicidade: 'eventual',
        recorteTemporal: { tipo: 'evento', historico: true },
        identificadores: [
          { nome: 'sqCandidato', descricao: 'Sequencial único do candidato', formato: 'string' },
          { nome: 'idEleicao', descricao: 'Identificador da eleição no DivulgaCandContas', formato: 'número' },
          {
            nome: 'sgUe',
            descricao: 'Unidade eleitoral',
            formato: '5 dígitos ou sigla da UF',
            territorial: true,
          },
        ],
        paginacao: 'nenhuma',
        rateLimit: { nivel: 'desconhecido' },
        peculiaridades: [
          'É o único recurso externo consumido diretamente pelo navegador do usuário, como imagem em <img>.',
          'O mapa de `idEleicao` por ano é metadado declarativo desta fonte (exportado como TSE_ID_ELEICAO).',
        ],
        observacoes: [
          'Hoje o mapa de idEleicao está duplicado no frontend e na API; nesta etapa o catálogo apenas o centraliza, sem alterar os consumidores.',
        ],
      },
      {
        id: 'portal-dados-abertos',
        finalidade:
          'Acessar os datasets publicados no portal do TSE por download humano (fallback operacional).',
        status: 'nao-usado',
        transporte: 'manual',
        caminho: '/dataset/resultados-{ano}',
        parametros: [
          {
            nome: 'ano',
            descricao: 'Ano da eleição do dataset.',
            obrigatorio: true,
            dimensao: 'ano',
            exemplo: '2024',
          },
        ],
        formato: 'zip-csv',
        periodicidade: 'eventual',
        recorteTemporal: { tipo: 'evento', historico: true },
        identificadores: [
          {
            nome: 'SG_UE',
            descricao: 'Unidade eleitoral presente nos arquivos baixados',
            formato: '5 dígitos ou sigla da UF',
            territorial: true,
          },
        ],
        paginacao: 'nenhuma',
        rateLimit: {
          nivel: 'critico',
          consequencia: 'HTTP 403 para acesso automatizado.',
          observacao: 'O acesso é feito por navegador humano; não há coleta automática.',
        },
        peculiaridades: [
          'O download é manual, feito por uma pessoa em navegador real.',
          'É o plano B quando o CDN está bloqueado.',
          'O dataset de municípios do portal é o insumo documentado para correlacionar códigos do TSE com os do IBGE (a correlação em si é RELACIONAMENTOS).',
        ],
        observacoes: [
          'Nenhum código do projeto baixa destas URLs; a entrada é manual.',
        ],
      },
    ],
  },

  // =========================================================================
  // Câmara dos Deputados
  // =========================================================================
  {
    id: 'camara',
    nome: 'Câmara dos Deputados — Dados Abertos',
    orgao: 'Câmara dos Deputados',
    tipo: 'api-rest',
    baseUrl: 'https://dadosabertos.camara.leg.br/api/v2',
    documentacao: 'https://dadosabertos.camara.leg.br/swagger/api.html',
    papel: 'primaria',
    recursos: [
      {
        id: 'deputados',
        finalidade: 'Listar os deputados em exercício, com partido, UF e foto.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/deputados',
        parametros: [
          {
            nome: 'idLegislatura',
            descricao: 'Legislatura a considerar.',
            obrigatorio: false,
            exemplo: '57',
          },
          {
            nome: 'siglaUf',
            descricao: 'Filtra por UF.',
            obrigatorio: false,
            dimensao: 'uf',
            exemplo: 'MG',
          },
          {
            nome: 'siglaPartido',
            descricao: 'Filtra por partido.',
            obrigatorio: false,
            exemplo: 'PT',
          },
          { nome: 'pagina', descricao: 'Página da listagem (a partir de 1).', obrigatorio: false, exemplo: '1' },
          { nome: 'itens', descricao: 'Itens por página; a API aceita no máximo 100.', obrigatorio: false, exemplo: '100' },
        ],
        formato: 'json-envelope',
        periodicidade: 'eventual',
        recorteTemporal: {
          tipo: 'vigente',
          historico: true,
          observacao:
            'Sem filtro de legislatura a API devolve apenas quem está em exercício no momento da consulta; legislaturas passadas exigem o filtro.',
        },
        identificadores: [
          {
            nome: 'id',
            descricao: 'Identificador do deputado na Câmara',
            formato: 'número',
            observacao:
              'Não é o mesmo identificador de candidato do TSE nem o código de área do IBGE.',
          },
          { nome: 'idLegislatura', descricao: 'Legislatura do mandato', formato: 'número' },
          { nome: 'siglaUf', descricao: 'UF do mandato', formato: '2 letras', territorial: true },
          { nome: 'siglaPartido', descricao: 'Partido do mandato', formato: 'texto' },
        ],
        paginacao: 'link-next',
        rateLimit: { nivel: 'brando' },
        peculiaridades: [
          'Toda listagem devolve envelope com os dados e a lista de links de navegação.',
          'A própria resposta informa a próxima página.',
          'Não exige autenticação.',
        ],
        observacoes: [
          'Contagens e agregações sobre a lista são PUBLICAÇÃO, não Caixa 1.',
        ],
        salvoHojeEm: ['data/congresso/deputados.json'],
      },
      {
        id: 'partidos',
        finalidade: 'Listar os partidos com representação na Câmara.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/partidos',
        parametros: [
          { nome: 'idLegislatura', descricao: 'Legislatura a considerar.', obrigatorio: false, exemplo: '57' },
          { nome: 'pagina', descricao: 'Página da listagem (a partir de 1).', obrigatorio: false, exemplo: '1' },
          { nome: 'itens', descricao: 'Itens por página; a API aceita no máximo 100.', obrigatorio: false, exemplo: '100' },
        ],
        formato: 'json-envelope',
        periodicidade: 'eventual',
        recorteTemporal: { tipo: 'vigente', historico: true },
        identificadores: [
          {
            nome: 'id',
            descricao: 'Identificador do partido',
            formato: 'número',
            observacao:
              'A mesma sigla pode ter sido usada por partidos diferentes em legislaturas distintas, por isso o id é a chave e a sigla é rótulo.',
          },
          { nome: 'sigla', descricao: 'Sigla do partido', formato: 'texto' },
        ],
        paginacao: 'link-next',
        rateLimit: { nivel: 'brando' },
        peculiaridades: ['Não exige autenticação.'],
        salvoHojeEm: ['data/congresso/partidos.json'],
      },
      {
        id: 'despesas-deputado',
        finalidade: 'Obter as despesas da cota parlamentar (CEAP) de um deputado em um ano.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/deputados/{id}/despesas',
        parametros: [
          {
            nome: 'id',
            descricao: 'Identificador do deputado.',
            obrigatorio: true,
            dimensao: 'deputado',
            exemplo: '204554',
          },
          {
            nome: 'ano',
            descricao: 'Ano das despesas.',
            obrigatorio: false,
            dimensao: 'ano',
            exemplo: '2024',
          },
          { nome: 'mes', descricao: 'Mês das despesas.', obrigatorio: false, dimensao: 'mes', exemplo: '3' },
          { nome: 'pagina', descricao: 'Página da listagem (a partir de 1).', obrigatorio: false, exemplo: '1' },
          { nome: 'itens', descricao: 'Itens por página; a API aceita no máximo 100.', obrigatorio: false, exemplo: '100' },
        ],
        formato: 'json-envelope',
        periodicidade: 'mensal',
        recorteTemporal: {
          tipo: 'ano',
          historico: true,
          observacao:
            'Sem informar ano ou mês, a API devolve apenas os seis meses anteriores, o que truncaria a série silenciosamente.',
        },
        identificadores: [
          { nome: 'id', descricao: 'Identificador do deputado', formato: 'número' },
          { nome: 'codDocumento', descricao: 'Código do documento da despesa', formato: 'número' },
          { nome: 'cnpjCpfFornecedor', descricao: 'CNPJ ou CPF do fornecedor', formato: 'texto' },
        ],
        paginacao: 'link-next',
        rateLimit: {
          nivel: 'moderado',
          observacao:
            'O recurso é instável no servidor da Câmara: já retornou lista vazia para todos os deputados e anos testados enquanto outros recursos respondiam normalmente.',
        },
        peculiaridades: [
          'Uma requisição por deputado e por ano — o fan-out é grande.',
          'Historicamente instável, podendo devolver conjunto vazio sem erro HTTP.',
        ],
        observacoes: [
          'O pipeline atual agrega as linhas por deputado/ano antes de publicar; a agregação é CÁLCULOS.',
        ],
        salvoHojeEm: ['data/congresso/despesas.json'],
      },
      {
        id: 'deputado-detalhe',
        finalidade: 'Obter o detalhe cadastral de um deputado (nome civil, CPF, escolaridade).',
        status: 'nao-usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/deputados/{id}',
        parametros: [
          {
            nome: 'id',
            descricao: 'Identificador do deputado.',
            obrigatorio: true,
            dimensao: 'deputado',
            exemplo: '204554',
          },
        ],
        formato: 'json-envelope',
        periodicidade: 'eventual',
        recorteTemporal: { tipo: 'vigente', historico: false },
        identificadores: [
          { nome: 'id', descricao: 'Identificador do deputado', formato: 'número' },
          { nome: 'cpf', descricao: 'CPF do deputado', formato: 'texto' },
          { nome: 'nomeCivil', descricao: 'Nome civil do deputado', formato: 'texto' },
        ],
        paginacao: 'nenhuma',
        rateLimit: { nivel: 'brando' },
        observacoes: [
          'Existe no adaptador, mas nenhum script de ingestão o invoca hoje.',
        ],
      },
    ],
  },

  // =========================================================================
  // Portal da Transparência
  // =========================================================================
  {
    id: 'portal-transparencia',
    nome: 'Portal da Transparência — API de Dados',
    orgao: 'Controladoria-Geral da União (CGU)',
    tipo: 'api-rest',
    baseUrl: 'https://api.portaldatransparencia.gov.br/api-de-dados',
    documentacao: 'https://api.portaldatransparencia.gov.br/swagger-ui/',
    credencial: {
      env: 'PORTAL_API_KEY',
      header: 'chave-api-dados',
      comoObter:
        'https://api.portaldatransparencia.gov.br/api-de-dados/cadastrar-email',
    },
    papel: 'primaria',
    recursos: [
      {
        id: 'despesas-por-orgao',
        finalidade: 'Obter a despesa do Poder Executivo Federal agregada por órgão.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/despesas/por-orgao',
        parametros: [
          {
            nome: 'ano',
            descricao: 'Ano das despesas.',
            obrigatorio: true,
            dimensao: 'ano',
            exemplo: '2024',
          },
          { nome: 'orgaoSuperior', descricao: 'Filtra por órgão superior.', obrigatorio: false, exemplo: 'Presidência da República' },
          { nome: 'orgao', descricao: 'Filtra por órgão.', obrigatorio: false },
          { nome: 'pagina', descricao: 'Página da listagem (a partir de 1).', obrigatorio: false, exemplo: '1' },
        ],
        formato: 'json',
        periodicidade: 'anual',
        recorteTemporal: { tipo: 'ano', historico: true },
        identificadores: [
          { nome: 'orgao', descricao: 'Órgão responsável pela despesa', formato: 'texto' },
          { nome: 'orgaoSuperior', descricao: 'Órgão superior na hierarquia', formato: 'texto' },
        ],
        paginacao: 'pagina-numerada',
        rateLimit: {
          nivel: 'moderado',
          limite: 'aproximadamente 90 requisições por minuto no plano gratuito',
          observacao: 'O limite é por chave e por período e pode variar.',
        },
        peculiaridades: [
          'A resposta é um array direto, sem envelope.',
          'A API não informa total nem última página: a única forma de parar é a página vazia.',
        ],
        salvoHojeEm: ['data/transparencia/despesas-orgaos.json'],
      },
      {
        id: 'emendas',
        finalidade: 'Obter as emendas parlamentares e seus valores.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/emendas',
        parametros: [
          { nome: 'ano', descricao: 'Ano das emendas.', obrigatorio: false, dimensao: 'ano', exemplo: '2024' },
          { nome: 'nomeAutor', descricao: 'Filtra pelo autor da emenda.', obrigatorio: false, exemplo: 'Aécio Neves' },
          { nome: 'tipoEmenda', descricao: 'Filtra pelo tipo da emenda.', obrigatorio: false },
          { nome: 'codigoEmenda', descricao: 'Filtra por emenda específica.', obrigatorio: false },
          { nome: 'codigoFuncao', descricao: 'Filtra por função orçamentária.', obrigatorio: false },
          { nome: 'pagina', descricao: 'Página da listagem (a partir de 1).', obrigatorio: false, exemplo: '1' },
        ],
        formato: 'json',
        periodicidade: 'anual',
        recorteTemporal: { tipo: 'ano', historico: true },
        identificadores: [
          { nome: 'codigoEmenda', descricao: 'Identificador da emenda', formato: 'texto' },
          { nome: 'numeroEmenda', descricao: 'Número da emenda', formato: 'texto' },
          { nome: 'autor', descricao: 'Autor da emenda', formato: 'texto' },
          {
            nome: 'localidadeDoGasto',
            descricao: 'Localidade de aplicação do recurso',
            formato: 'texto',
            territorial: true,
          },
        ],
        paginacao: 'pagina-numerada',
        rateLimit: {
          nivel: 'moderado',
          limite: 'aproximadamente 90 requisições por minuto no plano gratuito',
        },
        peculiaridades: ['A resposta é um array direto, sem envelope.'],
        observacoes: [
          'O autor da emenda é um nome, não um identificador estável de parlamentar — a ligação com a Câmara não é direta.',
        ],
        salvoHojeEm: ['data/transparencia/emendas.json'],
      },
      {
        id: 'programa-social-por-municipio',
        finalidade: 'Obter as parcelas de um programa social por município e mês.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/{programa}-por-municipio',
        parametros: [
          {
            nome: 'programa',
            descricao: 'Programa social consultado; faz parte do caminho.',
            obrigatorio: true,
            valores: [
              'bolsa-familia',
              'novo-bolsa-familia',
              'auxilio-brasil',
              'auxilio-emergencial',
              'bpc',
              'peti',
              'safra',
              'seguro-defeso',
            ],
            exemplo: 'bolsa-familia',
          },
          {
            nome: 'mesAno',
            descricao: 'Mês e ano de referência.',
            obrigatorio: true,
            dimensao: 'mes-ano',
            exemplo: '08/2024',
          },
          {
            nome: 'codigoIbge',
            descricao: 'Código IBGE do município.',
            obrigatorio: true,
            dimensao: 'municipio',
            exemplo: '3136702',
          },
          { nome: 'pagina', descricao: 'Página da listagem (a partir de 1).', obrigatorio: false, exemplo: '1' },
        ],
        formato: 'json',
        periodicidade: 'mensal',
        recorteTemporal: {
          tipo: 'mes-ano',
          historico: true,
          formato: 'MM/AAAA',
        },
        identificadores: [
          {
            nome: 'codigoIbge',
            descricao: 'Código IBGE do município da parcela',
            formato: '6 ou 7 dígitos',
            territorial: true,
            observacao:
              'A auditoria registra que a API pode devolver o código sem o dígito verificador em algumas respostas, embora o adaptador se refira a ele como o código do projeto.',
          },
        ],
        paginacao: 'pagina-numerada',
        rateLimit: {
          nivel: 'critico',
          limite: 'aproximadamente 90 requisições por minuto no plano gratuito',
          observacao:
            'Este recurso exige uma requisição por município: varrer o país inteiro é lento por construção.',
        },
        peculiaridades: [
          'O nome do programa é parte do caminho, não um parâmetro de consulta.',
          'O conjunto de campos varia por programa.',
          'Uma requisição por município e por mês — o fan-out é grande.',
        ],
        observacoes: [
          'Um município sem o programa no mês é ausência legítima, não falha de coleta.',
          'A lista de municípios a varrer vem hoje de um arquivo derivado do IBGE; isso é insumo de execução do COLETOR.',
        ],
        salvoHojeEm: ['data/transparencia/programas-sociais.json'],
      },
      {
        id: 'orgaos-siafi',
        finalidade: 'Obter o dicionário de órgãos do SIAFI.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/orgaos-siafi',
        parametros: [
          { nome: 'pagina', descricao: 'Página da listagem (a partir de 1).', obrigatorio: false, exemplo: '1' },
        ],
        formato: 'json',
        periodicidade: 'eventual',
        recorteTemporal: { tipo: 'vigente', historico: false },
        identificadores: [
          { nome: 'codigo', descricao: 'Código do órgão no SIAFI', formato: 'texto' },
          { nome: 'descricao', descricao: 'Nome do órgão', formato: 'texto' },
        ],
        paginacao: 'pagina-numerada',
        rateLimit: { nivel: 'brando' },
        peculiaridades: [
          'É o recurso mais barato do catálogo e serve de verificação de credencial.',
        ],
        salvoHojeEm: ['data/transparencia/orgaos.json'],
      },
      {
        id: 'orgaos-siape',
        finalidade: 'Obter o dicionário de órgãos do SIAPE.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/orgaos-siape',
        parametros: [
          { nome: 'pagina', descricao: 'Página da listagem (a partir de 1).', obrigatorio: false, exemplo: '1' },
        ],
        formato: 'json',
        periodicidade: 'eventual',
        recorteTemporal: { tipo: 'vigente', historico: false },
        identificadores: [
          { nome: 'codigo', descricao: 'Código do órgão no SIAPE', formato: 'texto' },
          { nome: 'descricao', descricao: 'Nome do órgão', formato: 'texto' },
        ],
        paginacao: 'pagina-numerada',
        rateLimit: { nivel: 'brando' },
        salvoHojeEm: ['data/transparencia/orgaos.json'],
      },
    ],
  },

  // =========================================================================
  // Brasil.io — fallback eleitoral
  // =========================================================================
  {
    id: 'brasilio',
    nome: 'Brasil.io — dataset eleições-brasil',
    orgao: 'Brasil.io (espelho normalizado dos dados do TSE)',
    tipo: 'api-rest',
    baseUrl: 'https://api.brasil.io/v1',
    documentacao: 'https://brasil.io/api/v1/',
    credencial: {
      env: 'BRASILIO_TOKEN',
      header: 'Authorization',
      esquema: 'Token {valor}',
      comoObter: 'https://brasil.io/auth/tokens-api/',
    },
    papel: 'fallback',
    recursos: [
      {
        id: 'candidatos',
        finalidade:
          'Obter candidaturas espelhadas do TSE quando a coleta primária do TSE falha.',
        status: 'usado',
        transporte: 'http-json',
        metodo: 'GET',
        caminho: '/dataset/eleicoes-brasil/{tabela}/data/',
        parametros: [
          {
            nome: 'tabela',
            descricao: 'Tabela do dataset eleições-brasil.',
            obrigatorio: true,
            valores: ['candidatos', 'votacoes', 'bens_candidatos', 'filiados'],
            exemplo: 'candidatos',
          },
          {
            nome: 'ano_eleicao',
            descricao: 'Ano da eleição.',
            obrigatorio: false,
            dimensao: 'ano',
            exemplo: '2024',
          },
        ],
        formato: 'json-envelope',
        periodicidade: 'eventual',
        recorteTemporal: { tipo: 'evento', historico: true },
        identificadores: [
          {
            nome: 'sigla_ue',
            descricao: 'Unidade eleitoral no padrão do TSE',
            formato: '5 dígitos',
            territorial: true,
            observacao:
              'É o mesmo código de 5 dígitos usado pelo TSE; a correspondência com o código do IBGE não é feita nesta caixa.',
          },
          { nome: 'sequencial_candidato', descricao: 'Sequencial do candidato', formato: 'string' },
          { nome: 'codigo_cargo', descricao: 'Código do cargo', formato: 'número' },
          { nome: 'sigla_uf', descricao: 'UF da candidatura', formato: '2 letras', territorial: true },
        ],
        paginacao: 'link-next',
        rateLimit: { nivel: 'desconhecido' },
        peculiaridades: [
          'A resposta é envelopada e traz o endereço da próxima página; a paginação segue até não haver próxima.',
          'Exige token enviado no header de autorização.',
          'Espelha e normaliza dados do TSE; não é a fonte oficial.',
        ],
        observacoes: [
          'Só é acionado quando a coleta primária de eleições falha.',
          'Hoje o resultado é gravado nos mesmos arquivos do TSE, sem distinguir a origem por registro.',
        ],
        salvoHojeEm: ['data/elections/ufs/{uf}.json', 'data/elections/metadata.json'],
      },
    ],
  },

  // =========================================================================
  // Base dos Dados — fallback socioeconômico
  // =========================================================================
  {
    id: 'basedosdados',
    nome: 'Base dos Dados (datalake público no BigQuery)',
    orgao: 'Base dos Dados (espelho padronizado de dados oficiais)',
    tipo: 'api-sql',
    baseUrl: 'https://bigquery.googleapis.com/bigquery/v2',
    documentacao: 'https://basedosdados.org',
    credencial: {
      env: 'BD_ACCESS_TOKEN',
      header: 'Authorization',
      esquema: 'Bearer {valor}',
      comoObter: 'gcloud auth print-access-token',
    },
    papel: 'fallback',
    recursos: [
      {
        id: 'populacao-municipal',
        finalidade:
          'Obter a população municipal por consulta SQL quando a fonte primária de indicadores falha.',
        status: 'usado',
        transporte: 'bigquery-sql',
        metodo: 'POST',
        caminho: '/projects/{projeto}/queries',
        parametros: [
          {
            nome: 'projeto',
            descricao: 'Projeto do Google Cloud usado para faturamento da consulta.',
            obrigatorio: true,
            exemplo: 'meu-projeto-gcp',
          },
          {
            nome: 'ano',
            descricao: 'Ano de referência, aplicado no filtro da consulta.',
            obrigatorio: true,
            dimensao: 'ano',
            exemplo: '2024',
          },
        ],
        formato: 'json',
        periodicidade: 'anual',
        recorteTemporal: { tipo: 'ano', historico: true },
        identificadores: [
          {
            nome: 'id_municipio',
            descricao: 'Código IBGE do município na tabela do datalake',
            formato: '7 dígitos',
            territorial: true,
          },
        ],
        paginacao: 'nenhuma',
        rateLimit: { nivel: 'desconhecido' },
        peculiaridades: [
          'O acesso é por consulta SQL enviada em requisição POST, não por download de arquivo.',
          'Exige projeto de faturamento e token de acesso do Google Cloud.',
          'A tabela consultada é `basedosdados.br_ibge_populacao.municipio`.',
        ],
        observacoes: [
          'O catálogo declara a consulta apenas como operação; o SQL concreto e a chave de faturamento são insumo de execução do COLETOR.',
        ],
        salvoHojeEm: ['data/indicators/ufs/{uf}.json', 'data/indicators/metadata.json'],
      },
      {
        id: 'pib-municipal',
        finalidade:
          'Obter o PIB municipal por consulta SQL quando a fonte primária de indicadores falha.',
        status: 'usado',
        transporte: 'bigquery-sql',
        metodo: 'POST',
        caminho: '/projects/{projeto}/queries',
        parametros: [
          {
            nome: 'projeto',
            descricao: 'Projeto do Google Cloud usado para faturamento da consulta.',
            obrigatorio: true,
            exemplo: 'meu-projeto-gcp',
          },
          {
            nome: 'ano',
            descricao: 'Ano de referência, aplicado no filtro da consulta.',
            obrigatorio: true,
            dimensao: 'ano',
            exemplo: '2021',
          },
        ],
        formato: 'json',
        periodicidade: 'anual',
        recorteTemporal: { tipo: 'ano', historico: true },
        identificadores: [
          {
            nome: 'id_municipio',
            descricao: 'Código IBGE do município na tabela do datalake',
            formato: '7 dígitos',
            territorial: true,
          },
        ],
        paginacao: 'nenhuma',
        rateLimit: { nivel: 'desconhecido' },
        peculiaridades: [
          'A tabela consultada é `basedosdados.br_ibge_pib.municipio`.',
          'O valor de PIB é publicado em milhares de reais na origem.',
        ],
        salvoHojeEm: ['data/indicators/ufs/{uf}.json', 'data/indicators/metadata.json'],
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Acesso ao catálogo
// ---------------------------------------------------------------------------

/** Devolve uma fonte pelo id, ou `undefined`. */
export function buscarFonte(id: string): Fonte | undefined {
  return FONTES.find((f) => f.id === id)
}

/** Devolve um recurso de uma fonte, ou `undefined`. */
export function buscarRecurso(fonteId: string, recursoId: string) {
  return buscarFonte(fonteId)?.recursos.find((r) => r.id === recursoId)
}

/** Lista os recursos marcados como usados hoje pelo projeto. */
export function recursosUsados(): ReadonlyArray<{ fonte: Fonte; recurso: Fonte['recursos'][number] }> {
  return FONTES.flatMap((fonte) =>
    fonte.recursos.filter((r) => r.status === 'usado').map((recurso) => ({ fonte, recurso })),
  )
}

/**
 * Resolve a URL base EFETIVA de um recurso.
 *
 * O recurso tem precedência; a fonte é apenas o padrão. É esta função que o
 * COLETOR deve usar — ler `fonte.baseUrl` diretamente produz URL errada nos
 * recursos que ficam em outro host (caso do TSE: portal, CDN e DivulgaCandContas).
 *
 * @returns A URL base, ou `undefined` para recurso sem endpoint (transporte `manual`).
 */
export function urlBaseEfetiva(fonte: Fonte, recurso: Fonte['recursos'][number]): string | undefined {
  return recurso.baseUrl ?? fonte.baseUrl
}

// ---------------------------------------------------------------------------
// Validação (checagem simples de integridade do catálogo)
// ---------------------------------------------------------------------------

/**
 * Verifica que o catálogo é internamente consistente.
 *
 * Checa apenas o que o tipo não consegue garantir: unicidade de ids e presença
 * de baseUrl quando o recurso é acessado por rede. Não é teste de pipeline.
 *
 * @returns Lista de problemas encontrados (vazia quando o catálogo está íntegro).
 */
export function validarCatalogo(fontes: readonly Fonte[] = FONTES): string[] {
  const problemas: string[] = []
  const idsFonte = new Set<string>()

  for (const fonte of fontes) {
    if (idsFonte.has(fonte.id)) problemas.push(`Fonte duplicada: ${fonte.id}`)
    idsFonte.add(fonte.id)

    if (fonte.recursos.length === 0) {
      problemas.push(`Fonte sem recursos: ${fonte.id}`)
    }

    const idsRecurso = new Set<string>()
    for (const recurso of fonte.recursos) {
      const ref = `${fonte.id}/${recurso.id}`

      if (idsRecurso.has(recurso.id)) problemas.push(`Recurso duplicado: ${ref}`)
      idsRecurso.add(recurso.id)

      const exigeUrl = recurso.transporte !== 'manual'
      if (exigeUrl && !urlBaseEfetiva(fonte, recurso)) {
        problemas.push(
          `Recurso ${ref} exige URL base, mas nem o recurso nem a fonte declaram uma`,
        )
      }
      // Um override de baseUrl precisa ser absoluto: se o recurso declara a sua
      // própria base, ela substitui a da fonte e não pode ser um caminho solto.
      if (recurso.baseUrl !== undefined && !/^https?:\/\//.test(recurso.baseUrl)) {
        problemas.push(`Recurso ${ref}: baseUrl própria deve ser absoluta (http/https)`)
      }
      if (recurso.transporte === 'manual' && recurso.baseUrl !== undefined) {
        problemas.push(`Recurso ${ref} é manual e não deveria declarar baseUrl`)
      }
      if (recurso.transporte === 'manual' && recurso.metodo !== undefined) {
        problemas.push(`Recurso ${ref} é manual e não deveria declarar método HTTP`)
      }
      if (recurso.transporte !== 'manual' && recurso.metodo === undefined) {
        problemas.push(`Recurso ${ref} é coletável e deveria declarar método HTTP`)
      }
      if (recurso.identificadores.length === 0) {
        problemas.push(`Recurso ${ref} não declara nenhum identificador`)
      }
      // Um parâmetro obrigatório precisa ser resolvível: ou está no caminho,
      // ou é enviado na consulta (dimensão de fan-out), ou tem valor fixo
      // declarado em `valores` (ex.: `formato` do IBGE, sempre o mesmo).
      for (const p of recurso.parametros ?? []) {
        if (!p.obrigatorio) continue
        const resolvivel =
          recurso.caminho.includes(`{${p.nome}}`) ||
          p.dimensao !== undefined ||
          (p.valores !== undefined && p.valores.length === 1)
        if (!resolvivel) {
          problemas.push(
            `Recurso ${ref}: parâmetro obrigatório "${p.nome}" não é resolvível (nem caminho, nem dimensão, nem valor fixo)`,
          )
        }
      }
    }
  }

  return problemas
}
