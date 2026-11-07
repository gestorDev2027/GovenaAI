import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Check,
  FlaskConical,
  Factory,
  MessageSquare,
  Plug,
  Plus,
  Rocket,
  Save,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { api, type AgenteFabrica, type OpcoesFabrica } from "@/lib/api";
import {
  CATEGORIA_FIXA,
  FERRAMENTA_OBRIGATORIA,
  MARCADORES,
  fmtMinutos,
  problemasDo,
  rascunhoDe,
  type RascunhoAgente,
} from "@/lib/fabrica";
import { fmtDataHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { Campo, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { Chip } from "@/components/ui/tabela";
import { BasesDoAgente } from "@/components/conhecimento/bases";
import { Documentos } from "@/components/conhecimento/documentos";
import { AvatarAgente, EditorCategorias, EscolhaDeCor, EscolhaDeFerramentas, Selecao } from "./campos";
import { BotaoExcluirAgente, travaDoInterruptor, useAtivarAgente } from "./ativacao";
import { CasosDoAgente } from "./casos";
import { FormFerramenta } from "./ferramentas-painel";
import { InstrucoesDoAgente, useInstrucoes } from "./instrucoes";
import { FormSkill } from "./skills";
import { usePode } from "@/hooks/use-permissoes";

/*
 * O editor do agente, num painel lateral: um menu de seções à esquerda e a seção aberta à direita.
 * As seções de campos (identidade, comportamento, ferramentas) dividem um rascunho só, gravado pelo
 * rodapé (inclusive as skills e as ferramentas HTTP marcadas); instruções, casos de teste e
 * publicação gravam por conta própria. Uma seção nova entra na lista SECOES.
 */

export type SecaoEditor =
  "identidade" | "comportamento" | "ferramentas" | "instrucoes" | "conhecimento" | "publicacao" | "skills" | "integracoes" | "casos";

const SECOES: { id: SecaoEditor; rotulo: string; icone: ComponentType<{ className?: string }> }[] = [
  { id: "identidade", rotulo: "Identidade", icone: UserRound },
  { id: "comportamento", rotulo: "Comportamento", icone: SlidersHorizontal },
  { id: "ferramentas", rotulo: "Ferramentas", icone: Wrench },
  { id: "instrucoes", rotulo: "Instruções", icone: ScrollText },
  { id: "conhecimento", rotulo: "Base de conhecimento", icone: BookOpen },
  { id: "publicacao", rotulo: "Testar e publicar", icone: Rocket },
  { id: "skills", rotulo: "Skills", icone: Sparkles },
  { id: "integracoes", rotulo: "Ferramentas HTTP", icone: Plug },
  { id: "casos", rotulo: "Casos de teste", icone: FlaskConical },
];

/** As seções que gravam pelo rodapé do painel. */
const DE_CAMPOS: SecaoEditor[] = ["identidade", "comportamento", "ferramentas", "skills", "integracoes"];

const AVISO_ALTERADO = "Há alterações não salvas neste agente. Fechar e descartá-las?";

export function EditorAgente({
  agente,
  opcoes,
  secao,
  aoTrocarSecao,
  aoFechar,
  nomeAgente,
}: {
  agente: AgenteFabrica | null;
  opcoes?: OpcoesFabrica;
  secao: SecaoEditor;
  aoTrocarSecao: (s: SecaoEditor) => void;
  aoFechar: () => void;
  nomeAgente: (id: string) => string;
}) {
  const alterado = useRef(false);

  // Avisa antes de fechar a aba do navegador com alteração não salva.
  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => {
      if (alterado.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, []);

  const aoMudarAlterado = useCallback((a: boolean) => {
    alterado.current = a;
  }, []);

  const fechar = () => {
    if (alterado.current && !window.confirm(AVISO_ALTERADO)) return;
    alterado.current = false;
    aoFechar();
  };

  return (
    <PainelLateral
      aberto={agente !== null}
      aoMudar={(aberto) => !aberto && fechar()}
      largura="2xl"
      corpo="livre"
      focoNoPainel
      rotulo="Fábrica de agentes"
      icone={<Factory />}
      titulo={agente?.nome ?? ""}
      descricao={agente?.descricao || undefined}
    >
      {agente && opcoes && (
        <Corpo
          key={agente.id}
          agente={agente}
          opcoes={opcoes}
          secao={secao}
          aoTrocarSecao={aoTrocarSecao}
          aoMudarAlterado={aoMudarAlterado}
          nomeAgente={nomeAgente}
        />
      )}
    </PainelLateral>
  );
}

function Corpo({
  agente,
  opcoes,
  secao,
  aoTrocarSecao,
  aoMudarAlterado,
  nomeAgente,
}: {
  agente: AgenteFabrica;
  opcoes: OpcoesFabrica;
  secao: SecaoEditor;
  aoTrocarSecao: (s: SecaoEditor) => void;
  aoMudarAlterado: (alterado: boolean) => void;
  nomeAgente: (id: string) => string;
}) {
  const qc = useQueryClient();
  const [salvo, setSalvo] = useState(() => rascunhoDe(agente));
  const [r, setR] = useState(salvo);
  const [instrucoesAlteradas, setInstrucoesAlteradas] = useState(false);
  const [criando, setCriando] = useState<"skill" | "ferramenta" | null>(null);
  const doCatalogo = opcoes.ferramentas.filter((f) => f.tipo === "catalogo");
  const doPainel = opcoes.ferramentas.filter((f) => f.tipo !== "catalogo");
  const alterado = JSON.stringify(r) !== JSON.stringify(salvo);
  const problemas = problemasDo(r, opcoes);
  const muda = <K extends keyof RascunhoAgente>(campo: K, valor: RascunhoAgente[K]) => setR((x) => ({ ...x, [campo]: valor }));

  // O agente veio de novo do servidor (outra aba, outra pessoa): sem edição em curso, o rascunho acompanha.
  const salvoAgora = useRef(salvo);
  salvoAgora.current = salvo;
  useEffect(() => {
    const novo = rascunhoDe(agente);
    const anterior = JSON.stringify(salvoAgora.current);
    setR((atual) => (JSON.stringify(atual) === anterior ? novo : atual));
    setSalvo(novo);
  }, [agente]);

  useEffect(() => aoMudarAlterado(alterado || instrucoesAlteradas), [alterado, instrucoesAlteradas, aoMudarAlterado]);

  const aoGravar = (a: AgenteFabrica) => {
    qc.setQueryData<{ agentes: AgenteFabrica[] }>(
      ["fabrica-agentes"],
      (d) => d && { agentes: d.agentes.map((x) => (x.id === a.id ? a : x)) },
    );
    qc.invalidateQueries({ queryKey: ["calibracao-opcoes"] });
    qc.invalidateQueries({ queryKey: ["config", a.id] });
    qc.invalidateQueries({ queryKey: ["central"] });
  };

  const salvar = useMutation({
    mutationFn: () => {
      const corpo: RascunhoAgente = {
        ...r,
        nome: r.nome.trim(),
        descricao: r.descricao.trim(),
        cargo: r.cargo.trim(),
        area: r.area.trim(),
        ferramentas: r.ferramentas.includes(FERRAMENTA_OBRIGATORIA) ? r.ferramentas : [...r.ferramentas, FERRAMENTA_OBRIGATORIA],
        categorias: Object.fromEntries(Object.entries(r.categorias).map(([k, v]) => [k, v.trim()])),
      };
      return api<AgenteFabrica>(`/fabrica/agentes/${encodeURIComponent(agente.id)}`, { method: "PUT", body: JSON.stringify(corpo) });
    },
    onSuccess: (a) => {
      const novo = rascunhoDe(a);
      setSalvo(novo);
      setR(novo);
      aoGravar(a);
      toast.success(`${a.nome} salvo`, {
        description: a.publicado ? "Vale a partir da próxima mensagem." : "O rascunho já pode ser testado no chat.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const deCampos = DE_CAMPOS.includes(secao);
  const { inatividade_min: minimo, inatividade_max: maximo } = opcoes.limites;

  return (
    <div className="grid min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[15.5rem_minmax(0,1fr)] md:grid-rows-1">
      {/* Menu de seções */}
      <nav
        aria-label="Seções do agente"
        className="thin-scroll flex gap-1 overflow-x-auto border-b border-border p-2 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:p-3"
      >
        <div className="mb-2 hidden items-center gap-2.5 px-2 md:flex">
          <AvatarAgente cor={r.cor} />
          <div className="min-w-0 text-xs">
            <div className="flex flex-wrap gap-1">
              <Chip tom={agente.publicado ? "sucesso" : "neutro"}>{agente.publicado ? "Publicado" : "Rascunho"}</Chip>
            </div>
            <div className="num mt-1 truncate text-muted-foreground">{agente.id}</div>
          </div>
        </div>
        {SECOES.map((s) => {
          const ativa = s.id === secao;
          const Icone = s.icone;
          const marca = (DE_CAMPOS.includes(s.id) && alterado && ativa) || (s.id === "instrucoes" && instrucoesAlteradas);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => aoTrocarSecao(s.id)}
              aria-current={ativa}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ativa ? "bg-primary/12 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icone className={cn("size-4 shrink-0", ativa && "text-primary-text")} />
              <span className="flex-1">{s.rotulo}</span>
              {marca && <span aria-label="alterado" className="size-1.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </nav>

      {/* Seção aberta */}
      <div className="flex min-h-0 flex-col">
        <div className="thin-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          {secao === "identidade" && (
            <>
              <SecaoPainel titulo="Como aparece">
                <div className="grid gap-5 md:grid-cols-2">
                  <Campo rotulo="Nome" ajuda="Como o agente se apresenta e aparece no painel e na Central.">
                    <Input value={r.nome} maxLength={60} onChange={(e) => muda("nome", e.target.value)} />
                  </Campo>
                  <Campo rotulo="Identificador" ajuda="Não muda depois de criado.">
                    <Input className="num" value={agente.id} disabled />
                  </Campo>
                  <Campo
                    className="md:col-span-2"
                    rotulo="Descrição"
                    ajuda="Uma frase com a função do agente. Aparece como função no AgentOS e na Central."
                  >
                    <Input value={r.descricao} maxLength={160} onChange={(e) => muda("descricao", e.target.value)} />
                  </Campo>
                  <Campo rotulo="Cargo" ajuda="Opcional.">
                    <Input value={r.cargo} maxLength={60} onChange={(e) => muda("cargo", e.target.value)} />
                  </Campo>
                  <Campo rotulo="Área" ajuda="Agrupa os agentes nos filtros do painel.">
                    <Input list="fabrica-areas" value={r.area} maxLength={60} onChange={(e) => muda("area", e.target.value)} />
                    <datalist id="fabrica-areas">
                      {opcoes.areas.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </Campo>
                </div>
              </SecaoPainel>
              <SecaoPainel titulo="Cor">
                <div className="flex flex-wrap items-center gap-4">
                  <AvatarAgente cor={r.cor} tamanho="lg" />
                  <EscolhaDeCor valor={r.cor} cores={opcoes.cores} aoMudar={(cor) => muda("cor", cor)} />
                </div>
                <p className="text-xs text-muted-foreground">A cor do agente na Central, nos filtros e nos gráficos.</p>
              </SecaoPainel>
            </>
          )}

          {secao === "comportamento" && (
            <>
              <SecaoPainel titulo="Quando transferir">
                <Campo
                  rotulo="Situações em que o agente passa a conversa para uma pessoa"
                  ajuda="Vai na descrição da ferramenta de transferência. Vazio: vale o texto padrão, que aparece no campo."
                >
                  <Textarea
                    rows={6}
                    value={r.quando_transferir}
                    placeholder={opcoes.padroes.quando_transferir}
                    onChange={(e) => muda("quando_transferir", e.target.value)}
                  />
                </Campo>
              </SecaoPainel>
              <SecaoPainel titulo="Memória">
                <Campo
                  rotulo="O que guardar de cada contato e o que nunca guardar"
                  ajuda="Vazio: vale o texto padrão, que aparece no campo."
                >
                  <Textarea
                    rows={7}
                    value={r.memoria}
                    placeholder={opcoes.padroes.memoria}
                    onChange={(e) => muda("memoria", e.target.value)}
                  />
                </Campo>
              </SecaoPainel>
              <SecaoPainel titulo="Inatividade">
                <Campo
                  rotulo="Encerrar a conversa depois de"
                  ajuda={`Entre ${minimo} min e ${fmtMinutos(maximo)}, dentro da janela de 24 h do WhatsApp. A despedida é a seção "## Encerramento por inatividade" da base.`}
                >
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      className="num w-32"
                      min={minimo}
                      max={maximo}
                      step={5}
                      value={Number.isNaN(r.minutos_inatividade) ? "" : r.minutos_inatividade}
                      onChange={(e) => muda("minutos_inatividade", e.target.valueAsNumber)}
                    />
                    <span className="text-sm text-muted-foreground">
                      minutos
                      {Number.isInteger(r.minutos_inatividade) && r.minutos_inatividade >= 60 && ` (${fmtMinutos(r.minutos_inatividade)})`}
                    </span>
                  </div>
                </Campo>
              </SecaoPainel>
            </>
          )}

          {secao === "ferramentas" && (
            <>
              <SecaoPainel titulo="Ferramentas do sistema" contagem={doCatalogo.filter((f) => r.ferramentas.includes(f.id)).length}>
                <p className="text-xs text-muted-foreground">
                  O que o agente pode fazer além de responder. Uma ferramenta com a fonte não configurada pode ser marcada, mas só chega ao
                  agente quando a fonte for configurada neste servidor.
                </p>
                <EscolhaDeFerramentas opcoes={doCatalogo} valor={r.ferramentas} aoMudar={(v) => muda("ferramentas", v)} />
              </SecaoPainel>
              <SecaoPainel titulo="Motivos de transferência" contagem={Object.keys(r.categorias).length}>
                <p className="text-xs text-muted-foreground">
                  O agente escolhe um destes ao transferir, e a equipe vê o motivo na fila. "{CATEGORIA_FIXA.rotulo}" entra sempre.
                </p>
                <EditorCategorias valor={r.categorias} aoMudar={(v) => muda("categorias", v)} />
              </SecaoPainel>
              <SecaoPainel titulo="Modelo">
                <div className="grid gap-5 md:grid-cols-2">
                  <Campo rotulo="Modelo de linguagem" ajuda="Sem escolha, vale o padrão do servidor.">
                    <Selecao value={r.modelo ?? ""} onChange={(e) => muda("modelo", e.target.value || null)}>
                      <option value="">Padrão do servidor</option>
                      {opcoes.modelos.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.rotulo}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Raciocínio" ajuda="Quanto o modelo pensa antes de responder: mais raciocínio, respostas mais lentas.">
                    <Selecao value={r.raciocinio ?? ""} onChange={(e) => muda("raciocinio", e.target.value || null)}>
                      <option value="">Padrão do servidor</option>
                      {opcoes.raciocinios.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                </div>
              </SecaoPainel>
            </>
          )}

          {secao === "skills" && (
            <SecaoPainel
              titulo="Skills do agente"
              contagem={r.skills.length}
              acao={
                <Button size="sm" variant="outline" onClick={() => setCriando("skill")}>
                  <Plus /> Nova skill
                </Button>
              }
            >
              <p className="text-xs text-muted-foreground">
                Instruções e materiais de um assunto que o agente só carrega quando o assunto aparece. As skills servem à fábrica toda; aqui
                você marca as deste agente.
              </p>
              {opcoes.skills.length ? (
                <EscolhaDeFerramentas
                  opcoes={opcoes.skills.map((x) => ({ ...x, disponivel: true, obrigatoria: false, tipo: "catalogo" as const }))}
                  valor={r.skills}
                  aoMudar={(v) => muda("skills", v)}
                />
              ) : (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Nenhuma skill ainda. Crie a primeira em “Nova skill”.
                </p>
              )}
            </SecaoPainel>
          )}

          {secao === "integracoes" && (
            <SecaoPainel
              titulo="Ferramentas HTTP"
              contagem={doPainel.filter((f) => r.ferramentas.includes(f.id)).length}
              acao={
                <Button size="sm" variant="outline" onClick={() => setCriando("ferramenta")}>
                  <Plus /> Nova ferramenta
                </Button>
              }
            >
              <p className="text-xs text-muted-foreground">
                Consultas a outros sistemas, que ficam na aba Ferramentas HTTP da fábrica. Uma ferramenta desligada pode ser marcada, mas só
                chega ao agente quando for ligada.
              </p>
              {doPainel.length ? (
                <EscolhaDeFerramentas opcoes={doPainel} valor={r.ferramentas} aoMudar={(v) => muda("ferramentas", v)} />
              ) : (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Nenhuma ferramenta HTTP ainda. Crie a primeira em “Nova ferramenta”.
                </p>
              )}
            </SecaoPainel>
          )}

          {secao === "casos" && <CasosDoAgente agente={agente} />}

          {secao === "instrucoes" && <InstrucoesDoAgente agente={agente.id} aoMudarAlterado={setInstrucoesAlteradas} />}

          {secao === "conhecimento" && (
            <>
              <SecaoPainel titulo="Roteiro de atendimento">
                <p className="text-xs text-muted-foreground">
                  O texto que entra no lugar de @@BASE_DE_CONHECIMENTO@@. Nele ficam também as seções que o sistema envia como estão:
                  boas-vindas, encerramento por inatividade e pedido fora do atendimento.
                </p>
                <Button variant="outline" asChild>
                  <Link to="/base" search={{ agente: agente.id }}>
                    <BookOpen /> Editar o roteiro de {agente.nome} <ArrowUpRight />
                  </Link>
                </Button>
              </SecaoPainel>
              <Documentos agente={agente.id} />
              <BasesDoAgente agente={agente.id} />
            </>
          )}

          {secao === "publicacao" && (
            <Publicacao agente={agente} alterado={alterado || instrucoesAlteradas} aoGravar={aoGravar} irPara={aoTrocarSecao} />
          )}
        </div>

        <FormSkill
          skill={null}
          aberto={criando === "skill"}
          aoFechar={() => setCriando(null)}
          aoCriar={(x) => muda("skills", [...r.skills, x.id])}
          nomeAgente={nomeAgente}
        />
        <FormFerramenta
          ferramenta={null}
          aberto={criando === "ferramenta"}
          aoFechar={() => setCriando(null)}
          aoCriar={(x) => muda("ferramentas", [...r.ferramentas, x.id])}
          nomeAgente={nomeAgente}
        />

        {/* Rodapé: grava o rascunho nas seções de campos */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-5 py-3 sm:px-6">
          <Button variant="ghost" asChild>
            <Link to="/chat" search={{ agente: agente.id }}>
              <MessageSquare /> Testar no chat
            </Link>
          </Button>
          {deCampos && (
            <>
              {alterado && problemas.length > 0 && <span className="text-xs text-destructive">{problemas[0]}</span>}
              <Button variant="outline" className="ml-auto" disabled={!alterado} onClick={() => setR(salvo)}>
                <Undo2 /> Descartar
              </Button>
              <Button disabled={!alterado || problemas.length > 0 || salvar.isPending} onClick={() => salvar.mutate()}>
                <Save /> Salvar
              </Button>
            </>
          )}
          {!deCampos && agente.atualizado_em && (
            <span className="ml-auto text-xs text-muted-foreground">
              Alterado em {fmtDataHora(agente.atualizado_em)}
              {agente.atualizado_por && ` por ${agente.atualizado_por}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────── Testar e publicar ───────── */

function Publicacao({
  agente,
  alterado,
  aoGravar,
  irPara,
}: {
  agente: AgenteFabrica;
  alterado: boolean;
  aoGravar: (a: AgenteFabrica) => void;
  irPara: (s: SecaoEditor) => void;
}) {
  const instrucoes = useInstrucoes(agente.id);
  const texto = instrucoes.data?.atual.texto;
  const obrigatorios = MARCADORES.filter((m) => m.obrigatorio);

  const itens: { ok: boolean | null; texto: string; secao?: SecaoEditor }[] = [
    { ok: !!agente.descricao.trim(), texto: "Descrição preenchida", secao: "identidade" },
    {
      ok: texto == null ? null : obrigatorios.every((m) => texto.includes(m.token)),
      texto: "Instruções com o marcador da base de conhecimento",
      secao: "instrucoes",
    },
    { ok: Object.keys(agente.categorias).length > 0, texto: "Ao menos um motivo de transferência", secao: "ferramentas" },
    { ok: !alterado, texto: "Nenhuma alteração por salvar" },
  ];
  const pronto = itens.every((i) => i.ok !== false);

  const pode = usePode();
  const ativar = useAtivarAgente(aoGravar);
  const trava = travaDoInterruptor(agente, pode("publicar"));

  return (
    <>
      <SecaoPainel titulo="1. Testar">
        <p className="text-xs text-muted-foreground">
          O chat de teste conversa com o agente como um servidor faria, já com o que está salvo, publicado ou não.
        </p>
        <Button variant="outline" asChild>
          <Link to="/chat" search={{ agente: agente.id }}>
            <MessageSquare /> Abrir o chat de teste
          </Link>
        </Button>
      </SecaoPainel>

      <SecaoPainel titulo="2. Ativar">
        <ul className="space-y-1.5 text-sm">
          {itens.map((i) => (
            <li key={i.texto} className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full",
                  i.ok
                    ? "bg-success/15 text-success"
                    : i.ok === false
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i.ok === false ? <X className="size-3" /> : <Check className="size-3" />}
              </span>
              <span className={cn(i.ok === false && "text-destructive")}>{i.texto}</span>
              {i.ok === false && i.secao && (
                <button type="button" onClick={() => irPara(i.secao!)} className="text-xs font-semibold text-primary-text hover:underline">
                  Resolver
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
          {agente.publicado ? (
            <>
              <Chip tom="sucesso">Ativo: está atendendo</Chip>
              <Button
                variant="outline"
                className="ml-auto"
                disabled={!!trava || ativar.isPending}
                title={trava}
                onClick={() => {
                  if (window.confirm(`Desativar ${agente.nome}? Ele para de atender, inclusive no WhatsApp, e sai das equipes.`))
                    ativar.mutate({ id: agente.id, ativo: false });
                }}
              >
                <Archive /> Desativar
              </Button>
            </>
          ) : (
            <>
              <Chip>Inativo: não atende</Chip>
              <Button
                className="ml-auto"
                disabled={!pronto || !!trava || ativar.isPending}
                title={trava}
                onClick={() => ativar.mutate({ id: agente.id, ativo: true })}
              >
                <Rocket /> Ativar
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Inativo não atende em lugar nenhum, nem no WhatsApp, e sai da distribuição das equipes na hora; o chat de teste continua
          funcionando. {agente.no_canal && `${agente.nome} atende o WhatsApp e não pode ser desativado por aqui.`}
        </p>
      </SecaoPainel>

      {agente.origem === "painel" && (
        <SecaoPainel titulo="3. Excluir">
          <p className="text-xs text-muted-foreground">
            Só agente inativo pode ser excluído. Ele sai da fábrica e de todas as equipes; as conversas antigas continuam mostrando quem
            atendeu. O identificador fica reservado.
          </p>
          <div>
            <BotaoExcluirAgente agente={agente} />
          </div>
        </SecaoPainel>
      )}
    </>
  );
}
