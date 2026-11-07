import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Link2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { usePode } from "@/hooks/use-permissoes";
import { Button } from "@/components/ui/button";

type LinkGestao = { ativo: boolean; caminho: string | null };

/**
 * O link da gestão (Visão geral só de leitura, sem login), pronto para copiar. Só para quem gerencia usuários:
 * quem tem o link vê os números agregados.
 */
export function BotaoLinkGestao() {
  const pode = usePode();
  const permitido = pode("gerenciar_usuarios");
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["link-gestao"], queryFn: () => api<LinkGestao>("/gestao-link"), enabled: permitido && aberto, staleTime: 60_000 });
  const url = q.data?.caminho ? `${window.location.origin}${q.data.caminho}` : null;

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => caixa.current && !caixa.current.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  if (!permitido) return null;

  async function copiar() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      toast.success("Link copiado. Quem tiver o link vê os números da Visão geral.");
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie com Ctrl+C.");
    }
  }

  return (
    <div ref={caixa} className="relative">
      <Button variant="outline" size="sm" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <Link2 /> Link da gestão
      </Button>
      {aberto && (
        <div className="vidro vidro-denso absolute top-full right-0 z-30 mt-2 w-[min(92vw,420px)] space-y-3 rounded-2xl p-4 shadow-2xl">
          <div>
            <div className="text-sm font-semibold">Link para a gestão</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Abre só os números desta Visão geral, sem login, sem menu e sem a comparação agente × humano. Não mostra nome, telefone
              nem texto de conversa. Quem tiver o link vê; para cortar o acesso, troque o código (PAINEL_LINK_GESTAO).
            </p>
          </div>
          {q.isLoading && <p className="text-xs text-muted-foreground">Buscando o link…</p>}
          {q.isError && <p className="text-xs text-destructive">{(q.error as Error).message}</p>}
          {q.data && !q.data.ativo && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-text">
              O link está desligado. Crie a variável <b>PAINEL_LINK_GESTAO</b> na DigitalOcean (um código aleatório com 24 caracteres ou
              mais) e espere o deploy.
            </p>
          )}
          {url && (
            <>
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Link da gestão"
                className="h-9 w-full rounded-lg border border-border/60 bg-background/60 px-2.5 font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={copiar}>
                  {copiado ? <Check /> : <Copy />} {copiado ? "Copiado" : "Copiar link"}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={url} target="_blank" rel="noopener">
                    <ExternalLink /> Abrir
                  </a>
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
