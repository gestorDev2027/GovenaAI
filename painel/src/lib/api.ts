/**
 * Cliente das rotas /painel/api. Acesso por login com Google (sessão em cookie, enviado
 * automaticamente) ou pela chave de acesso (OS_SECURITY_KEY), que fica no navegador.
 */

const CHAVE_LOCAL = "painel-agente-chave";

export function lerChave(): string {
  try {
    return localStorage.getItem(CHAVE_LOCAL) ?? "";
  } catch {
    return "";
  }
}

export function salvarChave(chave: string) {
  try {
    if (chave) localStorage.setItem(CHAVE_LOCAL, chave);
    else localStorage.removeItem(CHAVE_LOCAL);
  } catch {
    /* navegador sem armazenamento: a chave vale só nesta aba */
  }
  chaveEmMemoria = chave;
}

let chaveEmMemoria = lerChave();

export class ErroAcesso extends Error {
  constructor() {
    super("Chave de acesso inválida ou ausente.");
  }
}

export const EVENTO_SEM_ACESSO = "painel:sem-acesso";

export async function api<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const resposta = await fetch(`/painel/api${caminho}`, {
    ...init,
    headers: {
      // FormData (envio de arquivos) define o próprio Content-Type, com o boundary.
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(chaveEmMemoria ? { Authorization: `Bearer ${chaveEmMemoria}` } : {}),
      ...init.headers,
    },
  });
  if (resposta.status === 401) {
    window.dispatchEvent(new Event(EVENTO_SEM_ACESSO));
    throw new ErroAcesso();
  }
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null);
    const detalhe = corpo?.detail;
    const texto = Array.isArray(detalhe)
      ? detalhe.map((d: { msg?: string }) => d.msg).join("; ")
      : typeof detalhe === "string"
        ? detalhe
        : `Erro ${resposta.status} ao falar com o servidor.`;
    throw new Error(texto);
  }
  // 204 (exclusão) não tem corpo.
  if (resposta.status === 204) return undefined as T;
  return resposta.json() as Promise<T>;
}

/** Rota que responde em linhas JSON à medida que o servidor trabalha (ex.: /chat/etapas). Chama
 * `aoEvento` para cada linha; erros de acesso e de validação seguem as mesmas regras de `api`. */
