/**
 * Conteúdo educativo do Observatório — a base da "Politicopédia".
 *
 * Cada verbete responde, em linguagem simples:
 *   O que é? · Como funciona? · Qual a função?
 * e, quando faz sentido, lista as ATRIBUIÇÕES (o que a pessoa ou órgão faz).
 *
 * Nos textos, termos entre [[colchetes duplos]] viram links clicáveis para
 * outros verbetes (ex.: "o [[vereador]] fiscaliza o [[prefeito]]").
 */

export type Categoria =
  | 'Cargos'
  | 'Poderes'
  | 'Eleições'
  | 'Orçamento'
  | 'Indicadores'
  | 'Território'

export interface Explicacao {
  titulo: string
  categoria: Categoria
  /** Uma linha, para a lista da Politicopédia */
  resumo: string
  oQueE: string
  comoFunciona: string
  qualFuncao: string
  /** Lista do que a pessoa/órgão efetivamente faz */
  atribuicoes?: string[]
  atencao?: string
  /** Chaves de verbetes relacionados */
  relacionados?: string[]
}

export const EXPLICACOES: Record<string, Explicacao> = {
  // =========================================================== PODERES
  legislativo: {
    titulo: 'Poder Legislativo',
    categoria: 'Poderes',
    resumo: 'O poder que faz as leis e fiscaliza quem executa.',
    oQueE:
      'É um dos três poderes do Estado. Sua tarefa é criar as leis, aprovar o orçamento e fiscalizar o Poder Executivo. Não administra serviços no dia a dia — quem faz isso é o [[executivo]].',
    comoFunciona:
      'É exercido por casas de representantes eleitos: [[camaraMunicipal]] nos municípios, [[assembleia]] nos estados e [[congresso]] no país. As decisões são tomadas por votação entre os parlamentares, e a maioria precisa concordar para uma lei passar.',
    qualFuncao:
      'Transformar a vontade da população em leis e vigiar o uso do dinheiro público. É o contrapeso que impede o Executivo de decidir tudo sozinho.',
    atribuicoes: [
      'Criar, alterar e revogar leis',
      'Aprovar o orçamento e acompanhar sua execução',
      'Fiscalizar o Executivo (pedidos de informação, convocações, CPIs)',
      'Julgar o chefe do Executivo em casos de crime de responsabilidade',
      'Aprovar indicados para cargos públicos, quando exigido',
    ],
    relacionados: ['executivo', 'judiciario', 'separacaoDosPoderes', 'camaraMunicipal'],
  },
  executivo: {
    titulo: 'Poder Executivo',
    categoria: 'Poderes',
    resumo: 'O poder que administra e executa as políticas públicas.',
    oQueE:
      'É o poder responsável por governar: colocar em prática as leis e prestar os serviços públicos (saúde, educação, segurança, obras).',
    comoFunciona:
      'É chefiado por uma pessoa eleita — [[prefeito]], [[governador]] ou [[presidente]] — que nomeia secretários e ministros e comanda a máquina pública.',
    qualFuncao:
      'Executar o orçamento aprovado pelo [[legislativo]] e entregar serviços à população.',
    atribuicoes: [
      'Administrar o dia a dia do município, estado ou país',
      'Executar o orçamento aprovado',
      'Nomear secretários e dirigentes',
      'Propor projetos de lei ao Legislativo',
      'Prestar contas publicamente',
    ],
    atencao: 'Executar não é decidir sozinho: o gasto precisa estar previsto no orçamento aprovado.',
    relacionados: ['legislativo', 'prefeito', 'governador', 'presidente'],
  },
  judiciario: {
    titulo: 'Poder Judiciário',
    categoria: 'Poderes',
    resumo: 'O poder que julga conflitos e garante o cumprimento das leis.',
    oQueE:
      'É o poder que resolve disputas e diz o que a lei significa em cada caso concreto.',
    comoFunciona:
      'Não é eleito: seus membros entram por concurso público e por promoções na carreira. Funciona em instâncias — a decisão de primeira instância pode ser revista por tribunais superiores.',
    qualFuncao:
      'Garantir direitos e fazer valer a Constituição, inclusive contra os outros poderes.',
    atribuicoes: [
      'Julgar processos entre pessoas, empresas e o Estado',
      'Declarar uma lei inconstitucional',
      'Julgar crimes e aplicar penas',
      'Controlar a legalidade dos atos do Executivo e do Legislativo',
    ],
    relacionados: ['legislativo', 'executivo', 'separacaoDosPoderes'],
  },
  separacaoDosPoderes: {
    titulo: 'Separação dos Poderes',
    categoria: 'Poderes',
    resumo: 'A ideia de dividir o poder em três para ninguém mandar sozinho.',
    oQueE:
      'É o princípio de dividir o poder do Estado em três: [[legislativo]] (faz as leis), [[executivo]] (executa) e [[judiciario]] (julga).',
    comoFunciona:
      'Cada poder pode limitar os outros — é o sistema de "freios e contrapesos". O Legislativo aprova o orçamento e pode afastar o presidente; o Executivo veta projetos; o Judiciário anula atos ilegais.',
    qualFuncao:
      'Evitar a concentração de poder e proteger a democracia. Se um poder exagera, os outros podem reagir.',
    atencao: 'Na prática, os poderes negociam o tempo todo — por isso acompanhar quem tem maioria importa tanto.',
    relacionados: ['legislativo', 'executivo', 'judiciario'],
  },

  // =========================================================== CARGOS
  presidente: {
    titulo: 'Presidente(a) da República',
    categoria: 'Cargos',
    resumo: 'Chefia o Poder Executivo federal.',
    oQueE: 'É a pessoa que governa o Brasil e representa o país diante das outras nações.',
    comoFunciona: 'É eleito pelo voto direto em todo o país, a cada 4 anos. Pode haver [[segundoTurno]].',
    qualFuncao: 'Comandar o governo federal e executar o orçamento da União.',
    atribuicoes: [
      'Nomear ministros e dirigentes federais',
      'Comandar as Forças Armadas',
      'Sancionar ou vetar leis aprovadas pelo [[congresso]]',
      'Representar o Brasil no exterior',
      'Executar o orçamento federal aprovado',
    ],
    relacionados: ['vicePresidente', 'congresso', 'executivo'],
  },
  vicePresidente: {
    titulo: 'Vice-Presidente(a)',
    categoria: 'Cargos',
    resumo: 'Substitui o presidente quando necessário.',
    oQueE: 'É a pessoa que assume a Presidência quando o presidente se ausenta, adoece ou renuncia.',
    comoFunciona: 'É eleito na mesma chapa do presidente — o eleitor vota na dupla.',
    qualFuncao: 'Garantir a continuidade do governo e coordenar as tarefas que o presidente delegar.',
    relacionados: ['presidente', 'executivo'],
  },
  governador: {
    titulo: 'Governador(a)',
    categoria: 'Cargos',
    resumo: 'Chefia o Poder Executivo do estado.',
    oQueE: 'É a pessoa que governa o estado.',
    comoFunciona: 'É eleito pelo voto direto a cada 4 anos, com possibilidade de [[segundoTurno]].',
    qualFuncao: 'Administrar o estado e executar o orçamento estadual.',
    atribuicoes: [
      'Comandar a segurança pública estadual (polícias civil e militar)',
      'Administrar escolas estaduais e hospitais regionais',
      'Cuidar de rodovias e infraestrutura estaduais',
      'Nomear secretários estaduais',
      'Executar o orçamento aprovado pela [[assembleia]]',
    ],
    relacionados: ['viceGovernador', 'assembleia', 'executivo'],
  },
  viceGovernador: {
    titulo: 'Vice-Governador(a)',
    categoria: 'Cargos',
    resumo: 'Substitui o governador quando necessário.',
    oQueE: 'É a pessoa que assume o governo do estado em ausências e impedimentos do governador.',
    comoFunciona: 'É eleito na mesma chapa do governador.',
    qualFuncao: 'Garantir a continuidade do governo estadual e coordenar áreas delegadas.',
    relacionados: ['governador', 'executivo'],
  },
  prefeito: {
    titulo: 'Prefeito(a)',
    categoria: 'Cargos',
    resumo: 'Chefia o Poder Executivo do município.',
    oQueE: 'É a pessoa que governa a cidade.',
    comoFunciona:
      'É escolhido pelo voto direto a cada 4 anos. Cidades com mais de 200 mil eleitores podem ter [[segundoTurno]].',
    qualFuncao: 'Administrar a cidade e executar o orçamento municipal.',
    atribuicoes: [
      'Coordenar saúde, educação infantil e ensino fundamental',
      'Cuidar de transporte, limpeza urbana, iluminação e vias públicas',
      'Nomear secretários municipais',
      'Executar o orçamento aprovado pela [[camaraMunicipal]]',
      'Prestar contas à população e aos órgãos de controle',
    ],
    relacionados: ['vicePrefeito', 'camaraMunicipal', 'vereador', 'executivo'],
  },
  vicePrefeito: {
    titulo: 'Vice-Prefeito(a)',
    categoria: 'Cargos',
    resumo: 'Substitui o prefeito quando necessário.',
    oQueE: 'É a pessoa que assume a prefeitura quando o prefeito não pode exercer o cargo.',
    comoFunciona: 'É eleito na mesma chapa do prefeito: o voto é na dupla, não separado.',
    qualFuncao: 'Garantir a continuidade da gestão e coordenar áreas delegadas pelo prefeito.',
    relacionados: ['prefeito', 'executivo'],
  },
  senador: {
    titulo: 'Senador(a)',
    categoria: 'Cargos',
    resumo: 'Representa o estado no Senado Federal.',
    oQueE: 'É o representante do estado no [[senado]], uma das duas casas do [[congresso]].',
    comoFunciona:
      'Cada estado e o Distrito Federal elegem sempre 3 senadores, com mandato de 8 anos. A cada eleição renova-se 1/3 ou 2/3 das vagas.',
    qualFuncao: 'Revisar e aprovar leis federais e fiscalizar o governo federal.',
    atribuicoes: [
      'Revisar as leis aprovadas pela [[camaraFederal]]',
      'Aprovar autoridades indicadas pelo [[presidente]] (ministros de tribunal, por exemplo)',
      'Fiscalizar o Executivo federal',
      'Julgar crimes de responsabilidade do presidente e de ministros',
    ],
    relacionados: ['deputadoFederal', 'senado', 'congresso', 'legislativo'],
  },
  deputadoFederal: {
    titulo: 'Deputado(a) Federal',
    categoria: 'Cargos',
    resumo: 'Representa o povo na Câmara dos Deputados.',
    oQueE: 'É o representante eleito para a [[camaraFederal]], em Brasília.',
    comoFunciona:
      'É eleito pelo [[sistemaProporcional]] dentro de cada estado: o número de vagas do partido depende do total de votos da legenda.',
    qualFuncao: 'Criar leis federais, aprovar o orçamento da União e fiscalizar o governo federal.',
    atribuicoes: [
      'Propor, analisar e votar leis federais',
      'Aprovar o orçamento da União',
      'Fiscalizar ministérios e órgãos federais',
      'Integrar comissões e CPIs',
      'Destinar emendas parlamentares',
    ],
    relacionados: ['deputadoEstadual', 'senador', 'camaraFederal', 'sistemaProporcional'],
  },
  deputadoEstadual: {
    titulo: 'Deputado(a) Estadual',
    categoria: 'Cargos',
    resumo: 'Representa o povo na Assembleia Legislativa.',
    oQueE: 'É o representante eleito para a [[assembleia]] do estado.',
    comoFunciona: 'É eleito pelo [[sistemaProporcional]], dentro do estado.',
    qualFuncao: 'Criar leis estaduais, aprovar o orçamento do estado e fiscalizar o governador.',
    atribuicoes: [
      'Criar e votar leis estaduais',
      'Aprovar o orçamento estadual',
      'Fiscalizar as ações do [[governador]]',
      'Criar e acompanhar políticas estaduais',
    ],
    relacionados: ['deputadoFederal', 'assembleia', 'sistemaProporcional'],
  },
  deputadoDistrital: {
    titulo: 'Deputado(a) Distrital',
    categoria: 'Cargos',
    resumo: 'Representante da Câmara Legislativa do Distrito Federal.',
    oQueE: 'É o representante eleito para a Câmara Legislativa do Distrito Federal.',
    comoFunciona: 'Só existe no DF, que não é município nem estado — reúne as duas funções.',
    qualFuncao: 'Faz as leis do Distrito Federal e fiscaliza o governo distrital.',
    relacionados: ['deputadoEstadual', 'distritoFederal'],
  },
  vereador: {
    titulo: 'Vereador(a)',
    categoria: 'Cargos',
    resumo: 'Representante eleito para a Câmara Municipal.',
    oQueE: 'É o representante eleito para a [[camaraMunicipal]], o parlamento da cidade.',
    comoFunciona:
      'É eleito pelo [[sistemaProporcional]]: as vagas são distribuídas conforme a votação total do partido, e não só pelos votos de cada candidato.',
    qualFuncao: 'Criar leis municipais, aprovar o orçamento e fiscalizar o [[prefeito]].',
    atribuicoes: [
      'Criar leis municipais (plano diretor, zoneamento, taxas)',
      'Aprovar o orçamento da cidade',
      'Fiscalizar as contas e as obras da prefeitura',
      'Criar comissões e pedir informações ao Executivo',
      'Atender a população e intermediar demandas locais',
    ],
    atencao:
      'O número de vereadores é proporcional à população: capitais têm dezenas; cidades pequenas podem ter nove.',
    relacionados: ['prefeito', 'camaraMunicipal', 'cadeiras', 'sistemaProporcional'],
  },

  // =========================================================== ELEIÇÕES
  sistemaProporcional: {
    titulo: 'Sistema proporcional',
    categoria: 'Eleições',
    resumo: 'Regra em que as vagas são divididas conforme a votação dos partidos.',
    oQueE:
      'É o sistema usado para eleger [[vereador]], [[deputadoEstadual]] e [[deputadoFederal]]. Nele, o número de cadeiras de cada partido depende do total de votos que a legenda recebeu.',
    comoFunciona:
      'Somam-se os votos de todos os candidatos do partido (mais os votos de legenda). Calcula-se quantas cadeiras cabem a cada partido e, dentro do partido, assumem os mais votados. Por isso, um candidato muito votado ajuda a eleger colegas de legenda.',
    qualFuncao: 'Garantir que as minorias também tenham representação, refletindo a proporção de votos.',
    atencao:
      'É por isso que uma pessoa pode ser eleita com menos votos que outra que não se elege: o que conta é a força do partido.',
    relacionados: ['sistemaMajoritario', 'cadeiras', 'quocienteEleitoral'],
  },
  sistemaMajoritario: {
    titulo: 'Sistema majoritário',
    categoria: 'Eleições',
    resumo: 'Regra em que vence quem tem mais votos.',
    oQueE:
      'É o sistema usado para cargos de um só ocupante: [[prefeito]], [[governador]], [[senador]] e [[presidente]].',
    comoFunciona:
      'Vence quem obtiver mais votos. Em cidades com mais de 200 mil eleitores (e nos cargos estaduais e federal), se ninguém passar de 50% no primeiro turno, há [[segundoTurno]].',
    qualFuncao: 'Dar um único vencedor claro para cargos de comando.',
    relacionados: ['sistemaProporcional', 'segundoTurno'],
  },
  segundoTurno: {
    titulo: 'Segundo turno',
    categoria: 'Eleições',
    resumo: 'Nova votação quando ninguém atinge metade dos votos no 1º turno.',
    oQueE: 'É uma segunda votação, feita quando nenhum candidato alcança mais da metade dos votos válidos.',
    comoFunciona:
      'Acontece nas eleições para prefeito de cidades com mais de 200 mil eleitores, e sempre para governador, senador (quando a vaga não é única) e presidente.',
    qualFuncao: 'Garantir que o eleito tenha apoio da maioria do eleitorado.',
    relacionados: ['sistemaMajoritario'],
  },
  cadeiras: {
    titulo: 'Cadeiras (assentos)',
    categoria: 'Eleições',
    resumo: 'Cada assento conquistado num parlamento.',
    oQueE:
      'Cada "cadeira" é um assento no parlamento: [[camaraMunicipal]], [[assembleia]], [[camaraFederal]] ou [[senado]]. Quem ocupa uma cadeira vota as leis.',
    comoFunciona:
      'Reunimos todos os eleitos e contamos quantos pertencem a cada partido. O gráfico mostra esse total dividido por legenda.',
    qualFuncao:
      'Revela a correlação de forças: quem tem mais cadeiras consegue aprovar, barrar ou negociar projetos com mais facilidade.',
    atencao: 'Cadeira não é voto. Aqui contamos ASSENTOS conquistados, não a quantidade de votos recebidos.',
    relacionados: ['sistemaProporcional', 'dominante', 'mandato'],
  },
  dominante: {
    titulo: 'Partido dominante',
    categoria: 'Eleições',
    resumo: 'O partido com mais cadeiras num parlamento.',
    oQueE: 'É o partido com o maior número de [[cadeiras]] naquele parlamento.',
    comoFunciona:
      'Comparamos a contagem de cadeiras de todos os partidos e destacamos o primeiro colocado. Em caso de empate, aparece o primeiro em ordem alfabética.',
    qualFuncao:
      'Dá uma leitura rápida de quem tem mais influência — mas não significa que decide sozinho.',
    atencao: 'Maior bancada não é maioria automática: muitas decisões exigem acordos entre vários partidos.',
    relacionados: ['cadeiras', 'forcaPolitica'],
  },
  mandato: {
    titulo: 'Mandato',
    categoria: 'Eleições',
    resumo: 'O período em que o eleito exerce o cargo.',
    oQueE: 'É o tempo durante o qual a pessoa ocupa o cargo para o qual foi eleita.',
    comoFunciona:
      'A maioria dos cargos tem mandato de 4 anos (prefeito, governador, deputados e vereadores). Senadores têm 8 anos.',
    qualFuncao: 'Define o período de responsabilidade do eleito e quando haverá nova eleição.',
    relacionados: ['cadeiras', 'suplente'],
  },
  suplente: {
    titulo: 'Suplente',
    categoria: 'Eleições',
    resumo: 'Quem assume a cadeira se o titular sair.',
    oQueE: 'É o candidato que não se elegeu, mas fica na fila para assumir uma [[cadeiras]].',
    comoFunciona:
      'No [[sistemaProporcional]], assume o próximo mais votado do mesmo partido. No [[senado]], cada senador é eleito com dois suplentes.',
    qualFuncao: 'Evitar que a vaga fique vazia quando o titular renuncia, morre ou assume outro cargo.',
    relacionados: ['cadeiras', 'mandato'],
  },
  coligacao: {
    titulo: 'Coligação / federação',
    categoria: 'Eleições',
    resumo: 'Partidos que se unem para disputar a eleição.',
    oQueE: 'É a união de dois ou mais partidos para concorrer juntos numa eleição.',
    comoFunciona:
      'Nas eleições majoritárias, os partidos coligados apoiam o mesmo candidato. No [[sistemaProporcional]], a soma dos votos da coligação ajuda a eleger mais candidatos.',
    qualFuncao: 'Aumentar as chances de vitória e de eleger mais representantes.',
    relacionados: ['sistemaProporcional', 'sistemaMajoritario'],
  },
  quocienteEleitoral: {
    titulo: 'Quociente eleitoral',
    categoria: 'Eleições',
    resumo: 'A conta que define quantas cadeiras cada partido recebe.',
    oQueE:
      'É o número mínimo de votos que um partido precisa para conquistar uma [[cadeiras]] no [[sistemaProporcional]].',
    comoFunciona:
      'Divide-se o total de votos válidos pelo número de vagas. O resultado é o "preço" de cada cadeira. Depois, distribui-se o que sobra pelas maiores médias.',
    qualFuncao: 'Converter votos em assentos de forma proporcional entre os partidos.',
    relacionados: ['sistemaProporcional', 'cadeiras'],
  },

  // =========================================================== ORÇAMENTO
  orcamentoPublico: {
    titulo: 'Orçamento público',
    categoria: 'Orçamento',
    resumo: 'O plano de quanto o governo arrecada e quanto gasta.',
    oQueE:
      'É a lei que autoriza o governo a arrecadar e a gastar dinheiro em um ano. É o "planejamento financeiro" do município, do estado ou da União.',
    comoFunciona:
      'O [[executivo]] propõe, o [[legislativo]] analisa e aprova, e depois o Executivo executa. Os números ficam públicos na prestação de contas.',
    qualFuncao: 'Definir prioridades e permitir que a população e os órgãos de controle fiscalizem o gasto.',
    relacionados: ['receitaTotal', 'despesaTotal', 'legislativo', 'transferencias'],
  },
  receitaTotal: {
    titulo: 'Receita total',
    categoria: 'Orçamento',
    resumo: 'Todo o dinheiro que o governo arrecadou no ano.',
    oQueE: 'É a soma de tudo o que entrou nos cofres públicos no período.',
    comoFunciona:
      'Vem da prestação de contas oficial (Siconfi, do Tesouro Nacional). Somam-se impostos, taxas, contribuições e [[transferencias]] recebidas.',
    qualFuncao: 'Mostra quanto o governo tem disponível para gastar com serviços públicos.',
    atencao: 'Receita é o que ENTROU; nem tudo o que entra é gasto no mesmo ano.',
    relacionados: ['despesaTotal', 'transferencias', 'orcamentoPublico'],
  },
  despesaTotal: {
    titulo: 'Despesa total',
    categoria: 'Orçamento',
    resumo: 'O dinheiro que o governo efetivamente gastou.',
    oQueE: 'É a soma de tudo o que o governo gastou no ano.',
    comoFunciona:
      'Usamos as "despesas liquidadas": aquelas em que o serviço ou produto já foi entregue e conferido — o estágio mais próximo do gasto real.',
    qualFuncao: 'Mostra para onde foi o dinheiro público e permite cobrar resultados.',
    relacionados: ['receitaTotal', 'saude', 'educacao', 'orcamentoPublico'],
  },
  transferencias: {
    titulo: 'Transferências',
    categoria: 'Orçamento',
    resumo: 'Dinheiro que passa de um ente a outro da federação.',
    oQueE:
      'É o dinheiro que a União repassa aos estados e municípios, ou que os estados repassam aos municípios.',
    comoFunciona:
      'Parte vem de regras constitucionais (Fundo de Participação dos Municípios, repasses de saúde e educação) e parte de convênios e emendas.',
    qualFuncao:
      'Reduzir a desigualdade entre regiões: muitos municípios pequenos arrecadam pouco e dependem desses repasses.',
    relacionados: ['receitaTotal', 'uniao', 'estado', 'municipio'],
  },
  saude: {
    titulo: 'Gastos com Saúde',
    categoria: 'Orçamento',
    resumo: 'Quanto foi aplicado em saúde pública.',
    oQueE: 'É o total gasto na área da saúde.',
    comoFunciona:
      'Soma-se o que foi liquidado na função "Saúde" (código 10 na contabilidade pública), incluindo postos, hospitais, vacinação e vigilância.',
    qualFuncao:
      'A Constituição exige mínimo de 15% de certas receitas em saúde (municípios). O número ajuda a fiscalizar se o mínimo foi cumprido.',
    relacionados: ['despesaTotal', 'educacao', 'orcamentoPublico'],
  },
  educacao: {
    titulo: 'Gastos com Educação',
    categoria: 'Orçamento',
    resumo: 'Quanto foi aplicado em educação.',
    oQueE: 'É o total gasto na área da educação.',
    comoFunciona:
      'Soma-se o que foi liquidado na função "Educação" (código 12), incluindo escolas, salários de professores, material e transporte escolar.',
    qualFuncao:
      'A Constituição exige mínimo de 25% de certas receitas em educação. Comparar o gasto ajuda a cobrar prioridade.',
    relacionados: ['despesaTotal', 'saude', 'orcamentoPublico'],
  },

  // =========================================================== INDICADORES
  populacao: {
    titulo: 'População',
    categoria: 'Indicadores',
    resumo: 'Quantas pessoas moram no lugar.',
    oQueE: 'A quantidade de pessoas que moram naquele lugar.',
    comoFunciona:
      'Vem do IBGE. A cada ano o instituto estima os moradores de cada município, com base no último Censo e nos registros de nascimentos, mortes e migração.',
    qualFuncao:
      'Mostra o tamanho do lugar, serve de base para o [[pibPerCapita]] e para repartir recursos e [[transferencias]].',
    atencao: 'Estimativa não é contagem exata: entre um Censo e outro, o número é uma projeção.',
    relacionados: ['pib', 'pibPerCapita', 'municipio'],
  },
  pib: {
    titulo: 'PIB (Produto Interno Bruto)',
    categoria: 'Indicadores',
    resumo: 'Tudo o que a economia produz em um ano.',
    oQueE: 'É a soma de tudo o que é produzido em bens e serviços naquele lugar durante um ano.',
    comoFunciona:
      'O IBGE soma o que a agropecuária, a indústria e os serviços geraram, mais os impostos. Nos municípios, o dado costuma sair com dois a três anos de atraso.',
    qualFuncao: 'Mede o tamanho da economia — é como saber o "faturamento" de um lugar.',
    atencao: 'PIB grande não significa povo rico: um lugar pode produzir muito e distribuir mal.',
    relacionados: ['pibPerCapita', 'hexagonosPib', 'populacao'],
  },
  pibPerCapita: {
    titulo: 'PIB per capita',
    categoria: 'Indicadores',
    resumo: 'O PIB dividido pela população.',
    oQueE: 'É o [[pib]] dividido pelo número de habitantes.',
    comoFunciona: 'É uma conta simples: PIB ÷ [[populacao]]. Em média, quanto cada morador produz por ano.',
    qualFuncao:
      'Permite comparar lugares de tamanhos diferentes. Um município pequeno pode ter PIB per capita maior que uma capital.',
    atencao:
      'É uma MÉDIA. Não quer dizer que cada pessoa recebe esse valor — a riqueza pode estar concentrada em poucas mãos.',
    relacionados: ['pib', 'populacao'],
  },
  hexagonosPib: {
    titulo: 'PIB em hexágonos',
    categoria: 'Indicadores',
    resumo: 'Mapa que agrupa o PIB por área para mostrar a concentração.',
    oQueE:
      'Uma camada que agrupa os municípios em hexágonos e mostra, em cada um, a soma do [[pib]] daquela área. Quanto mais alto e claro o hexágono, mais riqueza se produz ali.',
    comoFunciona:
      'Cada município vira um ponto no centro do seu território, com o seu PIB. O sistema junta os pontos que caem dentro do mesmo hexágono e soma o PIB deles. A altura e a cor representam esse total.',
    qualFuncao:
      'Mostra num só golpe de vista onde a economia se concentra — e como ela é desigual entre as regiões.',
    atencao:
      'O hexágono não respeita fronteiras: ele apenas agrupa por proximidade. O valor é a SOMA do PIB da área, não o PIB de um lugar específico.',
    relacionados: ['pib', 'forcaPolitica', 'municipio'],
  },
  forcaPolitica: {
    titulo: 'Força política (mapa das cadeiras)',
    categoria: 'Eleições',
    resumo: 'Mapa que pinta cada lugar com a cor do partido mais forte.',
    oQueE:
      'Um jeito de enxergar no mapa quais partidos são mais fortes em cada lugar — uma "guerra de territórios" democrática.',
    comoFunciona:
      'Cada território é pintado com a cor do [[dominante]]. Ao clicar em um partido, as áreas ficam mais fortes onde ele tem mais [[cadeiras]] e mais apagadas onde tem poucas. O cálculo usa CADEIRAS, não votos.',
    qualFuncao:
      'Mostra o mapa do poder: onde cada partido manda e como isso muda de região para região.',
    atencao:
      'As cores dos partidos foram escolhidas para facilitar a leitura e não são as cores oficiais das legendas.',
    relacionados: ['cadeiras', 'dominante', 'hexagonosPib'],
  },

  // =========================================================== TERRITÓRIO
  uniao: {
    titulo: 'União (governo federal)',
    categoria: 'Território',
    resumo: 'O ente que representa o país inteiro.',
    oQueE: 'É o governo federal, que representa todo o Brasil.',
    comoFunciona:
      'Tem competências que valem para todo o país: moeda, defesa, relações exteriores, leis nacionais. Arrecada os maiores impostos e reparte parte com estados e municípios via [[transferencias]].',
    qualFuncao: 'Coordenar o país e reduzir desigualdades regionais.',
    relacionados: ['estado', 'municipio', 'transferencias'],
  },
  estado: {
    titulo: 'Estado (unidade federativa)',
    categoria: 'Território',
    resumo: 'Divisão do país com governo próprio.',
    oQueE: 'É cada uma das 26 unidades federativas, mais o Distrito Federal.',
    comoFunciona:
      'Tem governo próprio ([[governador]]) e parlamento próprio ([[assembleia]]). Divide competências com a União e os municípios.',
    qualFuncao: 'Cuidar de temas regionais: segurança pública, ensino médio, saúde de média complexidade, rodovias.',
    relacionados: ['municipio', 'uniao', 'governador', 'assembleia'],
  },
  municipio: {
    titulo: 'Município',
    categoria: 'Território',
    resumo: 'A menor divisão com governo próprio.',
    oQueE: 'É a cidade e seu entorno, com governo próprio.',
    comoFunciona:
      'Tem [[prefeito]] e [[camaraMunicipal]]. É o ente mais próximo da população e executa a maior parte dos serviços do dia a dia.',
    qualFuncao: 'Prestar serviços básicos: saúde, educação infantil e fundamental, limpeza, transporte e obras locais.',
    relacionados: ['estado', 'uniao', 'prefeito', 'vereador'],
  },
  distritoFederal: {
    titulo: 'Distrito Federal',
    categoria: 'Território',
    resumo: 'O ente que acumula funções de estado e município.',
    oQueE: 'É onde fica Brasília, a capital do país. Não é estado nem município.',
    comoFunciona:
      'Acumula competências estaduais e municipais: tem [[governador]] e deputados distritais, mas não tem prefeito nem vereadores.',
    qualFuncao: 'Sede do governo federal e responsável pelos serviços locais e estaduais do DF.',
    relacionados: ['uniao', 'estado', 'deputadoDistrital'],
  },

  // =========================================================== ÓRGÃOS
  camaraMunicipal: {
    titulo: 'Câmara Municipal',
    categoria: 'Poderes',
    resumo: 'O parlamento da cidade.',
    oQueE: 'É o [[legislativo]] do município, formado pelos [[vereador]].',
    comoFunciona: 'Os vereadores são eleitos a cada 4 anos pelo [[sistemaProporcional]].',
    qualFuncao: 'Faz as leis do município, aprova o orçamento e fiscaliza a prefeitura.',
    atribuicoes: [
      'Votar o plano diretor e as leis de uso do solo',
      'Aprovar o orçamento e as contas do prefeito',
      'Criar comissões e CPIs para investigar a gestão',
      'Fiscalizar obras e contratos municipais',
    ],
    relacionados: ['vereador', 'prefeito', 'legislativo'],
  },
  assembleia: {
    titulo: 'Assembleia Legislativa',
    categoria: 'Poderes',
    resumo: 'O parlamento do estado.',
    oQueE: 'É o [[legislativo]] do estado, formado pelos [[deputadoEstadual]].',
    comoFunciona: 'Os deputados estaduais são eleitos a cada 4 anos.',
    qualFuncao: 'Faz as leis estaduais, aprova o orçamento e fiscaliza o [[governador]].',
    relacionados: ['deputadoEstadual', 'governador', 'legislativo'],
  },
  camaraFederal: {
    titulo: 'Câmara dos Deputados',
    categoria: 'Poderes',
    resumo: 'A casa do Congresso com 513 deputados federais.',
    oQueE: 'É uma das duas casas do [[congresso]], com 513 [[deputadoFederal]].',
    comoFunciona:
      'Cada estado elege uma quantidade de deputados proporcional à sua população, pelo [[sistemaProporcional]].',
    qualFuncao: 'Analisa e vota as leis federais, aprova o orçamento da União e fiscaliza o governo federal.',
    relacionados: ['senado', 'congresso', 'deputadoFederal'],
  },
  senado: {
    titulo: 'Senado Federal',
    categoria: 'Poderes',
    resumo: 'A casa do Congresso com 3 senadores por estado.',
    oQueE: 'É a outra casa do [[congresso]], com 81 [[senador]] (3 por estado e pelo DF).',
    comoFunciona: 'Cada estado elege 3 senadores, com [[mandato]] de 8 anos.',
    qualFuncao: 'Revisa as leis aprovadas pela Câmara, aprova autoridades e julga crimes de responsabilidade.',
    relacionados: ['camaraFederal', 'congresso', 'senador'],
  },
  congresso: {
    titulo: 'Congresso Nacional',
    categoria: 'Poderes',
    resumo: 'O parlamento brasileiro: Câmara + Senado.',
    oQueE: 'É o [[legislativo]] federal, formado pela [[camaraFederal]] e pelo [[senado]].',
    comoFunciona: 'As duas casas precisam aprovar a maioria das leis; cada uma revisa o texto da outra.',
    qualFuncao: 'Elabora as leis do país, aprova o orçamento federal e fiscaliza o [[executivo]].',
    relacionados: ['camaraFederal', 'senado', 'legislativo'],
  },
  governoEstado: {
    titulo: 'Governo do Estado',
    categoria: 'Poderes',
    resumo: 'O Poder Executivo estadual.',
    oQueE: 'É o [[executivo]] do estado.',
    comoFunciona: 'É chefiado pelo [[governador]], eleito a cada 4 anos.',
    qualFuncao: 'Administra o estado e executa o orçamento aprovado pela [[assembleia]].',
    relacionados: ['governador', 'assembleia', 'executivo'],
  },
  presidencia: {
    titulo: 'Presidência da República',
    categoria: 'Poderes',
    resumo: 'O Poder Executivo federal.',
    oQueE: 'É o [[executivo]] federal.',
    comoFunciona: 'É chefiada pelo [[presidente]], eleito a cada 4 anos.',
    qualFuncao: 'Governa o país e executa o orçamento da União aprovado pelo [[congresso]].',
    relacionados: ['presidente', 'congresso', 'executivo'],
  },
}
