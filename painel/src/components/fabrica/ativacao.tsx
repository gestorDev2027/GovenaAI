import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { api, type AgenteFabrica, type Equipe } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePode } from "@/hooks/use-permissoes";

/**
 * Ativar, desativar e excluir agentes e equipes. Inativo para de atender em todo lugar (WhatsApp
 * inclusive); o agente inativo sai da distribuição das equipes, e o servidor remonta o coordenador na
 * hora. A exclusão é lógica e só vale para quem já está inativo (agente: só o criado no painel; ele sai
 * de todas as equipes). Quem está no Canal WhatsApp não pode ser desativado nem excluído.
 */

/** O que muda quando um agente liga, desliga ou some: listas, equipes, Central e chat de teste. */
function atualizarListas(qc: QueryClient, id: string) {
  qc.invalidateQueries({ queryKey: ["fabrica-agentes"] });
  qc.invalidateQueries({ queryKey: ["fabrica-equipes"] });
  qc.invalidateQueries({ queryKey: ["calibracao-opcoes"] });
  qc.invalidateQueries({ queryKey: ["config", id] });
  qc.invalidateQueries({ queryKey: ["central"] });
  qc.invalidateQueries({ queryKey: ["fabrica-canal"] }); // as opções do canal são os ativos
}

export function useAtivarAgente(aoGravar?: (a: AgenteFabrica) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api<AgenteFabrica>(`/fabrica/agentes/${encodeURIComponent(id)}/publicacao`, {
        method: "POST",
        body: JSON.stringify({ publicado: ativo }),
      }),
    onSuccess: (a) => {
      aoGravar?.(a);
      atualizarListas(qc, a.id);
      toast.success(a.publicado ? `${a.nome} ativado` : `${a.nome} desativado`, {
        description: a.publicado
          ? "Já atende, aparece na Central e entra na distribuição das equipes."
          : "Parou de atender, inclusive no WhatsApp, e saiu da distribuição das equipes. Dá para ativar de novo quando quiser.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível mudar a situação", { description: e.message }),
  });
}

export function useExcluirAgente(aoExcluir?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: AgenteFabrica) => api<void>(`/fabrica/agentes/${encodeURIComponent(a.id)}`, { method: "DELETE" }),
    onSuccess: (_, a) => {
      aoExcluir?.();
      atualizarListas(qc, a.id);
      toast.success(`${a.nome} excluído`, {
        description: "Saiu da fábrica e das equipes. As conversas antigas continuam mostrando quem atendeu.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });
}

/** Por que o interruptor está travado, ou undefined se não está. */
export function travaDoInterruptor(a: AgenteFabrica, podePublicar: boolean): string | undefined {
  if (!podePublicar) return "Sem a permissão Publicar";
  if (a.no_canal && a.publicado)
    return `${a.nome} está no Canal WhatsApp: troque lá quem atende ou quem recebe os leads antes de desativar.`;
  return undefined;
}

/** Por que o botão de excluir está desabilitado, ou undefined se dá para excluir. */
export function travaDaExclusao(a: AgenteFabrica, podeExcluir: boolean): string | undefined {
  if (!podeExcluir) return "Sem a permissão Excluir";
  if (a.origem !== "painel") return `${a.nome} vem do código: dá para desativar, não para excluir.`;
  if (a.publicado) return `Desative ${a.nome} antes de excluir.`;
  return undefined;
}

/** O interruptor em si: ligado, travado (com o motivo) e o clique. */
function Interruptor({
  ligado,
  nome,
  trava,
  ocupado,
  rotulo,
  feminino = false,
  aoMudar,
}: {
  ligado: boolean;
  nome: string;
  trava?: string;
  ocupado: boolean;
  rotulo: boolean;
  feminino?: boolean;
  aoMudar: () => void;
}) {
  const [ativo, inativo] = feminino ? ["Ativa", "Inativa"] : ["Ativo", "Inativo"];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={ligado ? `Desativar ${nome}` : `Ativar ${nome}`}
      title={trava ?? (ligado ? `${ativo}: clique para desativar` : `${inativo}: clique para ativar`)}
      disabled={!!trava || ocupado}
      onClick={aoMudar}
      className="inline-flex items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", ligado ? "bg-primary" : "bg-muted-foreground/30")}>
        <span
          className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform", ligado && "translate-x-4")}
        />
      </span>
      {rotulo && <span className={cn("font-medium", !ligado && "text-muted-foreground")}>{ligado ? ativo : inativo}</span>}
    </button>
  );
}

/** Interruptor Ativo/Inativo de um agente. Ativar um rascunho pela primeira vez é publicá-lo. */
export function InterruptorAtivo({
  agente,
  aoGravar,
  rotulo = false,
  desabilitado,
  motivo,
}: {
  agente: AgenteFabrica;
  aoGravar?: (a: AgenteFabrica) => void;
  /** Mostra "Ativo"/"Inativo" ao lado. */
  rotulo?: boolean;
  /** Trava extra de quem usa (ex.: alteração por salvar no editor). */
  desabilitado?: boolean;
  motivo?: string;
}) {
  const pode = usePode();
  const ativar = useAtivarAgente(aoGravar);
  const ligado = agente.publicado;
  return (
    <Interruptor
      ligado={ligado}
      nome={agente.nome}
      trava={travaDoInterruptor(agente, pode("publicar")) ?? (desabilitado ? motivo : undefined)}
      ocupado={ativar.isPending}
      rotulo={rotulo}
      aoMudar={() => {
        if (ligado && !window.confirm(`Desativar ${agente.nome}? Ele para de atender, inclusive no WhatsApp, e sai das equipes.`)) return;
        ativar.mutate({ id: agente.id, ativo: !ligado });
      }}
    />
  );
}

