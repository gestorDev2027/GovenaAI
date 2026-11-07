import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Loader2, Moon, Sun } from "lucide-react";
import { api, type Indicadores } from "@/lib/api";
import { ContextoGestao } from "@/lib/gestao";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { LogoMarca } from "@/components/layout/logo";
import { EmptyState, PageHeader, PageLoader, Pills } from "@/components/widgets/widgets";
import { ConteudoGestao, PERIODOS } from "@/pages/visao-geral";

/**
 * O link da gestão (/painel/gestao/<código>): a Visão geral só de leitura, sem login, sem menu e sem painéis
 * laterais. O servidor só responde com o código certo (PAINEL_LINK_GESTAO) e devolve só números agregados.
 */
export function PainelGestao() {
  const { codigo } = useParams({ strict: false }) as { codigo: string };
  const { theme, toggle } = useTheme();
  const [dias, setDias] = useState(30);
  const q = useQuery({
    queryKey: ["gestao-indicadores", codigo, dias],
    queryFn: () => api<Indicadores>(`/gestao/${encodeURIComponent(codigo)}/indicadores?dias=${dias}`),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const trocando = q.isPlaceholderData && q.isFetching;
  const rotuloPeriodo = PERIODOS.find((p) => p.value === dias)?.label ?? `${dias} dias`;

  return (
    <ContextoGestao.Provider value={codigo}>
      <div className="bi-shell relative min-h-svh w-full bg-background text-foreground">
        <div className="aurora-bg" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1600px] space-y-5 px-4 pb-10 sm:px-8">
          <PageHeader
            title="Atendimento dos agentes"
            icon={LayoutDashboard}
            description={`Retenção, desfechos e transferências do atendimento pelos agentes${
              q.dataUpdatedAt ? ` · números de ${new Date(q.dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}, atualizados a cada minuto` : ""
            }.`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Pills options={PERIODOS} value={dias} onChange={setDias} rotulo="Período" />
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={theme === "dark" ? "Usar o tema claro" : "Usar o tema escuro"}
                  className="grid size-9 place-items-center rounded-full border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </button>
                <LogoMarca className="hidden h-6 sm:block" />
              </div>
            }
          />

          {q.isLoading && <PageLoader className="h-[60vh]" label="Montando o painel" />}
          {q.isError && (
            <div className="surface-card">
              <EmptyState title="Não foi possível abrir este painel">
                {(q.error as Error).message} Confira o link com quem o enviou.
              </EmptyState>
            </div>
          )}
          {trocando && (
            <div className="sticky top-[72px] z-10 mx-auto flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-card/90 px-4 py-1.5 text-xs font-medium shadow-lg backdrop-blur">
              <Loader2 className="size-3.5 animate-spin text-primary-text" />
              Atualizando para {rotuloPeriodo}…
            </div>
          )}
          <div className={cn("space-y-5 transition-opacity", trocando && "pointer-events-none opacity-50")}>
            {q.data && <ConteudoGestao dados={q.data} periodo={rotuloPeriodo} />}
          </div>
        </div>
      </div>
    </ContextoGestao.Provider>
  );
}
