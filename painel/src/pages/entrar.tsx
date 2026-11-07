import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, LogIn, UserPlus } from "lucide-react";
import { api, salvarChave, type Acesso, type Usuario } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { carregarGsi } from "@/components/layout/access-gate";
import { CascaPublica } from "@/components/publico/casca";

/** Para onde vai quem acabou de entrar: implantação (ainda montando ou aguardando aprovação) ou o Painel. */
export async function destinoDepoisDeEntrar(): Promise<"/implantacao" | "/"> {
  const acesso = await api<Acesso>("/acesso");
  if (acesso.usuario?.situacao !== "ativo") return "/implantacao";
  const dela = await api<{ panorama: { municipio: { situacao: string | null } } | null }>("/implantacao").catch(() => null);
  const situacao = dela?.panorama?.municipio?.situacao;
  return dela && situacao !== "ativo" && dela.panorama ? "/implantacao" : "/";
}

export function Entrar() {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const acesso = useQuery({ queryKey: ["acesso"], queryFn: () => api<Acesso>("/acesso"), staleTime: Infinity });
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const botaoGoogle = useRef<HTMLDivElement>(null);
  const clientId = acesso.data?.google_client_id;

  useEffect(() => {
    document.title = "Entrar · GestorGov";
  }, []);

  async function seguir() {
    await qc.refetchQueries({ queryKey: ["acesso"] });
    navegar({ to: await destinoDepoisDeEntrar() });
  }

  useEffect(() => {
    if (!clientId || !botaoGoogle.current) return;
    const alvo = botaoGoogle.current;
    carregarGsi()
      .then((gsi) => {
        gsi.accounts.id.initialize({
          client_id: clientId,
          ux_mode: "popup",
          callback: async ({ credential }) => {
            setErro(null);
            setEnviando(true);
            try {
              await api<Usuario>("/login/google", { method: "POST", body: JSON.stringify({ credencial: credential }) });
              await seguir();
            } catch (e) {
              setErro(e instanceof Error ? e.message : "Não foi possível entrar com o Google.");
            } finally {
              setEnviando(false);
            }
          },
        });
        alvo.replaceChildren();
        gsi.accounts.id.renderButton(alvo, { theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: 320, locale: "pt-BR" });
      })
      .catch(() => setErro("Não foi possível carregar o login do Google. Use o e-mail e a senha."));
    // seguir muda a cada render; o botão do Google é desenhado uma vez por client id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api("/login/senha", { method: "POST", body: JSON.stringify({ email: email.trim(), senha }) });
      await seguir();
    } catch (falha) {
      setErro(falha instanceof Error && falha.message !== "Chave de acesso inválida ou ausente." ? falha.message : "E-mail ou senha não conferem.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <CascaPublica>
      <FormularioCentral titulo="Entrar no GestorGov" descricao="Use o e-mail e a senha da sua conta.">
        {acesso.data && !acesso.data.aceita_senha && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-text">
            O login com senha não está ligado neste servidor (falta a OS_SECURITY_KEY).
          </p>
        )}
        <form onSubmit={entrar} className="space-y-4">
          <Campo id="email" rotulo="E-mail">
            <Input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
          </Campo>
          <Campo id="senha" rotulo="Senha">
            <Input
              id="senha"
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="h-10"
            />
          </Campo>
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={enviando || !email.trim() || !senha}>
            {enviando ? <Loader2 className="animate-spin" /> : <LogIn />}
            Entrar
          </Button>
        </form>
        {clientId && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
            </div>
            <div ref={botaoGoogle} className="flex min-h-11 justify-center" />
          </div>
        )}
        <p className="text-center text-sm text-muted-foreground">
          Ainda não tem conta?{" "}
          <Link to="/cadastro" className="inline-flex items-center gap-1 font-semibold text-primary-text hover:underline">
            <UserPlus className="size-3.5" /> Cadastrar prefeitura
          </Link>
        </p>
        {acesso.data?.aceita_chave && <EntrarComChave aoEntrar={() => navegar({ to: "/" })} />}
      </FormularioCentral>
    </CascaPublica>
  );
}

/** Entrada da equipe técnica com a chave do AgentOS (rotinas, suporte). Fica recolhida. */
function EntrarComChave({ aoEntrar }: { aoEntrar: () => void }) {
  const qc = useQueryClient();
  const [chave, setChave] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    salvarChave(chave.trim());
    try {
      await api("/config");
      qc.clear();
      aoEntrar();
    } catch {
      salvarChave("");
      setErro("Chave incorreta.");
    }
  }
  return (
    <details className="rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">Equipe técnica: entrar com a chave de acesso</summary>
      <form onSubmit={enviar} className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <KeyRound className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="password" aria-label="Chave de acesso" placeholder="OS_SECURITY_KEY" className="h-9 pl-9" value={chave} onChange={(e) => setChave(e.target.value)} />
        </div>
        <Button type="submit" variant="outline" disabled={!chave.trim()}>
          Entrar
        </Button>
      </form>
      {erro && <p className="mt-2 text-xs text-destructive">{erro}</p>}
    </details>
  );
}

export function FormularioCentral({ titulo, descricao, children }: { titulo: string; descricao: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <div className="surface-card has-waves space-y-5 p-6 sm:p-8">
        <div>
          <h1 className="text-xl font-bold">{titulo}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Campo({ id, rotulo, ajuda, children }: { id: string; rotulo: string; ajuda?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo}
      </label>
      {children}
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}
