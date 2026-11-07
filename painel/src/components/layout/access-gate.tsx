import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Clock3, KeyRound, Loader2, LogOut } from "lucide-react";
import { api, EVENTO_SEM_ACESSO, lerChave, sair, salvarChave, type Acesso, type Usuario } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { PageLoader } from "@/components/widgets/widgets";
import { Brand } from "./app-shell";

/* Google Identity Services (https://accounts.google.com/gsi/client): só o que usamos. */
interface Gsi {
  accounts: {
    id: {
      initialize(opcoes: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: "popup" }): void;
      renderButton(
        elemento: HTMLElement,
        opcoes: { theme?: string; size?: string; text?: string; shape?: string; width?: number; locale?: string },
      ): void;
      disableAutoSelect(): void;
    };
  };
}
declare global {
  interface Window {
    google?: Gsi;
  }
}

let carregandoGsi: Promise<Gsi> | null = null;

function carregarGsi(): Promise<Gsi> {
  if (window.google) return Promise.resolve(window.google);
  carregandoGsi ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error("GSI indisponível")));
    script.onerror = () => {
      carregandoGsi = null;
      reject(new Error("GSI indisponível"));
    };
    document.head.appendChild(script);
  });
  return carregandoGsi;
}

/**
 * Entrada do painel quando o servidor exige acesso. Com PAINEL_GOOGLE_CLIENT_ID no servidor, as pessoas
 * entram com o Google (só e-mails da empresa); o campo da chave do AgentOS só aparece quando o servidor
 * ainda a aceita (aceita_chave). Quem entra pela primeira vez fica pendente até o dono aprovar; quem foi
 * bloqueado vê o aviso. Qualquer 401 posterior volta para esta tela.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const acesso = useQuery({ queryKey: ["acesso"], queryFn: () => api<Acesso>("/acesso"), staleTime: Infinity });
  const [liberado, setLiberado] = useState(false);
  const [chave, setChave] = useState("");
  const [usarChave, setUsarChave] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [testando, setTestando] = useState(false);
  const botaoGoogle = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const semAcesso = () => {
      salvarChave("");
      setLiberado(false);
      qc.invalidateQueries({ queryKey: ["acesso"] });
    };
    window.addEventListener(EVENTO_SEM_ACESSO, semAcesso);
    return () => window.removeEventListener(EVENTO_SEM_ACESSO, semAcesso);
  }, [qc]);

  useEffect(() => {
    if (!acesso.data) return;
    if (!acesso.data.requer_chave || acesso.data.usuario || lerChave()) setLiberado(true);
  }, [acesso.data]);

  const clientId = acesso.data?.google_client_id;
  useEffect(() => {
    if (liberado || !clientId || usarChave || !botaoGoogle.current) return;
    const alvo = botaoGoogle.current;
    carregarGsi()
      .then((gsi) => {
        gsi.accounts.id.initialize({
          client_id: clientId,
          ux_mode: "popup",
          callback: async ({ credential }) => {
            setErro(null);
            setTestando(true);
            try {
              await api<Usuario>("/login/google", {
                method: "POST",
                body: JSON.stringify({ credencial: credential }),
              });
              // O /acesso traz a situação e as permissões de quem acabou de entrar.
              await qc.refetchQueries({ queryKey: ["acesso"] });
              setLiberado(true);
            } catch (e) {
              setErro(e instanceof Error ? e.message : "Não foi possível entrar.");
            } finally {
              setTestando(false);
            }
          },
        });
        alvo.replaceChildren();
        gsi.accounts.id.renderButton(alvo, {
          theme: "filled_black",
          size: "large",
          text: "signin_with",
          shape: "pill",
          width: 320,
          locale: "pt-BR",
        });
      })
      .catch(() => setErro("Não foi possível carregar o login do Google. Recarregue a página ou use a chave."));
  }, [liberado, clientId, usarChave, qc]);

  async function entrarComChave(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setTestando(true);
    salvarChave(chave.trim());
    try {
      await api("/config");
      qc.clear();
      setLiberado(true);
    } catch {
      salvarChave("");
      setErro("Chave incorreta. Use a mesma OS_SECURITY_KEY configurada no servidor.");
    } finally {
      setTestando(false);
    }
  }

  if (acesso.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <PageLoader className="h-64 w-full max-w-md" label="Conectando" />
      </div>
    );
  }
  if (acesso.isError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center text-sm text-muted-foreground">
        Não foi possível falar com o servidor do agente. Confira se ele está no ar e recarregue a página.
      </div>
    );
  }
  const usuario = acesso.data?.usuario;
  if (liberado && usuario?.situacao === "pendente")
    return (
      <Aviso titulo="Seu acesso está aguardando aprovação" icone={<Clock3 className="size-5" />}>
        O dono do painel precisa aprovar o seu e-mail ({usuario.email}) e definir o que você pode fazer. Assim que isso acontecer, recarregue a
        página.
      </Aviso>
    );
  if (liberado && usuario?.situacao === "bloqueado")
    return (
      <Aviso titulo="Seu acesso ao painel foi bloqueado" icone={<Ban className="size-5" />}>
        Se acha que é um engano, fale com o dono do painel.
      </Aviso>
    );
  if (liberado) return <>{children}</>;

  // Com aceita_chave false, o Google é o único caminho: nada de campo de chave.
  const aceitaChave = acesso.data?.aceita_chave !== false;
  const comGoogle = Boolean(clientId) && (!usarChave || !aceitaChave);

  return (
    <div className="bi-shell grid min-h-dvh place-items-center p-6">
      <div className="aurora-bg bi-canvas" aria-hidden="true" />
      <div className="surface-card has-waves rise w-full max-w-md space-y-5 p-7">
        <Brand />
        {comGoogle ? (
          <>
            <div>
              <h1 className="text-xl font-bold">Entrar no painel</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                O painel mostra dados da gestão da saúde. Entre com a sua conta Google institucional; o primeiro acesso espera a aprovação do administrador.
              </p>
            </div>
            <div className="flex min-h-11 items-center justify-center">
              {/* Fica sempre montado: o Google desenha o botão aqui uma vez só. */}
              <div ref={botaoGoogle} className={testando ? "hidden" : undefined} />
              {testando && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            {aceitaChave && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  setErro(null);
                  setUsarChave(true);
                }}
              >
                Entrar com a chave de acesso do AgentOS
              </button>
            )}
          </>
        ) : (
          <form onSubmit={entrarComChave} className="space-y-5">
            <div>
              <h1 className="text-xl font-bold">Chave de acesso</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                O painel mostra conversas de servidores. Informe a chave de acesso do agente (a mesma usada no
                AgentOS) para continuar.
              </p>
            </div>
            <div className="relative">
              <KeyRound className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                autoFocus
                placeholder="OS_SECURITY_KEY"
                className="h-10 pl-9"
                value={chave}
                onChange={(e) => setChave(e.target.value)}
              />
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <Button type="submit" className="w-full" size="lg" disabled={!chave.trim() || testando}>
              {testando && <Loader2 className="animate-spin" />}
              Entrar
            </Button>
            <p className="text-xs text-muted-foreground">
              A chave fica salva só neste navegador.
              {clientId && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline-offset-4 hover:underline"
                    onClick={() => {
                      setErro(null);
                      setUsarChave(false);
                    }}
                  >
                    Voltar para o login com Google
                  </button>
                </>
              )}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

/** Tela de aviso no lugar do painel (acesso pendente ou bloqueado), com o botão de sair. */
function Aviso({ titulo, icone, children }: { titulo: string; icone: ReactNode; children: ReactNode }) {
  return (
    <div className="bi-shell grid min-h-dvh place-items-center p-6">
      <div className="aurora-bg bi-canvas" aria-hidden="true" />
      <div className="surface-card rise w-full max-w-md space-y-5 p-7">
        <Brand />
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary-text">{icone}</span>
          <div>
            <h1 className="text-lg font-bold">{titulo}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{children}</p>
          </div>
        </div>
        <Button variant="outline" className="w-full" onClick={() => sair()}>
          <LogOut /> Sair
        </Button>
      </div>
    </div>
  );
}
