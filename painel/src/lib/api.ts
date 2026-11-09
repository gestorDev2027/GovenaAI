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
  | "usar_chat"
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

/** A organização de quem está logado (dono ou membro) e o que ele pode fazer nela (agente/acessos.py). */
export type PermissaoOrganizacao =
  | "ver_painel"
  | "aprovar_entregas"
  | "gerenciar_fluxos"
  | "criar_agentes"
  | "definir_metas"
  | "registrar_dados"
  | "gerenciar_unidades"
  | "gerenciar_cargos"
  | "gerenciar_equipe"
  | "gerenciar_integracoes"
  | "ver_auditoria";

export interface ContextoOrganizacao {
  organizacao_id: string;
  /** O nome da organização. */
  organizacao: string | null;
  sigla?: string | null;
  cidade?: string | null;
  uf: string | null;
  segmento_id?: string | null;
  situacao_organizacao: string | null;
  papel: "dono" | "membro";
  cargo_id: string | null;
  cargo: string | null;
  permissoes: PermissaoOrganizacao[];
}

/* ───────── O cadastro da organização (GET /gestao/panorama e /organizacao/panorama) ───────── */

/** Os nomes de tela de cada segmento (agente/segmentos.py). */
export interface Rotulos {
  organizacao: string;
  organizacao_curta: string;
  area: string;
  areas: string;
  Area: string;
  Areas: string;
  unidade: string;
  unidades: string;
  Unidade: string;
  Unidades: string;
  pessoa: string;
  pessoas: string;
  Pessoas: string;
  responsavel: string;
  predio: string;
  mapa: string;
  centro: string;
}

/** Um campo do cadastro: `chave` é coluna de `organizacao` ou, com "dados.", chave de `dados_segmento`. */
export interface CampoSegmento {
  chave: string;
  rotulo: string;
  tipo: "texto" | "cnpj" | "cep" | "telefone" | "email" | "inteiro" | "uf" | "site" | string;
  obrigatorio: boolean;
  grupo: string;
}

export interface Segmento {
  id: string;
  nome: string;
  usa_cnes: boolean;
  rotulos: Rotulos;
  campos: CampoSegmento[];
}

export interface Organizacao {
  id: string;
  segmento_id: string;
  nome: string;
  sigla?: string | null;
  cnpj?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  codigo_ibge?: string | null;
  /** O centro do mapa. */
  latitude: string | number | null;
  longitude: string | number | null;
  zoom_mapa?: number | null;
  sede_latitude?: string | number | null;
  sede_longitude?: string | number | null;
  telefone?: string | null;
  email?: string | null;
  site?: string | null;
  responsavel_nome?: string | null;
  responsavel_email?: string | null;
  responsavel_telefone?: string | null;
  responsavel_cargo?: string | null;
  populacao?: number | null;
  andares?: number | null;
  dados_segmento?: Record<string, unknown> | null;
  situacao: string | null;
  plano?: string | null;
}

export interface PessoaOrganizacao {
  id: string;
  nome: string;
  email?: string | null;
  cargo?: string | null;
  area_id?: string | null;
  aprova_tarefas?: boolean | null;
}

export interface AtividadeArea {
  id: string;
  area_id: string;
  nome: string;
  descricao?: string | null;
  tipo?: string | null;
  frequencia?: string | null;
}

export interface AgenteArea {
  agente_id: string;
  area_id: string;
  funcao?: string | null;
  mesa?: number | null;
}

/** Uma área da organização (setor na saúde, departamento na empresa): uma sala do prédio. */
export interface AreaOrganizacao {
  id: string;
  tipo_id: string | null;
  nome: string;
  descricao?: string | null;
  andar: number | null;
  posicao: number | null;
  responsavel_id?: string | null;
  responsavel: PessoaOrganizacao | null;
  atividades: AtividadeArea[];
  agentes: AgenteArea[];
}

/** As fases da implantação, na ordem (gestao.fase_atual). */
export type FaseImplantacao = "organizacao" | "areas" | "atividades" | "cargos" | "responsaveis" | "agentes" | "equipe" | "unidades" | "revisao";

export interface PanoramaOrganizacao<U = Record<string, unknown>> {
  organizacao: Organizacao;
  segmento: Segmento;
  areas: AreaOrganizacao[];
  unidades: U[];
  pessoas: PessoaOrganizacao[];
  onboarding: { etapa: string | null } | null;
  /** O que falta em cada fase (vazio = completa). */
  pendencias?: Partial<Record<FaseImplantacao, string[]>>;
  /** A fase atual (a primeira incompleta) ou "concluido". */
  fase?: FaseImplantacao | "concluido";
}

/** O panorama vazio (sem organização) vem como {organizacao: null}. */
export type RespostaPanorama<U = Record<string, unknown>> = PanoramaOrganizacao<U> | { organizacao: null };

export interface Acesso {
  requer_chave: boolean;
  /** A organização da pessoa logada, se ela é dona ou membro ativo de uma. */
  organizacao?: ContextoOrganizacao | null;
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

/** O agente padrão do painel (o assistente de implantação): o que vale quando nenhum é escolhido. */
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

/** Como um agente aparece no painel: nome (apelido), cargo e área (agrupa seletores, baias e filtros). */
export interface AgentePainel {
  id: string;
  nome: string;
  cargo?: string;
  area?: string;
  /** A cor escolhida na fábrica. */
  cor?: string;
}

/** Uma equipe como o painel a mostra fora da fábrica: quem forma e quem recebe saudação e mensagem vaga. */
export interface EquipePainel {
  id: string;
  nome: string;
  membros: string[];
  padrao: string;
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
  versao_instrucoes: number;
  atualizado_em: string | null;
  atualizado_por: string | null;
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

/* ───────── Prédio 3D (o escritório dos agentes e o que eles fazem ao vivo) ───────── */

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