/* ───────── Equipes ───────── */

export function useAtivarEquipe(aoMudar?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ativa }: { id: string; ativa: boolean }) =>
      api<Equipe>(`/fabrica/equipes/${encodeURIComponent(id)}/publicacao`, { method: "POST", body: JSON.stringify({ publicado: ativa }) }),
    onSuccess: (e) => {
      aoMudar?.();
      atualizarListas(qc, e.id);
      toast.success(e.publicada ? `${e.nome} ativada` : `${e.nome} desativada`, {
        description: e.publicada
          ? "Já pode ser escolhida no Canal WhatsApp e aparece no chat de teste e na Central."
          : "Parou de atender. Dá para ativar de novo quando quiser.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível mudar a situação", { description: e.message }),
  });
}

export function useExcluirEquipe(aoExcluir?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (e: Equipe) => api<void>(`/fabrica/equipes/${encodeURIComponent(e.id)}`, { method: "DELETE" }),
    onSuccess: (_, e) => {
      aoExcluir?.();
      atualizarListas(qc, e.id);
      toast.success(`${e.nome} excluída`, { description: "Saiu da fábrica. As conversas antigas continuam no histórico." });
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });
}

export function travaDaEquipe(e: Equipe, podePublicar: boolean): string | undefined {
  if (!podePublicar) return "Sem a permissão Publicar";
  if (e.no_canal && e.publicada)
    return `${e.nome} está no Canal WhatsApp: troque lá quem atende ou quem recebe os leads antes de desativar.`;
  return undefined;
}

export function travaDaExclusaoDaEquipe(e: Equipe, podeExcluir: boolean): string | undefined {
  if (!podeExcluir) return "Sem a permissão Excluir";
  if (e.publicada) return `Desative ${e.nome} antes de excluir.`;
  if (e.no_canal) return `${e.nome} está no Canal WhatsApp: troque lá antes de excluir.`;
  return undefined;
}

/** Interruptor Ativa/Inativa de uma equipe. Ativar pela primeira vez é publicá-la. */
export function InterruptorEquipe({
  equipe,
  aoMudar,
  rotulo = false,
  desabilitado,
  motivo,
}: {
  equipe: Equipe;
  aoMudar?: () => void;
  rotulo?: boolean;
  desabilitado?: boolean;
  motivo?: string;
}) {
  const pode = usePode();
  const ativar = useAtivarEquipe(aoMudar);
  const ligada = equipe.publicada;
  return (
    <Interruptor
      ligado={ligada}
      nome={equipe.nome}
      feminino
      trava={travaDaEquipe(equipe, pode("publicar")) ?? (desabilitado ? motivo : undefined)}
      ocupado={ativar.isPending}
      rotulo={rotulo}
      aoMudar={() => {
        if (ligada && !window.confirm(`Desativar ${equipe.nome}? Ela para de atender.`)) return;
        ativar.mutate({ id: equipe.id, ativa: !ligada });
      }}
    />
  );
}

export function BotaoExcluirEquipe({
  equipe,
  aoExcluir,
  compacto = false,
}: {
  equipe: Equipe;
  aoExcluir?: () => void;
  compacto?: boolean;
}) {
  const pode = usePode();
  const excluir = useExcluirEquipe(aoExcluir);
  const trava = travaDaExclusaoDaEquipe(equipe, pode("excluir"));
  return (
    <Button
      variant="ghost"
      size={compacto ? "icon" : "sm"}
      className={cn("text-destructive hover:bg-destructive/10", compacto && "size-8")}
      title={trava ?? `Excluir ${equipe.nome}`}
      aria-label={`Excluir ${equipe.nome}`}
      disabled={!!trava || excluir.isPending}
      onClick={() => window.confirm(`Excluir ${equipe.nome}? As conversas antigas continuam no histórico.`) && excluir.mutate(equipe)}
    >
      <Trash2 />
      {!compacto && "Excluir equipe"}
    </Button>
  );
}

/** Botão de excluir, com confirmação. */
export function BotaoExcluirAgente({
  agente,
  aoExcluir,
  compacto = false,
}: {
  agente: AgenteFabrica;
  aoExcluir?: () => void;
  compacto?: boolean;
}) {
  const pode = usePode();
  const excluir = useExcluirAgente(aoExcluir);
  const trava = travaDaExclusao(agente, pode("excluir"));
  const confirmar = () => {
    if (window.confirm(`Excluir ${agente.nome}? Ele sai da fábrica e de todas as equipes. As conversas antigas continuam no histórico.`))
      excluir.mutate(agente);
  };
  return (
    <Button
      variant="ghost"
      size={compacto ? "icon" : "sm"}
      className={cn("text-destructive hover:bg-destructive/10", compacto && "size-8")}
      title={trava ?? `Excluir ${agente.nome}`}
      aria-label={`Excluir ${agente.nome}`}
      disabled={!!trava || excluir.isPending}
      onClick={confirmar}
    >
      <Trash2 />
      {!compacto && "Excluir agente"}
    </Button>
  );
}