export async function apiEmLinhas<T>(caminho: string, init: RequestInit, aoEvento: (evento: T) => void): Promise<void> {
  const resposta = await fetch(`/painel/api${caminho}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(chaveEmMemoria ? { Authorization: `Bearer ${chaveEmMemoria}` } : {}),
      ...init.headers,
    },
  });
  if (resposta.status === 401) {
    window.dispatchEvent(new Event(EVENTO_SEM_ACESSO));
    throw new ErroAcesso();
  }
  if (!resposta.ok || !resposta.body) {
    const corpo = await resposta.json().catch(() => null);
    const detalhe = corpo?.detail;
    throw new Error(
      Array.isArray(detalhe)
        ? detalhe.map((d: { msg?: string }) => d.msg).join("; ")
        : typeof detalhe === "string"
          ? detalhe
          : `Erro ${resposta.status} ao falar com o servidor.`,
    );
  }
  const leitor = resposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    resto += value;
    const linhas = resto.split("\n");
    resto = linhas.pop() ?? "";
    for (const linha of linhas) if (linha.trim()) aoEvento(JSON.parse(linha) as T);
  }
  if (resto.trim()) aoEvento(JSON.parse(resto) as T);
}

/** Baixa um arquivo de uma rota do painel (com a mesma autenticação) e o entrega ao navegador. */
export async function baixarArquivo(caminho: string, nome: string) {
  const resposta = await fetch(`/painel/api${caminho}`, {
    headers: chaveEmMemoria ? { Authorization: `Bearer ${chaveEmMemoria}` } : {},
  });
  if (resposta.status === 401) {
    window.dispatchEvent(new Event(EVENTO_SEM_ACESSO));
    throw new ErroAcesso();
  }
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null);
    throw new Error(typeof corpo?.detail === "string" ? corpo.detail : `Erro ${resposta.status} ao baixar.`);
  }
  const url = URL.createObjectURL(await resposta.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Encerra a sessão do Google e esquece a chave salva; a tela de entrada volta. */
export async function sair() {
  salvarChave("");
  window.google?.accounts.id.disableAutoSelect();
  await api("/logout", { method: "POST" }).catch(() => null);
  window.location.assign("/painel/inicio");
}

/* ───────── Tipos das respostas ───────── */

/** As permissões do painel (agente/usuarios.py). */
export type Permissao =
  | "ver_painel"
  | "tratar_alertas"
  | "usar_chat"
  | "avaliar"
  | "aprovar_calibracao"
  | "editar_conhecimento"
  | "editar_agentes"
  | "publicar"
  | "excluir"
  | "ferramentas_e_chaves"
  | "ver_banco"
  | "gerenciar_usuarios";

export type SituacaoUsuario = "pendente" | "ativo" | "bloqueado";

/** Quem entrou com o Google: o papel, a situação (pendente até o dono aprovar) e o que pode fazer. */
export interface Usuario {
  email: string;
  nome: string;
  papel?: string | null;
  situacao?: SituacaoUsuario;
  permissoes?: Permissao[];
}

/** A prefeitura de quem está logado (dono ou membro) e o que ele pode fazer nela (agente/acessos.py). */
export type PermissaoPrefeitura =
  | "ver_painel"
  | "aprovar_entregas"
  | "gerenciar_fluxos"
  | "criar_agentes"
  | "definir_metas"
  | "registrar_dados"
  | "gerenciar_cargos"
  | "gerenciar_equipe"
  | "ver_auditoria";

export interface ContextoPrefeitura {
  municipio_id: string;
  municipio: string | null;
  uf: string | null;
  situacao_municipio: string | null;
  papel: "dono" | "membro";
  cargo_id: string | null;
  cargo: string | null;
  permissoes: PermissaoPrefeitura[];
}

export interface Acesso {
  requer_chave: boolean;
  /** A prefeitura da pessoa logada, se ela é dona ou membro ativo de uma. */
  prefeitura?: ContextoPrefeitura | null;
  /** Cadastro e login com e-mail e senha ligados (o servidor tem a OS_SECURITY_KEY). */
  aceita_senha?: boolean;
  google_client_id: string | null;
  /** Token público do Mapbox (mapa da cidade); null sem MAPBOX_TOKEN no servidor. */
  mapbox_token?: string | null;
  /** false: com o Google ligado, pessoas entram só por ele (não mostrar o campo da chave). */
  aceita_chave?: boolean;
  usuario: Usuario | null;
}

/** Uma pessoa na tela de usuários. */
export interface UsuarioPainel {
  email: string;
  nome: string;
  papel: string | null;
  situacao: SituacaoUsuario;
  permissoes: Permissao[];
  criado_em: string | null;
  ultimo_acesso: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
}

export interface OpcoesUsuarios {
  permissoes: { id: Permissao; nome: string; descricao: string }[];
  /** Os papéis que se podem escolher (o dono não aparece). */
  papeis: { id: string; nome: string; descricao: string; permissoes: Permissao[] }[];
  situacoes: SituacaoUsuario[];
}

/**
 * sem_resposta: só as boas-vindas, e o servidor não respondeu no prazo da inatividade.
 * nao_chegou: a Unnichat pôs o cidadão com o agente e o aviso de entrada não chegou ao GestorGov (sem boas-vindas).
 */
export type Status = "em_atendimento" | "transferido" | "encerrado" | "sem_resposta" | "nao_chegou";

export interface Acao {
  tipo: "transferencia" | "encerramento" | "inatividade";
  categoria?: string;
  motivo?: string;
  dificuldade_relatada?: string;
  orientacoes_prestadas?: string;
  resumo?: string;
  registrado_em?: string;
}

/** Uma resposta do agente no rastreamento da conversa: o porquê, as ferramentas e o contexto que entrou. */
export interface RespostaRastreada {
  run_id: string;
  quando: string | null;
  agente?: string | null;
  mensagem: string;
  resposta: string;
  /** Resumo do raciocínio do modelo (o Gemini escreve em inglês). */
  raciocinio: string | null;
  duracao_s: number | null;
  tokens: { entrada: number | null; saida: number | null; raciocinio: number | null } | null;
  ferramentas: { nome: string; argumentos: Record<string, unknown> | null; resultado: string | null; erro: boolean }[];
  calibracao?: UsoCalibracao | null;
  chamadas_modelo: { modelo: string | null; duracao_ms: number | null; tokens_entrada: number | null; tokens_saida: number | null; tokens_cache: number | null; erro: boolean }[];
  /** O que entrou nas instruções desta resposta além da base: histórico do WhatsApp, trechos, exemplos, roteiro. */
  contexto: { whatsapp?: boolean; trechos?: boolean; exemplos?: boolean; roteiro?: boolean; whatsapp_texto?: string | null };
}

export interface RastreamentoConversa {
  session_id: string;
  status: Status | null;
  nome: string;
  acoes: Acao[];
  /** Learning: resumo da sessão com o plano (objetivo, passos e progresso). */
  resumo?: { summary: string | null; goal: string | null; plan: string[] | null; progress: string[] | null };
  perfil?: Record<string, string>;
  memorias?: string[];
  respostas: RespostaRastreada[];
}

export interface ResumoConversa {
  id: string;
  /** Id do agente que atende a conversa (onboarding, sdr...) e a área dele. */
  agente?: string;
  area?: string;
  origem: string;
  nome: string;
  status: Status;
  fim: "encerramento" | "inatividade" | null;
  criada_em: string | null;
  atualizada_em: string | null;
  mensagens: number;
  ultima_mensagem: string;
  ultima_resposta: string;
  categoria: string | null;
  categoria_rotulo: string | null;
  motivo: string | null;
  tokens_entrada: number;
  tokens_saida: number;
  duracao_media_s: number | null;
  /** Só as boas-vindas: o servidor ainda não respondeu (não há sessão do agente). */
  so_boas_vindas?: boolean;
  /** O aviso de entrada da Unnichat não chegou: o agente não mandou as boas-vindas. */
  nao_chegou?: boolean;
}

export interface Anexo {
  tipo: "imagem" | "arquivo" | "audio";
  nome: string;
  mime: string | null;
}

export interface ItemConversa {
  papel: "contato" | "agente";
  /** Numa conversa de equipe, quem respondeu esta mensagem. */
  agente?: string | null;
  run_id?: string;
  calibracao?: UsoCalibracao | null;
  texto: string;
  quando: string | null;
  anexos?: Anexo[];
  ferramentas?: { nome: string; argumentos: Record<string, unknown> | null }[];
  duracao_s?: number | null;
  tokens?: number | null;
}

export interface Conversa extends ResumoConversa {
  /** O id da equipe que atende a conversa, ou null. */
  equipe?: string | null;
  itens: ItemConversa[];
  acoes: Acao[];
  telefone: string;
}

/** Mensagem do histórico do Unnichat: servidor, agente (pela API), automação, equipe (Live Chat), nota interna ou aviso do sistema. */
export interface MensagemUnnichat {
  autor: "contato" | "agente" | "automacao" | "equipe" | "nota" | "sistema";
  tipo: string;
  texto: string;
  quando: string | null;
}

export interface NegocioUnnichat {
  id: string;
  funil: string | null;
  coluna: string | null;
  status: "open" | "won" | "lost" | string;
  criado_em: string | null;
  produtos: string[];
}

/** Uma parte da ficha que não pôde ser consultada (o resto da ficha continua valendo). */
export interface FalhaFicha {
  erro: string;
}

export interface UnnichatDaFicha {
  contato_id: string;
  nome: string | null;
  email: string | null;
  telefone: string;
  criado_em: string | null;
  campos: Record<string, unknown>;
  tags: string[];
  atendente: { id: string; nome: string | null; email: string | null } | null;
  negocios: NegocioUnnichat[];
  mensagens: MensagemUnnichat[];
}

/** GET /conversas/{id}/ficha. null quando não se aplica, ou { erro } quando a consulta falhou. */
export interface FichaContato {
  consultado_em: string;
  unnichat: UnnichatDaFicha | FalhaFicha | null;
}

/** Os números de um período (GET /indicadores). Taxas de 0 a 1, sobre as conversas terminadas. */
export interface MedidasPeriodo {
  /** Com sessão do agente + só de boas-vindas. */
  conversas: number;
  /** Em que o servidor escreveu ao menos uma vez (têm sessão do agente). */
  com_resposta: number;
  /** Transferidas + retidas: as que já terminaram. */
  terminadas: number;
  /** Ainda abertas (fora das taxas até terminar). */
  em_andamento: number;
  transferidas: number;
  /** Terminaram sem passar para a equipe. */
  retidas: number;
  retidas_detalhe: { encerradas_pelo_agente: number; inatividade: number; sem_resposta: number };
  /** Retidas ÷ terminadas: a taxa de retenção. */
  retencao_pct: number | null;
  transferencia_pct: number | null;
  /** Encerradas pelo agente (o servidor disse que não precisava de mais nada) ÷ terminadas. */
  resolucao_confirmada_pct: number | null;
  respostas: number;
  mensagens_por_conversa: number | null;
  /** Respostas em que o agente disse que não tinha a informação ou não achou a aula. */
  respostas_com_lacuna: number;
  lacuna_pct: number | null;
  /** Tempo médio do modelo por resposta. */
  tempo_modelo_s: number | null;
  /** Do início à última mensagem, nas que terminaram com o servidor conversando. */
  duracao_mediana_min: number | null;
  tokens_entrada: number;
  tokens_saida: number;
  /** Com PRECO_ENTRADA_REAIS_MILHAO / PRECO_SAIDA_REAIS_MILHAO no servidor; null sem eles. */
  custo_reais: number | null;
  custo_por_conversa: number | null;
  custo_por_retida: number | null;
  /** Em andamento, separado: boas-vindas ainda no prazo (o servidor não escreveu) e conversas abertas. */
  aguardando_boas_vindas: number;
  abertas: number;
  /** 90% das respostas do agente saem em até esse tempo. */
  tempo_resposta_p90_s: number | null;
  /** Respostas em que o agente consultou alguma ferramenta (sem transferir e encerrar). */
  respostas_com_consulta: number;
  ferramentas: UsoFerramenta[];
  /** Conversas com e sem alguma consulta, e como terminaram. */
  consulta: { com: DesfechosConversa; sem: DesfechosConversa };
}

export interface DesfechosConversa {
  conversas: number;
  resolvido: number;
  parou: number;
  transferido: number;
  aberta: number;
}

export interface UsoFerramenta extends DesfechosConversa {
  ferramenta: string;
  chamadas: number;
  erros: number;
  duracao_media_s: number | null;
}

/* ───────── Qualidade com a régua do Supervisor (qualidade_api.py) ───────── */

export type NivelSupervisor = "abaixo" | "dentro" | "acima" | "nao_avaliavel";

/** Percentuais entre os avaliáveis (sem o não avaliável). */
export interface DistribuicaoNiveis {
  avaliaveis: number;
  nao_avaliavel: number;
  abaixo: number | null;
  dentro: number | null;
  acima: number | null;
}

export interface ComparacaoQualidade {
  regua: { versao: string; copiada_em: string; modelo: string };
  agente: { atendimentos: number; revisadas: number };
  humanos: { disponivel: boolean; atendimentos: number; motivo: string | null };
  criterios: {
    criterio: string;
    rotulo: string;
    pergunta: string;
    agente: DistribuicaoNiveis;
    humanos: DistribuicaoNiveis | null;
    concordancia: { revisadas: number; concordou: number; pct: number | null };
  }[];
  temas: { motivo: string; rotulo: string; agente_atendimentos: number; agente_ok: number | null; humanos_atendimentos: number; humanos_ok: number | null }[];
}

export interface AvaliacaoQualidade {
  session_id: string;
  agente: string | null;
  iniciada_em: string | null;
  motivo: string | null;
  tema: string | null;
  subcausa: string | null;
  niveis: Record<string, { nivel: NivelSupervisor; evidencia: string }>;
  revisao: Record<string, NivelSupervisor> | null;
  revisor: string | null;
}

/** A situação neste momento, a mesma da barra da Central ao vivo. */
export interface AgoraAtendimento {
  /** Conversa aberta com mensagem nos últimos 15 min (na mesa do escritório). */
  atendendo_agora: number;
  /** O servidor conversou e parou há mais de 15 min, sem a conversa terminar. */
  abertas_paradas: number;
  /** Destas, as que passaram do prazo de inatividade (a rotina já deveria ter encerrado). */
  abertas_fora_do_prazo: number;
  /** Boas-vindas enviadas, ainda no prazo, sem resposta do servidor. */
  aguardando_boas_vindas: number;
}

export interface QualidadePeriodo {
  /** Avaliações da equipe na Calibração (sem as do guardrail). */
  avaliadas: number;
  positivas: number;
  negativas: number;
  aprovacao_pct: number | null;
  /** Pedidos de manipulação barrados. */
  guardrail: number;
  /** Nota média (0 a 10) das avaliações automáticas do último dia, e por dia. */
  nota_automatica: number | null;
  nota_automatica_serie: { dia: string; nota: number }[];
  /** Casos de uso de ferramentas aprovados no último dia. */
  confiabilidade_pct: number | null;
}

export interface Indicadores {
  periodo: { inicio: string; fim: string; dias: number };
  /** De onde vieram os números: as views do banco (agente_metricas) ou o cálculo do servidor. */
  fonte: "views" | "servidor";
  totais: MedidasPeriodo & {
    /** Entraram com o agente na Unnichat e o aviso não chegou ao servidor (fora do total). */
    nao_chegaram: number;
    custo_configurado: boolean;
  };
  /** O período anterior, de mesmo tamanho, para a variação. */
  anterior: MedidasPeriodo;
  qualidade: QualidadePeriodo;
  serie: {
    dia: string;
    total: number;
    transferidas: number;
    /** Soma das três formas de retenção, que também vêm separadas. */
    retidas: number;
    em_andamento: number;
    encerradas_pelo_agente: number;
    inatividade: number;
    sem_resposta: number;
  }[];
  categorias: { categoria: string; rotulo: string; total: number }[];
  origens: { origem: string; total: number }[];
  ultimas_transferencias: ResumoConversa[];
  /** Todas as transferências do período, com o motivo que o agente escreveu. */
  transferencias: { id: string; categoria: string; rotulo: string; motivo: string; tema?: string }[];
  /** Conversas abertas pelo servidor em cada hora do dia (0 a 23, Brasília). */
  por_hora: number[];
  agora: AgoraAtendimento;
}

/** O agente padrão do painel (a Luna, do onboarding): o que vale quando nenhum é escolhido. */
export const AGENTE_PADRAO = "onboarding";

export interface Config {
  /** Id e nome no painel (apelido) do agente descrito. */
  id?: string;
  nome?: string;
  /** Função do agente (nome do Agent no Agno). */
  agente: string;
  modelo: string | null;
  raciocinio: string | null;
  /** inteiro: o roteiro vai completo nas instruções; busca: só os trechos parecidos com a mensagem. */
  roteiro_modo?: "inteiro" | "busca";
  boas_vindas: string;
  minutos_inatividade: number;
  categorias: Record<string, string>;
  /** Pedida com o id de uma equipe, vem a config do padrão dela e a equipe; para um agente, null. */
  equipe?: { id: string; nome: string } | null;
}

export interface RespostaChat {
  session_id: string;
  /** Quem respondeu; numa equipe, o membro escolhido pela recepção. */
  agente?: string | null;
  /** O id da equipe, quando a conversa é de equipe. */
  equipe?: string | null;
  respondeu: boolean;
  resposta: string | null;
  run_id?: string | null;
  calibracao?: UsoCalibracao | null;
  status: Status;
  acoes: Acao[];
  ferramentas?: string[];
  metricas?: { tokens_entrada: number | null; tokens_saida: number | null; duracao_s: number | null };
}

/** Um passo do agente durante a resposta (rota /chat/etapas). */
export interface EtapaChat {
  id: string;
  /** recepcao: numa equipe, a recepção escolhendo quem responde (vem com `agente` e `nome` ao concluir). */
  chave: "contexto" | "modelo" | "ferramenta" | "memoria" | "recepcao";
  estado: "rodando" | "concluida" | "erro";
  nome?: string;
  agente?: string | null;
  argumentos?: Record<string, unknown>;
  modelo?: string | null;
  duracao_s?: number | null;
  tokens?: number | null;
  tokens_raciocinio?: number | null;
  contagem?: { exemplos: number; trechos: number; roteiro: number };
}

export type EventoChat =
  | { tipo: "inicio"; session_id: string }
  | ({ tipo: "etapa" } & EtapaChat)
  | { tipo: "texto"; delta: string }
  | ({ tipo: "fim" } & RespostaChat)
  | { tipo: "erro"; mensagem: string };

export interface Base {
  conteudo: string;
  atualizado_em: string | null;
  origem: "arquivo" | "painel";
  versao: number;
}

export interface VersaoBase {
  versao: number;
  atualizado_em: string | null;
  observacao: string | null;
  caracteres: number;
}

/* ───────── Calibração humana ───────── */

export type Situacao = "pendente" | "aprovada" | "recusada";

/** Como um agente aparece no painel: nome (apelido), cargo e área (agrupa seletores, baias e filtros). */
export interface AgentePainel {
  id: string;
  nome: string;
  cargo?: string;
  area?: string;
  /** A cor escolhida na fábrica. */
  cor?: string;
}

export interface OpcoesCalibracao {
  problemas: Record<string, string>;
  voce: string;
  pode_aprovar: boolean;
  /** Agentes do AgentOS (nome = apelido no painel). */
  agentes?: AgentePainel[];
  /** Equipes publicadas: o chat de teste conversa com elas como com um agente. */
  equipes?: EquipePainel[];
}

/** Uma equipe como o painel a mostra fora da fábrica: quem forma e quem recebe saudação e mensagem vaga. */
export interface EquipePainel {
  id: string;
  nome: string;
  membros: string[];
  padrao: string;
}

/** Um caso do gold e/ou do bad dataset: sai de uma avaliação aprovada (um 👎 aprovado é os dois). */
export interface CasoDataset {
  id: number;
  agente: string;
  origem: string;
  tipos: ("gold" | "bad")[];
  /** Mensagens do servidor, em ordem; a última é a que foi respondida. */
  mensagens: string[];
  gabarito: string;
  /** A resposta original de um 👎 (null num 👍). */
  resposta_ruim: string | null;
  problemas: string[];
  comentario: string | null;
  ferramentas_exigidas: string[];
  ferramentas_proibidas: string[];
  telefone: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
}

/** Frase que barra pedidos de manipulação (guardada sem acento e em minúsculas). */
export interface FraseGuardrail {
  id: number;
  /** null = vale para todos os agentes. */
  agente: string | null;
  frase: string;
  ativo: boolean;
  criada_por: string | null;
  criada_em: string | null;
}

export interface AvaliacaoHumana {
  id: number;
  criada_em: string;
  agente: string;
  origem: string;
  session_id: string;
  run_id: string;
  historico: { papel: "contato" | "agente"; texto: string; quando: string | null }[];
  mensagem_contato: string;
  resposta_agente: string;
  nota: 1 | -1;
  problemas: string[];
  problemas_rotulos: string[];
  comentario: string | null;
  resposta_ideal: string | null;
  avaliador: string;
  situacao: Situacao;
  revisada_por: string | null;
  revisada_em: string | null;
  observacao_revisao: string | null;
}

/** aberta: ninguém tratou; avaliada: a resposta já tem avaliação feita por outro caminho. */
export type SituacaoLacuna = "aberta" | "ignorada" | "respondida" | "avaliada";

/** Uma resposta de conversa real em que o agente transferiu, disse que não tinha a informação ou não achou a aula. */
export interface Lacuna {
  /** O run_id da resposta. */
  id: string;
  session_id: string;
  agente: string;
  nome: string;
  quando: string | null;
  mensagem: string;
  resposta: string;
  /** transferiu, sem_informacao, aula_nao_encontrada (rótulos em LacunasDoPeriodo.sinais). */
  sinais: string[];
  categoria: string | null;
  categoria_rotulo: string | null;
  motivo: string | null;
  dificuldade: string | null;
  /** Dado pelo assistente em "Organizar por assunto"; null até lá. */
  assunto: string | null;
  avaliacao_id: number | null;
  situacao: SituacaoLacuna;
}

/** GET /calibracao/lacunas. */
export interface LacunasDoPeriodo {
  lacunas: Lacuna[];
  /** Por assunto (sem assunto, a categoria da transferência), dos mais frequentes aos menos. */
  assuntos: { assunto: string; total: number; abertas: number }[];
  totais: Record<SituacaoLacuna, number> & {
    /** Respostas do agente olhadas no período. */
    respostas: number;
    lacunas: number;
    sem_assunto: number;
    por_sinal: Record<string, number>;
  };
  sinais: Record<string, string>;
}

/** Recomendação do assistente de curadoria (Gemini). Só recomenda: quem decide é o curador. */
export interface AnaliseCuradoria {
  id: number;
  recomendacao: "aprovar" | "recusar" | "revisar";
  confianca: "alta" | "media" | "baixa";
  motivo: string;
  resposta_ideal_sugerida: string;
  alertas: string[];
}

export interface ResumoCalibracao {
  total: number;
  positivas: number;
  negativas: number;
  aprovacao: number | null;
  por_situacao: Record<Situacao, number>;
  problemas: { problema: string; rotulo: string; total: number }[];
  /** Mensagens barradas pelo guardrail, por situação (fora das contagens de 👍 / 👎). */
  guardrail?: Record<Situacao, number>;
}

/* ───────── Documentos de referência e exemplos (vetorizados) ───────── */

/** O que entrou no contexto de uma resposta: exemplos ([id, versão]) e trechos de documentos (ids). */
export interface UsoCalibracao {
  exemplos?: [number, number][];
  trechos?: number[];
  roteiro?: number[];
  /** "e<id>" / "t<id>" → distância do cosseno (0 = idêntico). Só nas respostas mais recentes. */
  distancias?: Record<string, number>;
}

/** Central de atendimento em 3D (GET /central). */
export interface ConversaCentral {
  id: string;
  origem: string;
  nome: string;
  status: Status;
  fim: "encerramento" | "inatividade" | null;
  criada_em?: string | null;
  atualizada_em: string | null;
  mensagens: number;
  ultima_mensagem: string;
  categoria_rotulo: string | null;
  motivo: string | null;
  duracao_media_s: number | null;
  parada_ha_s: number | null;
  /** Quando foi transferida / encerrada (ISO). */
  transferida_em?: string | null;
  encerrada_em?: string | null;
  /** A regra dos números da Central: transferida / encerrada dentro do período escolhido. */
  transferida_no_periodo?: boolean;
  encerrada_no_periodo?: boolean;
}

export interface AgenteCentral {
  id: string;
  /** Nome do agente no painel (ex.: Luna). */
  nome: string;
  /** A cor escolhida na fábrica. */
  cor?: string;
  /** O que ele faz (ex.: Agente de Onboarding). */
  funcao: string;
  cargo?: string;
  area?: string;
  modelo: string | null;
  minutos_inatividade: number;
  conversas: ConversaCentral[];
  /** O que a mesa mostra: agora, no período e a nota da Calibração. */
  indicadores?: IndicadoresMesa;
}

export interface IndicadoresMesa {
  em_atendimento: number;
  /** Com atividade nos últimos 2 min. */
  conversando_agora: number;
  conversas: number;
  /** 0 a 1. */
  transferencia_pct: number | null;
  tempo_medio_resposta_s: number | null;
  calibracao_avaliadas: number;
  calibracao_aprovacao: number | null;
}

/** Um acontecimento ao vivo de um atendimento (/central/eventos e /central/feed). */
export interface EventoCentral {
  id: number;
  /** boas_vindas só vem do histórico (/central/acontecimentos). */
  tipo: "mensagem" | "pensando" | "ferramenta" | "respondeu" | "transferiu" | "encerrou" | "guardrail" | "erro" | "boas_vindas";
  agente: string;
  session_id: string;
  origem: "whatsapp" | "painel" | "outro";
  contato: string;
  /** ISO, UTC. */
  quando: string;
  texto?: string;
  ferramenta?: string;
  duracao_s?: number;
  categoria?: string;
  categoria_rotulo?: string;
  motivo?: string;
}

/** O que precisa de atenção agora (/central/alertas). */
export interface AlertaCentral {
  tipo: "falha_na_resposta" | "transferida_aguardando" | "guardrail_pendente";
  nivel: "alto" | "medio" | "baixo";
  agente: string;
  texto: string;
  session_id?: string;
  contato?: string;
  origem?: string;
  parada_min?: number | null;
  quantidade?: number;
  /** Desde quando (ISO): a transferência ou a última atividade. */
  desde?: string | null;
  categoria_rotulo?: string | null;
  /** O momento do acontecimento (epoch): identifica o alerta na baixa. */
  referencia?: number | null;
  /** Só nos que tiveram baixa. */
  baixa?: { motivo: string; motivo_rotulo: string; por: string | null; em: string | null };
}

export interface RespostaAlertas {
  alertas: AlertaCentral[];
  total: number;
  baixados?: AlertaCentral[];
  baixa_disponivel?: boolean;
}

/** Números dos setores no período (/central/setores). */
export interface SetoresCentral {
  ferramentas: Record<string, { total: number; por_agente: Record<string, number>; sem_resultado?: number }>;
  mensagens: { recebidas: number; respondidas: number; por_origem: Record<string, number> };
  transferencias: { por_categoria: { agente: string; categoria: string; rotulo: string; total: number }[]; aguardando: number };
  conhecimento: { documentos_ativos: Record<string, number>; exemplos_ativos: Record<string, number> };
}

export interface Central {
  horas: number;
  /** O período usado (epoch, s); ate null = até agora. */
  desde?: number;
  ate?: number | null;
  agentes: AgenteCentral[];
}

/** O conteúdo do que uma resposta usou (GET /conhecimento/uso). */
export interface DetalhesUso {
  trechos: {
    id: number;
    documento_id: number;
    documento: string;
    versao: number;
    ordem: number;
    secao: string | null;
    conteudo: string;
    ativo: boolean;
    roteiro: boolean;
  }[];
  exemplos: {
    id: number;
    versao: number;
    contexto: string | null;
    mensagem: string;
    resposta_ideal: string;
    observacao: string | null;
    ativo: boolean;
    aprovado_por: string;
    criado_em: string;
  }[];
}

export interface DocumentoConhecimento {
  id: number;
  agente: string;
  nome: string;
  versao: number;
  tipo_mime: string;
  tamanho: number;
  /** Caminho no bucket; começa com "(sem bucket)" quando a versão só está no banco (testes locais). */
  caminho: string;
  status: "processando" | "pronto" | "erro";
  ativo: boolean;
  trechos: number;
  erro: string | null;
  enviado_por: string;
  enviado_em: string;
  processado_em: string | null;
}

/** Uma mudança no roteiro sugerida pela IA a partir de um documento (POST /conhecimento/documentos/{id}/sugestoes-roteiro). */
export interface SugestaoRoteiro {
  id: number;
  tipo: "alterar" | "nova" | "remover";
  titulo: string;
  /** Só em nova: a seção depois da qual ela entra (null: antes de "Sempre transferir", ou no fim). */
  depois_de: string | null;
  texto_atual: string;
  texto_novo: string;
  motivo: string;
  trecho_documento: string;
  /** Seção que o sistema envia como está escrita (boas-vindas, encerramento...). */
  mensagem_automatica: boolean;
  /** Edições que não acharam o trecho, link que não estava no documento nem no roteiro. */
  avisos: string[];
}

export interface SugestoesRoteiro {
  documento: { id: number; nome: string; versao: number };
  agente: string;
  /** A versão do roteiro comparada: se o roteiro mudou depois, as sugestões não valem mais. */
  versao_roteiro: number;
  resumo: string;
  sugestoes: SugestaoRoteiro[];
  /** Exemplos aprovados na Calibração que contradizem o documento (o agente os imitaria numa pergunta parecida). */
  exemplos_conflitantes: { id: number; mensagem: string; resposta: string; motivo: string }[];
  alertas: string[];
}

export interface TrechoDocumento {
  ordem: number;
  secao: string | null;
  conteudo: string;
}

/* ───────── Banco (visão gerencial, só leitura) ───────── */

export interface TabelaBanco {
  nome: string;
  grupo: string;
  descricao: string;
  linhas: number;
}

export interface ColunaBanco {
  nome: string;
  tipo: string;
  vetor: boolean;
}

export type ValorBanco = string | number | boolean | null;

export interface PaginaBanco {
  tabela: string;
  grupo: string;
  descricao: string;
  colunas: ColunaBanco[];
  chave_primaria: string[];
  ordem: string | null;
  direcao: "asc" | "desc";
  total: number;
  pagina: number;
  por_pagina: number;
  linhas: { valores: ValorBanco[]; cortadas: string[]; chave: Record<string, ValorBanco> }[];
}

export interface RegistroBanco {
  tabela: string;
  campos: { coluna: string; tipo: string; valor: ValorBanco }[];
}

export interface ExemploCalibracao {
  id: number;
  agente: string;
  avaliacao_id: number;
  versao: number;
  contexto: string | null;
  mensagem: string;
  resposta_ideal: string;
  observacao: string | null;
  ativo: boolean;
  aprovado_por: string;
  criado_em: string;
}

/* ───────── Fábrica de agentes ───────── */

/** Um agente na fábrica: o que se configura pelo painel. Os de origem "codigo" vêm dos perfis em Python. */
export interface AgenteFabrica {
  id: string;
  nome: string;
  area: string;
  cargo: string;
  /** Texto curto: a função do agente no AgentOS e na Central. */
  descricao: string;
  cor: string;
  /** null: vale o padrão do servidor. */
  modelo: string | null;
  raciocinio: string | null;
  /** Ids das ferramentas: as do catálogo e as HTTP do painel. */
  ferramentas: string[];
  /** Ids das skills que o agente carrega quando o assunto aparece. */
  skills: string[];
  /** Quando usar a transferência (vai na descrição da ferramenta); vazio usa o padrão. */
  quando_transferir: string;
  /** O que o agente guarda de cada contato e o que nunca guarda; vazio usa o padrão. */
  memoria: string;
  /** Motivos de transferência: chave → rótulo. */
  categorias: Record<string, string>;
  minutos_inatividade: number;
  origem: "codigo" | "painel";
  /** Ativo: atende e entra na distribuição das equipes. */
  publicado: boolean;
  /** Atende um canal (a Luna no WhatsApp): não pode ser desativado pela fábrica. */
  no_canal: boolean;
  versao_instrucoes: number;
  atualizado_em: string | null;
  atualizado_por: string | null;
}

/** Canal WhatsApp: a configuração da automação única da Unnichat (agente/canal.py). */
export interface CanalWhatsApp {
  /** Agente ou equipe que atende. */
  atendente: string;
  /** "" sem porta do lead (o atendente atende todos); "nenhum": lead fica com o time; ou o id do agente dos leads. */
  leads: string;
  /** Falso quando o atendente salvo foi desativado ou excluído depois de salvo. */
  atendente_ativo: boolean;
  leads_ativo: boolean;
  /** Tags que calam o agente; terminada em * vale como prefixo. */
  tags_sem_agente: string[];
  /** Tags que sempre calam (agente-transferiu), fora da lista editável. */
  tags_fixas: string[];
  /** Horas depois da mensagem de uma pessoa do time em que o agente não responde (0 = desligado). */
  horas_pessoa: number;
  /** Só atende quem tem negócio aberto no pipeline do onboarding (o CS). */
  somente_pipeline: boolean;
  /** Dias de conversa com o time antes da entrada no CS que marcam o servidor como do comercial. */
  dias_comercial: number;
  /** Só atende quem tem a tag do agente (posta pela automação da Unnichat); as outras travas só ficam registradas. */
  pela_tag: boolean;
  /** A tag do agente (ex.: ec-agente-lunna-cs). */
  tag_atende: string;
  salvo: boolean;
  versao: number | null;
  salvo_em: string | null;
  salvo_por: string | null;
  /** Agentes ativos e equipes publicadas. */
  opcoes: { id: string; nome: string; tipo: "agente" | "equipe" }[];
}

export interface VersaoCanal {
  versao: number;
  atendente: string;
  leads: string;
  tags_sem_agente: string[];
  pela_tag?: boolean;
  salvo_em: string;
  salvo_por: string | null;
}

export interface OpcoesFabrica {
  modelos: { id: string; rotulo: string }[];
  raciocinios: string[];
  /** disponivel: a fonte está configurada (ou a ferramenta do painel está ativa); obrigatoria: só a transferência. */
  ferramentas: { id: string; nome: string; descricao: string; disponivel: boolean; obrigatoria: boolean; tipo: "catalogo" | "http" }[];
  skills: { id: string; nome: string; descricao: string }[];
  hosts_permitidos: string[];
  /** As chaves do cofre, sem o valor. */
  chaves: ChaveApi[];
  areas: string[];
  cores: string[];
  /** Os textos que valem quando o campo fica vazio. */
  padroes: { quando_transferir: string; memoria: string };
  limites: { inatividade_min: number; inatividade_max: number; id: string };
}

export interface VersaoInstrucoes {
  versao: number;
  texto?: string;
  observacao: string | null;
  autor: string | null;
  em: string | null;
}

export interface InstrucoesAgente {
  atual: VersaoInstrucoes & { texto: string };
  versoes: VersaoInstrucoes[];
}

/** Quem criou e quem alterou por último (skills, ferramentas e casos). */
interface Autoria {
  criado_em: string | null;
  criado_por: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
}

/** Instruções e materiais que o agente só carrega quando o assunto aparece. */
export interface Skill extends Autoria {
  id: string;
  nome: string;
  /** É por ela que o agente decide usar a skill. */
  descricao: string;
  instrucoes: string;
  referencias: { nome: string; conteudo: string }[];
  /** Os agentes que usam a skill. */
  agentes: string[];
}

export interface ParametroHttp {
  nome: string;
  tipo: "string" | "number" | "integer" | "boolean";
  local: "query" | "path" | "body";
  obrigatorio: boolean;
  descricao: string;
}

/** A chave de acesso da ferramenta: o nome de uma chave do cofre (o valor nunca passa pelo painel). */
export interface SegredoFerramenta {
  chave: string;
  cabecalho: string;
  prefixo: string;
}

/** Uma chave de API do cofre: só o nome e os 4 últimos caracteres; o valor nunca volta. */
export interface ChaveApi {
  nome: string;
  descricao: string;
  final: string;
  criado_em: string | null;
  criado_por: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
}

/** Um host que as ferramentas HTTP podem chamar. Os de origem "servidor" vêm de variável e não saem pelo painel. */
export interface HostLiberado {
  host: string;
  descricao: string;
  origem: "painel" | "servidor";
  criado_em: string | null;
  criado_por: string | null;
}

export interface ConfigHttp {
  metodo: "GET" | "POST";
  url: string;
  parametros: ParametroHttp[];
  cabecalhos: { nome: string; valor: string }[];
  segredo: SegredoFerramenta | null;
  timeout_s: number;
}

export interface FerramentaPainel extends Autoria {
  id: string;
  tipo: "http";
  nome: string;
  descricao: string;
  config: ConfigHttp;
  ativa: boolean;
  agentes: string[];
}

export type AcaoEsperada = "responder" | "transferir" | "encerrar" | "qualquer";

export interface CasoTeste {
  id: number;
  titulo: string;
  /** A mensagem do contato, como ele escreveria no WhatsApp. */
  mensagem: string;
  contexto: { nome_contato?: string; telefone?: string };
  /** agente: numa equipe, o membro que a recepção deve escolher (vazio = qualquer). */
  esperado: { acao: AcaoEsperada; categoria: string | null; mencionar: string[]; proibido: string[]; agente?: string | null };
  ativo: boolean;
}

/** Um caso do dataset aprovado na Calibração: só leitura na fábrica, roda junto com os outros. */
export interface CasoCalibracao {
  id: string;
  origem: "calibracao";
  /** O id da avaliação na Calibração. */
  avaliacao: number;
  titulo: string;
  mensagens: string[];
  esperado_texto: string;
  ferramentas_exigidas: string[];
  ferramentas_proibidas: string[];
}

export interface ResultadoCaso {
  /** O id do caso: número nos da fábrica, "calibracao-N" nos da Calibração. */
  caso: number | string;
  origem?: "fabrica" | "calibracao";
  /** De 0 a 10, só nos da Calibração; passa com 7 ou mais. */
  nota?: number | null;
  titulo: string;
  passou: boolean;
  motivos: string[];
  acao?: AcaoEsperada;
  categoria?: string | null;
  /** Numa equipe, quem respondeu. */
  agente?: string | null;
  resposta?: string;
  ferramentas?: string[];
}

export interface ExecucaoCasos {
  id: number;
  agente: string;
  situacao: "rodando" | "concluida" | "falhou";
  resultado: { total: number; passou: number; casos: ResultadoCaso[] } | null;
  iniciada_em: string | null;
  iniciada_por: string | null;
  concluida_em: string | null;
}

/** O que o assistente de IA da fábrica devolve: um rascunho para o formulário (nada é salvo). */
export type TipoAssistente = "agente" | "instrucoes" | "skill" | "ferramenta_http" | "casos";

/** Uma equipe de agentes: vários agentes no mesmo canal; a recepção escolhe quem responde cada mensagem. */
export interface Equipe {
  id: string;
  nome: string;
  descricao: string;
  /** De 2 a 8 ids de agentes. */
  membros: string[];
  /** O membro que recebe saudação e mensagem vaga; as boas-vindas são as dele. */
  padrao: string;
  /** O que a recepção deve saber além da descrição de cada agente. */
  orientacoes: string;
  /** Ativa: atende e pode ser escolhida no Canal WhatsApp. */
  publicada: boolean;
  /** Está no Canal WhatsApp (atendente ou leads): não pode ser desativada nem excluída. */
  no_canal: boolean;
  criado_em: string | null;
  criado_por: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
}

/** Uma base de conhecimento compartilhada: documentos que valem para todos os agentes (geral) ou para os escolhidos. */
export interface BaseCompartilhada {
  id: string;
  nome: string;
  descricao: string;
  geral: boolean;
  /** Os agentes que usam a base (vazio quando geral). */
  agentes: string[];
  /** Quantos documentos a base tem. */
  documentos: number;
  /** O "agente" dos documentos da base nas rotas de documentos: base_<id>. */
  dono: string;
  /** Só com ?agente=: se a base vale para esse agente. */
  vale?: boolean;
  criado_em: string | null;
  criado_por: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
}
