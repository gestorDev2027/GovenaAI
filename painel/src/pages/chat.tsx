import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Clock,
  FileText,
  Hammer,
  Loader2,
  Maximize2,
  Mic,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Plus,
  Search,
  Upload,
  User,
  X,
} from "lucide-react";
import {
  AGENTE_PADRAO,
  api,
  apiEmLinhas,
  type Acao,
  type Config,
  type EtapaChat,
  type EventoChat,
  type UsoCalibracao,
  type Conversa,
  type ResumoConversa,
  type RespostaChat,
  type Status,
} from "@/lib/api";
import { fmtDataHora, fmtInt, fmtRelativo, fmtSegundos } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { PageHeader, StatusBadge } from "@/components/widgets/widgets";
import { IconeAgente, IconeUsuario } from "@/components/chat/icones";
import { Anexos, ROTULO_FERRAMENTA, type AnexoExibido } from "./conversas";
import { AvaliarResposta } from "@/components/calibracao/avaliar-resposta";
import { porArea, useAgentes, useEquipesPublicadas } from "@/hooks/use-agentes";
import { UsoNaResposta } from "@/components/conhecimento/uso";

/*
 * Chat de teste no padrão do chat do AgentOS (Agent UI da Agno): sessões à esquerda, conversa numa
 * coluna central sem balões, ferramentas usadas como pílulas acima da resposta e caixa de texto central.
 */

interface Mensagem {
  papel: "contato" | "agente";
  texto: string;
  quando: string;
  automatica?: boolean;
  ferramentas?: string[];
  anexos?: AnexoExibido[];
  run_id?: string | null;
  calibracao?: UsoCalibracao | null;
  /** Passos do agente nesta resposta (só nas respostas feitas nesta tela). */
  etapas?: EtapaExibida[];
  /** Resposta ainda chegando do servidor. */
  escrevendo?: boolean;
  /** Numa conversa de equipe, quem respondeu (nome e cor do agente). */
  quem?: { nome: string; cor?: string };
}

/** Etapa com os horários medidos no navegador (os eventos chegam no momento em que acontecem). */
export type EtapaExibida = EtapaChat & { inicio: number; fim?: number };

// Perguntas de exemplo de cada agente (as do script dele); um agente novo sem lista usa as do padrão.
const SUGESTOES: Record<string, string[]> = {
  onboarding: [
    "Quero implantar o GestorGov no meu município",
    "Nosso CEP é 01001-000",
    "Importe as unidades do CNES",
    "Quais setores a secretaria pode ter?",
    "Sugira as atividades da Regulação",
    "O responsável pelas Compras é a Ana",
    "Como está a implantação?",
    "Quero falar com uma pessoa",
  ],
  compras: [
    "Preciso de um termo de referência para luvas de procedimento",
    "Quais contratos vencem nos próximos 60 dias?",
    "Qual o saldo da ata de medicamentos?",
    "Monte o pedido de compra das unidades básicas",
    "Quero falar com o responsável",
  ],
  atencao_primaria: [
    "Como estão os indicadores das equipes de Saúde da Família?",
    "Quais ACS estão com visitas atrasadas?",
    "Quantas gestantes estão sem consulta no mês?",
    "Monte um resumo para a reunião de coordenação",
  ],
  regulacao: [
    "Quem espera há mais de 90 dias?",
    "Quais especialidades têm vagas sem uso?",
    "Qual o tempo médio de espera em ortopedia?",
    "Prepare o relatório da fila para o secretário",
  ],
};

/** A configuração de um agente (boas-vindas, modelo, categorias de transferência). */
const buscarConfig = (agente: string) => api<Config>(`/config?agente=${encodeURIComponent(agente)}`);

// O mesmo que o servidor aceita (painel_api.py: TIPOS_ANEXO, MAX_ANEXOS, 10 MB).
const ACEITOS = "image/png,image/jpeg,image/webp,image/gif,application/pdf,audio/ogg,audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/aac";
const MAX_ANEXOS = 4;
const MAX_BYTES = 10 * 1024 * 1024;
const SEM_TEXTO = "(o servidor enviou o anexo sem texto)";

