import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Calendar, ExternalLink, Lightbulb, Loader2, MessageSquare, Search, Sparkles, Tag, User } from "lucide-react";
import { api, type Lacuna, type LacunasDoPeriodo, type SituacaoLacuna } from "@/lib/api";
import { fmtDataHora, fmtRelativo } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/fields";
import { Campo, PainelLateral } from "@/components/ui/painel-lateral";
import { Chip, Table, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/tabela";
import { PageLoader, Pills } from "@/components/widgets/widgets";
import { useOpcoesCalibracao } from "./avaliar-resposta";
import { useAgentes } from "./datasets";

type Filtro = SituacaoLacuna | "todas";

const SITUACAO: Record<SituacaoLacuna, { rotulo: string; tom: "alerta" | "neutro" | "sucesso" | "info" }> = {
  aberta: { rotulo: "Aberta", tom: "alerta" },
  respondida: { rotulo: "Respondida", tom: "sucesso" },
  avaliada: { rotulo: "Já avaliada", tom: "info" },
  ignorada: { rotulo: "Ignorada", tom: "neutro" },
};

const PERIODOS = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
];

const grupoDe = (l: Lacuna) => l.assunto || l.categoria_rotulo || "sem assunto";
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "—");

/**
 * Lacunas: as respostas das conversas reais em que o agente não teve o que dizer (transferiu, disse que não
 * tinha a informação, não achou a aula). O time escreve como deveria ser; a resposta entra na fila da
 * Calibração e, aprovada, vira gabarito e exemplo. O assistente dá um assunto a cada lacuna para juntar as
 * parecidas e mostrar o que mais falta.
 */
