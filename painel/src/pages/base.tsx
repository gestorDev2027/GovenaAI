import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { BookOpen, Check, FileText, History, Layers, Library, X } from "lucide-react";
import { AGENTE_PADRAO, api, type Base } from "@/lib/api";
import { fmtDataHora, fmtInt } from "@/lib/formato";
import { dividir, tipoDaSecao } from "@/lib/roteiro";
import { cn } from "@/lib/utils";
import { Abas, EmptyState, PageHeader, PageLoader, Pills } from "@/components/widgets/widgets";
import { useAgentes } from "@/hooks/use-agentes";
import { Documentos } from "@/components/conhecimento/documentos";
import { TabelaBases } from "@/components/conhecimento/bases";
import { chaveBase, TabelaHistorico, TabelaSecoes } from "@/components/conhecimento/roteiro";

type Aba = "roteiro" | "documentos" | "historico" | "bases";

/** As mensagens que o sistema envia a partir do roteiro; sem a seção, a mensagem não sai. */
const MENSAGENS = ["Boas-vindas", "Encerramento por inatividade", "Pedido fora do atendimento"];

/**
 * Base de conhecimento de cada agente: o roteiro de atendimento, seção por seção numa tabela (cada uma
 * se edita num painel lateral), os documentos de referência e o histórico de versões.
 */
export function BaseConhecimento() {
  const navigate = useNavigate();
  const pedido = useSearch({ from: "/protegido/painel/base" });
  const agentes = useAgentes();
  const agente = pedido.agente ?? AGENTE_PADRAO;
  const [aba, setAba] = useState<Aba>("roteiro");
  const base = useQuery({ queryKey: chaveBase(agente), queryFn: () => api<Base>(`/base?agente=${encodeURIComponent(agente)}`) });

  const nomeAgente = agentes.find((a) => a.id === agente)?.nome ?? agente;
  const roteiro = useMemo(() => (base.data ? dividir(base.data.conteudo) : null), [base.data]);
  const titulos = new Set(
    roteiro?.secoes.filter((s) => tipoDaSecao(s.titulo) === "mensagem").map((s) => s.titulo.trim().toLowerCase()) ?? [],
  );

  return (
    <div className="space-y-5 px-4 pb-8 sm:px-8">
      <PageHeader
        title="Base de conhecimento"
        icon={BookOpen}
        description="O roteiro de atendimento de cada agente, seção por seção, e os documentos de referência. Salvar muda as respostas na hora."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Pills
          rotulo="Agente"
          value={agente}
          onChange={(id) => navigate({ to: "/base", search: { agente: id }, replace: true })}
          options={[
            ...agentes.map((a) => ({ value: a.id, label: a.nome })),
            // Um rascunho da fábrica ainda não está na lista dos publicados.
            ...(agentes.some((a) => a.id === agente) ? [] : [{ value: agente, label: agente }]),
          ]}
        />
        <span className="text-xs text-muted-foreground">Cada agente tem o próprio roteiro e os próprios documentos.</span>
      </div>

      {base.isLoading && <PageLoader className="h-[50vh]" label="Carregando a base" />}
      {base.isError && (
        <div className="surface-card">
          <EmptyState title="Não foi possível carregar a base">{(base.error as Error).message}</EmptyState>
        </div>
      )}

      {base.data && roteiro && (
        <>
          {/* Resumo do roteiro em uso (some na aba das bases compartilhadas, que não são de um agente) */}
          <div className={cn("surface-card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5 text-sm", aba === "bases" && "hidden")}>
            <Resumo rotulo="Versão em uso" valor={base.data.origem === "arquivo" ? "Texto padrão" : `Versão ${base.data.versao}`} />
            <Resumo rotulo="Salva em" valor={base.data.origem === "arquivo" ? "repositório" : fmtDataHora(base.data.atualizado_em)} />
            <Resumo rotulo="Seções" valor={fmtInt(roteiro.secoes.length)} />
            <Resumo rotulo="Caracteres" valor={fmtInt(base.data.conteudo.length)} />
            <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
              <span className="mr-1 text-xs text-muted-foreground">Mensagens automáticas</span>
              {MENSAGENS.map((m) => {
                const tem = titulos.has(m.toLowerCase());
                return (
                  <span
                    key={m}
                    title={tem ? "A seção existe: o sistema envia esta mensagem." : "Sem a seção, o sistema não envia esta mensagem."}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      tem ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
                    )}
                  >
                    {tem ? <Check className="size-3" /> : <X className="size-3" />} {m}
                  </span>
                );
              })}
            </div>
          </div>

          <Abas
            rotulo="Base de conhecimento"
            valor={aba}
            onTrocar={setAba}
            abas={[
              { id: "roteiro", label: "Roteiro", icone: Layers, n: roteiro.secoes.length },
              { id: "documentos", label: "Documentos", icone: FileText },
              { id: "historico", label: "Histórico", icone: History },
              { id: "bases", label: "Bases compartilhadas", icone: Library },
            ]}
          />

          {aba === "roteiro" && (
            <TabelaSecoes key={agente} agente={agente} base={base.data} nomeAgente={nomeAgente} />
          )}
          {aba === "documentos" && <Documentos agente={agente} />}
          {aba === "historico" && <TabelaHistorico agente={agente} />}
          {aba === "bases" && <TabelaBases />}
        </>
      )}
    </div>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[11px] text-muted-foreground">{rotulo}</div>
      <div className="num font-semibold">{valor}</div>
    </div>
  );
}