/** "23 h", "1 h 30 min", "10 min": o prazo de inatividade do agente, para o botão que o simula. */
function tempoSemResposta(minutos: number) {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (!horas) return `${resto} min`;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

const agora = () => new Date().toISOString();

function tipoDoArquivo(mime: string): AnexoExibido["tipo"] {
  return mime.startsWith("image/") ? "imagem" : mime.startsWith("audio/") ? "audio" : "arquivo";
}

/* ───────── Peças no padrão do Agent UI ───────── */

function Rotulo({ children }: { children: ReactNode }) {
  return <div className="font-mono text-xs font-medium tracking-tight uppercase">{children}</div>;
}

const campo =
  "h-9 w-full rounded-xl border bg-muted/50 px-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50 disabled:opacity-60";

/** Texto do agente com os links clicáveis (as respostas não usam Markdown). */
export function TextoComLinks({ texto }: { texto: string }) {
  const partes = texto.split(/(https?:\/\/[^\s)]+)/gi);
  return (
    <>
      {partes.map((p, i) =>
        /^https?:\/\//i.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 [overflow-wrap:anywhere] hover:underline">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function Ferramentas({ nomes }: { nomes: string[] }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground" title="Ferramentas usadas">
        <Hammer className="size-3.5" />
      </span>
      <div className="flex flex-wrap gap-2">
        {nomes.map((f, i) => (
          <span
            key={i}
            title={ROTULO_FERRAMENTA[f] ?? f}
            className={cn(
              "cursor-default rounded-full px-2 py-1.5 font-mono text-xs uppercase",
              f === "transferir_para_humano" ? "bg-primary/14 text-primary" : "bg-muted text-foreground/80",
            )}
          >
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────── Etapas do agente (o que ele está fazendo) ───────── */

const ETAPA_FERRAMENTA: Record<string, string> = {
  transferir_para_humano: "Transferindo para a equipe",
  encerrar_atendimento: "Encerrando o atendimento",
  consultar_secretaria: "Consultando a secretaria",
  listar_unidades: "Listando as unidades",
  buscar_municipio: "Buscando o município",
  importar_unidades_cnes: "Importando as unidades do CNES",
  update_user_memory: "Registrando na memória",
};

function plural(n: number, um: string, varios: string) {
  return `${fmtInt(n)} ${n === 1 ? um : varios}`;
}

function descreverEtapa(e: EtapaExibida, indiceModelo: number): { rotulo: string; detalhe?: string } {
  const rodando = e.estado === "rodando";
  switch (e.chave) {
    case "contexto": {
      const c = e.contagem;
      const achados = c
        ? [c.exemplos && plural(c.exemplos, "exemplo", "exemplos"), c.trechos && plural(c.trechos, "trecho", "trechos"),
           c.roteiro && plural(c.roteiro, "trecho do roteiro", "trechos do roteiro")].filter(Boolean).join(" · ")
        : "";
      return {
        rotulo: rodando ? "Buscando exemplos e trechos parecidos" : "Exemplos e trechos parecidos",
        detalhe: rodando ? undefined : achados || "nada parecido",
      };
    }
    case "modelo": {
      const tokens = e.tokens
        ? `${fmtInt(e.tokens)} tokens${e.tokens_raciocinio ? ` (${fmtInt(e.tokens_raciocinio)} de raciocínio)` : ""}`
        : undefined;
      return {
        rotulo: indiceModelo === 1 ? (rodando ? "Pensando" : "Pensou") : rodando ? "Pensando com o resultado" : "Pensou com o resultado",
        detalhe: [e.modelo, tokens].filter(Boolean).join(" · ") || undefined,
      };
    }
    case "ferramenta": {
      const nome = e.nome ?? "ferramenta";
      const args = Object.entries(e.argumentos ?? {})
        .filter(([, v]) => v !== "" && v != null)
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" · ");
      return {
        rotulo: e.estado === "erro" ? `Falhou: ${nome}` : rodando ? (ETAPA_FERRAMENTA[nome] ?? nome) : (ROTULO_FERRAMENTA[nome] ?? nome),
        detalhe: args || undefined,
      };
    }
    case "memoria":
      return { rotulo: rodando ? "Atualizando a memória do servidor" : "Memória do servidor atualizada" };
    case "recepcao":
      return { rotulo: rodando ? "Recepção escolhendo quem responde" : `Recepção → ${e.nome ?? e.agente ?? "agente"}` };
  }
}

/** Relógio que anda enquanto `ativo`, para os tempos das etapas em andamento. */
function useAgora(ativo: boolean) {
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    const id = window.setInterval(() => setAgoraMs(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [ativo]);
  return agoraMs;
}

export function Etapas({ etapas, emAndamento }: { etapas: EtapaExibida[]; emAndamento: boolean }) {
  const [aberto, setAberto] = useState(emAndamento);
  // Aberto enquanto o agente trabalha; recolhe sozinho quando a resposta termina.
  useEffect(() => {
    setAberto(emAndamento);
  }, [emAndamento]);
  const agoraMs = useAgora(emAndamento);
  if (etapas.length === 0) return null;

  const inicio = etapas[0].inicio;
  const fim = emAndamento ? agoraMs : Math.max(...etapas.map((e) => e.fim ?? e.inicio));
  const atual = [...etapas].reverse().find((e) => e.estado === "rodando");
  let modelos = 0;
  const linhas = etapas.map((e) => ({ e, ...descreverEtapa(e, e.chave === "modelo" ? ++modelos : 0) }));
  const emCurso = atual ? linhas.find((l) => l.e === atual) : undefined;

  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-lg",
          emAndamento ? "bg-primary/14 text-primary" : "bg-muted text-muted-foreground",
        )}
        title="O que o agente fez"
      >
        {emAndamento ? <Loader2 className="size-3.5 animate-spin" /> : <Hammer className="size-3.5" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex h-6 items-center gap-2 self-start font-mono text-xs text-muted-foreground uppercase transition-colors hover:text-foreground"
        >
          <span className={cn(emAndamento && "text-foreground")}>
            {emAndamento ? (emCurso ? `${emCurso.rotulo}…` : "Trabalhando…") : `Trabalhou ${plural(etapas.length, "etapa", "etapas")}`}
          </span>
          <span className="num normal-case">{fmtSegundos((fim - inicio) / 1000)}</span>
          <ChevronDown className={cn("size-3.5 transition-transform", aberto && "rotate-180")} />
        </button>
        {aberto && (
          <ol className="ml-0.5 flex flex-col gap-1.5 border-l pl-3">
            {linhas.map(({ e, rotulo, detalhe }) => {
              const duracao = e.duracao_s ?? ((e.fim ?? (e.estado === "rodando" ? agoraMs : e.inicio)) - e.inicio) / 1000;
              return (
                <li key={e.id} className="flex min-w-0 items-center gap-2 text-xs">
                  {e.estado === "rodando" ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                  ) : e.estado === "erro" ? (
                    <X className="size-3.5 shrink-0 text-destructive" />
                  ) : (
                    <Check className="size-3.5 shrink-0 text-emerald-500" />
                  )}
                  <span className={cn("shrink-0", e.estado === "rodando" ? "text-foreground" : "text-foreground/80")}>{rotulo}</span>
                  {detalhe && <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={detalhe}>{detalhe}</span>}
                  <span className="num ml-auto shrink-0 pl-2 font-mono text-[11px] text-muted-foreground">
                    {duracao < 0.1 ? "<0,1 s" : fmtSegundos(duracao)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function MensagemAgente({ m, sessao }: { m: Mensagem; sessao?: string }) {
  const comEtapas = !!m.etapas?.length;
  return (
    <div className="flex flex-col gap-y-6">
      {comEtapas ? (
        <Etapas etapas={m.etapas!} emAndamento={!!m.escrevendo} />
      ) : (
        m.ferramentas && m.ferramentas.length > 0 && <Ferramentas nomes={m.ferramentas} />
      )}
      <div className="flex items-start gap-4" title={fmtDataHora(m.quando)}>
        <IconeAgente className="size-6 shrink-0" />
        <div className="flex min-w-0 flex-col gap-2">
          {m.quem && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-tight text-muted-foreground uppercase">
              <span className="size-1.5 rounded-full" style={{ background: m.quem.cor ?? "currentColor" }} />
              {m.quem.nome}
            </span>
          )}
          {m.escrevendo && !m.texto ? (
            <PontosPensando />
          ) : (
            <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
              <TextoComLinks texto={m.texto} />
              {m.escrevendo && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-foreground/60" />}
            </div>
          )}
          {m.automatica && (
            <span className="font-mono text-[11px] tracking-tight text-muted-foreground uppercase">Mensagem automática</span>
          )}
          {!m.escrevendo && <UsoNaResposta uso={m.calibracao} />}
          {!m.automatica && !m.escrevendo && m.run_id && sessao && (
            <AvaliarResposta sessionId={sessao} runId={m.run_id} origem="chat_teste" />
          )}
        </div>
      </div>
    </div>
  );
}

function MensagemContato({ m }: { m: Mensagem }) {
  const temTexto = m.texto && m.texto !== SEM_TEXTO;
  return (
    <div className="flex items-start gap-4 pt-4" title={fmtDataHora(m.quando)}>
      <IconeUsuario className="size-6 shrink-0" />
      <div className="flex min-w-0 flex-col gap-3">
        {temTexto && <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">{m.texto}</div>}
        {m.anexos && m.anexos.length > 0 && <Anexos anexos={m.anexos} />}
      </div>
    </div>
  );
}

export function PontosPensando() {
  return (
    <div className="mt-2 flex items-center gap-1">
      {["-0.3s", "-0.1s", "0s"].map((atraso) => (
        <span
          key={atraso}
          className="size-2 animate-bounce rounded-full bg-foreground/20"
          style={{ animationDelay: atraso, animationDuration: "0.7s" }}
        />
      ))}
    </div>
  );
}

/* Colunas recolhíveis: a escolha fica guardada neste navegador. */
const CHAVE_PAINEIS = "chat-teste-paineis";
type Paineis = { sessoes: boolean; contato: boolean };

function lerPaineis(): Paineis {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_PAINEIS) ?? "null");
    if (salvo && typeof salvo.sessoes === "boolean" && typeof salvo.contato === "boolean") return salvo;
  } catch {
    /* sem armazenamento: as duas colunas abertas */
  }
  return { sessoes: true, contato: true };
}

function BotaoBarra({ titulo, onClick, className, children }: { titulo: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
    >
      {children}
    </button>
  );
}

/** Caixa de texto que cresce de 40 a 96 px, como a do Agent UI. */
function CaixaTexto(props: React.ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "40px";
    t.style.height = `${Math.min(Math.max(t.scrollHeight, 40), 96)}px`;
    t.style.overflowY = t.scrollHeight > 96 ? "auto" : "hidden";
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      {...props}
      className="h-10 w-full resize-none rounded-xl border bg-card px-4 py-2.5 text-sm leading-5 shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

/* ───────── Tela ───────── */

export function Chat() {
  const qc = useQueryClient();
  const pedido = useSearch({ from: "/protegido/painel/chat" });
  // Com quem se conversa: escolhido antes da primeira mensagem; depois, o da sessão.
  const [agente, setAgente] = useState(pedido.agente ?? AGENTE_PADRAO);
  const agentes = useAgentes();
  const equipes = useEquipesPublicadas();
  const doAgente = agentes.find((a) => a.id === agente);
  // Numa equipe, as boas-vindas e o modelo mostrados são os do agente padrão (a equipe não tem /config).
  const equipe = equipes.find((e) => e.id === agente);
  const nomeDoAgente = (id?: string | null) => agentes.find((a) => a.id === id)?.nome ?? equipes.find((e) => e.id === id)?.nome ?? id ?? "";
  const quemRespondeu = (id?: string | null) => {
    const a = agentes.find((x) => x.id === id);
    return id ? { nome: a?.nome ?? id, cor: a?.cor } : undefined;
  };
  useEffect(() => {
    if (pedido.agente && !sessao) setAgente(pedido.agente);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido.agente]);
  const idConfig = equipe?.padrao ?? agente;
  const config = useQuery({ queryKey: ["config", idConfig], queryFn: () => buscarConfig(idConfig), staleTime: 5 * 60_000 });
  const [sessao, setSessao] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [texto, setTexto] = useState("");
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [status, setStatus] = useState<Status>("em_atendimento");
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [ultima, setUltima] = useState<RespostaChat["metricas"]>();
  const [pendentes, setPendentes] = useState<File[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [busca, setBusca] = useState("");
  const [gaveta, setGaveta] = useState<null | "sessoes" | "contato">(null);
  const [paineis, setPaineis] = useState<Paineis>(lerPaineis);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_PAINEIS, JSON.stringify(paineis));
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }, [paineis]);
  const foco = !paineis.sessoes && !paineis.contato;
  const arquivoRef = useRef<HTMLInputElement>(null);
  const textoRef = useRef<HTMLDivElement>(null);

  const boasVindas = (c: Config | undefined = config.data): Mensagem[] =>
    c ? [{ papel: "agente", texto: c.boas_vindas, quando: agora(), automatica: true }] : [];

  // Começa como no fluxo real: a mensagem de boas-vindas já foi enviada ao servidor. Trocar de agente
  // antes da primeira mensagem troca as boas-vindas.
  useEffect(() => {
    if (config.data && !sessao && mensagens.every((m) => m.automatica)) setMensagens(boasVindas());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.data]);

  const anteriores = useQuery({
    queryKey: ["conversas", "teste"],
    queryFn: () => api<{ conversas: ResumoConversa[] }>("/conversas?origem=Painel&limite=60"),
  });
  const listadas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const todas = anteriores.data?.conversas ?? [];
    return termo
      ? todas.filter((c) => `${c.nome} ${c.ultima_mensagem} ${c.ultima_resposta}`.toLowerCase().includes(termo))
      : todas;
  }, [anteriores.data, busca]);

  const previas = useMemo(
    () => pendentes.map((f) => ({ arquivo: f, url: URL.createObjectURL(f), tipo: tipoDoArquivo(f.type) })),
    [pendentes],
  );
  useEffect(() => () => previas.forEach((p) => URL.revokeObjectURL(p.url)), [previas]);

  function adicionarArquivos(lista: FileList | File[]) {
    const novos: File[] = [];
    for (const f of Array.from(lista)) {
      if (!ACEITOS.split(",").includes(f.type)) {
        toast.error(`Tipo não aceito: ${f.name}`, { description: "Envie imagem, PDF ou áudio." });
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} passa de 10 MB`);
        continue;
      }
      novos.push(f);
    }
    setPendentes((atuais) => {
      const juntos = [...atuais, ...novos];
      if (juntos.length > MAX_ANEXOS) toast.info(`No máximo ${MAX_ANEXOS} arquivos por mensagem.`);
      return juntos.slice(0, MAX_ANEXOS);
    });
  }

  /** Altera a resposta que está chegando (a última mensagem, enquanto `escrevendo`). */
  function atualizarResposta(f: (m: Mensagem) => Mensagem) {
    setMensagens((lista) => {
      const i = lista.length - 1;
      if (i < 0 || !lista[i].escrevendo) return lista;
      const nova = lista.slice();
      nova[i] = f(lista[i]);
      return nova;
    });
  }

  const enviar = useMutation({
    mutationFn: async ({ mensagem, arquivos }: { mensagem: string; arquivos: File[] }) => {
      const corpo = new FormData();
      corpo.append("mensagem", mensagem);
      if (sessao) corpo.append("session_id", sessao);
      corpo.append("nome_contato", nome);
      corpo.append("telefone", telefone);
      corpo.append("agente", agente);
      arquivos.forEach((f) => corpo.append("arquivos", f, f.name));
      const saida: { final?: RespostaChat; erro?: string } = {};
      await apiEmLinhas<EventoChat>("/chat/etapas", { method: "POST", body: corpo }, (ev) => {
        if (ev.tipo === "inicio") setSessao(ev.session_id);
        else if (ev.tipo === "texto") atualizarResposta((m) => ({ ...m, texto: m.texto + ev.delta }));
        else if (ev.tipo === "fim") saida.final = ev;
        else if (ev.tipo === "erro") saida.erro = ev.mensagem;
        else if (ev.tipo === "etapa") {
          const { tipo: _tipo, ...etapa } = ev;
          const instante = Date.now();
          const fim = etapa.estado === "rodando" ? undefined : instante;
          atualizarResposta((m) => {
            const etapas = m.etapas ?? [];
            const existente = etapas.find((e) => e.id === etapa.id);
            return {
              ...m,
              etapas: existente
                ? etapas.map((e) => (e.id === etapa.id ? { ...e, ...etapa, fim } : e))
                : [...etapas, { ...etapa, inicio: instante, fim }],
            };
          });
        }
      });
      if (saida.erro) throw new Error(saida.erro);
      if (!saida.final) throw new Error("A resposta foi interrompida.");
      return saida.final;
    },
    onSuccess: (r) => {
      setSessao(r.session_id);
      setStatus(r.status);
      setAcoes(r.acoes);
      setUltima(r.metricas);
      if (r.respondeu && r.resposta != null) {
        atualizarResposta((m) => ({
          ...m,
          texto: r.resposta ?? m.texto,
          ferramentas: r.ferramentas,
          run_id: r.run_id,
          calibracao: r.calibracao,
          escrevendo: false,
          quem: r.equipe ? quemRespondeu(r.agente) : undefined,
        }));
      } else {
        setMensagens((m) => m.filter((x) => !x.escrevendo));
        toast.info("O agente não responde mais nesta conversa", {
          description: "Ela já foi transferida ou encerrada. Comece uma nova conversa.",
        });
      }
      qc.invalidateQueries({ queryKey: ["indicadores"] });
      qc.invalidateQueries({ queryKey: ["conversas"] });
    },
    onError: (e: Error) => {
      toast.error("O agente não respondeu", { description: e.message });
      // Tira a resposta incompleta e a mensagem do servidor, que pode ser enviada de novo.
      setMensagens((m) => m.filter((x) => !x.escrevendo).slice(0, -1));
    },
  });

  // Rola para o fim a cada mensagem nova, a cada etapa e enquanto o texto chega.
  const ultimaMensagem = mensagens.at(-1);
  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens.length, ultimaMensagem?.texto.length, ultimaMensagem?.etapas?.length]);

  const inatividade = useMutation({
    mutationFn: () =>
      sessao
        ? api<{ encerrou: boolean; status: Status; mensagem: string | null }>(`/chat/${sessao}/inatividade`, { method: "POST" })
        : Promise.resolve({ encerrou: true, status: "encerrado" as Status, mensagem: null }),
    onSuccess: (r) => {
      if (!r.encerrou) {
        toast.info("Conversa já transferida ou encerrada: não se encerra por inatividade.");
        return;
      }
      setStatus("encerrado");
      if (r.mensagem) setMensagens((m) => [...m, { papel: "agente", texto: r.mensagem!, quando: agora(), automatica: true }]);
      qc.invalidateQueries({ queryKey: ["conversas"] });
    },
  });

  const abrir = useMutation({
    mutationFn: async (id: string) => {
      const c = await api<Conversa>(`/conversas/${encodeURIComponent(id)}`);
      // As boas-vindas são as do agente da conversa, que pode não ser o escolhido agora; numa equipe, as do padrão.
      const daEquipe = c.equipe ? equipes.find((e) => e.id === c.equipe) : undefined;
      const doAgente = daEquipe?.padrao ?? c.agente ?? AGENTE_PADRAO;
      const cfg = await qc.fetchQuery({ queryKey: ["config", doAgente], queryFn: () => buscarConfig(doAgente), staleTime: 5 * 60_000 });
      return { c, cfg };
    },
    onSuccess: ({ c, cfg }) => {
      setAgente(c.equipe ?? c.agente ?? AGENTE_PADRAO);
      setSessao(c.id);
      setNome(c.nome);
      setTelefone(c.telefone);
      setStatus(c.status);
      setAcoes(c.acoes);
      setUltima(undefined);
      setPendentes([]);
      setMensagens([
        ...boasVindas(cfg),
        ...c.itens.map((i) => ({
          papel: i.papel,
          texto: i.texto,
          quando: i.quando ?? agora(),
          ferramentas: i.ferramentas?.map((f) => f.nome),
          run_id: i.run_id,
          calibracao: i.calibracao,
          anexos: i.anexos?.map((a) => ({ tipo: a.tipo, nome: a.nome })),
          quem: c.equipe && i.papel === "agente" ? quemRespondeu(i.agente) : undefined,
        })),
      ]);
      setGaveta(null);
    },
    onError: (e: Error) => toast.error("Não foi possível abrir a conversa", { description: e.message }),
  });

  function submeter(e?: FormEvent, sugestao?: string) {
    e?.preventDefault();
    const mensagem = (sugestao ?? texto).trim();
    const arquivos = sugestao ? [] : pendentes;
    if ((!mensagem && arquivos.length === 0) || enviar.isPending || status !== "em_atendimento") return;
    setMensagens((m) => [
      ...m,
      {
        papel: "contato",
        texto: mensagem,
        quando: agora(),
        anexos: previas
          .filter((p) => arquivos.includes(p.arquivo))
          .map((p) => ({ tipo: p.tipo, nome: p.arquivo.name, url: URL.createObjectURL(p.arquivo) })),
      },
      // A resposta entra já, vazia, e vai recebendo as etapas e o texto.
      { papel: "agente", texto: "", quando: agora(), escrevendo: true, etapas: [] },
    ]);
    setTexto("");
    if (!sugestao) setPendentes([]);
    setGaveta(null);
    enviar.mutate({ mensagem, arquivos });
  }

  function novaConversa() {
    setSessao(null);
    setStatus("em_atendimento");
    setAcoes([]);
    setUltima(undefined);
    setPendentes([]);
    setTexto("");
    setMensagens(boasVindas());
    setGaveta(null);
    textoRef.current?.querySelector("textarea")?.focus();
  }

  function aoSoltar(e: DragEvent) {
    e.preventDefault();
    setArrastando(false);
    if (e.dataTransfer.files.length) adicionarArquivos(e.dataTransfer.files);
  }

  function aoColar(e: ClipboardEvent) {
    const imagens = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (imagens.length) {
      e.preventDefault();
      adicionarArquivos(imagens);
    }
  }

  const bloqueada = status !== "em_atendimento";
  const transferencia = acoes.filter((a) => a.tipo === "transferencia").at(-1);
  const soBoasVindas = mensagens.length <= 1 && !sessao;

  /* ───────── Coluna de sessões ───────── */
  const colunaSessoes = (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <button
        type="button"
        onClick={novaConversa}
        className="flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-foreground font-mono text-xs font-medium text-background uppercase transition-colors hover:bg-foreground/80"
      >
        <Plus className="size-4" /> Nova conversa
      </button>

      <div className="flex shrink-0 flex-col gap-2">
        <Rotulo>Agente</Rotulo>
        {(agentes.length > 1 || equipes.length > 0) && !sessao ? (
          // Antes da primeira mensagem dá para escolher com quem conversar; depois vale o da sessão.
          <div role="radiogroup" aria-label="Agente" className="flex flex-col gap-3">
            {porArea(agentes).map((grupo) => (
              <div key={grupo.area} className="flex flex-col gap-1">
                <span className="px-1 font-mono text-[10px] tracking-[0.12em] text-muted-foreground/80 uppercase">{grupo.area}</span>
                {grupo.itens.map((a) => {
                  const ativo = a.id === agente;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      onClick={() => setAgente(a.id)}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-left transition-colors",
                        ativo ? "border-primary/50 bg-primary/10 text-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{a.nome}</span>
                        {a.cargo && <span className="block truncate font-mono text-[10px] uppercase opacity-80">{a.cargo}</span>}
                      </span>
                      {ativo && <span className="size-2 shrink-0 rounded-full bg-emerald-500" />}
                    </button>
                  );
                })}
              </div>
            ))}
            {equipes.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-1 font-mono text-[10px] tracking-[0.12em] text-muted-foreground/80 uppercase">Equipes</span>
                {equipes.map((e) => {
                  const ativo = e.id === agente;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      onClick={() => setAgente(e.id)}
                      title={`Recepção escolhe entre: ${e.membros.map((m) => nomeDoAgente(m)).join(", ")}`}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-left transition-colors",
                        ativo ? "border-primary/50 bg-primary/10 text-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{e.nome}</span>
                        <span className="block truncate font-mono text-[10px] uppercase opacity-80">{e.membros.map((m) => nomeDoAgente(m)).join(" · ")}</span>
                      </span>
                      {ativo && <span className="size-2 shrink-0 rounded-full bg-emerald-500" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/50 px-3 py-1.5 text-muted-foreground">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">
                {equipe?.nome ?? config.data?.equipe?.nome ?? doAgente?.nome ?? config.data?.agente}
              </span>
              {equipe && (
                <span className="block truncate font-mono text-[10px] uppercase">Equipe · {equipe.membros.map((m) => nomeDoAgente(m)).join(" · ")}</span>
              )}
              {/* Uma equipe em rascunho não está na lista das publicadas: a config diz que é equipe. */}
              {!equipe && config.data?.equipe && <span className="block truncate font-mono text-[10px] uppercase">Equipe · rascunho</span>}
              {!equipe && !config.data?.equipe && doAgente?.cargo && (
                <span className="block truncate font-mono text-[10px] uppercase">
                  {doAgente.cargo}
                  {doAgente.area ? ` · ${doAgente.area}` : ""}
                </span>
              )}
            </span>
            <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
          </div>
        )}
        {config.data?.modelo && (
          <div className="flex h-9 items-center rounded-xl border bg-muted/50 px-3 font-mono text-xs font-medium text-muted-foreground uppercase">
            {config.data.modelo}
            {config.data.raciocinio && <span className="ml-auto normal-case">{config.data.raciocinio}</span>}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <Rotulo>Sessões</Rotulo>
        <div className="relative shrink-0">
          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(campo, "pl-8")} placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="thin-scroll -mr-1 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {listadas.length === 0 && (
            <p className="px-1 py-6 text-center font-sans text-xs text-muted-foreground">
              Nenhuma sessão ainda. As conversas feitas aqui aparecem nesta lista.
            </p>
          )}
          {listadas.map((c) => {
            const atual = c.id === sessao;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => !atual && abrir.mutate(c.id)}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors",
                  atual ? "cursor-default bg-primary/10" : "bg-muted/50 hover:bg-muted",
                )}
              >
                <span className={cn("truncate font-sans text-sm font-medium", atual && "text-primary")}>
                  {c.ultima_mensagem && c.ultima_mensagem !== SEM_TEXTO ? c.ultima_mensagem : "Anexo"}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      c.status === "em_atendimento" ? "bg-emerald-500" : c.status === "transferido" ? "bg-primary" : "bg-muted-foreground/50",
                    )}
                  />
                  <span className="truncate">{c.nome || "Sem nome"}</span>
                  {agentes.length > 1 && c.agente && <span className="shrink-0 rounded bg-secondary px-1">{nomeDoAgente(c.agente)}</span>}
                  <span className="ml-auto shrink-0">{fmtRelativo(c.atualizada_em)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  /* ───────── Coluna do servidor simulado ───────── */
  const colunaContato = (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Rotulo>{agente === AGENTE_PADRAO ? "Servidor simulado" : "Contato simulado"}</Rotulo>
        <input className={campo} placeholder="Nome no CRM (ex.: Maria)" value={nome} disabled={!!sessao} onChange={(e) => setNome(e.target.value)} />
        <input
          className={campo}
          placeholder="Telefone do WhatsApp"
          inputMode="tel"
          value={telefone}
          disabled={!!sessao}
          onChange={(e) => setTelefone(e.target.value)}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Com o telefone, o agente consulta o cadastro real, como faz com o número que chega pelo WhatsApp. O mesmo nome numa conversa
          nova simula o servidor voltando (memória). Os dois ficam fixos depois da primeira mensagem.
        </p>
        <button
          type="button"
          disabled={bloqueada || inatividade.isPending}
          onClick={() => inatividade.mutate()}
          className="flex h-9 items-center justify-center gap-2 rounded-xl border font-mono text-xs uppercase transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Clock className="size-3.5" /> {tempoSemResposta(config.data?.minutos_inatividade ?? 1380)} sem resposta
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <Rotulo>Estado</Rotulo>
        <div className="flex items-center justify-between rounded-xl border bg-muted/50 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Situação</span>
          <StatusBadge status={status} />
        </div>
        {ultima && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border bg-muted/50 px-3 py-2">
              <div className="font-mono text-[10px] text-muted-foreground uppercase">Resposta</div>
              <div className="num text-sm font-semibold">{fmtSegundos(ultima.duracao_s)}</div>
            </div>
            <div className="rounded-xl border bg-muted/50 px-3 py-2">
              <div className="font-mono text-[10px] text-muted-foreground uppercase">Tokens</div>
              <div className="num text-sm font-semibold">{fmtInt((ultima.tokens_entrada ?? 0) + (ultima.tokens_saida ?? 0))}</div>
            </div>
          </div>
        )}
        {transferencia && (
          <div className="rounded-xl border border-primary/30 bg-primary/8 px-3 py-2 text-xs">
            <div className="mb-1 font-semibold text-primary">
              Transferência · {config.data?.categorias[transferencia.categoria ?? ""] ?? transferencia.categoria}
            </div>
            <div className="text-muted-foreground">{transferencia.motivo}</div>
          </div>
        )}
        {sessao && (
          <Link to="/conversas" search={{ id: sessao }} className="font-mono text-[11px] text-primary uppercase hover:underline">
            Abrir em Conversas
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Rotulo>Perguntas do script</Rotulo>
        <div className="flex flex-wrap gap-1.5">
          {(SUGESTOES[agente] ?? SUGESTOES[AGENTE_PADRAO]).map((s) => (
            <button
              key={s}
              type="button"
              disabled={bloqueada || enviar.isPending}
              onClick={() => submeter(undefined, s)}
              className="rounded-full border px-2.5 py-1 text-left text-xs transition-colors hover:border-primary/50 hover:bg-primary/8 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 sm:px-8">
      <PageHeader
        title="Chat com os agentes"
        icon={Bot}
        description="Converse com o agente de cada setor (texto, documentos, planilhas e prints) e avalie cada resposta."
      />
    <div className="-mx-4 flex min-h-[520px] flex-1 gap-1.5 p-1.5 sm:-mx-8">
      {paineis.sessoes && <aside className="hidden w-64 shrink-0 px-2 py-3 lg:block">{colunaSessoes}</aside>}

      <main
        className="surface-card relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl"
        onDragOver={(e) => {
          e.preventDefault();
          if (!bloqueada) setArrastando(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setArrastando(false);
        }}
        onDrop={aoSoltar}
      >
        {arrastando && (
          <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/80 font-mono text-xs font-medium text-primary uppercase">
            <span className="flex items-center gap-2">
              <Upload className="size-4" /> Solte para anexar (imagem, PDF ou áudio)
            </span>
          </div>
        )}

        {/* Barra superior: a sessão, a situação e os botões para recolher as colunas */}
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          <BotaoBarra
            titulo={paineis.sessoes ? "Recolher as sessões" : "Mostrar as sessões"}
            onClick={() => setPaineis((p) => ({ ...p, sessoes: !p.sessoes }))}
            className="hidden lg:grid"
          >
            {paineis.sessoes ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </BotaoBarra>
          <button
            type="button"
            onClick={() => setGaveta((g) => (g === "sessoes" ? null : "sessoes"))}
            className="rounded-lg border px-2 py-1 font-mono text-[11px] uppercase lg:hidden"
          >
            Sessões
          </button>
          <span className="truncate font-mono text-[11px] text-muted-foreground uppercase">
            {sessao ?? "Nova sessão"}
          </span>
          <StatusBadge status={status} className="ml-auto" />
          <BotaoBarra
            titulo={foco ? "Sair do modo foco" : "Modo foco: recolher as duas colunas"}
            onClick={() => setPaineis(foco ? { sessoes: true, contato: true } : { sessoes: false, contato: false })}
            className="hidden lg:grid"
          >
            {foco ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </BotaoBarra>
          <BotaoBarra
            titulo={paineis.contato ? "Recolher o servidor simulado" : "Mostrar o servidor simulado"}
            onClick={() => setPaineis((p) => ({ ...p, contato: !p.contato }))}
            className="hidden xl:grid"
          >
            {paineis.contato ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </BotaoBarra>
          <button
            type="button"
            onClick={() => setGaveta((g) => (g === "contato" ? null : "contato"))}
            className={cn(
              "flex items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[11px] uppercase",
              paineis.contato ? "xl:hidden" : "",
            )}
          >
            <User className="size-3" /> Servidor
          </button>
        </div>

        {gaveta && (
          <div className="thin-scroll absolute inset-x-0 top-11 bottom-0 z-20 overflow-y-auto bg-background/95 p-4 backdrop-blur-sm">
            {gaveta === "sessoes" ? colunaSessoes : colunaContato}
          </div>
        )}

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          <div className={cn("mx-auto flex min-h-full w-full flex-col justify-end space-y-9 px-4 pt-6 pb-4", foco ? "max-w-3xl" : "max-w-2xl")}>
            {abrir.isPending && (
              <p className="text-center font-mono text-[11px] text-muted-foreground uppercase">Abrindo sessão…</p>
            )}
            {mensagens.map((m, i) =>
              m.papel === "agente" ? <MensagemAgente key={i} m={m} sessao={sessao ?? undefined} /> : <MensagemContato key={i} m={m} />,
            )}
            {soBoasVindas && !enviar.isPending && (
              <div className="flex flex-wrap gap-2 pl-10">
                {(SUGESTOES[agente] ?? SUGESTOES[AGENTE_PADRAO]).slice(0, 4).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submeter(undefined, s)}
                    className="rounded-xl border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {bloqueada && (
              <div className="rounded-xl border border-dashed px-4 py-3 text-center text-xs text-muted-foreground">
                {status === "transferido"
                  ? "Sessão transferida para a equipe: a partir daqui um atendente assume e o agente não responde mais."
                  : "Atendimento encerrado."}{" "}
                <button type="button" onClick={novaConversa} className="font-semibold text-primary hover:underline">
                  Nova conversa
                </button>
              </div>
            )}
            <div ref={fimRef} />
          </div>
        </div>

        {/* Caixa de texto */}
        <form onSubmit={submeter} className={cn("mx-auto w-full shrink-0 px-4 pb-3", foco ? "max-w-3xl" : "max-w-2xl")}>
          {previas.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {previas.map((p, i) => (
                <div key={i} className="relative">
                  {p.tipo === "imagem" ? (
                    <img src={p.url} alt={p.arquivo.name} className="size-16 rounded-lg border object-cover" />
                  ) : (
                    <div className="flex h-16 w-36 items-center gap-2 rounded-lg border bg-muted/50 px-2 text-xs">
                      {p.tipo === "audio" ? <Mic className="size-4 shrink-0" /> : <FileText className="size-4 shrink-0" />}
                      <span className="line-clamp-2 break-all">{p.arquivo.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`Remover ${p.arquivo.name}`}
                    onClick={() => setPendentes((l) => l.filter((f) => f !== p.arquivo))}
                    className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div ref={textoRef} className="flex items-end gap-2">
            <input
              ref={arquivoRef}
              type="file"
              multiple
              accept={ACEITOS}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) adicionarArquivos(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={bloqueada || pendentes.length >= MAX_ANEXOS}
              onClick={() => arquivoRef.current?.click()}
              aria-label="Anexar arquivo"
              title="Anexar imagem, PDF ou áudio (também dá para arrastar ou colar um print)"
              className="grid size-10 shrink-0 place-items-center rounded-xl border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Paperclip className="size-4" />
            </button>
            <CaixaTexto
              placeholder={bloqueada ? "Sessão finalizada" : "Escreva como o servidor escreveria"}
              value={texto}
              disabled={bloqueada}
              onChange={(e) => setTexto(e.target.value)}
              onPaste={aoColar}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submeter();
                }
              }}
            />
            <button
              type="submit"
              disabled={(!texto.trim() && pendentes.length === 0) || enviar.isPending || bloqueada}
              aria-label="Enviar"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground text-background transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </form>
      </main>

      {paineis.contato && <aside className="thin-scroll hidden w-72 shrink-0 overflow-y-auto px-2 py-3 xl:block">{colunaContato}</aside>}
    </div>
    </div>
  );
}