export function Lacunas() {
  const qc = useQueryClient();
  const opcoes = useOpcoesCalibracao();
  const podeAprovar = opcoes.data?.pode_aprovar ?? false;
  const [dias, setDias] = useState(7);
  const [agente, setAgente] = useState("todos");
  const [filtro, setFiltro] = useState<Filtro>("aberta");
  const [assunto, setAssunto] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<Lacuna | null>(null);

  const parametros = `dias=${dias}${agente === "todos" ? "" : `&agente=${encodeURIComponent(agente)}`}`;
  const q = useQuery({
    queryKey: ["calibracao-lacunas", dias, agente],
    queryFn: () => api<LacunasDoPeriodo>(`/calibracao/lacunas?${parametros}`),
  });
  const dados = q.data;
  const todas = dados?.lacunas ?? [];
  const agentes = useAgentes(todas.map((l) => l.agente));
  const nomeAgente = (id: string) => agentes.find((a) => a.id === id)?.nome ?? id;
  const sinal = (s: string) => dados?.sinais[s] ?? s;

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return todas.filter(
      (l) =>
        (filtro === "todas" || l.situacao === filtro) &&
        (!assunto || grupoDe(l) === assunto) &&
        (!termo || [l.mensagem, l.resposta, l.motivo ?? "", l.assunto ?? "", l.nome].some((t) => t.toLowerCase().includes(termo))),
    );
  }, [todas, filtro, assunto, busca]);

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["calibracao-lacunas"] });
    qc.invalidateQueries({ queryKey: ["calibracao-fila"] });
    qc.invalidateQueries({ queryKey: ["calibracao-resumo"] });
  };

  const organizar = useMutation({
    mutationFn: () => api<{ organizadas: number; restantes: number }>(`/calibracao/lacunas/organizar?${parametros}`, { method: "POST" }),
    onSuccess: (r) => {
      atualizar();
      toast.success(`${r.organizadas} lacuna(s) com assunto`, {
        description: r.restantes ? `Faltam ${r.restantes}: clique de novo para continuar.` : undefined,
      });
    },
    onError: (e: Error) => toast.error("Não foi possível organizar", { description: e.message }),
  });

  if (q.isLoading) return <PageLoader className="h-64" label="Procurando as lacunas nas conversas" />;

  const t = dados?.totais;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Respostas das conversas reais em que o agente <strong className="text-foreground">transferiu</strong>,{" "}
        <strong className="text-foreground">disse que não tinha a informação</strong> ou <strong className="text-foreground">não achou a aula</strong>.
        Escreva como deveria ser: a resposta entra em <em>Aguardando curadoria</em> e, aprovada, vira gabarito e exemplo para o agente. Quando
        a resposta depende de uma regra que vale para muitos servidores (norma, prazo, procedimento), cadastre também na{" "}
        <Link to="/base" className="font-semibold text-primary hover:underline">
          base de conhecimento
        </Link>{" "}
        ou numa skill na{" "}
        <Link to="/fabrica" className="font-semibold text-primary hover:underline">
          fábrica
        </Link>
        . Transferência certa (o servidor pediu uma pessoa, a decisão era do responsável) se ignora.
      </p>

      {t && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            <span className="num font-semibold text-foreground">{t.lacunas}</span> lacuna(s) em{" "}
            <span className="num font-semibold text-foreground">{t.respostas}</span> respostas ({pct(t.lacunas, t.respostas)})
          </span>
          <span aria-hidden>·</span>
          {Object.entries(t.por_sinal)
            .filter(([, n]) => n > 0)
            .map(([s, n]) => (
              <Chip key={s}>
                {sinal(s)} <span className="num font-semibold">{n}</span>
              </Chip>
            ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Pills rotulo="Período" value={dias} onChange={setDias} options={PERIODOS} />
        <Pills
          rotulo="Situação"
          value={filtro}
          onChange={setFiltro}
          options={[
            { value: "aberta", label: `Abertas · ${t?.aberta ?? 0}` },
            { value: "respondida", label: `Respondidas · ${t?.respondida ?? 0}` },
            { value: "avaliada", label: `Já avaliadas · ${t?.avaliada ?? 0}` },
            { value: "ignorada", label: `Ignoradas · ${t?.ignorada ?? 0}` },
            { value: "todas", label: `Todas · ${t?.lacunas ?? 0}` },
          ]}
        />
        {agentes.length > 1 && (
          <Pills
            rotulo="Agente"
            value={agente}
            onChange={setAgente}
            options={[{ value: "todos", label: "Todos os agentes" }, ...agentes.map((a) => ({ value: a.id, label: a.nome }))]}
          />
        )}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar na mensagem ou no motivo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {podeAprovar && (
          <Button
            variant="outline"
            className="ml-auto"
            disabled={!t?.sem_assunto || organizar.isPending}
            onClick={() => organizar.mutate()}
            title="O assistente dá um assunto curto a cada lacuna aberta, para juntar as parecidas"
          >
            {organizar.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Organizar por assunto
            {t?.sem_assunto ? ` (${t.sem_assunto})` : ""}
          </Button>
        )}
      </div>

      {dados && dados.assuntos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">O que mais falta</span>
          {dados.assuntos.slice(0, 14).map((a) => (
            <button
              key={a.assunto}
              type="button"
              onClick={() => setAssunto(assunto === a.assunto ? null : a.assunto)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                assunto === a.assunto ? "border-primary bg-primary/12 text-primary" : "hover:bg-secondary",
              )}
              title={`${a.total} no período, ${a.abertas} aberta(s)`}
            >
              {a.assunto}
              <span className="num font-semibold">{a.total}</span>
            </button>
          ))}
          {assunto && (
            <Button variant="ghost" size="sm" onClick={() => setAssunto(null)}>
              Limpar
            </Button>
          )}
        </div>
      )}

      <TableWrapper>
        <Table className="min-w-[980px]">
          <TableHeader>
            <tr>
              <TableHead icone={Calendar}>Quando</TableHead>
              <TableHead icone={Tag}>Assunto</TableHead>
              <TableHead icone={MessageSquare}>Mensagem do servidor</TableHead>
              <TableHead icone={Bot}>O que o agente fez</TableHead>
              <TableHead>Situação</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {visiveis.length === 0 && (
              <TableEmpty colSpan={5}>
                {todas.length ? "Nada com esses filtros." : "Nenhuma lacuna no período: o agente respondeu tudo sem transferir."}
              </TableEmpty>
            )}
            {visiveis.map((l) => (
              <TableRow key={l.id} onClick={() => setAberta(l)} className="cursor-pointer">
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground" title={l.quando ? fmtDataHora(l.quando) : undefined}>
                  <div className="font-medium text-foreground">{l.nome || "Servidor sem nome"}</div>
                  {l.quando && <div>{fmtRelativo(l.quando)}</div>}
                  <div className="font-mono text-[11px]">{nomeAgente(l.agente)}</div>
                </TableCell>
                <TableCell className="max-w-[12rem] text-sm">
                  {l.assunto ?? <span className="text-muted-foreground">{l.categoria_rotulo ?? "—"}</span>}
                </TableCell>
                <TableCell className="max-w-[20rem]">
                  <p className="line-clamp-2 text-sm">{l.mensagem}</p>
                </TableCell>
                <TableCell className="max-w-[18rem]">
                  <div className="flex flex-wrap gap-1">
                    {l.sinais.map((s) => (
                      <Chip key={s} tom={s === "transferiu" ? "alerta" : "erro"}>
                        {sinal(s)}
                      </Chip>
                    ))}
                  </div>
                  {l.motivo && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{l.motivo}</p>}
                </TableCell>
                <TableCell>
                  <Chip tom={SITUACAO[l.situacao].tom}>{SITUACAO[l.situacao].rotulo}</Chip>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableWrapper>

      <DetalheLacuna
        key={aberta?.id}
        lacuna={aberta}
        sinal={sinal}
        nomeAgente={nomeAgente}
        podeAprovar={podeAprovar}
        aoFechar={() => setAberta(null)}
        aoMudar={atualizar}
      />
    </div>
  );
}

function DetalheLacuna({
  lacuna: l,
  sinal,
  nomeAgente,
  podeAprovar,
  aoFechar,
  aoMudar,
}: {
  lacuna: Lacuna | null;
  sinal: (s: string) => string;
  nomeAgente: (id: string) => string;
  podeAprovar: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [ideal, setIdeal] = useState("");
  const [comentario, setComentario] = useState("");
  const transferiu = l?.sinais.includes("transferiu") ?? false;
  const [semTransferir, setSemTransferir] = useState(transferiu);

  const responder = useMutation({
    mutationFn: () =>
      api(`/calibracao/lacunas/${encodeURIComponent(l!.id)}/responder`, {
        method: "POST",
        body: JSON.stringify({
          session_id: l!.session_id,
          resposta_ideal: ideal.trim(),
          comentario: comentario.trim(),
          problemas: transferiu && semTransferir ? ["nao_deveria_transferir"] : [],
        }),
      }),
    onSuccess: () => {
      aoMudar();
      aoFechar();
      toast.success("Entrou na fila de curadoria", { description: "Aprovada, vira gabarito e exemplo para o agente." });
    },
    onError: (e: Error) => toast.error("Não foi possível enviar", { description: e.message }),
  });

  const situacao = useMutation({
    mutationFn: (nova: "aberta" | "ignorada") =>
      api(`/calibracao/lacunas/${encodeURIComponent(l!.id)}/situacao`, { method: "POST", body: JSON.stringify({ situacao: nova }) }),
    onSuccess: (_, nova) => {
      aoMudar();
      aoFechar();
      toast.success(nova === "ignorada" ? "Lacuna ignorada" : "Lacuna reaberta");
    },
    onError: (e: Error) => toast.error("Não foi possível mudar a situação", { description: e.message }),
  });

  const podeResponder = l?.situacao === "aberta";
  const curta = ideal.trim().length < 10;
  const rodape = l ? (
    <>
      <Button variant="outline" onClick={aoFechar}>
        Fechar
      </Button>
      {podeAprovar && (l.situacao === "aberta" || l.situacao === "ignorada") && (
        <Button
          variant="ghost"
          disabled={situacao.isPending}
          onClick={() => situacao.mutate(l.situacao === "ignorada" ? "aberta" : "ignorada")}
          title={l.situacao === "ignorada" ? undefined : "Não faltou conhecimento: transferir era o certo"}
        >
          {l.situacao === "ignorada" ? "Reabrir" : "Ignorar"}
        </Button>
      )}
      {podeResponder && (
        <Button disabled={curta || responder.isPending} onClick={() => responder.mutate()}>
          {responder.isPending && <Loader2 className="animate-spin" />} Enviar para a curadoria
        </Button>
      )}
    </>
  ) : undefined;

  return (
    <PainelLateral
      aberto={l !== null}
      aoMudar={(a) => !a && aoFechar()}
      rotulo="Lacuna"
      icone={<Lightbulb />}
      titulo={l ? l.assunto || l.categoria_rotulo || "Sem assunto ainda" : ""}
      descricao={l ? `${l.nome || "Servidor sem nome"} · ${nomeAgente(l.agente)}${l.quando ? ` · ${fmtDataHora(l.quando)}` : ""}` : undefined}
      largura="xl"
      rodape={rodape}
    >
      {l && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tom={SITUACAO[l.situacao].tom}>{SITUACAO[l.situacao].rotulo}</Chip>
            {l.sinais.map((s) => (
              <Chip key={s} tom={s === "transferiu" ? "alerta" : "erro"}>
                {sinal(s)}
              </Chip>
            ))}
            <Link
              to="/conversas"
              search={{ id: l.session_id }}
              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              Abrir a conversa <ExternalLink className="size-3" />
            </Link>
          </div>

          <Campo rotulo={<span className="inline-flex items-center gap-1.5"><User className="size-4" /> Mensagem do servidor</span>}>
            <div className="rounded-lg bg-secondary px-3 py-2 text-sm whitespace-pre-wrap">{l.mensagem || "(sem texto)"}</div>
          </Campo>
          <Campo rotulo={<span className="inline-flex items-center gap-1.5"><Bot className="size-4" /> O que o agente respondeu</span>}>
            <div className="rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap">{l.resposta || "(sem texto)"}</div>
          </Campo>
          {(l.motivo || l.dificuldade) && (
            <Campo rotulo="O que o agente registrou na transferência">
              <dl className="space-y-1 text-sm">
                {l.categoria_rotulo && (
                  <div>
                    <dt className="inline text-muted-foreground">Categoria: </dt>
                    <dd className="inline">{l.categoria_rotulo}</dd>
                  </div>
                )}
                {l.motivo && (
                  <div>
                    <dt className="inline text-muted-foreground">Motivo: </dt>
                    <dd className="inline">{l.motivo}</dd>
                  </div>
                )}
                {l.dificuldade && (
                  <div>
                    <dt className="inline text-muted-foreground">Relato do servidor: </dt>
                    <dd className="inline">{l.dificuldade}</dd>
                  </div>
                )}
              </dl>
            </Campo>
          )}

          {podeResponder ? (
            <>
              <Campo
                rotulo="Como o agente deveria responder"
                ajuda="Pronto para o servidor no WhatsApp, com a regra oficial (prazo, link, passo a passo). Vai para a curadoria antes de valer."
              >
                <Textarea rows={6} value={ideal} onChange={(e) => setIdeal(e.target.value)} placeholder="Ex.: O sorteio é para quem…" />
              </Campo>
              {transferiu && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={semTransferir} onChange={(e) => setSemTransferir(e.target.checked)} />
                  Com essa informação, o agente resolveria sem transferir
                </label>
              )}
              <Campo rotulo="Comentário para quem aprova" ajuda="Opcional: de onde vem a regra, até quando vale.">
                <Textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
              </Campo>
            </>
          ) : (
            l.avaliacao_id != null && (
              <p className="text-sm text-muted-foreground">
                Respondida: virou a avaliação #{l.avaliacao_id}, na{" "}
                <Link to="/calibracao" className="font-semibold text-primary hover:underline">
                  fila da Calibração
                </Link>
                .
              </p>
            )
          )}
        </div>
      )}
    </PainelLateral>
  );
}
