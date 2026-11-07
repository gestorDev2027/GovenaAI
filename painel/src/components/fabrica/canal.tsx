import { useEffect, useState, type ComponentType, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Calendar, History, Lock, MessageCircle, Pencil, Plus, Save, ShieldCheck, Tag, Users, X } from "lucide-react";
import { api, type CanalWhatsApp, type VersaoCanal } from "@/lib/api";
import { fmtDataHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { Campo, PainelLateral, SecaoPainel } from "@/components/ui/painel-lateral";
import { Chip, Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { EmptyState, PageLoader, Pills } from "@/components/widgets/widgets";
import { usePode } from "@/hooks/use-permissoes";
import { Selecao } from "./campos";

/**
 * Canais: por onde os agentes atendem. Hoje um só, o WhatsApp pela automação única da Unnichat, com a
 * configuração guardada no banco (agente/canal.py): quem atende, o que fazer com quem não é cidadão, as
 * tags que calam o agente e se quem o agente atende é decidido pela tag que a automação da Unnichat põe. A URL da automação fica só com o token; `&agente=` e `&leads=` na URL, se
 * houver, valem por cima do que está aqui.
 */

type ModoLeads = "todos" | "time" | "agente";

interface Rascunho {
  atendente: string;
  modo: ModoLeads;
  agenteLeads: string;
  tags: string[];
  /** Só quem tem a tag do agente é atendido; as travas só ficam registradas. */
  pelaTag: boolean;
}

const TAG_VALIDA = /^[a-z0-9_-]+\*?$/;

function rascunhoDe(c: CanalWhatsApp): Rascunho {
  const modo: ModoLeads = c.leads === "" ? "todos" : c.leads === "nenhum" ? "time" : "agente";
  return { atendente: c.atendente, modo, agenteLeads: modo === "agente" ? c.leads : "", tags: c.tags_sem_agente, pelaTag: c.pela_tag };
}

function leadsDo(r: Rascunho): string {
  return r.modo === "todos" ? "" : r.modo === "time" ? "nenhum" : r.agenteLeads;
}

function alterado(r: Rascunho, c: CanalWhatsApp): boolean {
  return (
    r.atendente !== c.atendente ||
    leadsDo(r) !== c.leads ||
    JSON.stringify(r.tags) !== JSON.stringify(c.tags_sem_agente) ||
    r.pelaTag !== c.pela_tag
  );
}

/** O que impede salvar, em português, ou null. */
function problemaDo(r: Rascunho): string | null {
  if (!r.atendente) return "Escolha quem atende.";
  if (r.modo === "agente" && !r.agenteLeads) return "Escolha o agente que atende os leads.";
  if (r.modo === "agente" && r.agenteLeads === r.atendente)
    return "Para o mesmo agente atender todos, escolha “O atendente responde a todos”.";
  return null;
}

const useCanal = () => useQuery({ queryKey: ["fabrica-canal"], queryFn: () => api<CanalWhatsApp>("/fabrica/canal") });

/* ───────── Tabela ───────── */

export function TabelaCanais() {
  const canal = useCanal();
  const [aberto, setAberto] = useState(false);

  if (canal.isLoading) return <PageLoader className="h-[50vh]" label="Carregando os canais" />;
  if (canal.isError || !canal.data)
    return (
      <div className="surface-card">
        <EmptyState icon={<MessageCircle className="size-5" />} title="Não foi possível carregar os canais">
          {(canal.error as Error | null)?.message}
        </EmptyState>
      </div>
    );

  const c = canal.data;
  const nome = (id: string) => c.opcoes.find((o) => o.id === id)?.nome ?? id;
  const tipo = (id: string) => (c.opcoes.find((o) => o.id === id)?.tipo === "equipe" ? "Equipe" : "Agente");
  const todasAsTags = [...c.tags_fixas, ...c.tags_sem_agente];
  const alerta = !c.atendente_ativo ? "O atendente salvo está inativo" : !c.leads_ativo ? "O agente dos leads está inativo" : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Por onde os agentes atendem. A automação da Unnichat chama só <span className="num">/unnichat/auto?token=…</span>; quem responde, o
        que fazer com os leads e as tags que calam o agente ficam aqui.
      </p>

      <TableWrapper>
        <Table className="min-w-[1040px]">
          <TableHeader>
            <tr>
              <TableHead icone={MessageCircle}>Canal</TableHead>
              <TableHead icone={Users}>Quem atende</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead icone={Tag}>Tags que calam</TableHead>
              <TableHead icone={ShieldCheck}>Situação</TableHead>
              <TableHead icone={Calendar}>Atualizado</TableHead>
              <TableHead className="sticky right-0 bg-card text-right">Ações</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            <TableRow className="group cursor-pointer" onClick={() => setAberto(true)}>
              <TableCell>
                <div className="font-semibold">WhatsApp</div>
                <div className="text-xs text-muted-foreground">Unnichat · automação única</div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <div className={cn(!c.atendente_ativo && "text-destructive")}>{nome(c.atendente)}</div>
                <div className="text-xs text-muted-foreground">{tipo(c.atendente)}</div>
              </TableCell>
              <TableCell>
                <Chip tom={c.leads === "" ? "neutro" : c.leads === "nenhum" ? "info" : c.leads_ativo ? "primario" : "erro"}>
                  {c.leads === "" ? "Atendente responde" : c.leads === "nenhum" ? "Ficam com o time" : nome(c.leads)}
                </Chip>
              </TableCell>
              <TableCell>
                <div className="flex max-w-80 flex-wrap gap-1" title={todasAsTags.join(", ")}>
                  {todasAsTags.slice(0, 3).map((t) => (
                    <span key={t} className="num rounded-md bg-muted px-1.5 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground">
                      {t}
                    </span>
                  ))}
                  {todasAsTags.length > 3 && <span className="text-[11px] text-muted-foreground">+{todasAsTags.length - 3}</span>}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {alerta ? (
                    <Chip tom="erro">{alerta}</Chip>
                  ) : (
                    <Chip tom={c.salvo ? "sucesso" : "neutro"}>{c.salvo ? `Configurado · v${c.versao}` : "Padrão do servidor"}</Chip>
                  )}
                  {c.pela_tag && <Chip tom="info">Pela tag</Chip>}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {c.salvo_em ? (
                  <>
                    <div>{fmtDataHora(c.salvo_em)}</div>
                    {c.salvo_por && <div className="text-xs text-muted-foreground">{c.salvo_por}</div>}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="sticky right-0 bg-card transition-colors group-hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end">
                  <Button size="icon" variant="ghost" title="Configurar" aria-label="Configurar o WhatsApp" onClick={() => setAberto(true)}>
                    <Pencil />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </tbody>
        </Table>
      </TableWrapper>

      <FormCanal canal={c} aberto={aberto} aoFechar={() => setAberto(false)} />
    </div>
  );
}

/* ───────── Painel lateral ───────── */

type Secao = "atende" | "tag" | "leads" | "tags" | "historico";

const SECOES: { id: Secao; rotulo: string; icone: ComponentType<{ className?: string }> }[] = [
  { id: "atende", rotulo: "Quem atende", icone: MessageCircle },
  { id: "tag", rotulo: "Quem é atendido", icone: ShieldCheck },
  { id: "leads", rotulo: "Leads", icone: Users },
  { id: "tags", rotulo: "Tags que calam", icone: Tag },
  { id: "historico", rotulo: "Histórico", icone: History },
];

function FormCanal({ canal: c, aberto, aoFechar }: { canal: CanalWhatsApp; aberto: boolean; aoFechar: () => void }) {
  const qc = useQueryClient();
  const pode = usePode();
  const podeSalvar = pode("publicar");
  const [secao, setSecao] = useState<Secao>("atende");
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(c));
  const [novaTag, setNovaTag] = useState("");
  const historico = useQuery({
    queryKey: ["fabrica-canal-historico"],
    queryFn: () => api<{ versoes: VersaoCanal[] }>("/fabrica/canal/historico"),
    enabled: aberto,
  });

  // Abrir, ou outra pessoa salvar, traz o canal de novo para o rascunho.
  useEffect(() => {
    if (aberto) setR(rascunhoDe(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, c.versao]);

  const mudou = alterado(r, c);
  const problema = problemaDo(r);
  const muda = (campos: Partial<Rascunho>) => setR((atual) => ({ ...atual, ...campos }));
  const nome = (id: string) => c.opcoes.find((o) => o.id === id)?.nome ?? id;
  const agentes = c.opcoes.filter((o) => o.tipo === "agente");
  const equipes = c.opcoes.filter((o) => o.tipo === "equipe");
  // O salvo deixou de estar ativo (só vale enquanto o rascunho não trocou).
  const atendenteFora = r.atendente === c.atendente ? !c.atendente_ativo : !c.opcoes.some((o) => o.id === r.atendente);
  const leadsFora = leadsDo(r) === c.leads && !c.leads_ativo;

  const salvar = useMutation({
    mutationFn: () =>
      api<CanalWhatsApp>("/fabrica/canal", {
        method: "PUT",
        body: JSON.stringify({
          atendente: r.atendente,
          leads: leadsDo(r),
          tags_sem_agente: r.tags,
          horas_pessoa: c.horas_pessoa,
          somente_pipeline: c.somente_pipeline,
          dias_comercial: c.dias_comercial,
          pela_tag: r.pelaTag,
        }),
      }),
    onSuccess: (novo) => {
      qc.setQueryData(["fabrica-canal"], novo);
      qc.invalidateQueries({ queryKey: ["fabrica-canal-historico"] });
      qc.invalidateQueries({ queryKey: ["fabrica-agentes"] }); // a trava de desativar acompanha o atendente
      setR(rascunhoDe(novo));
      toast.success("WhatsApp salvo", { description: "Vale a partir da próxima mensagem. A conversa já aberta continua com quem estava." });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar o canal", { description: e.message }),
  });

  const fechar = () => {
    if (mudou && !window.confirm("Há alterações não salvas no canal. Fechar e descartá-las?")) return;
    aoFechar();
  };

  const acrescentar = (e: FormEvent) => {
    e.preventDefault();
    const tag = novaTag.trim().toLowerCase();
    if (!tag) return;
    if (!TAG_VALIDA.test(tag)) {
      toast.error("Tag inválida", { description: "Use letras minúsculas, números, hífen e sublinhado; o * só no fim, para prefixo." });
      return;
    }
    if (tag.endsWith("*") && tag.length - 1 < 3) {
      toast.error("Prefixo curto demais", { description: "Use ao menos 3 caracteres antes do *." });
      return;
    }
    if (!c.tags_fixas.includes(tag) && !r.tags.includes(tag)) muda({ tags: [...r.tags, tag] });
    setNovaTag("");
  };

  const destinoLead =
    r.modo === "time" ? "fica com o time" : r.agenteLeads ? `vai para ${nome(r.agenteLeads)}` : "vai para o agente que você escolher";

  return (
    <PainelLateral
      aberto={aberto}
      aoMudar={(a) => !a && fechar()}
      largura="xl"
      corpo="livre"
      focoNoPainel
      rotulo="Canal"
      icone={<MessageCircle />}
      titulo="WhatsApp"
      descricao="Automação única da Unnichat: quem responde, o que fazer com os leads e as tags que calam o agente."
    >
      <div className="grid min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[14rem_minmax(0,1fr)] md:grid-rows-1">
        <nav
          aria-label="Seções do canal"
          className="thin-scroll flex gap-1 overflow-x-auto border-b border-border p-2 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:p-3"
        >
          <div className="mb-2 hidden items-center gap-2 px-2 md:flex">
            <Chip tom={c.salvo ? "sucesso" : "neutro"}>{c.salvo ? `v${c.versao}` : "Padrão"}</Chip>
          </div>
          {SECOES.map((s) => {
            const ativa = s.id === secao;
            const Icone = s.icone;
            const aviso = (s.id === "atende" && atendenteFora) || (s.id === "leads" && leadsFora);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSecao(s.id)}
                aria-current={ativa}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ativa ? "bg-primary/12 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icone className={cn("size-4 shrink-0", ativa && "text-primary-text")} />
                <span className="flex-1">{s.rotulo}</span>
                {aviso && <AlertTriangle className="size-3.5 text-destructive" />}
              </button>
            );
          })}
          <div className="mt-auto hidden space-y-1.5 rounded-lg border border-border p-3 text-xs md:block">
            <div className="font-semibold">Como fica</div>
            {r.pelaTag ? (
              <p className="text-muted-foreground">
                <b className="text-foreground">1.</b> Só quem tem a tag <span className="num">{c.tag_atende}</span>; as outras travas só
                são registradas.
              </p>
            ) : (
              <p className="text-muted-foreground">
                <b className="text-foreground">1.</b> Com tag da lista: nenhum agente responde.
              </p>
            )}
            <p className="text-muted-foreground">
              <b className="text-foreground">2.</b>{" "}
              {r.modo === "todos" ? (
                <>
                  Todos vão para <b className="text-foreground">{nome(r.atendente)}</b>.
                </>
              ) : (
                <>
                  Cidadão vai para <b className="text-foreground">{nome(r.atendente)}</b>; lead {destinoLead}.
                </>
              )}
            </p>
            <p className="text-muted-foreground">
              <b className="text-foreground">3.</b> Antes de enviar, as tags são conferidas de novo.
            </p>
          </div>
        </nav>

        <div className="flex min-h-0 flex-col">
          <div className="thin-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
            {secao === "atende" && (
              <SecaoPainel titulo="Quem atende">
                <Campo
                  rotulo="Agente ou equipe"
                  ajuda="Uma equipe tem um coordenador que escolhe o agente a cada mensagem. Só aparecem agentes ativos e equipes publicadas. Quem atende não pode ser desativado na fábrica."
                >
                  <Selecao value={r.atendente} disabled={!podeSalvar} onChange={(e) => muda({ atendente: e.target.value })}>
                    {atendenteFora && <option value={r.atendente}>{nome(r.atendente)} (inativo)</option>}
                    <optgroup label="Agentes">
                      {agentes.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nome}
                        </option>
                      ))}
                    </optgroup>
                    {equipes.length > 0 && (
                      <optgroup label="Equipes (com coordenador)">
                        {equipes.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.nome}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Selecao>
                </Campo>
                {atendenteFora && <Aviso>O atendente salvo não está ativo: o WhatsApp está sem agente. Escolha outro e salve.</Aviso>}
                <Campo
                  rotulo="URL da automação"
                  ajuda="Sem &agente= nem &leads=: o que está aqui vale. Se a URL trouxer, a URL vale por cima."
                >
                  <code className="block rounded-md bg-muted px-2.5 py-2 text-xs break-all">
                    https://&lt;endereço-do-gestorgov&gt;/unnichat/auto?token=…
                  </code>
                </Campo>
              </SecaoPainel>
            )}

            {secao === "tag" && (
              <SecaoPainel titulo="Quem é atendido">
                <Pills
                  rotulo="Quem é atendido"
                  value={r.pelaTag ? "tag" : "travas"}
                  onChange={(v) => podeSalvar && muda({ pelaTag: v === "tag" })}
                  options={[
                    { value: "travas", label: "Pelas travas (como antes)" },
                    { value: "tag", label: "Pela tag da Unnichat" },
                  ]}
                />
                {r.pelaTag ? (
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Quem decide é a Unnichat: a automação do onboarding põe a tag <span className="num">{c.tag_atende}</span> em quem comprou
                      e move o negócio para o CS. O agente atende só quem tem essa tag, com as boas-vindas a cada entrada no CS.
                    </p>
                    <p>
                      As travas (tags da lista, conversa com o time, pipeline, pessoa do time nas últimas {c.horas_pessoa} h e a porta do lead)
                      não barram: o que teriam barrado fica registrado no evento, para medir. Continuam calando o agente a falta da tag e,
                      nas mensagens, a tag <span className="num">agente-transferiu</span>.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    O servidor decide pelas travas: as tags da lista, a conversa com o time antes da entrada no CS, o pipeline, a pessoa do
                    time nas últimas {c.horas_pessoa} h e a porta do lead.
                  </p>
                )}
                {r.pelaTag && !c.pela_tag && (
                  <Aviso>
                    Ligue junto com o filtro pela tag na automação da Unnichat. Quem não tem a tag deixa de ser atendido, inclusive os cidadãos
                    que o agente atende hoje.
                  </Aviso>
                )}
              </SecaoPainel>
            )}

            {secao === "leads" && (
              <SecaoPainel titulo="Quem não é cidadão (leads)">
                <p className="text-sm text-muted-foreground">
                  O que fazer com quem chega pelo WhatsApp e ainda não é atendido por um agente.
                </p>
                <Pills
                  rotulo="Leads"
                  value={r.modo}
                  onChange={(modo) => podeSalvar && muda({ modo })}
                  options={[
                    { value: "todos", label: "O atendente responde a todos" },
                    { value: "time", label: "Ficam com o time" },
                    { value: "agente", label: "Vão para um agente" },
                  ]}
                />
                {r.modo === "todos" && <p className="text-xs text-muted-foreground">Não há consulta: cidadão e lead vão para quem atende.</p>}
                {r.modo === "time" && (
                  <p className="text-xs text-muted-foreground">
                    Nenhum agente responde ao lead; a mensagem fica na caixa da Unnichat para o time.
                  </p>
                )}
                {r.modo === "agente" && (
                  <Campo rotulo="Agente dos leads" ajuda="Ex.: o Rafa, que qualifica e passa para um consultor.">
                    <Selecao value={r.agenteLeads} disabled={!podeSalvar} onChange={(e) => muda({ agenteLeads: e.target.value })}>
                      <option value="">Escolha</option>
                      {leadsFora && <option value={r.agenteLeads}>{nome(r.agenteLeads)} (inativo)</option>}
                      {c.opcoes.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nome}
                          {o.tipo === "equipe" ? " (equipe)" : ""}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                )}
                {leadsFora && (
                  <Aviso>O agente dos leads salvo não está ativo: os leads estão ficando com o time. Escolha outro e salve.</Aviso>
                )}
              </SecaoPainel>
            )}

            {secao === "tags" && (
              <SecaoPainel titulo="Tags que calam o agente" contagem={r.tags.length + c.tags_fixas.length}>
                <p className="text-sm text-muted-foreground">
                  Contato com uma destas tags não é atendido por agente: o servidor confere quando a mensagem chega e de novo logo antes de
                  responder. Termine com * para valer como prefixo (ex.: <span className="num">black_26_*</span>). Tirar a tag do contato
                  devolve ele ao agente.
                </p>
                <TableWrapper>
                  <Table>
                    <TableHeader>
                      <tr>
                        <TableHead>Tag</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </tr>
                    </TableHeader>
                    <tbody>
                      {c.tags_fixas.map((t) => (
                        <TableRow key={t}>
                          <TableCell className="num">{t}</TableCell>
                          <TableCell>
                            <Chip tom="neutro">
                              <Lock className="size-3" /> Fixa: o agente coloca ao transferir
                            </Chip>
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      ))}
                      {r.tags.map((t) => (
                        <TableRow key={t}>
                          <TableCell className="num">{t}</TableCell>
                          <TableCell>
                            <Chip tom={t.endsWith("*") ? "info" : "primario"}>{t.endsWith("*") ? "Prefixo" : "Exata"}</Chip>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 text-destructive hover:bg-destructive/10"
                              disabled={!podeSalvar}
                              title={`Tirar ${t}`}
                              aria-label={`Tirar ${t}`}
                              onClick={() => muda({ tags: r.tags.filter((x) => x !== t) })}
                            >
                              <X />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {r.tags.length === 0 && <TableEmpty colSpan={3}>Só a tag fixa. Acrescente a do comercial abaixo.</TableEmpty>}
                    </tbody>
                  </Table>
                </TableWrapper>
                {podeSalvar && (
                  <form onSubmit={acrescentar} className="flex gap-2">
                    <Input
                      value={novaTag}
                      onChange={(e) => setNovaTag(e.target.value)}
                      placeholder="comercial-em-atendimento ou black_26_*"
                    />
                    <Button type="submit" variant="outline" disabled={!novaTag.trim()}>
                      <Plus /> Acrescentar
                    </Button>
                  </form>
                )}
              </SecaoPainel>
            )}

            {secao === "historico" && (
              <SecaoPainel titulo="Histórico" contagem={historico.data?.versoes.length}>
                <TableWrapper>
                  <Table>
                    <TableHeader>
                      <tr>
                        <TableHead>Versão</TableHead>
                        <TableHead>Quem atende</TableHead>
                        <TableHead>Leads</TableHead>
                        <TableHead>Tags</TableHead>
                        <TableHead>Quem é atendido</TableHead>
                      </tr>
                    </TableHeader>
                    <tbody>
                      {historico.isLoading && <TableEmpty colSpan={5}>Carregando…</TableEmpty>}
                      {historico.data && !historico.data.versoes.length && <TableEmpty colSpan={5}>Nenhuma versão salva ainda.</TableEmpty>}
                      {historico.data?.versoes.map((v) => (
                        <TableRow key={v.versao}>
                          <TableCell className="whitespace-nowrap">
                            <div className="num font-semibold">v{v.versao}</div>
                            <div className="text-xs text-muted-foreground">
                              {fmtDataHora(v.salvo_em)}
                              {v.salvo_por && ` · ${v.salvo_por}`}
                            </div>
                          </TableCell>
                          <TableCell>{nome(v.atendente)}</TableCell>
                          <TableCell>
                            <Chip tom={v.leads === "" ? "neutro" : v.leads === "nenhum" ? "info" : "primario"}>
                              {v.leads === "" ? "Atendente" : v.leads === "nenhum" ? "Time" : nome(v.leads)}
                            </Chip>
                          </TableCell>
                          <TableCell className="num text-xs text-muted-foreground">{v.tags_sem_agente.join(", ") || "—"}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {v.pela_tag ? <Chip tom="info">Pela tag</Chip> : <span className="text-muted-foreground">Pelas travas</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </tbody>
                  </Table>
                </TableWrapper>
              </SecaoPainel>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-5 py-3 sm:px-6">
            {mudou && problema && <span className="text-xs text-destructive">{problema}</span>}
            {!mudou && (
              <span className="text-xs text-muted-foreground">
                {c.salvo
                  ? `Versão ${c.versao}, salva em ${fmtDataHora(c.salvo_em!)}${c.salvo_por ? ` por ${c.salvo_por}` : ""}`
                  : "Ainda não salvo: valem os padrões do servidor."}
              </span>
            )}
            <Button variant="outline" className="ml-auto" disabled={!mudou} onClick={() => setR(rascunhoDe(c))}>
              Descartar
            </Button>
            <Button
              disabled={!podeSalvar || !mudou || !!problema || salvar.isPending}
              title={podeSalvar ? undefined : "Sem a permissão Publicar"}
              onClick={() => salvar.mutate()}
            >
              <Save /> Salvar
            </Button>
          </div>
        </div>
      </div>
    </PainelLateral>
  );
}

function Aviso({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}
